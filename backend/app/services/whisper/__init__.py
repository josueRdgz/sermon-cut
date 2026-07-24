"""Local transcription with faster-whisper.

Runs fully offline (after the first model download). Execution is managed by an
in-process asyncio + ThreadPoolExecutor job manager — no Celery, no Redis.
"""
