"""
train.py
--------
Trains a YOLOv8s (small) object-detection model on the Underwater Crack
Detection dataset for the HRT AI Inspection System.

The Roboflow project (type = object-detection) exports standard YOLO bounding-
box labels (class cx cy w h), so we use the 'detect' task here.

Usage:
    python ai_pipeline/train.py [--data PATH] [--epochs N] [--imgsz N] [--device cuda|cpu]

Outputs:
    runs/detect/hrt_crack_det/
        weights/best.pt     ← use this for inference
        weights/last.pt
        results.csv
        confusion_matrix.png
        PR_curve.png
        ...
"""

import argparse
import os
from pathlib import Path

from ultralytics import YOLO

# ── Default configuration ──────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
DATA_YAML   = ROOT / "data" / "data.yaml"   # written by Roboflow download
PRETRAINED  = "yolov8s.pt"                  # COCO-pretrained YOLOv8-small
PROJECT_DIR = ROOT / "runs" / "detect"
RUN_NAME    = "hrt_crack_det"
EPOCHS      = 100
PATIENCE    = 20              # early-stop if no improvement for 20 epochs
IMG_SIZE    = 640
BATCH       = 16              # reduce to 8 if GPU VRAM < 6 GB
WORKERS     = 4
DEVICE      = "0"             # "0" = first CUDA GPU; "cpu" for CPU-only
# ──────────────────────────────────────────────────────────────────────────────


def parse_args():
    p = argparse.ArgumentParser(description="Train YOLOv8s for HRT crack detection")
    p.add_argument("--data",   default=str(DATA_YAML), help="Path to data.yaml")
    p.add_argument("--epochs", type=int, default=EPOCHS)
    p.add_argument("--imgsz",  type=int, default=IMG_SIZE)
    p.add_argument("--batch",  type=int, default=BATCH)
    p.add_argument("--device", default=DEVICE, help="cuda device id or 'cpu'")
    p.add_argument("--resume", action="store_true", help="Resume last training run")
    return p.parse_args()


def main():
    args = parse_args()

    print("=" * 60)
    print("  HRT AI Inspection — YOLOv8s Training")
    print("=" * 60)
    print(f"  Data YAML : {args.data}")
    print(f"  Model     : {PRETRAINED}")
    print(f"  Epochs    : {args.epochs}  (patience={PATIENCE})")
    print(f"  Image size: {args.imgsz}")
    print(f"  Batch     : {args.batch}")
    print(f"  Device    : {args.device}")
    print("=" * 60)

    if not Path(args.data).exists():
        raise FileNotFoundError(
            f"data.yaml not found at: {args.data}\n"
            "Run  python download_dataset.py  first."
        )

    # Load pretrained weights (auto-downloads ~22 MB on first run)
    model = YOLO(PRETRAINED)

    # ── Training ────────────────────────────────────────────────────────────
    results = model.train(
        task       = "detect",
        data       = args.data,
        epochs     = args.epochs,
        patience   = PATIENCE,
        imgsz      = args.imgsz,
        batch      = args.batch,
        device     = args.device,
        workers    = WORKERS,
        project    = str(PROJECT_DIR),
        name       = RUN_NAME,
        exist_ok   = True,

        # ── Augmentation ────────────────────────────────────────────────────
        # These settings match/extend the Roboflow augmentations already
        # baked into version 3, giving extra diversity at training time.
        hsv_h      = 0.015,   # Hue jitter
        hsv_s      = 0.4,     # Saturation jitter
        hsv_v      = 0.4,     # Value (brightness) jitter
        degrees    = 15.0,    # Random rotation ±15°
        fliplr     = 0.5,     # Horizontal flip
        flipud     = 0.5,     # Vertical flip
        mosaic     = 1.0,     # Mosaic augmentation (4-image tiles)
        mixup      = 0.1,     # MixUp regularisation
        copy_paste = 0.1,     # Copy-paste augmentation
        scale      = 0.5,     # Random scale ±50 %

        # ── Optimiser ───────────────────────────────────────────────────────
        optimizer  = "AdamW",
        lr0        = 0.001,
        lrf        = 0.01,
        weight_decay = 0.0005,
        warmup_epochs = 3,

        # ── Logging & saving ────────────────────────────────────────────────
        save       = True,
        save_period = 10,     # save checkpoint every 10 epochs
        plots      = True,
        verbose    = True,
    )

    # ── Summary ─────────────────────────────────────────────────────────────
    best_weights = Path(results.save_dir) / "weights" / "best.pt"
    print("\n" + "=" * 60)
    print("  Training complete!")
    print(f"  Best weights : {best_weights}")
    print(f"  Results dir  : {results.save_dir}")
    print(f"\n  mAP@0.5      : {results.results_dict.get('metrics/mAP50(B)', 'N/A'):.4f}")
    print(f"  mAP@0.5:0.95 : {results.results_dict.get('metrics/mAP50-95(B)', 'N/A'):.4f}")
    print(f"  Precision    : {results.results_dict.get('metrics/precision(B)', 'N/A'):.4f}")
    print(f"  Recall       : {results.results_dict.get('metrics/recall(B)', 'N/A'):.4f}")
    print("=" * 60)
    print("\nNext step → evaluate:  python ai_pipeline/evaluate.py")
    print("         → inference:  python ai_pipeline/predict.py --source <video_or_image>")


if __name__ == "__main__":
    main()
