"""
extract_frames.py
-----------------
Pulls still frames out of inspection videos so they can be labelled by hand. The labelled frames are the one test that answers
"does the system find real cracks in OUR footage and leave the stains alone?".

    python ai_pipeline/extract_frames.py --video "C:/videos/run1.mp4" --out C:/hrt-data/own_frames --every 2

Then sort the frames into two folders by eye:
    C:/hrt-data/own_frames/crack/      frames that contain at least one real crack
    C:/hrt-data/own_frames/no_crack/   frames with no crack (stains, joints, shadows and clean wall all belong here)
and run  python ai_pipeline/evaluate_own_frames.py --frames C:/hrt-data/own_frames --new <weights.pt>
Frames from one video must not be split between a training set and this test set; keep this folder test-only.
"""
import argparse
from pathlib import Path

import cv2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=float, default=2.0, help="seconds between frames")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps * args.every)))
    out = Path(args.out) / "unsorted"
    out.mkdir(parents=True, exist_ok=True)
    stem = Path(args.video).stem.replace(" ", "_")
    i = saved = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % step == 0:
            cv2.imwrite(str(out / f"{stem}_{i:07d}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            saved += 1
        i += 1
    print(f"{saved} frames saved to {out}")


if __name__ == "__main__":
    main()
