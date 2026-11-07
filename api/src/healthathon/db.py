from collections.abc import Iterator

from psycopg import Connection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from healthathon.config import get_settings

_pool: ConnectionPool[Connection[DictRow]] | None = None


def open_pool(url: str | None = None) -> ConnectionPool[Connection[DictRow]]:
    global _pool
    if _pool is None:
        # max_size defaults to min_size, which is too few now that reading a
        # page runs in its own thread with its own connection: two reads, the
        # requests that started them and the polling behind them would use
        # every connection and wait on each other.
        _pool = ConnectionPool(
            url or get_settings().database_url,
            kwargs={"row_factory": dict_row},
            connection_class=Connection[DictRow],
            min_size=4,
            max_size=16,
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_conn() -> Iterator[Connection[DictRow]]:
    """FastAPI dependency. One transaction per request, committed on success."""
    with open_pool().connection() as conn:
        yield conn
