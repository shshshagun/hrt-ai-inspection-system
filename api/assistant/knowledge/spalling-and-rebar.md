# Spalling and exposed rebar
Source: this project's texture check (SPALL in frontend/src/utils/yoloBrowserInference.js)

## What spalling is
Spalling is concrete breaking away from the lining surface, leaving a rough cavity. When it is deep, the steel reinforcement bars (rebar) can show.
Exposed rebar can corrode, so it is usually treated as more serious than a surface mark.

## How the system finds it
The trained model only knows cracks. Spalling, cavities and exposed rebar are found by a separate texture check, not a trained model.
It splits the frame into a grid and marks cells that are rough at both a fine and a coarse scale. Spalled concrete is rough at both scales; dark water with floating specks and plain wall are not.
It ignores the bottom fifth of the frame, where an ROV's own frame and lights appear.
If more than 30% of the picture is rough (a landscape or gravel), it reports nothing for that frame.
A patch that sits on a detected crack is dropped, so one defect is not counted twice.

## When spalling counts
In a video scan, a patch counts as spalling when its texture confidence is at least 0.7 and it was seen in enough frames.
From a photo or the webcam it always waits for review, because one frame proves nothing.

## Known weak spots
The thresholds were tuned on two AI-generated clips only.
White leaching streaks and splashes can be counted as spalling, and rough crack edges can produce weak patches that wait for review.
A trained model with spalling and rebar classes would be the real fix.
