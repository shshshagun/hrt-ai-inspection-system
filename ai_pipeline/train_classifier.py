"""
train_classifier.py
-------------------
Second-stage "is this really a crack?" classifier. The detector has one class and fires on stains, joints and shadows; this small
network looks at each detected crop (224 x 224, with some context) and answers crack / not crack. It runs in the browser after the
detector, so the main model stays as it is.

Training data (all with licences that allow this use):
  * crack and crack-free concrete patches: Ozgenel and Gonenc Sorguc 2018, Mendeley Data, CC BY 4.0 (blocks of file numbers per split)
  * crack crops from the Roboflow underwater crack boxes in data/ (CC BY 4.0), cut the way the web app cuts them (square, 1.5 x the box)
  * crack-free crops from those same images, away from every labelled box (the domain the detector actually sees)

    python ai_pipeline/train_classifier.py --ozgenel C:/hrt-data/ozgenel --data C:/hrt-ai-inspection-system/data \
        --out C:/hrt-data/classifier --epochs 8
The crops the review screen collects (confirmed cracks and rejected non-cracks) can be added with --reviewed <folder> later.
"""
import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torchvision
from PIL import Image, ImageFilter
from torch.utils.data import DataLoader, Dataset

SIZE = 224
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
IMG_EXT = {".jpg", ".jpeg", ".png"}


def number(p: Path) -> int:
    d = "".join(c for c in p.stem if c.isdigit())
    return int(d) if d else -1


def square_around(box, w, h, scale=1.5, min_side=64):
    """The same square the web app cuts: centred on the box, 1.5 x its long side, kept inside the image."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    side = min(min(w, h), max(min_side, max(box[2] - box[0], box[3] - box[1]) * scale))
    x0 = max(0, min(w - side, cx - side / 2))
    y0 = max(0, min(h - side, cy - side / 2))
    return (x0, y0, x0 + side, y0 + side)


def read_boxes(label_path: Path, w, h):
    boxes = []
    if label_path.exists():
        for line in label_path.read_text().splitlines():
            p = line.split()
            if len(p) < 5:
                continue
            v = list(map(float, p[1:]))
            if len(v) == 4:
                cx, cy, bw, bh = v
                boxes.append(((cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h))
            else:
                xs, ys = np.array(v[0::2]) * w, np.array(v[1::2]) * h
                boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
    return boxes


def overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def collect(ozgenel: Path, data: Path, per_class_ozgenel: int, per_class_roboflow: int, rng: random.Random):
    """Returns {split: [(path, label, crop_box_or_None)]}. label 1 = crack."""
    items = {"train": [], "val": [], "test": []}
    blocks = {"train": (1, 16000), "val": (16001, 18000), "test": (18001, 20000)}
    counts = {"train": per_class_ozgenel, "val": 1000, "test": 1000}
    for cls_name, label in (("Positive", 1), ("Negative", 0)):
        files = sorted((p for p in (ozgenel / cls_name).iterdir() if p.suffix.lower() in IMG_EXT), key=number)
        for split, (lo, hi) in blocks.items():
            pool = [p for p in files if lo <= number(p) <= hi]
            rng.shuffle(pool)
            items[split] += [(p, label, None) for p in pool[: counts[split]]]

    for split, folder, n in (("train", "train", per_class_roboflow), ("val", "valid", 400), ("test", "test", 400)):
        imgs = sorted(p for p in (data / folder / "images").iterdir() if p.suffix.lower() in IMG_EXT)
        rng.shuffle(imgs)
        pos = neg = 0
        for p in imgs:
            if pos >= n and neg >= n:
                break
            w, h = Image.open(p).size
            boxes = read_boxes(data / folder / "labels" / (p.stem + ".txt"), w, h)
            if boxes and pos < n:
                b = rng.choice(boxes)
                items[split].append((p, 1, square_around(b, w, h)))
                pos += 1
            if neg < n:  # a square of a typical size that touches no labelled box
                for _ in range(8):
                    side = rng.uniform(0.25, 0.6) * min(w, h)
                    x0, y0 = rng.uniform(0, w - side), rng.uniform(0, h - side)
                    sq = (x0, y0, x0 + side, y0 + side)
                    if not any(overlaps(sq, b) for b in boxes):
                        items[split].append((p, 0, sq))
                        neg += 1
                        break
    return items


class Crops(Dataset):
    def __init__(self, items, train):
        self.items, self.train = items, train
        self.tf = torchvision.transforms.Compose([torchvision.transforms.ToTensor(), torchvision.transforms.Normalize(MEAN, STD)])

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label, box = self.items[i]
        img = Image.open(path).convert("RGB")
        if box is not None:
            img = img.crop(tuple(int(v) for v in box))
        img = img.resize((SIZE, SIZE), Image.BILINEAR)
        if self.train:
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_TOP_BOTTOM)
            if random.random() < 0.3:
                img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.4)))  # video frames are soft
            arr = np.asarray(img, dtype=np.float32)
            arr = arr * random.uniform(0.7, 1.3) + random.uniform(-25, 25)  # brightness and contrast: lighting differs a lot
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return self.tf(img), torch.tensor(float(label))


class Wrapped(nn.Module):
    """Normalisation and sigmoid live inside the exported file, so the browser only has to feed 0..1 pixels."""
    def __init__(self, net):
        super().__init__()
        self.net = net
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def forward(self, x):
        return torch.sigmoid(self.net((x - self.mean) / self.std))


def evaluate(model, loader, device):
    model.eval()
    scores, labels = [], []
    with torch.no_grad():
        for x, y in loader:
            scores.append(torch.sigmoid(model(x.to(device))).squeeze(1).cpu())
            labels.append(y)
    s, y = torch.cat(scores).numpy(), torch.cat(labels).numpy()
    out = {}
    for thr in (0.5, 0.7):
        pred = s >= thr
        tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
        fn = int(((pred == 0) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
        p = tp / max(1, tp + fp); r = tp / max(1, tp + fn)
        out[str(thr)] = dict(precision=round(p, 4), recall=round(r, 4), f1=round(2 * p * r / max(1e-9, p + r), 4), tp=tp, fp=fp, fn=fn, tn=tn, accuracy=round((tp + tn) / len(y), 4))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ozgenel", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--per-class-ozgenel", type=int, default=6000)
    ap.add_argument("--per-class-roboflow", type=int, default=3000)
    args = ap.parse_args()

    rng = random.Random(0)
    random.seed(0); torch.manual_seed(0)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    items = collect(Path(args.ozgenel), Path(args.data), args.per_class_ozgenel, args.per_class_roboflow, rng)
    print({k: (len(v), sum(1 for _, l, _ in v if l == 1)) for k, v in items.items()}, "(images, cracks)")

    device = "cuda"
    net = torchvision.models.mobilenet_v3_small(weights=torchvision.models.MobileNet_V3_Small_Weights.DEFAULT)
    net.classifier[-1] = nn.Linear(net.classifier[-1].in_features, 1)
    net = net.to(device)

    loaders = {s: DataLoader(Crops(items[s], s == "train"), batch_size=args.batch, shuffle=(s == "train"), num_workers=args.workers, persistent_workers=True) for s in items}
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=args.epochs * len(loaders["train"]))
    scaler = torch.amp.GradScaler()
    loss_fn = nn.BCEWithLogitsLoss()
    best, best_f1 = None, -1.0
    for epoch in range(args.epochs):
        net.train(); t0 = time.time(); total = 0.0
        for x, y in loaders["train"]:
            x, y = x.to(device), y.to(device)
            with torch.autocast("cuda", dtype=torch.float16):
                loss = loss_fn(net(x).squeeze(1), y)
            opt.zero_grad(); scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
            total += float(loss)
        val = evaluate(net, loaders["val"], device)
        f1 = val["0.5"]["f1"]
        print(f"epoch {epoch + 1}/{args.epochs}  loss {total / len(loaders['train']):.4f}  val F1@0.5 {f1}  ({time.time() - t0:.0f}s)", flush=True)
        if f1 > best_f1:
            best_f1, best = f1, {k: v.detach().clone() for k, v in net.state_dict().items()}

    net.load_state_dict(best)
    report = dict(val=evaluate(net, loaders["val"], device), test=evaluate(net, loaders["test"], device),
                  sizes={k: len(v) for k, v in items.items()}, epochs=args.epochs, note="Held-out blocks of the public datasets; not the accuracy of the whole system on tunnel footage.")
    (out / "classifier_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report["test"], indent=2))

    torch.save(Wrapped(net.cpu().eval()).state_dict(), out / "hrt_crack_cls.pt")
    print("saved", out / "hrt_crack_cls.pt", "- now run: python ai_pipeline/export_classifier.py --dir", out)


if __name__ == "__main__":
    main()
