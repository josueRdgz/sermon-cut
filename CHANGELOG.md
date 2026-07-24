# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Tauri 2 desktop shell (local FastAPI on `127.0.0.1`, system FFmpeg).
- `docs/PRIVACY.md`, `docs/LICENSING.md`, `docs/DESKTOP.md`, `docs/PENDING.md`.
- Startup reconciliation of orphaned render/transcription/analysis jobs.
- SQLite `foreign_keys=ON`, WAL, and `busy_timeout`.
- Pastoral / privacy disclaimers in export and Gemini UI.
- Frontend `ErrorBoundary` and Escape/focus on confirm dialogs.

### Fixed

- Project status no longer flips to completed/failed while sibling renders run.
- Whisper audio extract respects cancel (terminates FFmpeg).
- Render cancel checked through verify/finalize.
- ASS karaoke encodes pauses between words; crossfade cues no longer double-stack.
- Subtitle / end-card font candidates for Windows and Linux.
- README claim of missing subtitles/end card; “100% local” wording clarified.
- Separate size limits for cover/logo/music uploads; magic-byte sniffing.
- Render reports and reveal responses no longer expose absolute filesystem paths.
- x264 `-preset` values whitelisted.

### Changed

- Cross-platform setup scripts (`scripts/setup-macos.sh`, `setup-linux.sh`,
  `setup-windows.ps1`) and start scripts for backend/frontend.
- `python -m app.cli doctor` diagnostics (Python/Node/npm/FFmpeg/FFprobe,
  permissions, SQLite, disk, Gemini, Whisper).
- Configurable storage root (`SERMON_CUT_STORAGE_DIR`) and safe auto-migrations
  on API startup.
- Export profiles (YouTube Shorts, Facebook/Instagram Reels, WhatsApp Status),
  size estimates, SHA-256, FFprobe verification, JSON reports.
- Optional local background music with ducking and loudness controls.
- Demo CC0 sample clip + transcript under `demo/`.
- Community files: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates,
  GitHub Actions CI.
- README targets macOS, Windows, and Linux (still no Docker requirement).

## [0.1.0] — 2026-07-24

### Added

- Local projects, transcripts (SRT/VTT/JSON/TXT), faster-whisper transcription.
- Multi-segment Reels, FFmpeg render, ASS subtitles, mandatory Pillow end cards.
- Optional Gemini editorial analysis (mock fallback), join coherence, cut
  suggestions, vertical subject tracking.
- MIT license.
