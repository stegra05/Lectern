from __future__ import annotations

from enum import Enum


class GenerationErrorCode(str, Enum):
    INVALID_INPUT = "invalid_input"
    PDF_UNAVAILABLE = "pdf_unavailable"
    PROVIDER_UPLOAD_FAILED = "provider_upload_failed"
    PROVIDER_GENERATION_FAILED = "provider_generation_failed"
    PROVIDER_REFLECTION_FAILED = "provider_reflection_failed"
    HISTORY_PERSIST_FAILED = "history_persist_failed"
    HISTORY_CORRUPT_SEQUENCE = "history_corrupt_sequence"
    SESSION_NOT_FOUND = "session_not_found"
    RESUME_VERSION_MISMATCH = "resume_version_mismatch"
    RESUME_CONFLICT_ALREADY_RUNNING = "resume_conflict_already_running"
    CANCEL_IDEMPOTENT_NOOP = "cancel_idempotent_noop"
    STREAM_DISCONNECTED = "stream_disconnected"
    INTERNAL_UNEXPECTED = "internal_unexpected"
