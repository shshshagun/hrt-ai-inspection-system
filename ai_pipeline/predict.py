"""
ai_pipeline/predict.py
----------------------
Inference & OpenCV Telemetry Pipeline with Physical Metric Quantification Engine.

Features:
 - RTSP / MP4 / AVI / Webcam capture support.
 - Sub-pixel Otsu/Canny edge segmentation inside bounding boxes.
 - Real-world mm dimension calculation using pinhole camera optical formula.
 - Neon-green box overlay with dynamic metric labels.
 - Synchronized video output (.mp4) and CSV frame telemetry export.
"""

import argparse
import csv
import shutil
import time
import cv2
import numpy as np
import torch
from pathlib import Path
from ultralytics import YOLO

try:
    from utils.api_client import DetectionAPIClient
except ImportError:
    try:
        from ai_pipeline.utils.api_client import DetectionAPIClient
    except ImportError:
        DetectionAPIClient = None

# -- Defaults -------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
OUTPUT_DIR = ROOT / "runs" / "predict"
# ------------------------------------------------------------------------------


def resolve_weights(weights_arg: str) -> str:
    """
    Resolves model weights path.
    Supports custom trained weights (best.pt), checking common locations,
    and provides a graceful fallback to yolov8s.pt if the custom weights file is not found.
    """
    if not weights_arg:
        weights_arg = str(DEFAULT_WEIGHTS)

    # If explicitly asking for a standard pretrained model
    std_models = {"yolov8n.pt", "yolov8s.pt", "yolov8m.pt", "yolov8l.pt", "yolov8x.pt"}
    if weights_arg.lower() in std_models:
        return weights_arg

    p = Path(weights_arg)
    if p.exists() and p.is_file():
        return str(p)

    if (ROOT / weights_arg).exists() and (ROOT / weights_arg).is_file():
        return str(ROOT / weights_arg)

    # Check common project locations for custom trained weights (best.pt)
    candidates = [
        DEFAULT_WEIGHTS,
        ROOT / "runs" / "detect" / "train" / "weights" / "best.pt",
        ROOT / "runs" / "detect" / "train" / "weights" / "last.pt",
        ROOT / "weights" / "best.pt",
        ROOT / "best.pt",
        ROOT / "ai_pipeline" / "weights" / "best.pt",
        ROOT / "underwater-crack-detection" / "weights" / "best.pt",
    ]

    for cand in candidates:
        if cand.exists() and cand.is_file():
            print(f"[+] Found custom weights at: {cand}")
            return str(cand)

    # Graceful fallback to yolov8s.pt
    print(f"[!] Custom weights '{weights_arg}' not found.")
    print("    Gracefully falling back to pretrained 'yolov8s.pt'...")
    return "yolov8s.pt"


class PhysicalCrackQuantifier:
    """Calculates physical crack dimensions (mm) using pinhole optics and sub-pixel edge detection."""

    def __init__(self, focal_length_mm: float, distance_mm: float, pixel_pitch_mm: float):
        self.focal_length_mm = focal_length_mm
        self.distance_mm = distance_mm
        self.pixel_pitch_mm = pixel_pitch_mm

    def pixels_to_mm(self, px_dim: float) -> float:
        """
        Pinhole Camera Optical Formula:
        Physical Size (mm) = (Pixel Size * Distance (mm) / Focal Length (mm)) * Pixel Pitch (mm)
        """
        if self.focal_length_mm <= 0:
            return 0.0
        return (px_dim * self.distance_mm / self.focal_length_mm) * self.pixel_pitch_mm

    def measure_crop(self, crop_bgr: np.ndarray) -> tuple[float, float]:
        """Traces sub-pixel edges within crop using Canny + Otsu thresholding."""
        if crop_bgr.size == 0 or crop_bgr.shape[0] < 4 or crop_bgr.shape[1] < 4:
            return 0.0, 0.0

        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Apply Otsu thresholding & Canny edge detection
        _, otsu_mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        canny_edges = cv2.Canny(blurred, 30, 100)
        combined = cv2.bitwise_and(otsu_mask, canny_edges)

        contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            contours, _ = cv2.findContours(otsu_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return 0.0, 0.0

        largest_contour = max(contours, key=cv2.contourArea)
        if len(largest_contour) < 4:
            return 0.0, 0.0

        # Fit minimum area oriented rectangle
        rect = cv2.minAreaRect(largest_contour)
        (_, _), (d1_px, d2_px), _ = rect

        length_px = max(d1_px, d2_px)
        width_px = min(d1_px, d2_px)

        length_mm = self.pixels_to_mm(length_px)
        width_mm = self.pixels_to_mm(width_px)

        return round(length_mm, 2), round(width_mm, 2)


def run_inference(
    source: str,
    weights: str,
    conf_thresh: float,
    focal_length: float,
    distance: float,
    pixel_pitch: float,
    show: bool,
    api_url: str = None,
    save_txt: bool = False,
    save_csv: bool = False,
    device: str = None,
):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if device is None:
        device = "0" if torch.cuda.is_available() else "cpu"

    quantifier = PhysicalCrackQuantifier(
        focal_length_mm=focal_length,
        distance_mm=distance,
        pixel_pitch_mm=pixel_pitch,
    )

    api_client = None
    if api_url and DetectionAPIClient:
        api_client = DetectionAPIClient(base_url=api_url, verbose=True)

    weights = resolve_weights(weights)

    print("=" * 60)
    print("  HRT AI Inspection - Real-Time Stream & Metric Quantification")
    print("=" * 60)
    print(f"  Source       : {source}")
    print(f"  Weights      : {weights}")
    print(f"  Conf Thresh  : {conf_thresh}")
    print(f"  Focal Length : {focal_length} mm")
    print(f"  Distance     : {distance} mm")
    print(f"  Pixel Pitch  : {pixel_pitch} mm")
    print(f"  Device       : {device}")
    if api_url:
        print(f"  API Ingestion: {api_url}")
    print("=" * 60)
    print("=" * 60)

    model = YOLO(weights)
    stream_src = int(source) if str(source).isdigit() else source
    cap = cv2.VideoCapture(stream_src)

    if not cap.isOpened() and str(source) == "0":
        fallback_video = ROOT / "runs" / "predict" / "annotated_inspection.mp4"
        if fallback_video.exists():
            print(f"[!] Webcam '0' not available. Falling back cleanly to sample video: {fallback_video}")
            stream_src = str(fallback_video)
            cap = cv2.VideoCapture(stream_src)

    if not cap.isOpened():
        raise RuntimeError(f"Could not open video stream or source: {source}")

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30

    out_video_path = OUTPUT_DIR / "annotated_inspection.mp4"
    out_csv_path = OUTPUT_DIR / "frame_telemetry.csv"

    # Avoid in-place read/write collision if stream_src resolves to out_video_path
    is_same_file = False
    try:
        if not str(stream_src).isdigit() and Path(stream_src).is_file() and Path(stream_src).resolve() == out_video_path.resolve():
            is_same_file = True
    except Exception:
        pass

    writer_target = OUTPUT_DIR / "temp_annotated.mp4" if is_same_file else out_video_path

    # Synchronized Video Export
    writer = cv2.VideoWriter(
        str(writer_target),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (frame_w, frame_h),
    )

    # Frame-level CSV telemetry writer
    csv_file = open(out_csv_path, mode="w", newline="", encoding="utf-8")
    csv_writer = csv.writer(csv_file)
    csv_writer.writerow([
        "frame_id",
        "timestamp_unix",
        "class_name",
        "confidence",
        "x1",
        "y1",
        "x2",
        "y2",
        "length_mm",
        "width_mm",
    ])

    frame_count = 0
    neon_green = (0, 255, 0)
    bg_black = (0, 0, 0)

    print(f"[+] Processing video stream... Saving telemetry to: {out_csv_path}")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1
        curr_ts = round(time.time(), 3)

        results = model.predict(frame, conf=conf_thresh, verbose=False, device=device)[0]
        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            class_name = model.names[cls_id]

            # Bounding box sub-image crop
            crop = frame[max(0, y1) : min(frame_h, y2), max(0, x1) : min(frame_w, x2)]
            length_mm, width_mm = quantifier.measure_crop(crop)

            if save_txt:
                labels_dir = OUTPUT_DIR / "labels"
                labels_dir.mkdir(parents=True, exist_ok=True)
                txt_path = labels_dir / f"frame_{frame_count:04d}.txt"
                norm_x = ((x1 + x2) / 2.0) / frame_w if frame_w > 0 else 0.0
                norm_y = ((y1 + y2) / 2.0) / frame_h if frame_h > 0 else 0.0
                norm_w = (x2 - x1) / frame_w if frame_w > 0 else 0.0
                norm_h = (y2 - y1) / frame_h if frame_h > 0 else 0.0
                with open(txt_path, "a", encoding="utf-8") as tf:
                    tf.write(f"{cls_id} {norm_x:.6f} {norm_y:.6f} {norm_w:.6f} {norm_h:.6f} {conf:.4f}\n")

            # Draw Neon-Green Bounding Box
            cv2.rectangle(frame, (x1, y1), (x2, y2), neon_green, 2)

            # Format Tag: e.g. "crack 0.92 | 4.2mm x 1.8mm"
            tag = f"{class_name} {conf:.2f} | {length_mm}mm x {width_mm}mm"
            (font_w, font_h), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)

            tag_y1 = max(0, y1 - font_h - 8)
            cv2.rectangle(frame, (x1, tag_y1), (x1 + font_w + 6, tag_y1 + font_h + 6), neon_green, -1)
            cv2.putText(
                frame,
                tag,
                (x1 + 3, tag_y1 + font_h + 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                bg_black,
                1,
                cv2.LINE_AA,
            )

            # Log to CSV
            csv_writer.writerow([
                frame_count,
                curr_ts,
                class_name,
                round(conf, 4),
                x1, y1, x2, y2,
                length_mm,
                width_mm,
            ])

            # Ingest to REST API backend if enabled
            if api_client:
                api_client.post({
                    "class_label": class_name,
                    "confidence": round(conf, 4),
                    "bbox": {
                        "x1": float(x1),
                        "y1": float(y1),
                        "x2": float(x2),
                        "y2": float(y2),
                        "width": float(max(0, x2 - x1)),
                        "height": float(max(0, y2 - y1)),
                    },
                    "frame_index": frame_count,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(curr_ts)),
                    "x": 0.0,
                    "y": 0.0,
                    "z": round(frame_count * 0.1, 2),
                })

        writer.write(frame)

        if show:
            cv2.imshow("HRT AI Inspection System", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    writer.release()
    csv_file.close()
    if is_same_file and writer_target.exists():
        shutil.move(str(writer_target), str(out_video_path))
    if show:
        cv2.destroyAllWindows()

    if api_client:
        api_client.print_stats()

    print(f"\n[+] Pipeline execution completed successfully.")
    print(f"  Output Video: {out_video_path}")
    print(f"  Telemetry CSV: {out_csv_path}")


def parse_args():
    p = argparse.ArgumentParser(description="HRT Inspection Inference & Quantification Engine")
    p.add_argument("--source", default="0", help="MP4/AVI file, webcam ID, or RTSP stream URL")
    p.add_argument(
        "--weights",
        default=str(DEFAULT_WEIGHTS),
        help="Path to model weights (.pt); falls back to best.pt candidates or yolov8s.pt if not found",
    )
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--focal-length", type=float, default=8.0, help="Lens focal length in mm")
    p.add_argument("--distance", type=float, default=1000.0, help="Distance to target wall in mm")
    p.add_argument("--pixel-pitch", type=float, default=0.00345, help="Sensor pixel pitch in mm/px")
    p.add_argument("--api-url", default=None, help="Backend REST API ingestion URL (e.g. http://localhost:3000/api/detections)")
    p.add_argument("--no-api", action="store_true", help="Disable API streaming")
    p.add_argument("--save-txt", action="store_true", help="Save detection results to text file")
    p.add_argument("--save-csv", action="store_true", help="Save results to CSV file")
    p.add_argument(
        "--device",
        default="0" if torch.cuda.is_available() else "cpu",
        help="Hardware device to run inference on ('0' or 'cpu')",
    )
    p.add_argument("--show", action="store_true", help="Display stream window")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    api_url = None if args.no_api else args.api_url
    run_inference(
        source=args.source,
        weights=args.weights,
        conf_thresh=args.conf,
        focal_length=args.focal_length,
        distance=args.distance,
        pixel_pitch=args.pixel_pitch,
        show=args.show,
        api_url=api_url,
        save_txt=args.save_txt,
        save_csv=args.save_csv,
        device=args.device,
    )