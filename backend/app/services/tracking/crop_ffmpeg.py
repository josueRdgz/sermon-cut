"""Build FFmpeg crop expressions / sendcmd files from crop keyframes.

The final MP4 is always produced by FFmpeg — OpenCV only supplies sample boxes.
"""

from __future__ import annotations

from pathlib import Path

from app.services.tracking.types import CropKeyframe


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def build_piecewise_expr(keys: list[CropKeyframe], *, axis: str) -> str:
    """Nested ``if(lt(t,…))`` expression for crop x or y.

    Times are segment-relative (``setpts=PTS-STARTPTS`` already applied on the
    trimmed input, so ``t`` starts at 0 inside each segment filter).
    """
    if not keys:
        return "0"
    if len(keys) == 1:
        value = keys[0].x if axis == "x" else keys[0].y
        return _fmt(value)

    def value_at(key: CropKeyframe) -> float:
        return key.x if axis == "x" else key.y

    # Build from the end: if(lt(t,t1), lerp0, if(lt(t,t2), lerp1, ...))
    expr = _fmt(value_at(keys[-1]))
    for index in range(len(keys) - 2, -1, -1):
        left = keys[index]
        right = keys[index + 1]
        t0, t1 = left.t, right.t
        v0, v1 = value_at(left), value_at(right)
        span = max(1e-3, t1 - t0)
        # Linear: v0 + (v1-v0) * (t-t0) / span
        lerp = (
            f"({_fmt(v0)}+({_fmt(v1)}-({_fmt(v0)}))*(t-({_fmt(t0)}))/({_fmt(span)}))"
        )
        expr = f"if(lt(t\\,{_fmt(t1)})\\,{lerp}\\,{expr})"
    return expr


def build_crop_filter(
    *,
    width: int,
    height: int,
    keys: list[CropKeyframe],
    static_x: float | None = None,
    static_y: float | None = None,
) -> str:
    """Return a ``crop=W:H:x:y`` filter fragment (no surrounding commas)."""
    if static_x is not None and static_y is not None and not keys:
        return f"crop={width}:{height}:{_fmt(static_x)}:{_fmt(static_y)}"
    if not keys:
        return f"crop={width}:{height}"
    if len(keys) == 1:
        return f"crop={width}:{height}:{_fmt(keys[0].x)}:{_fmt(keys[0].y)}"
    x_expr = build_piecewise_expr(keys, axis="x")
    y_expr = build_piecewise_expr(keys, axis="y")
    return f"crop={width}:{height}:'{x_expr}':'{y_expr}'"


def write_sendcmd_file(keys: list[CropKeyframe], path: Path) -> Path:
    """Write a sendcmd timeline that updates crop x/y over time."""
    lines: list[str] = []
    for key in keys:
        lines.append(f"{_fmt(key.t)} crop x {_fmt(key.x)};")
        lines.append(f"{_fmt(key.t)} crop y {_fmt(key.y)};")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
