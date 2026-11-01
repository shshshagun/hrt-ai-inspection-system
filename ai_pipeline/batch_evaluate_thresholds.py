"""
batch_evaluate_thresholds.py
----------------------------
Sweeps confidence thresholds (0.10 to 0.90, step 0.05) on the test split
to locate optimal operating points and generate metric curves under runs/evaluate/.
"""

import json
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from ultralytics import YOLO

# FIXED: Resolve root path correctly from within subdirectories
ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
DATA_YAML = ROOT / "data" / "data.yaml"
RESULTS_DIR = ROOT / "runs" / "evaluate" / "threshold_sweeps"

def run_sweep(device_str: str):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    if not WEIGHTS.exists():
        raise FileNotFoundError(f"Model weights not found at: {WEIGHTS}")

    model = YOLO(str(WEIGHTS))
    thresholds = np.arange(0.10, 0.95, 0.05)
    records = []

    print("=" * 70)
    print("  STARTING CONFIDENCE THRESHOLD SWEEP (0.10 to 0.90)")
    print(f"  Execution Device Engine: {device_str}")
    print("=" * 70)

    for conf in thresholds:
        conf_val = round(float(conf), 2)
        metrics = model.val(
            data=str(DATA_YAML),
            split="test",
            imgsz=640,
            conf=conf_val,
            iou=0.45,
            device=device_str, # FIXED: Dynamically passes command execution device
            plots=True,
            project=str(RESULTS_DIR),
            name=f"conf_{conf_val:.2f}",
            exist_ok=True,
            verbose=False,
        )

        box = metrics.box
        p = float(box.mp)
        r = float(box.mr)
        map50 = float(box.map50)
        map50_95 = float(box.map)
        f1 = (2 * p * r) / (p + r + 1e-9)

        records.append({
            "conf_threshold": conf_val,
            "precision": round(p, 4),
            "recall": round(r, 4),
            "f1_score": round(f1, 4),
            "mAP_50": round(map50, 4),
            "mAP_50_95": round(map50_95, 4),
        })

        print(
            f"  Conf: {conf_val:.2f} | Precision: {p:.4f} | Recall: {r:.4f} | "
            f"F1: {f1:.4f} | mAP@0.5: {map50:.4f}"
        )

    df = pd.DataFrame(records)
    csv_path = RESULTS_DIR / "confidence_sweep_results.csv"
    df.to_csv(csv_path, index=False)

    best_row = df.loc[df["f1_score"].idxmax()]

    summary = {
        "best_conf_threshold": float(best_row["conf_threshold"]),
        "peak_f1_score": float(best_row["f1_score"]),
        "precision_at_best_f1": float(best_row["precision"]),
        "recall_at_best_f1": float(best_row["recall"]),
        "mAP_50_at_best_f1": float(best_row["mAP_50"]),
    }

    with open(RESULTS_DIR / "sweep_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 70)
    print("  OPTIMAL OPERATING POINT")
    print("=" * 70)
    print(f"  Best Confidence Threshold : {summary['best_conf_threshold']}")
    print(f"  Peak F1-Score             : {summary['peak_f1_score']}")
    print(f"  Precision                 : {summary['precision_at_best_f1']}")
    print(f"  Recall                    : {summary['recall_at_best_f1']}")
    print(f"  mAP @ 0.5                 : {summary['mAP_50_at_best_f1']}")
    print(f"  Full CSV Exported To      : {csv_path}")
    print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="cpu", help="Device engine execution context")
    args = parser.parse_args()
    
    run_sweep(device_str=args.device)
