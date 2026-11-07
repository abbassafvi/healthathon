"""
A page the patient photographs, and what it does to both sides.

The pipeline is the same one the desk uses, so these cover what is new:
the patient's door into it, that the reading lands on the clinician's
record for that patient, and that nothing a clinician has not settled is
presented to the patient as settled.
"""

import time
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest

from healthathon.uploads.agent import Advice, DocumentReading, LabValue, RegimenLine
from healthathon.uploads.detector import Box
from healthathon.uploads.factory import set_agent, set_detector
from healthathon.uploads.jobs import registry
from tests.fakes import FakeAgent, FakeDetector, page_image
from tests.helpers import patient_id

BOXES = [
    Box(0.10, 0.08, 0.60, 0.03),
    Box(0.10, 0.15, 0.60, 0.03),
    Box(0.10, 0.22, 0.60, 0.03),
]


@pytest.fixture(autouse=True)
def _reader() -> Iterator[None]:
    set_detector(FakeDetector(BOXES))
    registry().clear()
    yield
    set_detector(None)
    set_agent(None)


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def send(client: Any, pid: str, reading: Any, **over: Any) -> dict[str, Any]:
    """Photograph a page on the phone and wait for the read to finish."""
    set_agent(FakeAgent(reading))
    params = {
        "capture_id": over.pop("capture", "phone-cap-1"),
        "doc_type": over.pop("doc_type", "prescription"),
    }
    params.update({k: str(v) for k, v in over.items()})
    res = client.post(
        f"/api/app/patients/{pid}/documents",
        params=params,
        content=page_image(),
        headers={"Content-Type": "image/png"},
    )
    assert res.status_code == 201, res.text
    upload_id = res.json()["id"]
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        body = client.get(f"/api/app/patients/{pid}/uploads/{upload_id}").json()
        if body["stage"] in ("done", "duplicate", "failed"):
            return dict(body)
        time.sleep(0.05)
    raise AssertionError(f"upload {upload_id} did not finish: {body}")


RX = DocumentReading(
    lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")],
    advice=[Advice(1, "Walk 30 minutes daily")],
)


def test_a_page_from_the_phone_is_read(client: Any, pid: str) -> None:
    body = send(client, pid, RX)
    assert body["stage"] == "done", body
    assert body["document_id"] is not None


def test_a_page_from_the_phone_lands_on_the_clinicians_record(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    """The point of the feature: one record, not a second place to look."""
    before = next(
        p["documents"] for p in client.get("/api/patients").json() if p["id"] == pid
    )
    send(client, pid, RX)
    after = next(p for p in client.get("/api/patients").json() if p["id"] == pid)
    assert after["documents"] == before + 1
    row = db.execute(
        "SELECT i.channel::text AS channel, i.uploaded_by FROM core.intake i"
        " JOIN core.document d ON d.intake_id = i.id WHERE d.patient_id = %s"
        " ORDER BY i.received_at DESC LIMIT 1",
        (pid,),
    ).fetchone()
    assert row is not None
    # No clinic user touched this page, so the audit names none.
    assert (row["channel"], row["uploaded_by"]) == ("patient_app", None)


def test_the_medicines_read_off_the_phone_reach_the_clinics_review(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    body = send(client, pid, RX)
    drugs = db.execute(
        "SELECT ri.drug_text FROM core.regimen_item ri JOIN core.regimen r"
        " ON r.id = ri.regimen_id WHERE r.source_document_id = %s",
        (body["document_id"],),
    ).fetchall()
    assert [r["drug_text"] for r in drugs] == ["Tab. Metformin"]
    reading = client.get(f"/api/documents/{body['document_id']}/reading")
    assert reading.status_code == 200, reading.text


def test_the_patient_sees_the_medicines_read_off_their_own_page(
    client: Any, pid: str
) -> None:
    body = send(client, pid, RX)
    doc = client.get(f"/api/app/patients/{pid}/documents/{body['document_id']}").json()
    assert [line["drug_text"] for line in doc["lines"]] == ["Tab. Metformin"]
    assert [a["text"] for a in doc["advice"]] == ["Walk 30 minutes daily"]
    assert doc["sent_from"] == "patient_app"
    assert doc["page_uri"] is not None


def test_a_line_no_clinician_settled_is_marked_unchecked(client: Any, pid: str) -> None:
    """
    The patient is shown the reading, and told nobody has checked it.
    Presenting an unchecked reading as a fact about a medicine is the
    thing the assistive boundary exists to prevent.
    """
    body = send(client, pid, RX)
    doc = client.get(f"/api/app/patients/{pid}/documents/{body['document_id']}").json()
    assert doc["lines"][0]["checked"] is False


def test_an_unsettled_laboratory_number_has_no_text_for_the_patient(
    client: Any, pid: str
) -> None:
    """
    proj.renderable_value admits only accepted and confirmed values and is
    the only view a value may be read from. An unsettled number therefore
    reaches nobody, the patient included.
    """
    reading = DocumentReading(values=[LabValue(0, "hba1c", "7.4", "%")], ungrounded=[0])
    body = send(client, pid, reading, doc_type="lab_report", capture="phone-cap-lab")
    doc = client.get(f"/api/app/patients/{pid}/documents/{body['document_id']}").json()
    assert [v["value_text"] for v in doc["values"]] == [None]
    assert [v["checked"] for v in doc["values"]] == [False]


def test_a_page_the_clinic_scanned_is_listed_for_the_patient_too(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    from tests.fakes import upload, wait_for

    set_agent(FakeAgent(RX))
    sent = upload(client, pid, page_image(), doc_type="prescription", capture="desk-cap-1")
    wait_for(client, sent.json()["id"])
    listed = client.get(f"/api/app/patients/{pid}/documents").json()
    assert any(d["sent_from"] == "desk_scan" for d in listed), listed


def test_the_clinician_sees_which_door_the_page_came_in_by(client: Any, pid: str) -> None:
    """
    A clinician settling a line should know whether the page was
    photographed at the desk or sent from the patient's phone.
    """
    body = send(client, pid, RX)
    reading = client.get(f"/api/documents/{body['document_id']}/reading").json()
    assert reading["document"]["sent_from"] == "patient_app", reading["document"]


def test_the_same_photograph_sent_twice_is_read_once(client: Any, pid: str) -> None:
    send(client, pid, RX)
    again = send(client, pid, RX, capture="phone-cap-2")
    assert again["stage"] == "duplicate", again


def test_another_patients_document_is_not_served(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    body = send(client, pid, RX)
    other = patient_id(db, "DEV-0002")
    res = client.get(f"/api/app/patients/{other}/documents/{body['document_id']}")
    assert res.status_code == 404, res.text
    page = client.get(f"/api/app/patients/{other}/documents/{body['document_id']}/page")
    assert page.status_code == 404, page.text


def test_an_empty_photograph_is_refused(client: Any, pid: str) -> None:
    res = client.post(
        f"/api/app/patients/{pid}/documents",
        params={"capture_id": "phone-cap-9", "doc_type": "prescription"},
        content=b"",
        headers={"Content-Type": "image/png"},
    )
    assert res.status_code == 422, res.text
