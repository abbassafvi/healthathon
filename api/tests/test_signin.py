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


class _Exotel:
    """Stands in for Exotel's SMS API: records each message, answers as told."""

    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple[str, dict[str, list[str]], str]] = []
        self.fail = fail

    def __call__(self, req: Any, timeout: float) -> Any:
        if self.fail:
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
        self.calls.append((req.full_url, urllib.parse.parse_qs(req.data.decode()),
                           req.get_header("Authorization")))  # fmt: skip
        return io.BytesIO(json.dumps({"SMSMessage": {"Sid": "sms-1", "Status": "queued"}}).encode())

    def code(self) -> str:
        body = self.calls[-1][1]["Body"][0]
        return body.split(" ", 1)[0]


EXOTEL = {
    "exotel_api_key": "key-test",
    "exotel_api_token": "token-test",
    "exotel_account_sid": "clinic1",
    "exotel_sms_from": "CLNCON",
    "exotel_dlt_entity_id": "1101000000000001",
    "exotel_dlt_template_id": "1107000000000001",
    "otp_test_code": "111111",
}


@pytest.fixture
def exotel(monkeypatch: Any) -> Any:
    def use(fake: _Exotel, **keys: str) -> _Exotel:
        configured = get_settings().model_copy(update={**EXOTEL, **keys})
        monkeypatch.setattr(signin, "get_settings", lambda: configured)
        monkeypatch.setattr(signin.urllib.request, "urlopen", fake)
        return fake

    return use


def test_with_exotel_keys_the_code_goes_by_sms_and_is_never_shown(
    unsigned_client: Any, exotel: Any
) -> None:
    fake = exotel(_Exotel())
    assert _start(unsigned_client).json() == {"demo_code": None}
    url, form, auth = fake.calls[0]
    assert url == "https://api.exotel.com/v1/Accounts/clinic1/Sms/send.json"
    assert auth == "Basic " + base64.b64encode(b"key-test:token-test").decode()
    code = fake.code()
    assert form == {
        "From": ["CLNCON"],
        "To": ["+915550000001"],
        "Body": [f"{code} is your cliniConnect sign-in code. It expires in 10 minutes."],
        "DltEntityId": ["1101000000000001"],
        "DltTemplateId": ["1107000000000001"],
        "SmsType": ["transactional"],
    }
    # A real SMS never uses the fixed test code, and no secret is in the URL.
    assert code != "111111" and len(code) == 6 and code.isdigit()
    assert "token-test" not in url
    assert _check(unsigned_client, code).status_code == 200
    assert _check(unsigned_client, code).status_code == 401


def test_with_exotel_a_wrong_code_is_refused(unsigned_client: Any, exotel: Any) -> None:
    fake = exotel(_Exotel())
    _start(unsigned_client)
    wrong = "000000" if fake.code() != "000000" else "999999"
    assert _check(unsigned_client, wrong).status_code == 401


def test_the_wording_follows_the_registered_template(unsigned_client: Any, exotel: Any) -> None:
    fake = exotel(_Exotel(), exotel_otp_template="Use {code} to sign in to cliniConnect.")
    _start(unsigned_client)
    body = fake.calls[0][1]["Body"][0]
    assert body.startswith("Use ") and body.endswith(" to sign in to cliniConnect.")


def test_when_exotel_refuses_the_screen_is_told_and_no_code_works(
    unsigned_client: Any, exotel: Any
) -> None:
    exotel(_Exotel(fail=True))
    assert _start(unsigned_client).status_code == 503
    assert _check(unsigned_client, "111111").status_code == 401


def test_an_exotel_key_alone_leaves_sign_in_in_test_mode(
    unsigned_client: Any, monkeypatch: Any
) -> None:
    """Until every value is set, nothing is sent and the code is shown."""
    partial = get_settings().model_copy(update={"exotel_api_key": "key-only"})
    monkeypatch.setattr(signin, "get_settings", lambda: partial)
    assert _start(unsigned_client).json()["demo_code"]
