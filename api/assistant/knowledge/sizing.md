# How defect sizes are estimated
Source: this project's scanner (computeSpatialProps in frontend/src/utils/yoloBrowserInference.js) and README limitations

## Width, length and area
Sizes in millimetres are estimated from the size of the detection box in the frame, using a fixed scale for a camera at a typical stand-off from the wall.
Crack width is clamped between 0.8 mm and 28 mm. Length is at least 25 mm.
Crack area comes from the crack's mask when there is one, otherwise from a fraction of the box.

## Why sizes are approximate
Real sizing needs the camera's focal length, pixel pitch and distance to the wall. The demo uses fixed values, so sizes are estimates, not measurements.
Wrong calibration gives sizes that are wrong in the same direction every time.
Growth between inspections is compared using these estimates, so small changes may be noise.
