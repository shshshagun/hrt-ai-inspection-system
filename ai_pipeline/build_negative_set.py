"""
build_negative_set.py
---------------------
Adds crack-free images to the training set. The Roboflow data in data/ has no background images at all (every label file
has a box), so the detector never learned what a crack-free wall looks like and fires on stains, joints and shadows.

Negatives come from the "Concrete Crack Images for Classification" dataset (Ozgenel and Gonenc Sorguc, 2018, Mendeley Data,
CC BY 4.0): 20,000 crack-free 227 x 227 px concrete patches. They are close-up patches, not tunnel footage, so they are a
first step. The negatives that matter most are frames from the project's own footage (see --own).

Splits are blocks of file numbers (not random), because neighbouring patches usually come from the same photograph and a
random split would leak near-duplicates between train and test.

Usage (from the repository root, with the training virtual environment):
    python ai_pipeline/build_negative_set.py --source C:/hrt-data/ozgenel/Negative --out C:/hrt-data/negatives \
        --roboflow data --yaml C:/hrt-data/hrt_v2.yaml
    python ai_pipeline/build_negative_set.py ... --own C:/hrt-data/own_negatives   # your own crack-free frames, optional
"""
import argparse
import shutil
from pathlib import Path

import yaml

# (split name, first file number, last file number, keep every n-th file)
BLOCKS = [("train", 1, 16000, 14), ("valid", 16001, 18000, 13), ("test", 18001, 20000, 4)]


def number(p: Path) -> int:
    digits = "".join(ch for ch in p.stem if ch.isdigit())
    return int(digits) if digits else -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="folder with the crack-free patches (Negative/)")
    ap.add_argument("--out", required=True, help="where to write negatives/{train,valid,test}/images")
    ap.add_argument("--roboflow", default="data", help="the existing YOLO dataset folder (data/)")
    ap.add_argument("--yaml", required=True, help="dataset yaml to write")
    ap.add_argument("--own", default=None, help="optional folder of your own crack-free frames (added to train)")
    args = ap.parse_args()

    src, out, rf = Path(args.source), Path(args.out), Path(args.roboflow).resolve()
    files = sorted((p for p in src.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}), key=number)
    counts = {}
    for split, lo, hi, step in BLOCKS:
        dest = out / split / "images"
        dest.mkdir(parents=True, exist_ok=True)
        chosen = [p for p in files if lo <= number(p) <= hi][::step]
        for p in chosen:
            shutil.copy2(p, dest / f"neg_{p.name}")
        counts[split] = len(chosen)

    if args.own:
        dest = out / "train" / "images"
        own = [p for p in Path(args.own).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        for p in own:
            shutil.copy2(p, dest / f"own_{p.name}")
        counts["own (added to train)"] = len(own)

    cfg = {
        "path": str(rf),
        "train": [str(rf / "train" / "images"), str(out / "train" / "images")],
        "val": [str(rf / "valid" / "images"), str(out / "valid" / "images")],
        "test": [str(rf / "test" / "images"), str(out / "test" / "images")],
        "names": {0: "crack"},
        "nc": 1,
    }
    Path(args.yaml).write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    print("negative images:", counts)
    print("dataset yaml:", args.yaml)


if __name__ == "__main__":
    main()
