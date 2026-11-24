"""
compare_detectors.py
--------------------
Measures the deployed detector (ONNX, YOLOv8n-seg, third party) and a new YOLOv8n weights file side by side on the SAME images:

  1. the crack test split (184 labelled images): precision, recall, F1 and mAP@0.5 at the web application's 0.42 threshold
  2. crack-free negatives (500 patches the new model never trained on): how many images get a false detection, and how many
     false detections per image, at 0.42 and at 0.5

Boxes are scored (the labels are boxes). Close-up concrete patches are not tunnel footage, so the negative result shows how often a
detector fires on plain concrete; it is not a promise about tunnel video. The number that answers the panel is the same
comparison on frames from your own footage, which need hand labels (see the --own-frames option).

    python ai_pipeline/compare_detectors.py --new C:/hrt-data/runs/hrt_v2/weights/best.pt
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from evaluate_onnx import IMG_EXT, SIZE, average_precision, load_gt, predict, prf_at

ROOT = Path(__file__).resolve().parent.parent
DEPLOYED = ROOT / "frontend" / "public" / "models" / "hrt_yolov8_crack.onnx"


def images_in(folder: Path):
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMG_EXT)


def run_deployed(session, paths):
    out = []
    for p in paths:
        boxes, scores, (w, h) = predict(session, p, 0.001)
        out.append((boxes, scores, (w, h)))
    return out


def run_new(model, paths):
    out = []
    for p in paths:
        w, h = Image.open(p).size
        r = model.predict(str(p), imgsz=SIZE, conf=0.001, iou=0.45, device=0, verbose=False)[0]
        b = r.boxes
        out.append((b.xyxy.cpu().numpy() if len(b) else np.zeros((0, 4)), b.conf.cpu().numpy() if len(b) else np.zeros(0), (w, h)))
    return out


def crack_metrics(results, paths, labels_dir: Path):
    gts, preds = [], []
    for i, ((boxes, scores, (w, h)), p) in enumerate(zip(results, paths)):
        gts.append(load_gt(labels_dir / (p.stem + ".txt"), w, h))
        preds.extend((i, float(s), b) for b, s in zip(boxes, scores))
    sweep = [prf_at(preds, gts, c) for c in np.arange(0.05, 0.95, 0.05)]
    return dict(
        at_0_42=prf_at(preds, gts, 0.42),
        at_0_50=prf_at(preds, gts, 0.50),
        best_f1=max(sweep, key=lambda r: r["f1"]),
        mAP_50=round(average_precision(preds, gts, 0.5), 4),
    )


def negative_metrics(results):
    out = {}
    for conf in (0.42, 0.50):
        counts = [int((scores >= conf).sum()) for _, scores, _ in results]
        out[f"conf_{conf}"] = dict(
            images_with_a_false_detection_pct=round(100 * np.mean([c > 0 for c in counts]), 1),
            false_detections_per_image=round(float(np.mean(counts)), 3),
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new", required=True, help="new weights (.pt)")
    ap.add_argument("--deployed", default=str(DEPLOYED))
    ap.add_argument("--data", default=str(ROOT / "data"))
    ap.add_argument("--negatives", default="C:/hrt-data/negatives/test/images")
    ap.add_argument("--out", default=str(ROOT / "runs" / "evaluate" / "compare_detectors.json"))
    args = ap.parse_args()

    from ultralytics import YOLO
    model = YOLO(args.new)
    session = ort.InferenceSession(args.deployed, providers=["CPUExecutionProvider"])

    pos = images_in(Path(args.data) / "test" / "images")
    neg = images_in(Path(args.negatives))
    labels = Path(args.data) / "test" / "labels"

    report = dict(generated=datetime.now().isoformat(timespec="seconds"), crack_test_images=len(pos), negative_images=len(neg))
    for name, runner, handle in (("deployed_onnx_seg", run_deployed, session), ("new_yolov8n", run_new, model)):
        report[name] = dict(crack_test=crack_metrics(runner(handle, pos), pos, labels), negatives=negative_metrics(runner(handle, neg)))

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
