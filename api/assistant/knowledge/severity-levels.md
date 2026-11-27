# Severity levels
Source: this project's scanner (frontend/src/utils/yoloBrowserInference.js)

## How a crack gets its severity
The scanner gives every crack one of three levels when it is detected: Minor, Major or Critical.
A crack is Critical when the model's confidence is 0.60 or more, or its estimated width is 3.0 mm or more, or its estimated length is 200 mm or more.
Otherwise it is Major when the confidence is 0.36 or more, or the estimated length is 110 mm or more.
Everything else is Minor.
Severity is partly based on model confidence, so a high level means "the model is sure and the mark is large", not a structural rating by an engineer.

## How spalling gets its severity
Spalling and exposed rebar patches from the texture check are only ever Minor or Major, never Critical.
A patch is Major when its texture confidence is 0.72 or more, or its box covers a large part of the frame; otherwise it is Minor.
In practice most counted spalling patches are Major.

## The Info level
Info exists in the filters and the demo data, but the live scanner never assigns it.
Old records with no severity are shown as Critical when their confidence is 0.85 or more, and as Major otherwise.

## What severity does not mean
Severity is an automatic first sort to help an engineer decide what to look at first.
It is not a repair priority and it has not been checked against a design code. An engineer must review the defect.
