from typing import Any


def _preflight(client: Any, origin: str) -> Any:
    return client.options(
        "/api/app/patients",
        headers={"Origin": origin, "Access-Control-Request-Method": "PUT"},
    )


def test_the_patient_app_dev_server_may_call_the_api(client: Any) -> None:
    res = _preflight(client, "http://localhost:8081")
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:8081"
    get = client.get("/api/app/patients", headers={"Origin": "http://localhost:8081"})
    assert get.headers["access-control-allow-origin"] == "http://localhost:8081"


def test_any_other_origin_is_not_allowed(client: Any) -> None:
    res = _preflight(client, "https://example.org")
    assert "access-control-allow-origin" not in res.headers
    get = client.get("/api/app/patients", headers={"Origin": "https://example.org"})
    assert "access-control-allow-origin" not in get.headers


def test_the_patient_app_may_send_its_sign_in_token(client: Any) -> None:
    res = client.options(
        "/api/app/patients/x/today",
        headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "GET",
                 "Access-Control-Request-Headers": "authorization"},
    )  # fmt: skip
    assert res.status_code == 200
    assert "authorization" in res.headers["access-control-allow-headers"].lower()
