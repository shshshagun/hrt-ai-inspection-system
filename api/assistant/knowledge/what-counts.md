# What counts as a defect
Source: this project's counting rules (frontend/src/utils/crackVerdict.js and api/detectionRules.js)

## Automatic verdict
The detection model fires on many things that are not cracks, such as shadows, stains and ring joints.
So every detection gets an automatic verdict when it is made: "crack" (it counts) or "candidate" (it waits for an engineer).
The verdict comes from shape rules (a crack is long and thin), a second small crack / not-crack classifier, and how many frames the detection was seen in.

## Engineer review
An engineer can confirm or reject any detection on the AI Detections page or in Quick Review.
A detection counts when an engineer confirmed it, or when it is unreviewed and its automatic verdict is "crack".
A rejected detection never counts. Reject reasons are: shadow, stain or water streak, ring joint or seam, debris, concrete texture, or something else.

## Counted and awaiting review
Dashboards, reports and the assistant show counted detections by default.
Detections that are still candidates are "awaiting review"; the assistant includes them only when asked.
Older records saved before the automatic verdict existed stay candidates until someone reviews them.

## Why the counts can look low
The rules prefer missing a faint crack to counting a shadow. Fine cracks and cracks on the tunnel floor are often missed by the model.
Re-scanning an old video applies the current rules to it.
