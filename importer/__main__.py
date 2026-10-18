"""CLI entry point: ``python -m importer`` (one-shot), ``--watch N``, ``--dry-run``."""

from __future__ import annotations

import argparse
import logging
import sys
import time

from .core import Config, UnsafePathError, run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Import LinkedIn posts into beaconfolio.com")
    ap.add_argument("--dry-run", action="store_true", help="do everything except POST")
    ap.add_argument(
        "--watch",
        type=int,
        metavar="SECONDS",
        default=0,
        help="re-run every N seconds instead of once",
    )
    ap.add_argument(
        "--publish", action="store_true", help="import as published (default: draft)"
    )
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    overrides = {"dry_run": args.dry_run}
    if args.publish:
        overrides["publish"] = True
    try:
        cfg = Config.from_env(**overrides)
    except UnsafePathError as exc:
        logging.error("refusing to start: %s", exc)
        return 2

    if not cfg.token and not cfg.dry_run:
        logging.error(
            "LINKEDIN_IMPORT_TOKEN is not set — refusing to import. Use --dry-run to preview."
        )
        return 2

    if args.watch:
        logging.info("watch mode: every %ds (Ctrl-C to stop)", args.watch)
        while True:
            try:
                run(cfg)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                logging.error("run failed: %s", exc)
            time.sleep(args.watch)

    summary = run(cfg)
    # Non-zero exit if any post hard-failed, so a cron wrapper can alert.
    return 0 if summary.ok else 1


if __name__ == "__main__":
    sys.exit(main())
