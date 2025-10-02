from __future__ import annotations

import time


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
        print(f"{C.CYAN}▶ {self.name}{C.RESET}")
        return self

    def fail(self, message: str) -> None:
        self._failed = True
        self._fail_msg = message

    def __exit__(self, exc_type, exc, tb) -> bool:
        elapsed = _format_duration(time.perf_counter() - self._start)
        if exc_type is not None:
            print(f"{C.RED}✖ {self.name} failed in {elapsed}: {exc}{C.RESET}")
            return False  # propagate
        if self._failed:
            print(f"{C.RED}✖ {self.name} failed in {elapsed}: {self._fail_msg}{C.RESET}")
        else:
            print(f"{C.GREEN}✔ {self.name} done in {elapsed}{C.RESET}")
        return False


