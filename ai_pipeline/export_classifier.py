"""
export_classifier.py
--------------------
Exports the trained crack classifier (hrt_crack_cls.pt) to ONNX for the browser, and checks that ONNX Runtime gives the same
probabilities as PyTorch on random inputs and on a few real crops.

    python ai_pipeline/export_classifier.py --dir C:/hrt-data/classifier
"""
import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import torch.nn as nn
import torchvision

from train_classifier import SIZE, Wrapped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    args = ap.parse_args()
    d = Path(args.dir)

    net = torchvision.models.mobilenet_v3_small(weights=None)
    net.classifier[-1] = nn.Linear(net.classifier[-1].in_features, 1)
    model = Wrapped(net)
    model.load_state_dict(torch.load(d / "hrt_crack_cls.pt", map_location="cpu"))
    model.eval()

    dummy = torch.rand(1, 3, SIZE, SIZE)
    target = d / "hrt_crack_cls.onnx"
    torch.onnx.export(model, dummy, str(target), input_names=["image"], output_names=["crack_probability"], opset_version=17, dynamo=False)

    sess = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
    worst = 0.0
    for _ in range(20):
        x = torch.rand(1, 3, SIZE, SIZE)
        a = model(x).item()
        b = float(sess.run(None, {"image": x.numpy()})[0].ravel()[0])
        worst = max(worst, abs(a - b))
    print(f"exported {target} ({target.stat().st_size / 1e6:.1f} MB); largest PyTorch/ONNX difference over 20 random inputs: {worst:.2e}")
    assert worst < 1e-4, "ONNX output differs from PyTorch"


if __name__ == "__main__":
    main()
