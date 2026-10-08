"""
visualise_dataset.py
--------------------
Quick visual sanity-check for the downloaded dataset.

Displays a grid of random training images with their ground-truth
bounding boxes overlaid, so you can verify labels look correct before training.

Usage:
    python ai_pipeline/visualise_dataset.py
    python ai_pipeline/visualise_dataset.py --split val --n 16
"""

import argparse
import math
import random
from pathlib import Path

import cv2
import numpy as np
import yaml

ROOT      = Path(__file__).resolve().parent.parent
DATA_YAML = ROOT / "data" / "data.yaml"


def parse_args():
    p = argparse.ArgumentParser(description="Visualise dataset labels")
    p.add_argument("--data",  default=str(DATA_YAML))
    p.add_argument("--split", default="train", choices=["train", "val", "test"])
    p.add_argument("--n",     type=int, default=16, help="Number of images in grid")
    p.add_argument("--size",  type=int, default=320, help="Each cell size (px)")
    p.add_argument("--out",   default="", help="Save path (empty = show window)")
    return p.parse_args()


COLOURS = [
    (0, 255, 64),   # crack  – neon green
    (255, 80, 0),   # class1 – orange (if more classes added later)
    (0, 120, 255),  # class2 – blue
]


def load_yaml(path):
    with open(path) as f:
        return yaml.safe_load(f)


def draw_yolo_boxes(img, label_path, class_names):
    h, w = img.shape[:2]
    if not label_path.exists():
        return img
    with open(label_path) as f:
        lines = f.read().strip().splitlines()
    for line in lines:
        parts = line.split()
        if len(parts) < 5:
            continue
        cls_id = int(parts[0])
        cx, cy, bw, bh = map(float, parts[1:5])
        x1 = int((cx - bw / 2) * w)
        y1 = int((cy - bh / 2) * h)
        x2 = int((cx + bw / 2) * w)
        y2 = int((cy + bh / 2) * h)
        colour = COLOURS[cls_id % len(COLOURS)]
        cv2.rectangle(img, (x1, y1), (x2, y2), colour, 2)
        label = class_names[cls_id] if cls_id < len(class_names) else str(cls_id)
        cv2.putText(img, label, (x1, max(y1 - 4, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA)
    return img


def make_grid(images, cols, cell_size):
    rows = math.ceil(len(images) / cols)
    canvas = np.zeros((rows * cell_size, cols * cell_size, 3), dtype=np.uint8)
    for idx, img in enumerate(images):
        r, c = divmod(idx, cols)
        thumb = cv2.resize(img, (cell_size, cell_size))
        canvas[r * cell_size:(r + 1) * cell_size,
               c * cell_size:(c + 1) * cell_size] = thumb
    return canvas


def main():
    args   = parse_args()
    config = load_yaml(args.data)
    data_root = Path(args.data).parent

    # Resolve split path
    split_key = args.split
    split_rel = config.get(split_key, f"{split_key}/images")
    img_dir   = (data_root / split_rel).resolve()

    if not img_dir.exists():
        print(f"❌ Image directory not found: {img_dir}")
        print("   Run  python download_dataset.py  first.")
        return

    class_names = config.get("names", {})
    if isinstance(class_names, dict):
        class_names = [class_names[i] for i in sorted(class_names)]

    img_paths = sorted(list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")))
    print(f"Found {len(img_paths)} images in {img_dir}")

    sample = random.sample(img_paths, min(args.n, len(img_paths)))
    annotated = []
    for ip in sample:
        img       = cv2.imread(str(ip))
        if img is None:
            continue
        label_path = ip.parent.parent / "labels" / (ip.stem + ".txt")
        img = draw_yolo_boxes(img, label_path, class_names)
        annotated.append(img)

    cols = int(math.ceil(math.sqrt(len(annotated))))
    grid = make_grid(annotated, cols, args.size)

    if args.out:
        cv2.imwrite(args.out, grid)
        print(f"✅ Saved grid → {args.out}")
    else:
        cv2.imshow(f"Dataset: {args.split} split ({len(annotated)} images)", grid)
        print("Press any key to close...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
