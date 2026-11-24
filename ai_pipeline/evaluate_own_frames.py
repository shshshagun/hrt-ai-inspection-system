"""
evaluate_own_frames.py
----------------------
Image-level test on hand-sorted frames from your own footage (see extract_frames.py). A frame counts as "detected" when the detector
reports at least one crack at the chosen confidence. Reported for the deployed model and a new one:

  * recall on frames that have a crack (how many are found)
  * false-alarm rate on frames that have none (how many get a crack that is not there)

This is deliberately simple: it needs only a folder sort, not box labels. Use it before and after every change you want to claim.

    python ai_pipeline/evaluate_own_frames.py --frames C:/hrt-data/own_frames --new C:/hrt-data/runs/hrt_v2/weights/best.pt
"""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

from compare_detectors import DEPLOYED, images_in, run_deployed, run_new


def rates(results_pos, results_neg, conf):
    hit = lambda results: [bool((s >= conf).any()) for _, s, _ in results]
    pos, neg = hit(results_pos), hit(results_neg)
    return dict(
        conf=conf,
        crack_frames=len(pos), found=int(sum(pos)), recall=round(float(np.mean(pos)) if pos else 0.0, 3),
        clean_frames=len(neg), false_alarms=int(sum(neg)), false_alarm_rate=round(float(np.mean(neg)) if neg else 0.0, 3),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--new", required=True)
    args = ap.parse_args()
    root = Path(args.frames)
    pos, neg = images_in(root / "crack"), images_in(root / "no_crack")
    if not pos or not neg:
        raise SystemExit("Put frames with cracks in crack/ and frames without in no_crack/ first.")

    from ultralytics import YOLO
    session = ort.InferenceSession(str(DEPLOYED), providers=["CPUExecutionProvider"])
    model = YOLO(args.new)
    report = {}
    for name, runner, handle in (("deployed_onnx_seg", run_deployed, session), ("new_yolov8n", run_new, model)):
        rp, rn = runner(handle, pos), runner(handle, neg)
        report[name] = [rates(rp, rn, c) for c in (0.42, 0.5, 0.6)]
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
