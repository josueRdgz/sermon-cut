"""CLI entrypoints: ``python -m app.cli doctor``."""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="Utilidades locales de Sermon Cut / Sermon Clips.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    doctor_parser = sub.add_parser(
        "doctor",
        help="Diagnóstico del entorno local (versiones, FFmpeg, SQLite, etc.).",
    )
    doctor_parser.add_argument(
        "--json",
        action="store_true",
        help="Imprime el informe en JSON (para scripts).",
    )

    migrate_parser = sub.add_parser(
        "migrate",
        help="Aplica migraciones Alembic (falla con código ≠ 0 si hay error).",
    )
    migrate_parser.add_argument(
        "--raise",
        dest="raise_on_error",
        action="store_true",
        default=True,
        help="Abortar con error (por defecto).",
    )

    args = parser.parse_args(argv)

    if args.command == "doctor":
        from app.cli.doctor import run_doctor

        return run_doctor(as_json=args.json)

    if args.command == "migrate":
        from app.core.migrate import run_migrations

        ok = run_migrations(raise_on_error=False)
        if not ok:
            print("Migración fallida. Revisa el log anterior.", file=sys.stderr)
            return 1
        print("Migraciones OK.")
        return 0

    parser.error(f"Comando desconocido: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
