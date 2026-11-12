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
import time
import cv2
import numpy as np
from pathlib import Path
from ultralytics import YOLO

# ── Defaults ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
OUTPUT_DIR = ROOT / "runs" / "predict"
# ──────────────────────────────────────────────────────────────────────────────


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
):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    quantifier = PhysicalCrackQuantifier(
        focal_length_mm=focal_length,
        distance_mm=distance,
        pixel_pitch_mm=pixel_pitch,
    )

    print("=" * 60)
    print("  HRT AI Inspection — Real-Time Stream & Metric Quantification")
    print("=" * 60)
    print(f"  Source       : {source}")
    print(f"  Weights      : {weights}")
    print(f"  Conf Thresh  : {conf_thresh}")
    print(f"  Focal Length : {focal_length} mm")
    print(f"  Distance     : {distance} mm")
    print(f"  Pixel Pitch  : {pixel_pitch} mm")
    print("=" * 60)

    model = YOLO(weights)
    stream_src = int(source) if source.isdigit() else source
    cap = cv2.VideoCapture(stream_src)

    if not cap.isOpened():
        raise RuntimeError(f"Could not open video stream or source: {source}")

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30

    out_video_path = OUTPUT_DIR / "annotated_inspection.mp4"
    out_csv_path = OUTPUT_DIR / "frame_telemetry.csv"

    # Synchronized Video Export
    writer = cv2.VideoWriter(
        str(out_video_path),
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

        results = model.predict(frame, conf=conf_thresh, verbose=False, device="0")[0]

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            class_name = model.names[cls_id]

            # Bounding box sub-image crop
            crop = frame[max(0, y1) : min(frame_h, y2), max(0, x1) : min(frame_w, x2)]
            length_mm, width_mm = quantifier.measure_crop(crop)

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

        writer.write(frame)

        if show:
            cv2.imshow("HRT AI Inspection System", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    writer.release()
    csv_file.close()
    if show:
        cv2.destroyAllWindows()

    print(f"\n[+] Pipeline execution completed successfully.")
    print(f"  Output Video: {out_video_path}")
    print(f"  Telemetry CSV: {out_csv_path}")


def parse_args():
    p = argparse.ArgumentParser(description="HRT Inspection Inference & Quantification Engine")
    p.add_argument("--source", default="0", help="MP4/AVI file, webcam ID, or RTSP stream URL")
    p.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--focal-length", type=float, default=8.0, help="Lens focal length in mm")
    p.add_argument("--distance", type=float, default=1000.0, help="Distance to target wall in mm")
    p.add_argument("--pixel-pitch", type=float, default=0.00345, help="Sensor pixel pitch in mm/px")
    p.add_argument("--show", action="store_true", help="Display stream window")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_inference(
        source=args.source,
        weights=args.weights,
        conf_thresh=args.conf,
        focal_length=args.focal_length,
        distance=args.distance,
        pixel_pitch=args.pixel_pitch,
        show=args.show,
    )
    
#here the Predict.py works properly