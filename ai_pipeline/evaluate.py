"""
ai_pipeline/evaluate.py
-----------------------
Evaluates a trained YOLOv8s model on the test split of the Underwater Crack
Detection dataset and prints/saves a full metrics report.
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

from ultralytics import YOLO

# ── Defaults ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
DATA_YAML = ROOT / "data" / "data.yaml"
RESULTS_DIR = ROOT / "runs" / "evaluate"
IMG_SIZE = 640
DEVICE = "0"
CONF_THRESH = 0.25
IOU_THRESH = 0.45
# ──────────────────────────────────────────────────────────────────────────────


def parse_args():
    p = argparse.ArgumentParser(description="Evaluate HRT crack detection model")
    p.add_argument(
        "--weights",
        default=str(DEFAULT_WEIGHTS),
        help="Path to trained weights (.pt)",
    )
    p.add_argument("--data", default=str(DATA_YAML), help="Path to data.yaml")
    p.add_argument(
        "--split",
        default="test",
        choices=["train", "val", "test"],
        help="Dataset split to evaluate on",
    )
    p.add_argument("--device", default=DEVICE)
    p.add_argument("--conf", type=float, default=CONF_THRESH)
    p.add_argument("--iou", type=float, default=IOU_THRESH)
    return p.parse_args()


def run_evaluation(weights_path: Path, data_yaml: Path, split: str, conf: float, iou: float, device: str):
    if not weights_path.exists():
        raise FileNotFoundError(
            f"Weights not found: {weights_path}\n"
            "Train the model first: python ai_pipeline/train.py"
        )

    run_name = f"eval_{split}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    save_dir = RESULTS_DIR / run_name

    model = YOLO(str(weights_path))
    metrics = model.val(
        data=str(data_yaml),
        split=split,
        imgsz=IMG_SIZE,
        device=device,
        conf=conf,
        iou=iou,
        plots=True,
        save_json=True,
        project=str(RESULTS_DIR),
        name=run_name,
        exist_ok=True,
        verbose=True,
    )

    box = metrics.box
    f1_val = (
        float(box.f1.mean())
        if hasattr(box, "f1") and len(box.f1) > 0
        else (2 * box.mp * box.mr / (box.mp + box.mr + 1e-9))
    )

    results = {
        "split": split,
        "weights": str(weights_path),
        "conf_thresh": conf,
        "iou_thresh": iou,
        "timestamp": datetime.now().isoformat(),
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "mAP_50": round(float(box.map50), 4),
        "mAP_50_95": round(float(box.map), 4),
        "f1": round(float(f1_val), 4),
        "save_dir": str(save_dir),
    }

    print("\n" + "=" * 60)
    print("  EVALUATION RESULTS")
    print("=" * 60)
    print(f"  Split        : {results['split']}")
    print(f"  Precision    : {results['precision']:.4f}  ({results['precision']*100:.1f} %)")
    print(f"  Recall       : {results['recall']:.4f}  ({results['recall']*100:.1f} %)")
    print(f"  F1 Score     : {results['f1']:.4f}")
    print(f"  mAP @ 0.5    : {results['mAP_50']:.4f}  ({results['mAP_50']*100:.1f} %)")
    print(f"  mAP @0.5:0.95: {results['mAP_50_95']:.4f}  ({results['mAP_50_95']*100:.1f} %)")
    print("=" * 60)

    report_path = save_dir / f"eval_report_{split}.json"
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n  ✅ Report saved → {report_path}")
    print(f"  📊 Plots saved  → {save_dir}")
    return results


def main():
    args = parse_args()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    run_evaluation(
        weights_path=Path(args.weights),
        data_yaml=Path(args.data),
        split=args.split,
        conf=args.conf,
        iou=args.iou,
        device=args.device,
    )


if __name__ == "__main__":
    main()
    
# here the evaluate.py works flawlessly