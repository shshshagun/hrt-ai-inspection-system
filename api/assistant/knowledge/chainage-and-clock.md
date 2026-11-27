# Chainage and clock position
Source: this project's coordinate conventions (README and computeSpatialProps in frontend/src/utils/yoloBrowserInference.js)

## Chainage
Chainage is the distance along the tunnel in metres, measured from the intake at 0 m. The demo tunnel is 250 m long.
In a video scan chainage is estimated from time: the ROV is assumed to move at 0.4 m per second, so a defect seen 100 seconds in is placed at 40 m.
In a photo batch each photo is placed 2.5 m after the previous one.
If the ROV speeds up, stops or reverses, the chainage drifts. A real deployment would need a Doppler Velocity Log (DVL) for odometry.

## Clock position
Clock position says where around the tunnel lining a defect is, like the face of a clock seen looking along the tunnel.
12 o'clock is the crown (the top), 6 o'clock is the invert (the floor), and 3 and 9 o'clock are the side walls.
It is worked out from where the defect sits in the camera frame, in 30 degree steps.

## Position on the 3D twin
On the digital twin, the tunnel axis is +Z and the origin (0, 0, 0) is at the intake.
Defect markers are placed on a circle of radius 2.95 m at their clock angle and their chainage.
