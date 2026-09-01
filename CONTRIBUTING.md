# Contributing to Sermon Cut

Thanks for helping improve **Sermon Cut** (also referred to as Sermon Clips).
This is a **local-first**, open-source tool — no Docker required for day-to-day
development.

## Code of conduct

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be respectful in issues,
PRs, and discussions.

## Development setup

### macOS

```bash
git clone https://github.com/josueRdgz/sermon-cut.git
cd sermon-cut
./scripts/clone-macos.sh          # o ./scripts/setup-macos.sh
# ./scripts/clone-macos.sh --with-desktop   # Rust + extras para el .dmg
./scripts/start-backend.sh        # terminal 1
./scripts/start-frontend.sh       # terminal 2
```

### Linux

```bash
./scripts/setup-linux.sh
./scripts/start-backend.sh
./scripts/start-frontend.sh
```

### Windows (PowerShell)

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
.\scripts\start-backend.ps1
.\scripts\start-frontend.ps1
```

Then open <http://localhost:5173>.

Diagnose the machine:

```bash
cd backend && source .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
python -m app.cli doctor
```

## Project layout

- `backend/` — FastAPI, SQLAlchemy, Alembic, FFmpeg render pipeline
- `frontend/` — React + Vite
- `scripts/` — setup / start helpers (no Docker)
- `demo/` — tiny CC0 sample media + transcript
- `storage/` — local data (gitignored); configurable via `SERMON_CUT_STORAGE_DIR`

## Coding guidelines

- Prefer small, focused PRs.
- Match existing style (Ruff on the backend, ESLint/Prettier on the frontend).
- Do not commit: videos, personal transcripts, API keys, Whisper weights, renders,
  or local SQLite files.
- Do not commit iCloud conflict copies (`audio_repair 2.py`, `Foo 2.tsx`). The
  repo lives in iCloud Drive; keep only the file without the ` 2` suffix.
- Do not add commercial music catalogues or automatic music downloads.
- Keep the app usable **without** Gemini (mock provider) and without Docker.

## Tests

```bash
# Backend
cd backend && source .venv/bin/activate
ruff check app tests
pytest

# Frontend
cd frontend
npm test
npm run build
```

## Pull requests

1. Fork and create a branch (`feat/…`, `fix/…`, `docs/…`).
2. Add/adjust tests when behaviour changes.
3. Update docs (`README.md`, `docs/`, `CHANGELOG.md`) when user-facing.
4. Fill in the PR template.
5. Ensure CI is green.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for vulnerabilities
that could put users’ local data at risk.

## License

By contributing you agree that your contributions are licensed under the MIT
License (see [LICENSE](LICENSE)).
