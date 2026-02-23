"""Error handling utilities for consistent exception logging and message capture."""

import logging
import traceback
from typing import Tuple

logger = logging.getLogger(__name__)


def capture_exception(
    e: Exception,
    context: str = "",
    include_trace_in_response: bool = False,
) -> Tuple[str, str]:
    """Captures full exception details for logging and returns sanitized message.

    Args:
        e: The caught exception
        context: A descriptive string for log context (e.g., "PDF upload", "Generation loop")
        include_trace_in_response: If True, includes the full trace in the returned trace string
                                   for debugging purposes in development

    Returns:
        A tuple of (user_message, full_trace) where:
        - user_message: A sanitized message safe to show to users
        - full_trace: The complete traceback string for debugging
    """
    full_trace = traceback.format_exc()

    # Log the full traceback to the backend terminal
    if context:
        logger.error(f"[{context}] Exception occurred:\n{full_trace}")
    else:
        logger.error(f"Exception occurred:\n{full_trace}")

    # Create a user-friendly message
    user_message = str(e) if str(e) else f"{type(e).__name__}"

    return user_message, full_trace
