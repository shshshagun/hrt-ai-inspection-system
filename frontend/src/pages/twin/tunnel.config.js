/**
 * tunnel.config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parametric configuration for the Head Race Tunnel (HRT) 3D Digital Twin.
 *
 * IMPORTANT:
 * Parametric model — not a survey-accurate reconstruction.
 * Real dimensions, lining profiles, and chainage alignments must be sourced
 * directly from as-built engineering surveys and bathymetric LiDAR data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const TUNNEL_CONFIG = {
  // Bore dimensions
  diameter_m: 6.0,            // Tunnel bore inner diameter (meters)
  radius_m: 3.0,              // Radius derived: diameter / 2
  length_m: 250.0,            // Simulated segment length along +Z axis (meters)
  ring_length_m: 2.5,         // Segmented precast lining ring length (meters)
  radial_segments: 64,        // High-resolution cylinder tessellation
  
  // Coordinate frame definition
  coordinate_frame: 'Model coordinates, origin at intake (0, 0, 0), +Z along the tunnel',

  // Submerged underwater environment optics (cinematic deep abyss teal)
  water_fog: {
    color: 0x061521,          // Deep cinematic aquatic navy
    density: 0.016,           // Natural underwater visibility without blowout or blackness
  },

  // Marine snow / suspended particulate matter
  particles: {
    count: 600,               // Realistic underwater particulate density
    spread_radius: 2.8,       // Kept strictly within tunnel radius
    size: 0.04,               // Subtly visible suspended sediment
    color: 0x5eead4,          // Bioluminescent cyan-tinted suspended sediment
    drift_speed: 0.18,
  },

  // Subsea Inspection ROV dynamics & optics
  rover: {
    start_pos: [0.0, -0.5, 6.0],  // Initial XYZ inside tunnel bore
    collision_radius: 0.45,       // Hard collision bounding sphere radius (meters)
    max_radial_distance: 2.45,    // (radius_m - collision_radius - buffer)
    max_speed: 7.0,               // Forward/reverse cruising speed (m/s)
    boost_mult: 2.0,              // Speed multiplier when Shift is held
    acceleration: 12.0,           // Smooth hydrodynamic acceleration
    damping: 5.0,                 // Water drag / resistance factor
    turn_speed: 1.8,              // Angular turn rate (rad/s)
    vertical_speed: 3.2,          // Vertical traverse speed (m/s)
    headlight_intensity: 28.0,    // Balanced inspection LED lumens
    headlight_distance: 42.0,     // Beam throw distance (meters)
    fill_intensity: 8.0,          // Near-field ambient fill
  },
};
