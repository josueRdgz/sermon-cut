"""Pydantic schemas for subtitle preview and template listing."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.reel import SubtitleGranularity, SubtitlePosition, SubtitleStyle


class SubtitleTemplateInfo(BaseModel):
    id: SubtitleStyle
    label: str
    description: str
    max_lines: int
    highlight_current_word: bool
    quote_style: bool
    default_font_size: int
    default_max_words: int
    default_uppercase: bool
    default_margin_bottom: int
    default_granularity: SubtitleGranularity


class SubtitleTemplateListResponse(BaseModel):
    items: list[SubtitleTemplateInfo]


class SubtitleCuePreview(BaseModel):
    start: float
    end: float
    text: str
    highlight: bool = False
    words: list[dict[str, float | str]] = Field(default_factory=list)


class SubtitlePreviewResponse(BaseModel):
    style: str
    granularity_used: SubtitleGranularity
    total_duration_seconds: float
    cues: list[SubtitleCuePreview]
    position: SubtitlePosition
    font_size: int
    uppercase: bool
    opacity: float
    margin_bottom: int
    max_words: int
