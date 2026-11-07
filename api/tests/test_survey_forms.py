"""
A paper survey photographed at the desk is kept with the record, as it
is. Nothing on it is read, so no detector, no agent and no value is
involved, and the clinician sees the photograph itself.
"""

from collections.abc import Iterator
from typing import Any

import psycopg
import pytest

from healthathon.uploads.factory import set_agent, set_detector
from healthathon.uploads.jobs import registry
from tests.fakes import page_image, upload
from tests.helpers import patient_id


class Untouchable:
    """A detector or agent that fails the test if anything asks it to read."""

    name = "untouchable"
    version = "0"

    def detect(self, *_: Any) -> Any:
        raise AssertionError("a survey form was sent to the detector")

    def read(self, *_: Any) -> Any:
        raise AssertionError("a survey form was sent to the agent")


@pytest.fixture(autouse=True)
def _nothing_reads() -> Iterator[None]:
    set_detector(Untouchable())  # type: ignore[arg-type]
    set_agent(Untouchable())  # type: ignore[arg-type]
    registry().clear()
    yield
    set_detector(None)
    set_agent(None)


def test_a_survey_form_is_kept_without_being_read(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0001")

    res = upload(client, pid, page_image(), doc_type="survey_form")

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["stage"] == "done"
    assert body["outcome"]["values_in_record"] == 0
    assert body["outcome"]["sent_to_queue"] == []
    doc = db.execute(
        "SELECT doc_type::text AS doc_type, page_count FROM core.document WHERE id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert doc == {"doc_type": "survey_form", "page_count": 1}
    runs = db.execute(
        "SELECT count(*) AS n FROM core.extraction_run WHERE document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert runs == {"n": 0}


def test_a_survey_form_appears_on_the_record_with_its_photograph(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    res = upload(client, pid, page_image(), doc_type="survey_form")
    document_id = res.json()["outcome"]["document_id"]

    record = client.get(f"/api/patients/{pid}/record").json()

    [form] = record["survey_forms"]
    assert form["id"] == document_id
    assert form["width_px"] == 1240 and form["height_px"] == 1754
    assert client.get(form["url"]).status_code == 200
    assert all(d["id"] != document_id for d in record["documents"])


def test_the_same_survey_photograph_twice_is_one_document(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    data = page_image()
    upload(client, pid, data, capture="cap-a", doc_type="survey_form")

    second = upload(client, pid, data, capture="cap-b", doc_type="survey_form")

    assert second.json()["stage"] == "duplicate"
    count = db.execute(
        "SELECT count(*) AS n FROM core.document WHERE doc_type = 'survey_form'"
    ).fetchone()
    assert count == {"n": 1}


def test_the_upload_of_a_survey_form_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0001")
    upload(client, pid, page_image(), doc_type="survey_form")

    row = db.execute(
        "SELECT new_value->>'doc_type' AS doc_type FROM audit.event"
        " WHERE action = 'document.upload' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row == {"doc_type": "survey_form"}


def test_a_patient_without_survey_forms_has_none(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0002")
    assert client.get(f"/api/patients/{pid}/record").json()["survey_forms"] == []
