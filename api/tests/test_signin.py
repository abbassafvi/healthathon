import base64
import io
import json
import time
import urllib.error
import urllib.parse
from typing import Any

import psycopg
import pytest

from healthathon.config import get_settings
from healthathon.patient_app import signin
from tests.helpers import patient_id, verify_audit_chain

ASHA_PHONE = "55500 00001"  # the seed's fictional number for DEV-0001


def _start(c: Any, phone: str = ASHA_PHONE) -> Any:
    return c.post("/api/app/sign-in/start", json={"phone": phone})


def _check(c: Any, code: str, phone: str = ASHA_PHONE) -> Any:
    return c.post("/api/app/sign-in/check", json={"phone": phone, "code": code})


def test_a_phone_on_record_signs_in_with_the_code_sent_to_it(
    unsigned_client: Any, db: psycopg.Connection[Any]
) -> None:
    code = _start(unsigned_client).json()["demo_code"]
    assert code and len(code) == 6
    res = _check(unsigned_client, code)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["patient"]["registration_no"] == "DEV-0001"
    today = unsigned_client.get(f"/api/app/patients/{body['patient']['id']}/today",
                                headers={"Authorization": f"Bearer {body['token']}"})  # fmt: skip
    assert today.status_code == 200
    assert [r["action"] for r in verify_audit_chain(db)] == ["patient.sign_in"]


def test_a_code_works_once(unsigned_client: Any) -> None:
    code = _start(unsigned_client).json()["demo_code"]
    assert _check(unsigned_client, code).status_code == 200
    assert _check(unsigned_client, code).status_code == 401


def test_wrong_codes_run_out_and_then_the_right_one_fails_too(unsigned_client: Any) -> None:
    code = _start(unsigned_client).json()["demo_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(signin.MAX_TRIES):
        assert _check(unsigned_client, wrong).status_code == 401
    assert _check(unsigned_client, code).status_code == 401


def test_a_code_runs_out_after_ten_minutes(unsigned_client: Any, monkeypatch: Any) -> None:
    code = _start(unsigned_client).json()["demo_code"]
    later = time.time() + signin.CODE_SECONDS + 1
    monkeypatch.setattr(signin.time, "time", lambda: later)
    assert _check(unsigned_client, code).status_code == 401


def test_an_unknown_number_gets_no_code_and_the_same_answer(unsigned_client: Any) -> None:
    res = _start(unsigned_client, "98765 43210")
    assert res.status_code == 200 and res.json() == {"demo_code": None}
    assert _check(unsigned_client, "123456", "98765 43210").status_code == 401
    assert _start(unsigned_client, "not a phone").status_code == 422


def test_codes_to_one_number_are_limited_each_hour(unsigned_client: Any) -> None:
    for _ in range(get_settings().otp_sends_per_hour):
        assert _start(unsigned_client).status_code == 200
    assert _start(unsigned_client).status_code == 429


def test_tests_can_fix_the_code(unsigned_client: Any, monkeypatch: Any) -> None:
    fixed = get_settings().model_copy(update={"otp_test_code": "246810"})
    monkeypatch.setattr(signin, "get_settings", lambda: fixed)
    assert _start(unsigned_client).json()["demo_code"] == "246810"
    assert _check(unsigned_client, "246810").status_code == 200


def test_every_patient_route_needs_that_patients_token(
    unsigned_client: Any, db: psycopg.Connection[Any]
) -> None:
    asha, imran = patient_id(db, "DEV-0001"), patient_id(db, "DEV-0002")
    gets = ["today", "survey", "days"]
    posts = ["answers", "meals", "recordings", "readings", "survey"]
    base = f"/api/app/patients/{asha}"
    routes = [("get", f"{base}/{r}") for r in gets] + [("post", f"{base}/{r}") for r in posts]
    tokens = {
        None: 401,
        "Bearer not-a-token": 401,
        f"Bearer {signin.token_for(imran)}": 403,
        f"Bearer {signin.token_for(asha)}x": 401,
    }
    for method, url in routes:
        for header, status in tokens.items():
            headers = {"Authorization": header} if header else {}
            res = getattr(unsigned_client, method)(url, headers=headers)
            assert res.status_code == status, (method, url, header, res.status_code)


def test_a_token_runs_out(db: psycopg.Connection[Any], monkeypatch: Any) -> None:
    token = signin.token_for(patient_id(db, "DEV-0001"))
    later = time.time() + get_settings().session_days * 86400 + 1
    monkeypatch.setattr(signin.time, "time", lambda: later)
    assert signin.patient_for(token) is None


class _Twilio:
    """Stands in for Twilio Verify: records each call, answers as told."""

    def __init__(self, check_status: str = "approved", fail: bool = False) -> None:
        self.calls: list[tuple[str, dict[str, list[str]], str]] = []
        self.check_status, self.fail = check_status, fail

    def __call__(self, req: Any, timeout: float) -> Any:
        if self.fail:
            raise urllib.error.URLError("no network")
        self.calls.append((req.full_url, urllib.parse.parse_qs(req.data.decode()),
                           req.get_header("Authorization")))  # fmt: skip
        status = self.check_status if req.full_url.endswith("VerificationCheck") else "pending"
        return io.BytesIO(json.dumps({"status": status}).encode())


@pytest.fixture
def twilio(monkeypatch: Any) -> Any:
    keys = {
        "twilio_account_sid": "AC-test",
        "twilio_auth_token": "secret",
        "twilio_verify_sid": "VA-test",
    }
    configured = get_settings().model_copy(update=keys)
    monkeypatch.setattr(signin, "get_settings", lambda: configured)

    def use(fake: _Twilio) -> _Twilio:
        monkeypatch.setattr(signin.urllib.request, "urlopen", fake)
        return fake

    return use


def test_with_twilio_keys_the_code_goes_by_sms_and_is_never_shown(
    unsigned_client: Any, twilio: Any
) -> None:
    fake = twilio(_Twilio())
    assert _start(unsigned_client).json() == {"demo_code": None}
    url, form, auth = fake.calls[0]
    assert url == "https://verify.twilio.com/v2/Services/VA-test/Verifications"
    assert form == {"To": ["+915550000001"], "Channel": ["sms"]}
    assert auth == "Basic " + base64.b64encode(b"AC-test:secret").decode()
    assert _check(unsigned_client, "482913").status_code == 200
    assert fake.calls[1][0].endswith("/VerificationCheck")
    assert fake.calls[1][1] == {"To": ["+915550000001"], "Code": ["482913"]}


def test_with_twilio_a_code_it_does_not_approve_is_refused(
    unsigned_client: Any, twilio: Any
) -> None:
    twilio(_Twilio(check_status="pending"))
    _start(unsigned_client)
    assert _check(unsigned_client, "482913").status_code == 401


def test_when_twilio_cannot_be_reached_the_screen_is_told(
    unsigned_client: Any, twilio: Any
) -> None:
    twilio(_Twilio(fail=True))
    assert _start(unsigned_client).status_code == 503


def test_the_seed_can_put_a_real_phone_on_a_demo_patient(
    unsigned_client: Any, db: psycopg.Connection[Any]
) -> None:
    from dev_seed.patient_data import set_phone

    assert set_phone(db, "DEV-0003", "+91 98765 43210") == "3210"
    code = _start(unsigned_client, "98765 43210").json()["demo_code"]
    assert (
        _check(unsigned_client, code, "98765 43210").json()["patient"]["registration_no"]
        == "DEV-0003"
    )
    assert _start(unsigned_client, "55500 00003").json() == {"demo_code": None}


def test_a_provider_refusal_is_logged_with_its_reason(
    unsigned_client: Any, twilio: Any, caplog: Any
) -> None:
    """ "HTTP Error 403" alone did not say a trial number was unverified."""

    def refuse(req: Any, timeout: float) -> Any:
        body = json.dumps({"code": 21608, "message": "the recipient must be a verified tester"})
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(body.encode()))  # type: ignore[arg-type]

    twilio(refuse)
    assert _start(unsigned_client).status_code == 503
    assert "code 21608: the recipient must be a verified tester" in caplog.text
