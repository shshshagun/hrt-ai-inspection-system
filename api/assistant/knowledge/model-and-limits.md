# The detection model and its limits
Source: this project's README (Real-World Limitations)

## The model
Cracks are detected by YOLOv8n-seg, a small segmentation model, exported to ONNX and run inside the browser.
The weights are third-party crack segmentation weights with one class, crack. They were not trained on this tunnel.
Each video frame is scanned whole and in four overlapping tiles, so small cracks are not shrunk away.
Sightings of the same crack across frames are merged by a tracker.

## What it cannot do
It detects only cracks. Spalling and exposed rebar come from a hand-tuned texture check. Seepage, honeycomb voids and delamination are not detected at all.
It was trained on fairly clear images, so muddy or turbid water can make footage unusable. Sonar would be needed then.
It is not connected to real ROV hardware; it works on uploaded video, photos or a webcam.
Every result is an AI prediction and needs an engineer's review.
