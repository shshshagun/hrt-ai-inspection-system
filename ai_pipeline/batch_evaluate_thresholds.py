"""
batch_evaluate_thresholds.py
-----------------------------
Sweeps over confidence thresholds to find the optimal conf value
that maximises F1 score on the validation split.

Usage:
    python ai_pipeline/batch_evaluate_thresholds.py
    python ai_pipeline/batch_evaluate_thresholds.py --start 0.1 --end 0.9 --step 0.05
"""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
from ultralytics import YOLO

ROOT            = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
DATA_YAML       = ROOT / "data" / "data.yaml"
OUTPUT_DIR      = ROOT / "runs" / "threshold_sweep"


def parse_args():
    p = argparse.ArgumentParser(description="Sweep confidence thresholds")
    p.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    p.add_argument("--data",    default=str(DATA_YAML))
    p.add_argument("--split",   default="val", choices=["val", "test"])
    p.add_argument("--start",   type=float, default=0.10)
    p.add_argument("--end",     type=float, default=0.90)
    p.add_argument("--step",    type=float, default=0.05)
    p.add_argument("--device",  default="0")
    return p.parse_args()


def main():
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    model  = YOLO(str(args.weights))
    threshs = []
    precisions, recalls, f1s, maps = [], [], [], []

    conf = args.start
    while conf <= args.end + 1e-6:
        conf_r = round(conf, 3)
        print(f"\n  Testing conf={conf_r:.3f} …", end=" ", flush=True)

        metrics = model.val(
            data    = args.data,
            split   = args.split,
            conf    = conf_r,
            iou     = 0.45,
            imgsz   = 640,
            device  = args.device,
            verbose = False,
            plots   = False,
        )
        box = metrics.box
        p   = float(box.mp)
        r   = float(box.mr)
        m   = float(box.map50)
        f1  = 2 * p * r / (p + r + 1e-9)

        threshs.append(conf_r)
        precisions.append(p)
        recalls.append(r)
        f1s.append(f1)
        maps.append(m)
        print(f"P={p:.3f}  R={r:.3f}  F1={f1:.3f}  mAP50={m:.3f}")
        conf += args.step

    best_idx  = f1s.index(max(f1s))
    best_conf = threshs[best_idx]
    best_f1   = f1s[best_idx]

    print(f"\n🏆 Optimal confidence threshold: {best_conf:.3f}  (F1={best_f1:.4f})")

    # ── Save results JSON ────────────────────────────────────────────────────
    results = [
        {"conf": c, "precision": p, "recall": r, "f1": f, "mAP50": m}
        for c, p, r, f, m in zip(threshs, precisions, recalls, f1s, maps)
    ]
    json_path = OUTPUT_DIR / "threshold_sweep.json"
    with open(json_path, "w") as fh:
        json.dump({"best_conf": best_conf, "best_f1": best_f1, "results": results}, fh, indent=2)

    # ── Plot ─────────────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(threshs, precisions, label="Precision", marker="o", markersize=4)
    ax.plot(threshs, recalls,    label="Recall",    marker="s", markersize=4)
    ax.plot(threshs, f1s,        label="F1",        marker="^", markersize=4, linewidth=2)
    ax.plot(threshs, maps,       label="mAP@0.5",   marker="D", markersize=4, linestyle="--")
    ax.axvline(best_conf, color="red", linestyle=":", label=f"Best conf={best_conf}")
    ax.set_xlabel("Confidence Threshold")
    ax.set_ylabel("Score")
    ax.set_title("Confidence Threshold Sweep — HRT Crack Detection")
    ax.legend()
    ax.grid(alpha=0.3)
    plot_path = OUTPUT_DIR / "threshold_sweep.png"
    fig.savefig(str(plot_path), dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"\n  📊 Plot  → {plot_path}")
    print(f"  📄 JSON  → {json_path}")


if __name__ == "__main__":
    main()
