"""Simplify Pydantic JSON Schema for Gemini constrained decoding.

Gemini serving rejects schemas with too many automaton states. Typical triggers
are min/max bounds on numbers, string length/pattern matchers, and nested
array length limits. Validation stays in Pydantic after the model returns JSON.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

# JSON Schema *keywords* to drop from a schema object. Never apply these to
# keys inside ``properties`` / ``$defs`` — a field can be named "description".
_SCHEMA_KEYWORDS_TO_STRIP = frozenset(
    {
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minContains",
        "maxContains",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "pattern",
        "format",
        "minProperties",
        "maxProperties",
        "uniqueItems",
        "default",
        "examples",
        "example",
        "title",
        "description",
    }
)

_NAME_MAPS = frozenset({"properties", "patternProperties", "$defs", "defs", "definitions"})


def serving_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON Schema safe to send as Gemini ``response_json_schema``."""
    cleaned = _strip_schema(model.model_json_schema())
    if not isinstance(cleaned, dict):
        raise TypeError("JSON Schema must be an object")
    return cleaned


def _strip_schema(node: Any) -> Any:
    if isinstance(node, dict):
        cleaned: dict[str, Any] = {}
        for key, value in node.items():
            if key in _SCHEMA_KEYWORDS_TO_STRIP:
                continue
            if key in _NAME_MAPS and isinstance(value, dict):
                cleaned[key] = {name: _strip_schema(schema) for name, schema in value.items()}
            else:
                cleaned[key] = _strip_schema(value)
        return cleaned
    if isinstance(node, list):
        return [_strip_schema(item) for item in node]
    return node
