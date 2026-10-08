"""
utils/spatial.py
----------------
Simulates ROV spatial telemetry for the HRT AI Inspection System.

In a real deployment, these XYZ values would come from the ROV's IMU,
depth sensor, or acoustic positioning system.  For the project demo / testing
phase, this module generates a synthetic helical path through a cylindrical
tunnel — a realistic approximation of how an ROV would travel.

Tunnel model
────────────
  • The tunnel is a cylinder with:
      – length  L  along the Z-axis  (default 200 m)
      – radius  R  (default 2.5 m)
  • The ROV follows a helical path:
      x(t) = R * cos(2π * t * turns)
      y(t) = R * sin(2π * t * turns)  (or near-centre if straight-mode)
      z(t) = L * t
  • t ∈ [0, 1] is the normalised progress (frame_index / total_frames)

The module can also load real telemetry from a CSV / JSON file.
"""

import json
import math
from pathlib import Path
from typing import Optional


class SpatialTelemetry:
    """
    Maps frame indices → (x, y, z) spatial coordinates.

    Parameters
    ----------
    mode : str
        'helix'   – helical path (default, good demo)
        'straight' – straight path through tunnel centre
        'file'    – load from telemetry_file (CSV or JSON)
    total_frames : int
        Expected total number of video frames.  The helix is scaled
        to span the full tunnel length in this many frames.
    tunnel_length_m : float
        Tunnel length in metres (Z span).
    tunnel_radius_m : float
        Tunnel radius in metres.
    helix_turns : float
        How many full rotations the ROV makes along the tunnel.
    telemetry_file : str or Path, optional
        Path to a JSON or CSV file with columns/keys: frame, x, y, z.
    """

    def __init__(
        self,
        mode            : str   = "helix",
        total_frames    : int   = 10_000,
        tunnel_length_m : float = 200.0,
        tunnel_radius_m : float = 2.5,
        helix_turns     : float = 3.0,
        telemetry_file  : Optional[str] = None,
    ):
        self.mode            = mode
        self.total_frames    = max(total_frames, 1)
        self.tunnel_length_m = tunnel_length_m
        self.tunnel_radius_m = tunnel_radius_m
        self.helix_turns     = helix_turns
        self._lookup: dict   = {}

        if mode == "file" and telemetry_file:
            self._load_file(telemetry_file)

    # ── Public interface ──────────────────────────────────────────────────────

    def position_at(self, frame_index: int) -> dict:
        """
        Return the (x, y, z) position for *frame_index*.

        Returns
        -------
        dict with keys x, y, z (all floats, in metres, 2 decimal places)
        """
        if self.mode == "file":
            return self._lookup.get(frame_index,
                                    self._lookup.get(max(self._lookup.keys()), {"x": 0.0, "y": 0.0, "z": 0.0}))

        t = min(frame_index / self.total_frames, 1.0)  # normalised [0, 1]

        if self.mode == "straight":
            x = 0.0
            y = 0.0
            z = round(self.tunnel_length_m * t, 2)
        else:  # helix (default)
            angle = 2 * math.pi * self.helix_turns * t
            x = round(self.tunnel_radius_m * math.cos(angle), 2)
            y = round(self.tunnel_radius_m * math.sin(angle), 2)
            z = round(self.tunnel_length_m * t, 2)

        return {"x": x, "y": y, "z": z}

    def export_path_json(self, total_frames: Optional[int] = None,
                          output_path: Optional[str] = None) -> list:
        """
        Export the full ROV path as a list of {frame, x, y, z} dicts.
        Optionally writes to *output_path* as JSON.
        """
        n      = total_frames or self.total_frames
        path   = [{"frame": i, **self.position_at(i)} for i in range(n)]

        if output_path:
            with open(output_path, "w") as f:
                json.dump(path, f, indent=2)
            print(f"ROV path exported → {output_path}")

        return path

    # ── Private helpers ───────────────────────────────────────────────────────

    def _load_file(self, file_path):
        """Load telemetry from JSON or CSV into self._lookup."""
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"Telemetry file not found: {file_path}")

        if file_path.suffix.lower() == ".json":
            with open(file_path) as f:
                records = json.load(f)
            for rec in records:
                self._lookup[int(rec["frame"])] = {
                    "x": float(rec["x"]),
                    "y": float(rec["y"]),
                    "z": float(rec["z"]),
                }

        elif file_path.suffix.lower() == ".csv":
            import csv
            with open(file_path, newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self._lookup[int(row["frame"])] = {
                        "x": float(row["x"]),
                        "y": float(row["y"]),
                        "z": float(row["z"]),
                    }
        else:
            raise ValueError("telemetry_file must be .json or .csv")

        print(f"Loaded {len(self._lookup)} telemetry records from {file_path}")


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Testing SpatialTelemetry (helix mode) — 10 sample frames:\n")
    telem = SpatialTelemetry(mode="helix", total_frames=1000)
    for i in range(0, 1001, 100):
        pos = telem.position_at(i)
        print(f"  frame {i:>4} → x={pos['x']:>6.2f} m  y={pos['y']:>6.2f} m  z={pos['z']:>6.2f} m")

    # Export path to JSON (useful for Three.js frontend)
    path = telem.export_path_json(total_frames=100, output_path="rov_path.json")
    print(f"\nExported {len(path)} path points → rov_path.json")
