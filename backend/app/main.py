import logging
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field

from app.agent import run_agent, stream_agent
from app.config import settings
from app.ingestion import ingest_pdf
from app.vectorstore import get_collection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)

app = FastAPI(title="PDF-Constrained Conversational Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

_status: dict[str, dict] = {}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB — matches frontend cap
PDF_MAGIC = b"%PDF-"


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    pdf_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    history: list[HistoryTurn] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/info")
def info():
    return {
        "answer_model": settings.answer_model,
        "embedding_model": settings.embedding_model,
        "top_k": settings.top_k,
    }


@app.post("/upload")
async def upload(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only PDF files are accepted")

    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file too large (>{MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
        )
    if not body.startswith(PDF_MAGIC):
        raise HTTPException(
            status_code=400, detail="file does not look like a PDF"
        )

    pdf_id = uuid.uuid4().hex[:12]
    dest = Path(settings.upload_dir) / f"{pdf_id}.pdf"
    dest.write_bytes(body)

    filename = file.filename or f"{pdf_id}.pdf"
    _status[pdf_id] = {"status": "processing", "filename": filename}
    background_tasks.add_task(ingest_pdf, pdf_id, str(dest), _status)

    return {"pdf_id": pdf_id, "status": "processing", "filename": filename}


def _hydrate_status_from_disk(pdf_id: str) -> dict | None:
    """Reconstruct a `ready` status entry for a PDF whose chunks are still in
    Chroma and whose file is still on disk, even though the in-memory `_status`
    was wiped (e.g., backend restart, `uvicorn --reload`).

    Returns the synthesized info dict if recoverable, else None. The original
    upload filename is not preserved across restarts, so it's omitted — the
    frontend's localStorage-stored filename takes precedence on hydration.
    """
    if not (Path(settings.upload_dir) / f"{pdf_id}.pdf").exists():
        return None
    try:
        existing = get_collection().get(where={"pdf_id": pdf_id})
    except Exception:
        return None
    chunk_ids = existing.get("ids") or []
    if not chunk_ids:
        return None
    metadatas = existing.get("metadatas") or []
    pages = max(
        (int(m.get("page", 0)) for m in metadatas if m),
        default=0,
    )
    info = {
        "status": "ready",
        "pages": pages,
        "chunks": len(chunk_ids),
    }
    _status[pdf_id] = info  # cache so subsequent requests don't re-query Chroma
    return info


@app.get("/pdf/status/{pdf_id}")
def pdf_status(pdf_id: str):
    info = _status.get(pdf_id) or _hydrate_status_from_disk(pdf_id)
    if info is None:
        raise HTTPException(status_code=404, detail="unknown pdf_id")
    return {"pdf_id": pdf_id, **info}


@app.get("/pdf/file/{pdf_id}")
def pdf_file(pdf_id: str):
    path = Path(settings.upload_dir) / f"{pdf_id}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="pdf not found on disk")
    return FileResponse(path, media_type="application/pdf", filename=f"{pdf_id}.pdf")


def _check_ready(pdf_id: str) -> None:
    info = _status.get(pdf_id) or _hydrate_status_from_disk(pdf_id)
    if info is None:
        raise HTTPException(status_code=404, detail="unknown pdf_id")
    if info.get("status") != "ready":
        raise HTTPException(status_code=409, detail=f"pdf is {info.get('status')}")


@app.post("/chat")
def chat(req: ChatRequest):
    _check_ready(req.pdf_id)
    history = [{"role": t.role, "content": t.content} for t in req.history]
    return run_agent(req.message, req.pdf_id, history=history)


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    _check_ready(req.pdf_id)
    history = [{"role": t.role, "content": t.content} for t in req.history]
    return StreamingResponse(
        stream_agent(req.message, req.pdf_id, history=history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
