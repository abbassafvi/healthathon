from uuid import UUID

from fastapi import APIRouter

from healthathon.auth import Conn, User
from healthathon.reading import service
from healthathon.reading.models import DocumentReading

router = APIRouter(prefix="/api", tags=["reading"])


@router.get("/documents/{document_id}/reading", response_model=DocumentReading)
def get_reading(document_id: UUID, conn: Conn, user: User) -> DocumentReading:
    return service.reading(conn, user, document_id)
