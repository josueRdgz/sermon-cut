"""Transcription engine abstraction.

The concrete engine wraps faster-whisper, but the manager depends only on the
``TranscriptionEngine`` protocol so tests can inject a fake engine that never
downloads a model.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass
class EngineWord:
    """A single word with timing (seconds) and optional probability."""

    start: float
    end: float
    text: str
    probability: float | None = None


@dataclass
class EngineSegment:
    """A transcribed segment, streamed one at a time as decoding progresses."""

    start: float
    end: float
    text: str
    words: list[EngineWord] = field(default_factory=list)


@dataclass
class EngineInfo:
    """Metadata known once decoding starts."""

    language: str | None
    duration: float | None


@runtime_checkable
class TranscriptionEngine(Protocol):
    """Streaming transcription contract.

    Implementations return the detected ``EngineInfo`` plus an iterator that
    yields segments incrementally, allowing the manager to report progress and
    honor cancellation between segments.
    """

    def transcribe(
        self,
        audio_path: Path,
        *,
        model_name: str,
        language: str | None,
        device: str,
        compute_type: str,
        word_timestamps: bool = True,
    ) -> tuple[EngineInfo, Iterator[EngineSegment]]: ...


class FasterWhisperEngine:
    """Real engine backed by faster-whisper.

    The heavy ``faster_whisper`` import and model load are deferred until
    ``transcribe`` is first called, so importing this module never triggers a
    download and tests can avoid it entirely.
    """

    def __init__(self) -> None:
        # Cache loaded models by (model_name, device, compute_type).
        self._models: dict[tuple[str, str, str], object] = {}

    def _get_model(self, model_name: str, device: str, compute_type: str):
        key = (model_name, device, compute_type)
        model = self._models.get(key)
        if model is None:
            from faster_whisper import WhisperModel  # lazy import

            model = WhisperModel(model_name, device=device, compute_type=compute_type)
            self._models[key] = model
        return model

    def transcribe(
        self,
        audio_path: Path,
        *,
        model_name: str,
        language: str | None,
        device: str,
        compute_type: str,
        word_timestamps: bool = True,
    ) -> tuple[EngineInfo, Iterator[EngineSegment]]:
        model = self._get_model(model_name, device, compute_type)
        segments, info = model.transcribe(
            str(audio_path),
            language=language,
            word_timestamps=word_timestamps,
            vad_filter=True,
        )

        engine_info = EngineInfo(
            language=getattr(info, "language", None),
            duration=getattr(info, "duration", None),
        )

        def _iter() -> Iterator[EngineSegment]:
            for seg in segments:
                words: list[EngineWord] = []
                for word in getattr(seg, "words", None) or []:
                    words.append(
                        EngineWord(
                            start=float(word.start),
                            end=float(word.end),
                            text=word.word,
                            probability=getattr(word, "probability", None),
                        )
                    )
                yield EngineSegment(
                    start=float(seg.start),
                    end=float(seg.end),
                    text=seg.text.strip(),
                    words=words,
                )

        return engine_info, _iter()


_default_engine: FasterWhisperEngine | None = None


def get_default_engine() -> FasterWhisperEngine:
    """Return a process-wide faster-whisper engine (model cache reused)."""
    global _default_engine
    if _default_engine is None:
        _default_engine = FasterWhisperEngine()
    return _default_engine
