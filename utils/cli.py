from __future__ import annotations

import logging
import time
from typing import Optional, Iterable, Any

from rich.console import Console
from rich.theme import Theme
from rich.progress import (
    Progress as RichProgress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.table import Table
from rich.syntax import Syntax
from rich.markdown import Markdown
from rich.columns import Columns
from rich.logging import RichHandler

# -----------------------------------------------------------------------------
# Console configuration and theming
# -----------------------------------------------------------------------------
THEME = Theme(
    {
        # Message styles
        "success": "bold bright_green",
        "error": "bold bright_red",
        "warning": "bold yellow",
        "info": "bold bright_blue",
        "debug": "dim",
        # Utility styles
        "title": "bold magenta",
        "summary": "bold bright_blue",
        "prompt": "bold bright_cyan",
    }
)

console = Console(theme=THEME)

# Verbosity: 0=quiet, 1=normal, 2=verbose
_VERBOSITY: int = 1


def set_verbosity(level: int) -> None:
    global _VERBOSITY
    _VERBOSITY = 0 if level <= 0 else (2 if level >= 2 else 1)


def get_verbosity() -> int:
    return _VERBOSITY


def is_quiet() -> bool:
    return _VERBOSITY <= 0


def is_verbose() -> bool:
    return _VERBOSITY >= 2


# -----------------------------------------------------------------------------
# Message helpers with consistent styles and icons
# -----------------------------------------------------------------------------

def debug(message: str, level: int = 2) -> None:
    if _VERBOSITY >= level:
        console.print(f"· {message}", style="debug")


def info(message: str) -> None:
    if not is_quiet():
        console.print(f"ℹ {message}", style="info")


def success(message: str) -> None:
    if not is_quiet():
        console.print(f"✔ {message}", style="success")


def warn(message: str) -> None:
    if not is_quiet():
        console.print(f"⚠ {message}", style="warning")


def error(message: str) -> None:
    # Always show errors regardless of verbosity
    console.print(f"✖ {message}", style="error")


# Backward-compatible verbose print utility

def vprint(message: str, level: int = 1) -> None:
    if _VERBOSITY >= level:
        console.print(message)


# -----------------------------------------------------------------------------
# Timing helpers
# -----------------------------------------------------------------------------
class StepTimer:
    """Context manager to time and report a named step with Rich styling."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._start = 0.0
        self._failed = False
        self._fail_msg = ""

    def __enter__(self) -> "StepTimer":
        self._start = time.perf_counter()
        if not is_quiet():
            console.print(f"▶ {self.name}", style="info")
        return self

    def fail(self, message: str) -> None:
        self._failed = True
        self._fail_msg = message

    def __exit__(self, exc_type, exc, tb) -> bool:
        elapsed = _format_duration(time.perf_counter() - self._start)
        # Always surface failures even in quiet
        if exc_type is not None:
            console.print(f"✖ {self.name} failed in {elapsed}: {exc}", style="error")
            return False  # propagate
        if self._failed:
            console.print(f"✖ {self.name} failed in {elapsed}: {self._fail_msg}", style="error")
        else:
            if not is_quiet():
                console.print(f"✔ {self.name} done in {elapsed}", style="success")
        return False


def _format_duration(seconds: float) -> str:
    ms = int((seconds - int(seconds)) * 1000)
    m = int(seconds) // 60
    s = int(seconds) % 60
    if m:
        return f"{m}m {s:02d}s {ms:03d}ms"
    return f"{s}s {ms:03d}ms"


# -----------------------------------------------------------------------------
# Progress helpers
# -----------------------------------------------------------------------------
class Progress:
    """Rich-based progress indicator with optional total.

    Call `update(current)` to advance. Stops automatically when completed.
    """

    def __init__(self, total: Optional[int], label: str) -> None:
        self.total = total
        self.label = label
        self.current = 0
        self._progress: Optional[RichProgress] = None
        self._task_id: Optional[int] = None

    def _ensure_started(self) -> None:
        if is_quiet():
            return
        if self._progress is None:
            self._progress = RichProgress(
                SpinnerColumn(),
                TextColumn("{task.description}"),
                BarColumn(),
                TextColumn("{task.completed}/{task.total}"),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
                console=console,
            )
            self._progress.start()
            self._task_id = self._progress.add_task(self.label, total=self.total if self.total is not None else None)

    def update(self, current: int) -> None:
        self.current = current
        if is_quiet():
            return
        self._ensure_started()
        if self._progress and self._task_id is not None:
            self._progress.update(self._task_id, completed=current)
            if self.total is not None and current >= self.total:
                self._progress.stop()
                self._progress = None
                self._task_id = None


# -----------------------------------------------------------------------------
# Rendering utilities: tables, code, markdown, columns
# -----------------------------------------------------------------------------

def render_table(columns: Iterable[str], rows: Iterable[Iterable[Any]] | Iterable[dict[str, Any]], title: str | None = None) -> None:
    table = Table(title=title, title_style="title")
    col_list = list(columns)
    for col in col_list:
        table.add_column(str(col))
    for row in rows:
        if isinstance(row, dict):
            table.add_row(*(str(row.get(c, "")) for c in col_list))
        else:
            table.add_row(*(str(cell) for cell in row))
    console.print(table)


def print_code(code: str, language: str = "python", theme: str = "monokai") -> None:
    syntax = Syntax(code, language, theme=theme, line_numbers=False, word_wrap=True)
    console.print(syntax)


def print_markdown(md_text: str) -> None:
    console.print(Markdown(md_text))


def render_grid(items: Iterable[Any], equal: bool = True) -> None:
    console.print(Columns(items, equal=equal))


# -----------------------------------------------------------------------------
# Logging integration (DEBUG, INFO, WARN, ERROR)
# -----------------------------------------------------------------------------
_logger: Optional[logging.Logger] = None


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    global _logger
    logger = logging.getLogger("lectern")
    logger.setLevel(level)
    # Avoid duplicate handlers if reconfigured
    if not any(isinstance(h, RichHandler) for h in logger.handlers):
        handler = RichHandler(
            console=console,
            show_time=True,
            show_level=True,
            show_path=False,
            rich_tracebacks=True,
            markup=True,
        )
        formatter = logging.Formatter("%(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.propagate = False
    _logger = logger
    return logger


def get_logger() -> logging.Logger:
    if _logger is None:
        return setup_logging(logging.INFO)
    return _logger


