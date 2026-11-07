"""
What the server's own access log may say about a request.

uvicorn logs every request line, query string included. Exotel's Passthru
calls a URL that carries the voice secret in its path and the caller's
number in its query, so without this both would land in the log on every
step of every call, and phones.py promises a phone number is never kept.
"""

import logging

REDACTED = "/api/voice/exotel/[redacted]"


class RedactVoicePaths(logging.Filter):
    """Replace an Exotel request's path and query before the line is written."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5:
            path = args[2]
            if isinstance(path, str) and path.startswith("/api/voice/exotel/"):
                record.args = (args[0], args[1], REDACTED, args[3], args[4])
        return True


def install() -> None:
    """Attach the filter to uvicorn's access logger, once."""
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactVoicePaths) for f in logger.filters):
        logger.addFilter(RedactVoicePaths())
