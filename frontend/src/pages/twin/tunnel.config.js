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
  radial_segments: 48,        // Cylinder circumferential tessellation
  
  // Coordinate frame definition
  coordinate_frame: 'Model coordinates, origin at intake (0, 0, 0), +Z along the tunnel',

  // Submerged underwater environment optics
  water_fog: {
    color: 0x061820,          // Deep underwater navy / blue-green
    density: 0.042,           // Exponential fog density (FogExp2)
  },

  // Marine snow / suspended particulate matter
  particles: {
    count: 450,               // Restrained count to maintain 60 fps & realism
    spread_radius: 2.7,       // Kept strictly within tunnel radius
    size: 0.035,              // Subtly visible suspended sediment
    color: 0x486b77,          // Muted blue-grey, non-glowing
    drift_speed: 0.15,
  },

  // Inspection Rover dynamic parameters
  rover: {
    start_pos: [0.0, -0.6, 6.0], // Initial XYZ inside tunnel
    collision_radius: 0.45,       // Hard collision bounding sphere radius (meters)
    max_radial_distance: 2.45,    // (radius_m - collision_radius - buffer)
    max_speed: 7.5,               // Forward/reverse max speed (m/s)
    boost_mult: 2.0,              // Speed multiplier when Shift is held
    acceleration: 14.0,           // Linear acceleration
    damping: 5.5,                 // Water drag / resistance factor
    turn_speed: 1.8,              // Angular turn rate (rad/s)
    vertical_speed: 3.5,          // Vertical traverse speed (m/s)
    headlight_intensity: 45.0,    // Primary dual spotlight lumens
    headlight_distance: 36.0,     // Beam throw distance (meters)
    fill_intensity: 2.5,          // Near-field ambient fill
  },
};
