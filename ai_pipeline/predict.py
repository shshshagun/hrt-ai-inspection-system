"""
predict.py
----------
Runs real-time / batch inference on images or video using a trained
YOLOv8s model for the HRT AI Inspection System.

For each frame / image:
  1. Detects crack bounding boxes + confidence scores
  2. Overlays annotated results on the frame
  3. Assigns simulated spatial telemetry (X, Y, Z) from the ROV path
  4. POSTs each detection as JSON to the backend REST API
  5. Writes an annotated output video and a CSV log

Usage:
    # Run on a video file
    python ai_pipeline/predict.py --source path/to/rov_video.mp4

    # Run on a directory of images
    python ai_pipeline/predict.py --source path/to/images/

    # Run on webcam (device 0)
    python ai_pipeline/predict.py --source 0

    # Run on a single image
    python ai_pipeline/predict.py --source path/to/image.jpg

    # Disable API posting (offline mode)
    python ai_pipeline/predict.py --source vid.mp4 --no-api

    # Use custom weights
    python ai_pipeline/predict.py --source vid.mp4 \\
        --weights runs/detect/hrt_crack_det/weights/best.pt
"""

import argparse
import csv
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from utils.spatial import SpatialTelemetry
from utils.api_client import DetectionAPIClient

# ── Defaults ───────────────────────────────────────────────────────────────────
ROOT            = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
OUTPUT_DIR      = ROOT / "runs" / "predictions"
API_URL         = "http://localhost:3000/api/detections"   # Node.js REST API
CONF_THRESH     = 0.35
IOU_THRESH      = 0.45
IMG_SIZE        = 640
DEVICE          = "0"    # first CUDA GPU; "cpu" for CPU-only
CLASS_NAMES     = {0: "crack"}
# Colour per class (BGR)
CLASS_COLOURS   = {0: (0, 255, 64)}   # neon-green for cracks
# ──────────────────────────────────────────────────────────────────────────────


def parse_args():
    p = argparse.ArgumentParser(description="HRT crack detection — inference")
    p.add_argument("--source",  required=True,
                   help="Video file, image dir, webcam index (0), or image path")
    p.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    p.add_argument("--conf",    type=float, default=CONF_THRESH)
    p.add_argument("--iou",     type=float, default=IOU_THRESH)
    p.add_argument("--device",  default=DEVICE)
    p.add_argument("--imgsz",   type=int, default=IMG_SIZE)
    p.add_argument("--no-api",  action="store_true",
                   help="Disable posting detections to REST API")
    p.add_argument("--api-url", default=API_URL)
    p.add_argument("--show",    action="store_true",
                   help="Display frames in a window (requires display)")
    return p.parse_args()


def draw_detections(frame: np.ndarray, boxes, class_names, class_colours) -> np.ndarray:
    """Draw bounding boxes and labels on *frame* (in-place, returns frame)."""
    for box in boxes:
        cls_id     = int(box.cls[0].item())
        conf       = float(box.conf[0].item())
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        colour     = class_colours.get(cls_id, (0, 200, 255))
        label      = f"{class_names.get(cls_id, str(cls_id))} {conf:.2f}"

        # Box
        cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)

        # Label background
        (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(frame, (x1, y1 - th - baseline - 4),
                      (x1 + tw + 4, y1), colour, cv2.FILLED)
        cv2.putText(frame, label, (x1 + 2, y1 - baseline - 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)
    return frame


def build_detection_payload(box, class_names, telemetry: dict,
                             frame_idx: int, timestamp: str) -> dict:
    """Build the JSON payload for the REST API."""
    cls_id       = int(box.cls[0].item())
    conf         = float(box.conf[0].item())
    x1, y1, x2, y2 = box.xyxy[0].tolist()
    return {
        "class_label": class_names.get(cls_id, str(cls_id)),
        "confidence" : round(conf, 4),
        "bbox"       : {
            "x1": round(x1, 2), "y1": round(y1, 2),
            "x2": round(x2, 2), "y2": round(y2, 2),
            "width" : round(x2 - x1, 2),
            "height": round(y2 - y1, 2),
        },
        "frame_index": frame_idx,
        "timestamp"  : timestamp,
        "x"          : telemetry["x"],
        "y"          : telemetry["y"],
        "z"          : telemetry["z"],
    }


def source_is_video(source: str) -> bool:
    video_exts = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
    return Path(source).suffix.lower() in video_exts or source.isdigit()


def main():
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    weights_path = Path(args.weights)
    if not weights_path.exists():
        raise FileNotFoundError(
            f"Weights not found: {weights_path}\n"
            "Train the model first: python ai_pipeline/train.py"
        )

    print("=" * 60)
    print("  HRT AI Inspection — YOLOv8s Inference")
    print("=" * 60)
    print(f"  Source  : {args.source}")
    print(f"  Weights : {weights_path}")
    print(f"  Conf    : {args.conf}   IoU: {args.iou}")
    print(f"  Device  : {args.device}")
    print(f"  API     : {'disabled' if args.no_api else args.api_url}")
    print("=" * 60)

    model      = YOLO(str(weights_path))
    telemetry  = SpatialTelemetry()
    api_client = None if args.no_api else DetectionAPIClient(args.api_url)

    # ── Set up CSV log ───────────────────────────────────────────────────────
    run_ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = OUTPUT_DIR / f"detections_{run_ts}.csv"
    csv_file = open(csv_path, "w", newline="")
    csv_writer = csv.writer(csv_file)
    csv_writer.writerow([
        "frame_index", "timestamp", "class", "confidence",
        "x1", "y1", "x2", "y2", "width", "height",
        "rov_x", "rov_y", "rov_z", "api_status"
    ])

    # ── Video / Image source ─────────────────────────────────────────────────
    is_video = source_is_video(args.source)
    if is_video:
        source  = int(args.source) if args.source.isdigit() else args.source
        cap     = cv2.VideoCapture(source)
        fps     = cap.get(cv2.CAP_PROP_FPS) or 25
        w       = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        out_path = OUTPUT_DIR / f"annotated_{run_ts}.mp4"
        writer  = cv2.VideoWriter(
            str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)
        )
        print(f"  Video   : {w}×{h} @ {fps:.1f} fps  ({total_frames} frames)")
        print(f"  Output  : {out_path}")
    else:
        # Image directory or single image
        src_path = Path(args.source)
        if src_path.is_dir():
            img_paths = sorted(src_path.glob("*.jpg")) + sorted(src_path.glob("*.png"))
        else:
            img_paths = [src_path]
        total_frames = len(img_paths)
        print(f"  Images  : {total_frames}")
        writer = None

    print()

    # ── Inference loop ───────────────────────────────────────────────────────
    frame_idx    = 0
    total_dets   = 0
    start_time   = time.time()

    try:
        while True:
            # Read next frame / image
            if is_video:
                ok, frame = cap.read()
                if not ok:
                    break
            else:
                if frame_idx >= total_frames:
                    break
                frame = cv2.imread(str(img_paths[frame_idx]))
                if frame is None:
                    frame_idx += 1
                    continue

            ts_str    = datetime.now(timezone.utc).isoformat()
            rov_pos   = telemetry.position_at(frame_idx)

            # ── Run YOLO ────────────────────────────────────────────────────
            results = model.predict(
                source  = frame,
                conf    = args.conf,
                iou     = args.iou,
                imgsz   = args.imgsz,
                device  = args.device,
                verbose = False,
            )

            det_result = results[0]
            boxes      = det_result.boxes

            # ── Annotate frame ───────────────────────────────────────────────
            annotated = draw_detections(
                frame.copy(), boxes, CLASS_NAMES, CLASS_COLOURS
            )

            # ── Overlay HUD ─────────────────────────────────────────────────
            elapsed  = time.time() - start_time
            fps_live = frame_idx / elapsed if elapsed > 0 else 0
            hud_text = (
                f"Frame: {frame_idx}  |  "
                f"Dets: {len(boxes)}  |  "
                f"FPS: {fps_live:.1f}  |  "
                f"ROV ({rov_pos['x']:.1f}, {rov_pos['y']:.1f}, {rov_pos['z']:.1f})"
            )
            cv2.putText(annotated, hud_text, (8, 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

            if writer:
                writer.write(annotated)
            else:
                out_img_path = OUTPUT_DIR / f"frame_{frame_idx:05d}.jpg"
                cv2.imwrite(str(out_img_path), annotated)

            if args.show:
                cv2.imshow("HRT Crack Detection", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            # ── Log and POST each detection ─────────────────────────────────
            for box in boxes:
                payload    = build_detection_payload(
                    box, CLASS_NAMES, rov_pos, frame_idx, ts_str
                )
                api_status = "skipped"
                if api_client:
                    api_status = api_client.post(payload)

                csv_writer.writerow([
                    frame_idx, ts_str,
                    payload["class_label"], payload["confidence"],
                    payload["bbox"]["x1"], payload["bbox"]["y1"],
                    payload["bbox"]["x2"], payload["bbox"]["y2"],
                    payload["bbox"]["width"], payload["bbox"]["height"],
                    rov_pos["x"], rov_pos["y"], rov_pos["z"],
                    api_status,
                ])
                total_dets += 1

            frame_idx += 1

            # Progress print every 50 frames
            if frame_idx % 50 == 0:
                pct = frame_idx / total_frames * 100 if total_frames else 0
                print(f"  [{frame_idx:>5}/{total_frames}] {pct:5.1f}%  "
                      f"dets_so_far={total_dets}  fps={fps_live:.1f}")

    finally:
        csv_file.close()
        if is_video:
            cap.release()
        if writer:
            writer.release()
        if args.show:
            cv2.destroyAllWindows()

    # ── Summary ──────────────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("  Inference complete!")
    print(f"  Frames processed : {frame_idx}")
    print(f"  Total detections : {total_dets}")
    print(f"  Elapsed time     : {elapsed:.1f} s")
    print(f"  Avg FPS          : {frame_idx / elapsed:.1f}")
    print(f"  CSV log          : {csv_path}")
    if writer:
        print(f"  Output video     : {out_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
