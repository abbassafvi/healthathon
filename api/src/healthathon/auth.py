from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel

from healthathon.config import get_settings
from healthathon.db import get_conn


class CurrentUser(BaseModel):
    id: UUID
    full_name: str
    role: str


# The transaction must commit before the response is sent. A dependency with
# yield defaults to scope="request", which commits after: a client could then
# read straight after a write and miss it, and a failed commit would follow a
# 200. scope="function" ends the dependency, and commits, first.
DbConn = Annotated[Connection[DictRow], Depends(get_conn, scope="function")]


def current_user(conn: DbConn) -> CurrentUser:
    """
    Authentication stub. Registration and login are out of scope for the
    prototype, so every request acts as the one seeded clinician. Replacing
    this function is the only change a real login needs.
    """
    row = conn.execute(
        "SELECT id, full_name, role::text AS role FROM core.clinic_user"
        " WHERE email = %s AND is_active",
        (get_settings().stub_user_email,),
    ).fetchone()
    if row is None:
        raise HTTPException(503, "The stub clinician is not seeded. Run the dev seed.")
    return CurrentUser(**row)


User = Annotated[CurrentUser, Depends(current_user)]
Conn = DbConn
