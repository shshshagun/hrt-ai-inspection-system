"""
utils/api_client.py
-------------------
HTTP client that POSTs detection records to the HRT backend REST API
(Node.js / Express endpoint: POST /api/detections).

Handles:
  • Connection errors (API not running) — logs warning, does not crash
  • HTTP error codes — logs and returns status string
  • Request timeouts — configurable, defaults to 2 s so inference isn't stalled
"""

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")


class DetectionAPIClient:
    """
    Sends detection payloads to the backend REST API via HTTP POST.

    Parameters
    ----------
    base_url : str
        Full URL of the detections endpoint, e.g.
        "http://localhost:3000/api/detections"
    timeout : float
        Request timeout in seconds (default 2 s — keeps inference fast).
    max_retries : int
        Number of retry attempts on connection error (default 0 — no retry
        so inference pipeline is never blocked).
    verbose : bool
        If True, logs every successful POST. Useful during development.
    """

    def __init__(
        self,
        base_url    : str   = "http://localhost:3000/api/detections",
        timeout     : float = 2.0,
        max_retries : int   = 0,
        verbose     : bool  = False,
    ):
        self.base_url    = base_url
        self.timeout     = timeout
        self.max_retries = max_retries
        self.verbose     = verbose
        self._total_sent = 0
        self._total_fail = 0

    # ── Public interface ──────────────────────────────────────────────────────

    def post(self, payload: dict) -> str:
        """
        POST a detection payload to the API.

        Parameters
        ----------
        payload : dict
            Detection record (see predict.py → build_detection_payload).

        Returns
        -------
        str
            "ok"              – 2xx response received
            "error_<code>"    – non-2xx HTTP response
            "timeout"         – request timed out
            "connection_error" – API unreachable (not running)
        """
        body = json.dumps(payload).encode("utf-8")
        req  = urllib.request.Request(
            self.base_url,
            data    = body,
            headers = {"Content-Type": "application/json", "Accept": "application/json"},
            method  = "POST",
        )

        attempts = 0
        while attempts <= self.max_retries:
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    code = resp.getcode()
                    if 200 <= code < 300:
                        self._total_sent += 1
                        if self.verbose:
                            logger.info(
                                f"[API] ✅ Posted detection  "
                                f"cls={payload.get('class_label')}  "
                                f"conf={payload.get('confidence')}  "
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

            except TimeoutError:
                self._total_fail += 1
                logger.warning(f"[API] Timeout posting frame {payload.get('frame_index')}")
                return "timeout"

            except (urllib.error.URLError, ConnectionRefusedError, OSError) as e:
                self._total_fail += 1
                if attempts == 0:
                    logger.warning(
                        f"[API] Connection error ({type(e).__name__}). "
                        f"Is the backend running at {self.base_url}? "
                        "Continuing without API posting."
                    )
                return "connection_error"

            attempts += 1
            time.sleep(0.1 * attempts)  # brief back-off before retry

        return "max_retries_exceeded"

    @property
    def stats(self) -> dict:
        """Return cumulative send statistics."""
        return {
            "total_sent": self._total_sent,
            "total_failed": self._total_fail,
        }

    def print_stats(self):
        s = self.stats
        total = s["total_sent"] + s["total_failed"]
        pct   = s["total_sent"] / total * 100 if total else 0
        print(
            f"\n  API stats: {s['total_sent']} sent / {s['total_failed']} failed "
            f"/ {total} total  ({pct:.1f}% success)"
        )


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import random

    print("Testing DetectionAPIClient (will fail gracefully if API is offline):\n")
    client = DetectionAPIClient(verbose=True)

    dummy = {
        "class_label" : "crack",
        "confidence"  : round(random.uniform(0.5, 0.99), 4),
        "bbox"        : {"x1": 100, "y1": 80, "x2": 300, "y2": 200,
                         "width": 200, "height": 120},
        "frame_index" : 42,
        "timestamp"   : "2026-09-18T08:00:00Z",
        "x": 1.2, "y": -0.5, "z": 45.3,
    }

    status = client.post(dummy)
    print(f"Status: {status}")
    client.print_stats()
