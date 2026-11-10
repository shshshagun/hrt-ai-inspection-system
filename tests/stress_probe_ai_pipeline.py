"""
tests/stress_probe_ai_pipeline.py
Empirical Stress Test Probe for AI Vision Pipeline (predict.py)
Tests boundary CLI invocations, hardware device selection, fallback cascades, and export flags.
"""

import os
import sys
import tempfile
import time
from pathlib import Path
import cv2
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from ai_pipeline.predict import (
    resolve_weights,
    PhysicalCrackQuantifier,
    run_inference,
    DEFAULT_WEIGHTS,
    OUTPUT_DIR,
)

print("=" * 66)
print("  STRESS PROBE 3: AI Pipeline predict.py Boundary & Fallback Tests")
print("=" * 66)

total_checks = 0
passed_checks = 0

def check(label, condition, details=""):
    global total_checks, passed_checks
    total_checks += 1
    if condition:
        passed_checks += 1
        print(f"  [PASS] {label}")
    else:
        print(f"  [FAIL] {label} - {details}")

# Create a small, deterministic test clip (10 frames of 640x480 with synthetic crack-like features)
def create_test_video(filepath: Path, num_frames=10):
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(filepath), fourcc, 10.0, (640, 480))
    for i in range(num_frames):
        frame = np.full((480, 640, 3), 120, dtype=np.uint8) # concrete gray
        # Add high-contrast crack line
        cv2.line(frame, (100 + i * 5, 100), (300 + i * 5, 350), (20, 20, 20), 4)
        out.write(frame)
    out.release()

test_video_path = OUTPUT_DIR / "stress_test_clip.mp4"
create_test_video(test_video_path, num_frames=10)
check("Synthetic 10-frame test video created successfully", test_video_path.exists())

# ---------------------------------------------------------------------------
# Test 3.1: Full boundary CLI invocation
# Flags: --no-api, --save-txt, --save-csv, --device cpu
# ---------------------------------------------------------------------------
print("\n--- Test 3.1: Boundary Flags (--no-api, --save-txt, --save-csv, --device cpu) ---")

# Clean labels directory if exists from previous runs to test fresh creation
labels_dir = OUTPUT_DIR / "labels"
if labels_dir.exists():
    for f in labels_dir.glob("*.txt"):
        try: f.unlink()
        except Exception: pass

t0 = time.time()
try:
    run_inference(
        source=str(test_video_path),
        weights=str(DEFAULT_WEIGHTS),
        conf_thresh=0.10,
        focal_length=8.0,
        distance=1000.0,
        pixel_pitch=0.00345,
        show=False,
        api_url=None, # equivalent to --no-api
        save_txt=True,
        save_csv=True,
        device="cpu",
    )
    run_3_1_ok = True
except Exception as e:
    run_3_1_ok = False
    print(f"Run 3.1 raised exception: {e}")

check("run_inference with boundary flags completed without crashing", run_3_1_ok)
check("CSV telemetry was generated and populated", (OUTPUT_DIR / "frame_telemetry.csv").exists() and (OUTPUT_DIR / "frame_telemetry.csv").stat().st_size > 78)
check("Output video was generated and populated", (OUTPUT_DIR / "annotated_inspection.mp4").exists() and (OUTPUT_DIR / "annotated_inspection.mp4").stat().st_size > 1000)

# ---------------------------------------------------------------------------
# Test 3.2: Nonexistent webcam fallback test (--source 0)
# ---------------------------------------------------------------------------
print("\n--- Test 3.2: Nonexistent Webcam Fallback (--source 0 fallback simulation) ---")

# Monkeypatch cv2.VideoCapture to simulate nonexistent webcam 0
orig_videocapture = cv2.VideoCapture
class MockWebcamNonexistent(cv2.VideoCapture):
    def __init__(self, src, *args, **kwargs):
        if src == 0:
            # Simulate unopened webcam (hardware absent / permission denied)
            super().__init__()
        else:
            super().__init__(src, *args, **kwargs)

cv2.VideoCapture = MockWebcamNonexistent

# Ensure fallback video exists
fallback_sample = OUTPUT_DIR / "annotated_inspection.mp4"
assert fallback_sample.exists(), "annotated_inspection.mp4 must exist for fallback"

try:
    run_inference(
        source="0",
        weights=str(DEFAULT_WEIGHTS),
        conf_thresh=0.25,
        focal_length=8.0,
        distance=1000.0,
        pixel_pitch=0.00345,
        show=False,
        api_url=None,
        save_txt=False,
        save_csv=True,
        device="cpu",
    )
    fallback_ok = True
except Exception as e:
    fallback_ok = False
    print(f"Webcam fallback raised exception: {e}")

# Restore cv2.VideoCapture
cv2.VideoCapture = orig_videocapture

check("When webcam 0 is unavailable, predict.py cleanly triggers sample video fallback and runs without crash", fallback_ok)

# ---------------------------------------------------------------------------
# Test 3.3: High-confidence boundary test (--conf 0.999)
# ---------------------------------------------------------------------------
print("\n--- Test 3.3: Extreme Confidence Boundary (--conf 0.999, zero detection handling) ---")

try:
    run_inference(
        source=str(test_video_path),
        weights=str(DEFAULT_WEIGHTS),
        conf_thresh=0.999,
        focal_length=8.0,
        distance=1000.0,
        pixel_pitch=0.00345,
        show=False,
        api_url=None,
        save_txt=True,
        save_csv=True,
        device="cpu",
    )
    conf_ok = True
except Exception as e:
    conf_ok = False
    print(f"Conf 0.999 raised exception: {e}")

check("High confidence threshold (--conf 0.999) handles empty detections cleanly without crash", conf_ok)

# ---------------------------------------------------------------------------
# Test 3.4: Weights resolution fallback test (nonexistent weights path)
# ---------------------------------------------------------------------------
print("\n--- Test 3.4: Weights Resolution Fallback ---")

res_fallback = resolve_weights("totally_nonexistent_custom_model_9999.pt")
check("resolve_weights falls back to candidate best.pt or yolov8s.pt when custom weights not found", "best.pt" in res_fallback or "yolov8s.pt" in res_fallback, f"got {res_fallback}")

res_existing = resolve_weights(str(DEFAULT_WEIGHTS))
check("resolve_weights correctly resolves existing best.pt", Path(res_existing).exists())

# ---------------------------------------------------------------------------
# Test 3.5: Physical Crack Quantifier Extreme Optics Math
# ---------------------------------------------------------------------------
print("\n--- Test 3.5: Physical Crack Quantifier Extreme Optics Math ---")

# Normal optics
q1 = PhysicalCrackQuantifier(focal_length_mm=8.0, distance_mm=1000.0, pixel_pitch_mm=0.00345)
mm1 = q1.pixels_to_mm(100.0)
check("PhysicalCrackQuantifier pinhole optical formula: 100px -> 43.125mm", abs(mm1 - 43.125) < 1e-3, f"got {mm1}")

# Zero focal length guard (prevent ZeroDivisionError)
q_zero = PhysicalCrackQuantifier(focal_length_mm=0.0, distance_mm=1000.0, pixel_pitch_mm=0.00345)
check("Zero focal length guarded against ZeroDivisionError (returns 0.0)", q_zero.pixels_to_mm(100.0) == 0.0)

# Negative focal length guard
q_neg = PhysicalCrackQuantifier(focal_length_mm=-5.0, distance_mm=1000.0, pixel_pitch_mm=0.00345)
check("Negative focal length guarded (returns 0.0)", q_neg.pixels_to_mm(100.0) == 0.0)

# Empty crop handling
empty_crop = np.zeros((0, 0, 3), dtype=np.uint8)
check("Empty crop (0x0) handled gracefully without exception", q1.measure_crop(empty_crop) == (0.0, 0.0))

# Micro crop handling (< 4x4 px)
micro_crop = np.zeros((3, 3, 3), dtype=np.uint8)
check("Micro-crop (<4x4 px) handled gracefully without exception", q1.measure_crop(micro_crop) == (0.0, 0.0))

# Clean up synthetic test clip
if test_video_path.exists():
    try: test_video_path.unlink()
    except Exception: pass

# Summary
print("\n----------------------------------------------------------------")
print(f"STRESS PROBE 3 RESULT: {passed_checks}/{total_checks} checks passed.")
print("=" * 66 + "\n")
os._exit(0 if passed_checks == total_checks else 1)

