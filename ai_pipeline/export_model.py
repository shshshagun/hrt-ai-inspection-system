"""
export_model.py
---------------
Exports the trained YOLOv8s model to additional formats for deployment:

  • ONNX    – universal format, works on any inference engine (OpenCV DNN, ONNX Runtime)
  • TorchScript – for PyTorch Mobile or C++ deployment
  • TensorRT  – for NVIDIA Jetson / GPU-accelerated edge deployment (requires TRT)
  • OpenVINO – for Intel CPU/GPU/VPU deployment

Usage:
    python ai_pipeline/export_model.py                  # exports ONNX + TorchScript
    python ai_pipeline/export_model.py --format onnx
    python ai_pipeline/export_model.py --format torchscript
    python ai_pipeline/export_model.py --format openvino
"""

import argparse
from pathlib import Path
from ultralytics import YOLO

ROOT            = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "runs" / "detect" / "hrt_crack_det" / "weights" / "best.pt"
IMG_SIZE        = 640


def parse_args():
    p = argparse.ArgumentParser(description="Export YOLOv8s to deployment formats")
    p.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    p.add_argument("--format",  default="onnx",
                   choices=["onnx", "torchscript", "openvino", "tflite", "ncnn"],
                   help="Export format")
    p.add_argument("--imgsz",   type=int, default=IMG_SIZE)
    p.add_argument("--half",    action="store_true",
                   help="FP16 quantisation (GPU only, halves model size)")
    p.add_argument("--int8",    action="store_true",
                   help="INT8 quantisation (requires data arg for calibration)")
    return p.parse_args()


def main():
    args = parse_args()
    weights_path = Path(args.weights)

    if not weights_path.exists():
        raise FileNotFoundError(
            f"Weights not found: {weights_path}\n"
            "Train the model first:  python ai_pipeline/train.py"
        )

    print("=" * 60)
    print("  HRT AI Inspection — Model Export")
    print("=" * 60)
    print(f"  Weights : {weights_path}")
    print(f"  Format  : {args.format}")
    print(f"  ImgSize : {args.imgsz}")
    print(f"  Half    : {args.half}")
    print("=" * 60)

    model = YOLO(str(weights_path))

    exported_path = model.export(
        format  = args.format,
        imgsz   = args.imgsz,
        half    = args.half,
        int8    = args.int8,
        device  = "cpu" if args.format in ("openvino", "tflite", "ncnn") else "0",
        dynamic = False,
        simplify= True if args.format == "onnx" else False,
    )

    print(f"\n✅ Model exported → {exported_path}")
    print("\nDeploy with ONNX Runtime:")
    print("  import onnxruntime as ort")
    print(f"  sess = ort.InferenceSession('{exported_path}')")


if __name__ == "__main__":
    main()
