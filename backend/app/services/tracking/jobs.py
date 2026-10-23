"""In-memory async tracking jobs so the UI is not blocked for minutes."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from uuid import UUID

from app.db.session import SessionLocal
from app.schemas.tracking import TrackingComputeRequest, TrackingReport
from app.services.tracking import service as tracking_service


@dataclass
class TrackingJobState:
    status: str = "idle"
    error: str | None = None
    report: TrackingReport | None = None


class TrackingJobManager:
    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="framing")
        self._lock = threading.Lock()
        self._jobs: dict[UUID, TrackingJobState] = {}

    def status_for(self, reel_id: UUID) -> TrackingJobState:
        with self._lock:
            return self._jobs.get(reel_id, TrackingJobState())

    def start(self, project_id: UUID, reel_id: UUID, payload: TrackingComputeRequest) -> TrackingJobState:
        with self._lock:
            current = self._jobs.get(reel_id)
            if current and current.status in {"queued", "running"}:
                return current
            state = TrackingJobState(status="queued")
            self._jobs[reel_id] = state
        self._executor.submit(self._run, project_id, reel_id, payload)
        return state

    def _run(self, project_id: UUID, reel_id: UUID, payload: TrackingComputeRequest) -> None:
        with self._lock:
            state = self._jobs.setdefault(reel_id, TrackingJobState())
            state.status = "running"
            state.error = None
        db = SessionLocal()
        try:
            report = tracking_service.compute_tracking(db, project_id, reel_id, payload)
            with self._lock:
                state = self._jobs.setdefault(reel_id, TrackingJobState())
                state.status = "completed"
                state.report = report
                state.error = None
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                state = self._jobs.setdefault(reel_id, TrackingJobState())
                state.status = "failed"
                state.error = str(exc)
        finally:
            db.close()


_manager: TrackingJobManager | None = None


def get_tracking_job_manager() -> TrackingJobManager:
    global _manager
    if _manager is None:
        _manager = TrackingJobManager()
    return _manager
