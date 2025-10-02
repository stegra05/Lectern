from __future__ import annotations

import time
from typing import Optional


# Simple CLI color helpers
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"


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


def vprint(message: str, level: int = 1) -> None:
    if _VERBOSITY >= level:
        print(message)


def _format_duration(seconds: float) -> str:
    ms = int((seconds - int(seconds)) * 1000)
    m = int(seconds) // 60
    s = int(seconds) % 60
    if m:
        return f"{m}m {s:02d}s {ms:03d}ms"
    return f"{s}s {ms:03d}ms"


class StepTimer:
    """Context manager to time and report a named step.

    Usage:
        with StepTimer("Parse PDF") as t:
            ...
            if failure:
                t.fail("reason")
                return 2
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self._start = 0.0
        self._failed = False
        self._fail_msg = ""

    def __enter__(self) -> "StepTimer":
        self._start = time.perf_counter()
        if not is_quiet():
            print(f"{C.CYAN}▶ {self.name}{C.RESET}")
        return self

    def fail(self, message: str) -> None:
        self._failed = True
        self._fail_msg = message

    def __exit__(self, exc_type, exc, tb) -> bool:
        elapsed = _format_duration(time.perf_counter() - self._start)
        # Always surface failures even in quiet
        if exc_type is not None:
            print(f"{C.RED}✖ {self.name} failed in {elapsed}: {exc}{C.RESET}")
            return False  # propagate
        if self._failed:
            print(f"{C.RED}✖ {self.name} failed in {elapsed}: {self._fail_msg}{C.RESET}")
        else:
            if not is_quiet():
                print(f"{C.GREEN}✔ {self.name} done in {elapsed}{C.RESET}")
        return False


class Progress:
    """Lightweight textual progress indicator with optional total.

    This class avoids external dependencies. Prefer to use when `rich` is not
    installed. Call `update(current)` to print occasional progress lines.
    """

    def __init__(self, total: Optional[int], label: str) -> None:
        self.total = total
        self.label = label
        self.current = 0
        self._last_print = 0

    def update(self, current: int) -> None:
        self.current = current
        if is_quiet():
            return
        # Print every step for small totals, or occasionally for large totals
        should_print = True if (self.total and self.total <= 20) else (self.current - self._last_print >= 5)
        if should_print:
            self._last_print = self.current
            if self.total is None:
                print(f"  {C.BLUE}{self.label}{C.RESET}: {self.current}")
            else:
                print(f"  {C.BLUE}{self.label}{C.RESET}: {self.current}/{self.total}")


