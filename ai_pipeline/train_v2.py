"""
train_v2.py
-----------
Fine-tunes a COCO-pretrained YOLOv8n detector on the crack data plus crack-free background images, sized for a laptop GPU with
4 GB of VRAM (about 1.3 GB of it is already used by the desktop). Resumable, and `--fraction` makes a quick speed test.

    python ai_pipeline/train_v2.py --data C:/hrt-data/hrt_v2.yaml --epochs 1 --fraction 0.1 --name bench       # speed test
    python ai_pipeline/train_v2.py --data C:/hrt-data/hrt_v2.yaml --epochs 60 --name hrt_v2                      # real run
    python ai_pipeline/train_v2.py --data C:/hrt-data/hrt_v2.yaml --name hrt_v2 --resume                         # after an interruption
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="yolov8n.pt", help="COCO-pretrained starting weights")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--fraction", type=float, default=1.0)
    ap.add_argument("--patience", type=int, default=15)
    ap.add_argument("--name", default="hrt_v2")
    ap.add_argument("--project", default=str(Path("C:/hrt-data/runs")))
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if args.resume:
        model = YOLO(str(Path(args.project) / args.name / "weights" / "last.pt"))
        model.train(resume=True)
        return

    model = YOLO(args.model)
    model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, workers=args.workers,
        fraction=args.fraction, patience=args.patience, device=0, amp=True, cache=False,
        project=args.project, name=args.name, exist_ok=True, plots=True, seed=0,
        close_mosaic=5,  # the last 5 epochs without mosaic: what the model sees then looks like real frames
        # cracks are thin: avoid augmentations that destroy them
        mosaic=1.0, mixup=0.0, degrees=0.0, perspective=0.0, fliplr=0.5, flipud=0.0, scale=0.4,
    )


if __name__ == "__main__":
    main()
