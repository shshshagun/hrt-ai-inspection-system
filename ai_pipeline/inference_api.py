"""
inference_api.py
────────────────────────────────────────────────────────────────────────────────
FastAPI + YOLOv8 inference service for the HRT AI Inspection System.

Endpoints:
  POST /infer                      — Upload video, start processing job
  GET  /infer/stream/{job_id}      — SSE stream of detection results
  GET  /infer/status/{job_id}      — Polling status (JSON)
  GET  /health                     — Health check

Usage:
  uvicorn ai_pipeline.inference_api:app --host 0.0.0.0 --port 8000 --reload

CORS is configured to allow the Vite dev server (localhost:5173) and production.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sys
import uuid
from pathlib import Path
from typing import AsyncGenerator

import cv2
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("inference_api")

# ── YOLO model (lazy-loaded) ──────────────────────────────────────────────────
MODEL_PATH = Path(os.environ.get(
    "HRT_MODEL_PATH",
    "runs/detect/hrt_crack_det/weights/best.pt",
))
_model = None


def _get_model():
    """Lazy-load YOLOv8 to avoid import-time errors if ultralytics is absent."""
    global _model
    if _model is not None:
        return _model
    if not MODEL_PATH.exists():
        log.warning("Model not found at %s — using yolov8n.pt fallback", MODEL_PATH)
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")
    else:
        from ultralytics import YOLO
        _model = YOLO(str(MODEL_PATH))
    log.info("YOLO model loaded from %s", MODEL_PATH)
    return _model


# ── Spatial telemetry ─────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
try:
    from utils.spatial import SpatialTelemetry  # type: ignore
except ImportError:
    SpatialTelemetry = None  # type: ignore


def _spatial(total_frames: int) -> "SpatialTelemetry | None":
    if SpatialTelemetry is None:
        return None
    return SpatialTelemetry(mode="helix", total_frames=max(total_frames, 1))


# ── Detection backend gateway ─────────────────────────────────────────────────
DETECTIONS_API = os.environ.get("HRT_DETECTIONS_API", "http://localhost:5000/api/detections")


async def _push_detection(payload: dict) -> None:
    """Fire-and-forget push to the MongoDB gateway."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(DETECTIONS_API, json=payload)
    except Exception as exc:  # noqa: BLE001
        log.debug("Failed to push detection to gateway: %s", exc)


# ── Severity mapping ──────────────────────────────────────────────────────────
_SEVERITY: dict[str, str] = {
    "crack":    "Critical",
    "spalling": "Major",
    "leakage":  "Major",
    "erosion":  "Minor",
}

_CLOCK: list[str] = [
    "12 o'clock", "1 o'clock", "2 o'clock", "3 o'clock",
    "4 o'clock",  "5 o'clock", "6 o'clock", "7 o'clock",
    "8 o'clock",  "9 o'clock", "10 o'clock","11 o'clock",
]


def _bbox_to_clock(x_center: float, y_center: float, img_w: int, img_h: int) -> str:
    """Map bounding-box center to clock-face position (tunnel wall mapping)."""
    # Treat centre of frame as tunnel axis; map angle to clock position
    dx = x_center - img_w / 2
    dy = -(y_center - img_h / 2)      # invert Y so 12 o'clock is up
    angle = math.degrees(math.atan2(dx, dy)) % 360   # 0° = 12 o'clock
    hour  = int(round(angle / 30)) % 12
    return _CLOCK[hour]


def _bbox_to_mm(x1: float, y1: float, x2: float, y2: float) -> tuple[int, int]:
    """Rough pixel→mm estimate assuming 1 pixel ≈ 0.5 mm at ROV distance."""
    PX_TO_MM = 0.5
    w = int(abs(x2 - x1) * PX_TO_MM)
    h = int(abs(y2 - y1) * PX_TO_MM)
    return max(w, 1), max(h, 1)


# ── Job store ─────────────────────────────────────────────────────────────────
# In production replace with Redis; for the demo a simple in-process dict works.
_jobs: dict[str, dict] = {}  # job_id → {status, results_queue, ...}


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="HRT AI Inspection — Inference API",
    description="YOLOv8 video inference with Server-Sent Events streaming",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://hrt-ai-inspection-system.vercel.app",
        "*",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": str(MODEL_PATH)}


# ── POST /infer ───────────────────────────────────────────────────────────────
@app.post("/infer")
async def start_inference(video: UploadFile = File(...)) -> dict:
    """
    Accept a video file upload, persist it temporarily, start background
    inference, and return a job_id + total_frames estimate.
    """
    if not video.filename:
        raise HTTPException(400, "No filename provided")

    allowed = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    suffix = Path(video.filename).suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported format {suffix!r}. Use: {allowed}")

    job_id  = str(uuid.uuid4())
    tmp_dir = Path("/tmp") if Path("/tmp").exists() else Path(".")
    tmp_path = tmp_dir / f"hrt_{job_id}{suffix}"

    # Save upload to disk
    with tmp_path.open("wb") as f:
        while chunk := await video.read(1024 * 1024):  # 1 MB chunks
            f.write(chunk)

    # Probe frame count
    cap = cv2.VideoCapture(str(tmp_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 300
    cap.release()

    # Register job
    _jobs[job_id] = {
        "status":       "queued",
        "total_frames": total_frames,
        "video_path":   str(tmp_path),
        "queue":        asyncio.Queue(),
    }

    # Launch background task
    asyncio.create_task(_run_inference(job_id))

    log.info("Job %s queued — %d frames", job_id, total_frames)
    return {"job_id": job_id, "total_frames": total_frames}


# ── GET /infer/stream/{job_id} ────────────────────────────────────────────────
@app.get("/infer/stream/{job_id}")
async def stream_results(job_id: str):
    """SSE endpoint that streams detection events for a given job."""
    if job_id not in _jobs:
        raise HTTPException(404, f"Job {job_id!r} not found")

    return StreamingResponse(
        _sse_generator(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse_generator(job_id: str) -> AsyncGenerator[str, None]:
    """Yield SSE events from the job queue until done/error."""
    queue: asyncio.Queue = _jobs[job_id]["queue"]
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=30)
        except asyncio.TimeoutError:
            yield "data: {\"type\":\"ping\"}\n\n"
            continue

        payload = json.dumps(event)
        yield f"data: {payload}\n\n"

        if event.get("type") in ("done", "error"):
            break


# ── GET /infer/status/{job_id} ────────────────────────────────────────────────
@app.get("/infer/status/{job_id}")
async def job_status(job_id: str) -> dict:
    if job_id not in _jobs:
        raise HTTPException(404, f"Job {job_id!r} not found")
    j = _jobs[job_id]
    return {
        "job_id":       job_id,
        "status":       j["status"],
        "total_frames": j["total_frames"],
    }


# ── Background inference task ─────────────────────────────────────────────────
async def _run_inference(job_id: str) -> None:
    job   = _jobs[job_id]
    queue = job["queue"]
    path  = job["video_path"]
    total = job["total_frames"]

    job["status"] = "running"
    telem = _spatial(total)

    try:
        model = _get_model()
    except Exception as exc:
        await queue.put({"type": "error", "message": str(exc)})
        job["status"] = "error"
        return

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        await queue.put({"type": "error", "message": "Cannot open video file"})
        job["status"] = "error"
        return

    FRAME_STEP = max(1, total // 150)   # process at most ~150 frames
    frame_idx  = 0
    det_count  = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % FRAME_STEP == 0:
                # Progress event
                await queue.put({
                    "type":         "progress",
                    "frame_index":  frame_idx,
                    "total_frames": total,
                })

                # Run YOLO on this frame
                img_h, img_w = frame.shape[:2]
                results = model(frame, verbose=False)[0]

                for box in results.boxes:
                    cls_id  = int(box.cls[0])
                    cls_name = model.names.get(cls_id, str(cls_id)).lower()
                    conf     = round(float(box.conf[0]), 3)
                    if conf < 0.25:
                        continue

                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    cx = (x1 + x2) / 2
                    cy = (y1 + y2) / 2
                    clock  = _bbox_to_clock(cx, cy, img_w, img_h)
                    w_mm, h_mm = _bbox_to_mm(x1, y1, x2, y2)

                    pos = telem.position_at(frame_idx) if telem else {"x": 0, "y": 0, "z": 0}

                    detection = {
                        "type":        "detection",
                        "class":       cls_name,
                        "confidence":  conf,
                        "severity":    _SEVERITY.get(cls_name, "Info"),
                        "frame_index": frame_idx,
                        "timestamp":   round(frame_idx / max(cap.get(cv2.CAP_PROP_FPS), 1), 2),
                        "bbox":        [round(v) for v in (x1, y1, x2, y2)],
                        "clock_pos":   clock,
                        "width_mm":    w_mm,
                        "height_mm":   h_mm,
                        "chainage_z":  pos["z"],
                        "x":           pos["x"],
                        "y":           pos["y"],
                        "z":           pos["z"],
                        "job_id":      job_id,
                    }

                    await queue.put(detection)
                    asyncio.create_task(_push_detection(detection))
                    det_count += 1

                # Yield control so the event loop can flush SSE events
                await asyncio.sleep(0)

            frame_idx += 1

    finally:
        cap.release()
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass

    await queue.put({"type": "done", "total_detections": det_count})
    job["status"] = "done"
    log.info("Job %s complete — %d detections", job_id, det_count)

