from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from healthathon import storage
from healthathon.auth import CurrentUser, User
from healthathon.confirm_queue.routes import router as confirm_queue_router
from healthathon.db import close_pool, open_pool
from healthathon.entries.routes import router as entries_router
from healthathon.record.routes import router as record_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    open_pool()
    yield
    close_pool()


app = FastAPI(title="Healthathon API", version="0.1.0", lifespan=lifespan)
app.include_router(confirm_queue_router)
app.include_router(record_router)
app.include_router(entries_router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me", response_model=CurrentUser, tags=["meta"])
def me(user: User) -> CurrentUser:
    return user


@app.get("/api/storage/{key:path}", tags=["storage"], response_class=FileResponse)
def get_stored_file(key: str, _user: User) -> FileResponse:
    path = storage.resolve(key)
    if path is None:
        raise HTTPException(404, "Not found")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
