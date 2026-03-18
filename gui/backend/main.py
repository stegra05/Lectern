import sys
import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import json
from typing import Any

# NOTE(Paths): Use Path.resolve() to handle frozen PyInstaller envs correctly.
_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent.parent))
sys.path.insert(0, str(_here))

from lectern.version import __version__
from lectern import config
from lectern.utils.path_utils import get_app_data_dir, ensure_app_dirs
from lectern.utils.history import HistoryManager
from session import session_manager
from gui.backend.routers import system, anki, history, generation

ensure_app_dirs()
log_file = get_app_data_dir() / "logs" / "backend.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("lectern.backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        recovered = HistoryManager().recover_interrupted_sessions()
        if recovered:
            logger.warning(
                "Recovered %s interrupted in-flight session(s) from previous runs.",
                recovered,
            )
        yield
    finally:
        session_manager.shutdown()


app = FastAPI(title="Lectern API", version=__version__, lifespan=lifespan)
session_manager.sweep_orphan_temp_files()

def _canonicalize(obj: Any) -> Any:
    """Deep-sort dicts by key and lists by value for a deterministic OpenAPI schema."""
    if isinstance(obj, dict):
        return {k: _canonicalize(obj[k]) for k in sorted(obj)}
    if isinstance(obj, list):
        items = [_canonicalize(v) for v in obj]
        try:
            return sorted(items, key=lambda v: json.dumps(v, sort_keys=True))
        except TypeError:
            return items
    return obj

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    app.openapi_schema = _canonicalize(schema)
    return app.openapi_schema

app.openapi = custom_openapi

app.add_middleware(
    CORSMiddleware,
    allow_origins=getattr(config, "FRONTEND_ORIGINS", ["http://localhost:5173"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, tags=["system"])
app.include_router(anki.router, tags=["anki"])
app.include_router(history.router, tags=["history"])
app.include_router(generation.router, tags=["generation"])


class StreamToLogger:
    """Redirect a stream (like stdout/stderr) to a logger."""

    def __init__(self, logger: logging.Logger, log_level: int):
        self.logger = logger
        self.log_level = log_level
        self._linebuf = ""

    def write(self, buf: str):
        self._linebuf += buf
        while "\n" in self._linebuf:
            line, self._linebuf = self._linebuf.split("\n", 1)
            self.logger.log(self.log_level, line.rstrip("\r\n"))

    def flush(self):
        if self._linebuf:
            self.logger.log(self.log_level, self._linebuf.rstrip("\r\n"))
            self._linebuf = ""

    def isatty(self) -> bool:
        """Required by uvicorn formatter and some native backends."""
        return False


sys.stdout = StreamToLogger(logging.getLogger("STDOUT"), logging.INFO)
sys.stderr = StreamToLogger(logging.getLogger("STDERR"), logging.ERROR)

if hasattr(sys, "_MEIPASS"):
    frontend_dist = os.path.join(getattr(sys, "_MEIPASS"), "frontend", "dist")
else:
    frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(frontend_dist):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(frontend_dist, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react_app(full_path: str):
        api_roots = {
            getattr(r, "path", "").lstrip("/").split("/")[0]
            for r in app.routes
            if hasattr(r, "methods")
            and getattr(r, "path", None) not in {None, "/", "/{full_path:path}"}
        }
        if full_path.split("/")[0] in api_roots or full_path.startswith("assets"):
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist, "index.html"))

else:
    logger.warning(f"Frontend build not found at {frontend_dist}")
