"""
utils/api_client.py
───────────────────
HTTP client that POSTs detection records to the HRT backend REST API
(Node.js / Express endpoint: POST /api/detections).

Key capabilities:
  • Fast, non-blocking telemetry ingestion during real-time inference (default timeout: 2.0s)
  • Resilient offline detection spooling: appends failed detections to
    `runs/predict/offline_detections.jsonl` when the API is offline / unreachable
  • Offline queue synchronization: `sync_offline_detections()` flushes queued
    records to the live API and truncates/purges transmitted lines
  • CLI with `--sync`, `--url`, `--spool-file`, `--timeout`, and `--test` options
"""

import argparse
import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Union

logger = logging.getLogger("hrt.api_client")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

# ── Paths & Defaults ──────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_SPOOL_PATH = ROOT / "runs" / "predict" / "offline_detections.jsonl"
DEFAULT_API_URL = os.environ.get("HRT_API_URL", "http://localhost:3000/api/detections")


class DetectionAPIClient:
    """
    Sends detection payloads to the backend REST API via HTTP POST with automatic
    offline queue spooling and backlog synchronization.

    Parameters
    ----------
    base_url : str
        Full URL of the detections endpoint (e.g. "http://localhost:3000/api/detections").
    timeout : float
        Request timeout in seconds (default 2.0 s — keeps inference fast).
    max_retries : int
        Number of retry attempts on connection error (default 0 — no retry
        so inference pipeline is never blocked).
    verbose : bool
        If True, logs every successful POST and spool action.
    spool_path : Path or str, optional
        Custom path for the offline detection JSONL buffer.
    auto_spool : bool
        If True, automatically spools detections when the backend is unreachable.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_API_URL,
        timeout: float = 2.0,
        max_retries: int = 0,
        verbose: bool = False,
        spool_path: Optional[Union[str, Path]] = None,
        auto_spool: bool = True,
    ):
        self.base_url = base_url
        self.timeout = timeout
        self.max_retries = max_retries
        self.verbose = verbose
        self.spool_path = Path(spool_path) if spool_path else DEFAULT_SPOOL_PATH
        self.auto_spool = auto_spool

        self._total_sent = 0
        self._total_fail = 0
        self._total_spooled = 0
        self._total_synced = 0

    # ── Public interface ──────────────────────────────────────────────────────

    def post(self, payload: dict) -> str:
        """Alias for post_detection for backward compatibility."""
        return self.post_detection(payload)

    def post_detection(self, payload: dict, spool_on_error: Optional[bool] = None) -> str:
        """
        POST a detection payload to the API.

        Parameters
        ----------
        payload : dict
            Detection record (e.g., class_label, confidence, bbox, frame_index, etc.).
        spool_on_error : bool, optional
            Whether to spool to offline buffer on network error/timeout.
            Defaults to self.auto_spool if None.

        Returns
        -------
        str
            "ok"               – 2xx response received
            "error_<code>"     – non-2xx HTTP response
            "timeout"          – request timed out
            "connection_error" – API unreachable (connection refused, host down, etc.)
        """
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base_url,
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )

        should_spool = self.auto_spool if spool_on_error is None else spool_on_error
        attempts = 0

        while attempts <= self.max_retries:
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    code = resp.getcode()
                    if 200 <= code < 300:
                        self._total_sent += 1
                        if self.verbose:
                            logger.info(
                                f"[API] ✅ Posted detection: "
                                f"cls={payload.get('class_label')} "
                                f"conf={payload.get('confidence')} "
                                f"frame={payload.get('frame_index')}"
                            )
                        return "ok"
                    else:
                        self._total_fail += 1
                        logger.warning(f"[API] HTTP {code} for frame {payload.get('frame_index')}")
                        return f"error_{code}"

            except urllib.error.HTTPError as e:
                self._total_fail += 1
                logger.warning(f"[API] HTTP error {e.code}: {e.reason}")
                return f"error_{e.code}"

            except (TimeoutError, socket.timeout) as e:
                self._total_fail += 1
                logger.warning(f"[API] Timeout posting frame {payload.get('frame_index')}: {e}")
                if should_spool:
                    self.spool_detection(payload)
                return "timeout"

            except (urllib.error.URLError, ConnectionRefusedError, OSError) as e:
                self._total_fail += 1
                is_timeout = isinstance(getattr(e, "reason", None), (TimeoutError, socket.timeout))
                status = "timeout" if is_timeout else "connection_error"

                if attempts == 0:
                    logger.warning(
                        f"[API] Connection error ({type(e).__name__}). "
                        f"Is the backend running at {self.base_url}? "
                        f"{'Spooling detection offline.' if should_spool else 'Continuing without API posting.'}"
                    )
                if should_spool:
                    self.spool_detection(payload)
                return status

            attempts += 1
            time.sleep(0.1 * attempts)

        return "max_retries_exceeded"

    def spool_detection(
        self,
        payload: dict,
        spool_path: Optional[Union[str, Path]] = None,
    ) -> bool:
        """
        Append a failed detection record to the offline JSONL spool file.
        Creates parent directories automatically if they do not exist.
        """
        target = Path(spool_path) if spool_path else self.spool_path
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self._total_spooled += 1
            if self.verbose:
                logger.info(f"[API] Spooled detection to offline queue: {target}")
            return True
        except Exception as err:
            logger.error(f"[API] Failed to write offline spool at {target}: {err}")
            return False

    def sync_offline_detections(
        self,
        spool_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Any]:
        """
        Read queued detection records from the offline JSONL spool file,
        attempt to POST each to the live backend API, and purge successfully
        transmitted records while retaining any that still fail.

        Returns
        -------
        dict
            {"total": int, "synced": int, "failed": int, "remaining": int}
        """
        target = Path(spool_path) if spool_path else self.spool_path

        if not target.is_file():
            logger.info(f"[API Sync] No offline spool file found at {target}.")
            return {"total": 0, "synced": 0, "failed": 0, "remaining": 0}

        try:
            with open(target, "r", encoding="utf-8") as f:
                raw_lines = [line.strip() for line in f if line.strip()]
        except Exception as err:
            logger.error(f"[API Sync] Could not read spool file {target}: {err}")
            return {"total": 0, "synced": 0, "failed": 0, "remaining": 0}

        total_lines = len(raw_lines)
        if total_lines == 0:
            logger.info(f"[API Sync] Offline spool file {target} is empty.")
            return {"total": 0, "synced": 0, "failed": 0, "remaining": 0}

        logger.info(f"[API Sync] Processing {total_lines} queued offline detection(s) -> {self.base_url}...")

        synced_count = 0
        failed_lines = []

        for idx, line in enumerate(raw_lines, start=1):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as err:
                logger.warning(f"[API Sync] Line {idx} is invalid JSON ({err}) — skipping.")
                continue

            # Post with spool_on_error=False so we never re-spool during sync
            status = self.post_detection(payload, spool_on_error=False)

            if status == "ok":
                synced_count += 1
                self._total_synced += 1
                if self.verbose:
                    logger.info(
                        f"[API Sync] [{idx}/{total_lines}] Transmitted: "
                        f"{payload.get('class_label')} (frame {payload.get('frame_index')})"
                    )
            else:
                failed_lines.append(line)
                logger.warning(
                    f"[API Sync] [{idx}/{total_lines}] Failed to send record: status={status}"
                )

        # Update spool file: purge successfully transmitted records
        try:
            if not failed_lines:
                target.write_text("", encoding="utf-8")
                logger.info(f"[API Sync] ✅ All {synced_count} queued detection(s) synced. Spool file cleared.")
            else:
                with open(target, "w", encoding="utf-8") as f:
                    for fl in failed_lines:
                        f.write(fl + "\n")
                logger.warning(
                    f"[API Sync] ⚠️ Partial sync: {synced_count} transmitted, "
                    f"{len(failed_lines)} remaining in {target}."
                )
        except Exception as err:
            logger.error(f"[API Sync] Failed to update spool file {target}: {err}")

        return {
            "total": total_lines,
            "synced": synced_count,
            "failed": len(failed_lines),
            "remaining": len(failed_lines),
        }

    @property
    def stats(self) -> dict:
        """Return cumulative telemetry statistics."""
        return {
            "total_sent": self._total_sent,
            "total_failed": self._total_fail,
            "total_spooled": self._total_spooled,
            "total_synced": self._total_synced,
        }

    def print_stats(self):
        s = self.stats
        total = s["total_sent"] + s["total_failed"]
        pct = (s["total_sent"] / total * 100) if total else 0.0
        print(
            f"\n  API stats: {s['total_sent']} sent / {s['total_failed']} failed "
            f"/ {s['total_spooled']} spooled / {total} total ({pct:.1f}% success)"
        )


# ── Module-level helper functions ─────────────────────────────────────────────

def sync_offline_detections(
    spool_path: Optional[Union[str, Path]] = None,
    base_url: str = DEFAULT_API_URL,
    timeout: float = 2.0,
    verbose: bool = False,
) -> Dict[str, Any]:
    """
    Convenience function to flush queued offline detections to the backend API.
    """
    client = DetectionAPIClient(
        base_url=base_url,
        timeout=timeout,
        verbose=verbose,
        auto_spool=False,
    )
    return client.sync_offline_detections(spool_path=spool_path)


def post_detection(
    payload: dict,
    base_url: str = DEFAULT_API_URL,
    timeout: float = 2.0,
    spool_path: Optional[Union[str, Path]] = None,
) -> str:
    """
    Convenience function to POST a single detection record with offline spool fallback.
    """
    client = DetectionAPIClient(
        base_url=base_url,
        timeout=timeout,
        spool_path=spool_path,
        auto_spool=True,
    )
    return client.post_detection(payload)


# ── CLI Entry Point ───────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="HRT Detection API Client & Offline Telemetry Spooler",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_API_URL,
        help="Backend REST API detections endpoint URL",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="Synchronize queued offline detections from spool file to live backend",
    )
    parser.add_argument(
        "--spool-file",
        default=str(DEFAULT_SPOOL_PATH),
        help="Path to offline detections JSONL spool file",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="HTTP request timeout in seconds",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Transmit a synthetic detection payload (spools offline if backend is unreachable)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose debug logging",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    client = DetectionAPIClient(
        base_url=args.url,
        timeout=args.timeout,
        verbose=args.verbose,
        spool_path=args.spool_file,
    )

    if args.sync:
        print(f"\n[+] Synchronizing offline detection spool: {args.spool_file}")
        print(f"    Target endpoint: {args.url}")
        res = client.sync_offline_detections(args.spool_file)
        print(f"    Result: {res['synced']} synced / {res['failed']} failed / {res['total']} total records")
        sys.exit(0 if res["failed"] == 0 else 1)

    # If --test or executed directly without arguments: run a safe self-test
    print(f"Testing DetectionAPIClient (target: {args.url})...")
    test_record = {
        "class_label": "crack",
        "confidence": 0.925,
        "bbox": {
            "x1": 120.0,
            "y1": 80.0,
            "x2": 320.0,
            "y2": 210.0,
            "width": 200.0,
            "height": 130.0,
        },
        "frame_index": 105,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "x": 0.5,
        "y": -0.2,
        "z": 10.5,
    }

    status = client.post_detection(test_record)
    print(f"  Post status: {status}")
    client.print_stats()

    if status in ("connection_error", "timeout"):
        print(f"  Offline spool file updated: {client.spool_path}")
        print("  Run with --sync once the backend API is live to flush the spool.")


if __name__ == "__main__":
    main()
