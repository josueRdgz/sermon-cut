"""Internal normalized representation produced by all transcript parsers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ParsedWord:
    text: str
    start: float | None = None
    end: float | None = None
    confidence: float | None = None


@dataclass
class ParsedSegment:
    text: str
    start: float | None = None
    end: float | None = None
    words: list[ParsedWord] = field(default_factory=list)


@dataclass
class ParsedTranscript:
    """Format-independent transcript payload."""

    segments: list[ParsedSegment]
    language: str | None = None
    has_timing: bool = True
    has_word_timestamps: bool = False
