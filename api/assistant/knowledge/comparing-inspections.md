# Comparing inspections and defect history
Source: this project's site matching (api/assistant/sites.js)

## Matching the same defect across inspections
Two detections are treated as the same physical defect (a "site") when they have the same class, are within 3 m of chainage and within 35 degrees around the lining.

## New, grown, steady, not seen again
When two inspections are compared, each site is put in one group.
New: seen in the latest inspection only.
Grown: its estimated area went up by 20% or more.
Steady: seen in both with less growth than that.
Not seen again: seen before but not in the latest inspection.

## Careful reading
"Not seen again" does not prove a repair. The latest footage may not cover that stretch, or the model may have missed it.
Growth uses estimated sizes, so a small change can be noise.
