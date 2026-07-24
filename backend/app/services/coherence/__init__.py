"""Join-coherence validation for multi-segment Reels."""

from app.services.coherence.service import (
    assert_render_allowed,
    dismiss_warning,
    expand_segment_context,
    validate_reel,
)

__all__ = [
    "assert_render_allowed",
    "dismiss_warning",
    "expand_segment_context",
    "validate_reel",
]
