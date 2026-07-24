"""Application-level exceptions with structured API payloads."""

from __future__ import annotations


class AppError(Exception):
    """Domain error converted to a JSON response by the FastAPI handler."""

    def __init__(self, detail: str, *, code: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status_code = status_code


class NotFoundError(AppError):
    def __init__(self, detail: str = "Resource not found", *, code: str = "not_found") -> None:
        super().__init__(detail, code=code, status_code=404)


class ValidationAppError(AppError):
    def __init__(self, detail: str, *, code: str = "validation_error") -> None:
        super().__init__(detail, code=code, status_code=400)


class ConflictError(AppError):
    def __init__(self, detail: str, *, code: str = "conflict") -> None:
        super().__init__(detail, code=code, status_code=409)
