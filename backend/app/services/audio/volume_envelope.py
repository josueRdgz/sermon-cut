"""Volume keyframes for timeline clips and background music."""

from __future__ import annotations

import json
from typing import Any


def parse_keyframes(raw: str | list | None) -> list[dict[str, float]]:
    data: Any = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = []
    if not isinstance(data, list) or not data:
        return [{"t_ms": 0.0, "gain": 1.0}]
    points: list[dict[str, float]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        t_ms = max(0.0, float(item.get("t_ms", 0)))
        gain = min(1.0, max(0.0, float(item.get("gain", 1.0))))
        points.append({"t_ms": t_ms, "gain": gain})
    if not points:
        return [{"t_ms": 0.0, "gain": 1.0}]
    points.sort(key=lambda item: item["t_ms"])
    return points


def dump_keyframes(points: list[dict[str, float]] | None) -> str:
    return json.dumps(parse_keyframes(points), ensure_ascii=False)


def interpolate_gain(points: list[dict[str, float]], t_ms: float) -> float:
    ordered = parse_keyframes(points)
    if t_ms <= ordered[0]["t_ms"]:
        return ordered[0]["gain"]
    for index, point in enumerate(ordered[1:], start=1):
        prev = ordered[index - 1]
        if t_ms <= point["t_ms"]:
            span = point["t_ms"] - prev["t_ms"]
            if span <= 0:
                return point["gain"]
            ratio = (t_ms - prev["t_ms"]) / span
            return prev["gain"] + (point["gain"] - prev["gain"]) * ratio
    return ordered[-1]["gain"]


def ffmpeg_volume_filter(points: list[dict[str, float]], duration_seconds: float) -> str | None:
    """Return a volume filter, or None when gain is constantly 1."""
    ordered = parse_keyframes(points)
    if (
        len(ordered) == 1
        and ordered[0]["t_ms"] <= 0
        and abs(ordered[0]["gain"] - 1.0) < 0.001
    ):
        return None
    if len(ordered) == 1:
        gain = max(0.0, min(1.0, ordered[0]["gain"]))
        return f"volume={_fmt(gain)}"

    def expr_for(index: int) -> str:
        point = ordered[index]
        if index + 1 >= len(ordered):
            return _fmt(point["gain"])
        nxt = ordered[index + 1]
        t0 = point["t_ms"] / 1000.0
        t1 = nxt["t_ms"] / 1000.0
        g0 = point["gain"]
        g1 = nxt["gain"]
        if t1 <= t0:
            return _fmt(g1)
        inner = (
            f"{_fmt(g0)}+({_fmt(g1)}-{_fmt(g0)})*(t-{_fmt(t0)})/"
            f"{_fmt(t1 - t0)}"
        )
        return f"if(lt(t\\,{_fmt(t1)})\\,{inner}\\,{expr_for(index + 1)})"

    first_t = ordered[0]["t_ms"] / 1000.0
    body = expr_for(0)
    if first_t > 0:
        body = f"if(lt(t\\,{_fmt(first_t)})\\,{_fmt(ordered[0]['gain'])}\\,{body})"
    del duration_seconds
    return f"volume=eval=frame:volume='{body}'"


def _fmt(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"
