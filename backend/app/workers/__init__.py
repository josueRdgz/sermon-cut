"""Background workers.

Long-running jobs (transcription, rendering) will live here later, executed
with FastAPI background tasks / a local task runner. No Celery or Redis is used:
the app must run entirely on a single local machine.
"""
