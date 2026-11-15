"""
ai_pipeline/evaluate_onnx.py
----------------------------
Measures the model that is actually deployed in the browser (frontend/public/models/hrt_yolov8_crack.onnx)
on a labelled split of the dataset, using only numpy, Pillow and onnxruntime (no PyTorch or OpenCV needed).

Evaluation is box-based: the dataset labels are bounding boxes, so the segmentation masks are not scored.
Each image is letter-boxed to 640 x 640 and run through the model once (the full-frame mode that the webcam
and photo modes use); the tiled video scan is not part of this benchmark.

Usage:
    python ai_pipeline/evaluate_onnx.py
    python ai_pipeline/evaluate_onnx.py --split valid --conf 0.42
"""
import argparse
import json
import platform
import statistics
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = ROOT / "frontend" / "public" / "models" / "hrt_yolov8_crack.onnx"
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "runs" / "evaluate"
SIZE = 640
NMS_IOU = 0.45
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def letterbox(img: Image.Image):
    w, h = img.size
    r = min(SIZE / w, SIZE / h)
    nw, nh = round(w * r), round(h * r)
    resized = img.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (SIZE, SIZE), (114, 114, 114))
    dx, dy = (SIZE - nw) // 2, (SIZE - nh) // 2
    canvas.paste(resized, (dx, dy))
    arr = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return arr, r, dx, dy


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """IoU between boxes a (N,4) and b (M,4) in xyxy format."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0]); y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2]); y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1]); area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, thr: float):
    order = scores.argsort()[::-1]
    keep = []
    while len(order):
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break
        ious = iou_matrix(boxes[i:i + 1], boxes[order[1:]])[0]
        order = order[1:][ious < thr]
    return keep


def predict(session, path: Path, min_conf: float):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    arr, r, dx, dy = letterbox(img)
    out = session.run(None, {session.get_inputs()[0].name: arr})[0][0]  # (37, 8400)
    scores = out[4]
    m = scores >= min_conf
    if not m.any():
        return np.zeros((0, 4)), np.zeros(0), (w, h)
    cx, cy, bw, bh = out[0][m], out[1][m], out[2][m], out[3][m]
    boxes = np.stack([(cx - bw / 2 - dx) / r, (cy - bh / 2 - dy) / r, (cx + bw / 2 - dx) / r, (cy + bh / 2 - dy) / r], 1)
    boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
    boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)
    s = scores[m]
    keep = nms(boxes, s, NMS_IOU)
    return boxes[keep], s[keep], (w, h)


def load_gt(label_path: Path, w: int, h: int) -> np.ndarray:
    rows = []
    if label_path.exists():
        for line in label_path.read_text().splitlines():
            p = line.split()
            if len(p) < 5:
                continue
            vals = list(map(float, p[1:]))
            if len(vals) == 4:  # box: cx cy w h
                cx, cy, bw, bh = vals
                rows.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
            else:  # polygon: x1 y1 x2 y2 ... -> enclosing box
                xs, ys = np.array(vals[0::2]) * w, np.array(vals[1::2]) * h
                rows.append([xs.min(), ys.min(), xs.max(), ys.max()])
    return np.array(rows).reshape(-1, 4)


def average_precision(preds, gts, iou_thr: float) -> float:
    """preds: list of (image_idx, score, box); gts: list of (N,4) per image. All-point interpolated AP."""
    n_gt = sum(len(g) for g in gts)
    if n_gt == 0:
        return 0.0
    used = [np.zeros(len(g), bool) for g in gts]
    tp, fp = [], []
    for img, score, box in sorted(preds, key=lambda p: -p[1]):
        g = gts[img]
        if len(g) == 0:
            fp.append(1); tp.append(0); continue
        ious = iou_matrix(box[None], g)[0]
        j = int(ious.argmax())
        if ious[j] >= iou_thr and not used[img][j]:
            used[img][j] = True; tp.append(1); fp.append(0)
        else:
            tp.append(0); fp.append(1)
    tp, fp = np.cumsum(tp), np.cumsum(fp)
    rec = tp / n_gt
    prec = tp / np.maximum(tp + fp, 1e-9)
    mrec = np.concatenate([[0.0], rec, [1.0]]); mpre = np.concatenate([[1.0], prec, [0.0]])
    mpre = np.flip(np.maximum.accumulate(np.flip(mpre)))
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def prf_at(preds, gts, conf: float, iou_thr: float = 0.5):
    sel = [p for p in preds if p[1] >= conf]
    n_gt = sum(len(g) for g in gts)
    used = [np.zeros(len(g), bool) for g in gts]
    tp = fp = 0
    for img, score, box in sorted(sel, key=lambda p: -p[1]):
        g = gts[img]
        if len(g):
            ious = iou_matrix(box[None], g)[0]
            j = int(ious.argmax())
            if ious[j] >= iou_thr and not used[img][j]:
                used[img][j] = True; tp += 1; continue
        fp += 1
    fn = n_gt - tp
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / n_gt if n_gt else 0.0
    f1 = 2 * p * r / (p + r) if p + r else 0.0
    return dict(conf=round(conf, 2), precision=round(p, 4), recall=round(r, 4), f1=round(f1, 4), tp=tp, fp=fp, fn=fn)


def main():
    ap = argparse.ArgumentParser(description="Benchmark the deployed ONNX model on a labelled split")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--data", default=str(DATA_DIR))
    ap.add_argument("--split", default="test", choices=["train", "valid", "test"])
    ap.add_argument("--conf", type=float, default=0.42, help="operating threshold used by the web application")
    args = ap.parse_args()

    img_dir = Path(args.data) / args.split / "images"
    lbl_dir = Path(args.data) / args.split / "labels"
    images = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in IMG_EXT)
    session = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, SIZE, SIZE), np.float32)})  # warm-up

    preds, gts, times = [], [], []
    for i, path in enumerate(images):
        t0 = time.perf_counter()
        boxes, scores, (w, h) = predict(session, path, 0.001)
        times.append((time.perf_counter() - t0) * 1000)
        gts.append(load_gt(lbl_dir / (path.stem + ".txt"), w, h))
        preds.extend((i, float(s), b) for b, s in zip(boxes, scores))

    aps = [average_precision(preds, gts, t) for t in np.arange(0.5, 0.96, 0.05)]
    sweep = [prf_at(preds, gts, c) for c in np.arange(0.05, 0.95, 0.05)]
    best = max(sweep, key=lambda r: r["f1"])
    report = dict(
        generated=datetime.now().isoformat(timespec="seconds"), model=str(Path(args.model).name),
        split=args.split, images=len(images), ground_truth_boxes=int(sum(len(g) for g in gts)),
        operating_point=prf_at(preds, gts, args.conf),
        best_f1_point=best,
        mAP_50=round(aps[0], 4), mAP_50_95=round(float(np.mean(aps)), 4),
        latency_ms_per_image=dict(mean=round(statistics.mean(times), 1), median=round(statistics.median(times), 1), p95=round(float(np.percentile(times, 95)), 1)),
        hardware=dict(cpu=platform.processor(), os=platform.platform(), onnxruntime=ort.__version__, provider="CPUExecutionProvider"),
        note="Box-based, full-frame letterbox 640x640, NMS IoU 0.45. Masks and the tiled video scan are not scored.",
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"onnx_{args.split}_report.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
