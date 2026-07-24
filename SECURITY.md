# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.1.x` (main) | Yes |

## Reporting a vulnerability

Sermon Cut runs **locally** and may hold sermon videos, transcripts, and API
keys on disk. Please report security issues **privately**:

1. Prefer [GitHub Security Advisories](https://github.com/josueRdgz/sermon-cut/security/advisories/new)
   for this repository, **or**
2. Email the maintainer listed on the GitHub profile of the repo owner.

Include:

- A short description of the issue and impact
- Steps to reproduce (proof of concept if possible)
- Affected version / commit

Please **do not** open a public issue for vulnerabilities that could expose
local media, transcripts, Gemini keys, or allow remote code execution.

We aim to acknowledge reports within **7 days** and to publish a fix or
mitigation as soon as practical.

## What is out of scope

- Social-engineering of individual users’ machines
- Issues that only affect intentionally insecure local misconfiguration
  (e.g. world-writable `SERMON_CUT_STORAGE_DIR` on a shared host)
- Denial of service against a user’s own `uvicorn` process

## Hardening tips for operators

- Keep `.env` out of Git (already gitignored).
- Do not expose the API (`127.0.0.1:8000`) to the public internet without auth.
  There is **no application-level authentication** by design; any local process
  that can reach the port can read/delete projects. Prefer the Tauri shell or
  bind only to loopback.
- Treat sermon media and transcripts as sensitive pastoral data.
- See [docs/PRIVACY.md](docs/PRIVACY.md) for optional Gemini / Hugging Face flows.
- Treat `storage/` as sensitive; back it up privately.
- Never commit Whisper weights, renders, or SQLite databases.
