"""The server's own access log never keeps the voice secret or a caller's number."""

import logging

from healthathon import access_log
from healthathon.access_log import REDACTED, RedactVoicePaths


def _line(path: str) -> logging.LogRecord:
    """A record shaped as uvicorn's access logger makes it."""
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", path, "1.1", 200), None,
    )  # fmt: skip


def test_an_exotel_request_is_logged_without_its_secret_or_caller() -> None:
    record = _line("/api/voice/exotel/the-secret/tick/yes?CallSid=x&CallFrom=%2B915550000001")
    assert RedactVoicePaths().filter(record) is True
    message = record.getMessage()
    assert REDACTED in message
    assert "the-secret" not in message and "5550000001" not in message


def test_every_other_request_is_logged_as_it_was() -> None:
    record = _line("/api/patients?x=1")
    RedactVoicePaths().filter(record)
    assert "/api/patients?x=1" in record.getMessage()


def test_the_filter_is_on_uvicorns_access_logger_once() -> None:
    import healthathon.main  # noqa: F401  installs it on import

    access_log.install()
    filters = logging.getLogger("uvicorn.access").filters
    assert sum(isinstance(f, RedactVoicePaths) for f in filters) == 1
