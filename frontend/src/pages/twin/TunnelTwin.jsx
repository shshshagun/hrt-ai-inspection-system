import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import * as THREE from 'three';
import { TUNNEL_CONFIG } from './tunnel.config';
import './TunnelTwin.css';

// ─── Severity visual tokens ───────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  Critical: { color: '#ef4444', threeColor: 0xef4444, label: 'CRITICAL' },
  Major:    { color: '#f97316', threeColor: 0xf97316, label: 'MAJOR' },
  Minor:    { color: '#eab308', threeColor: 0xeab308, label: 'MINOR' },
  Info:     { color: '#38bdf8', threeColor: 0x38bdf8, label: 'INFO' },
};

// ─── Defect marker projected radius (snapped 5cm inside inner wall) ───────────
const DEFECT_R = 2.95;

function formatClockPosition(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized === 0 || normalized === 360) return "12 o'clock (Crown)";
  if (normalized === 90)  return "3 o'clock (Right Wall)";
  if (normalized === 180) return "6 o'clock (Invert / Floor)";
  if (normalized === 270) return "9 o'clock (Left Wall)";
  const clock = Math.round(normalized / 30) || 12;
  return `${clock} o'clock (${normalized}\xB0)`;
}

// ─── Procedural concrete texture (damp mottled aggregate, submerged) ──────────
function createProceduralConcreteTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#4b5563';
  ctx.fillRect(0, 0, size, size);

  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const damp = Math.sin(x * 0.015) * Math.cos(y * 0.015) * 16;
      const noise = (Math.random() - 0.5) * 28;
      const base = 132 + damp + noise;
      data[idx]     = Math.max(0, Math.min(255, base - 8));  // R (cold tone)
      data[idx + 1] = Math.max(0, Math.min(255, base + 2));  // G
      data[idx + 2] = Math.max(0, Math.min(255, base + 8));  // B (blue-shift)
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Ring joint groove
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // Longitudinal formwork seam lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const lx = (size / 4) * i;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ─── WebGL capability check — run once as lazy state initializer ──────────────
// FIX #2: Never call setWebglError inside a useEffect; detect at init time.
function detectWebGLError() {
  if (typeof window === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!window.WebGLRenderingContext || !gl) {
      return 'WebGL is unavailable or disabled in your browser environment. Three.js hardware acceleration is required.';
    }
    return null;
  } catch {
    return 'WebGL context creation failed. Please enable hardware acceleration in your browser settings.';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TunnelTwin() {
  const navigate = useNavigate();
  const mountRef = useRef(null);

  // FIX #2: webglError uses a lazy initializer — setWebglError is never needed
  // inside an effect, eliminating the react/no-direct-mutation-state lint warning.
  const [webglError] = useState(detectWebGLError);

  const [loading, setLoading]       = useState(true);
  const [cracksData, setCracksData] = useState([]);
  const [dataError, setDataError]   = useState(null);
  const [selectedCrack, setSelectedCrack] = useState(null);

  // Mirror selectedCrack in a ref so the rAF loop reads it without stale closure
  const selectedCrackRef = useRef(null);
  useEffect(() => { selectedCrackRef.current = selectedCrack; }, [selectedCrack]);

  const [cameraMode, setCameraMode]         = useState('chase');
  const cameraModeRef                       = useRef('chase');
  const [showControlsHint, setShowControlsHint] = useState(true);
  const [showInventory, setShowInventory]   = useState(false);
  const [sortBy, setSortBy]                 = useState('chainage');

  // Autonomous Survey Fly-Through State
  const [autoPilot, setAutoPilot]           = useState(false);
  const autoPilotRef                        = useRef(false);
  const autoPilotPauseUntilRef              = useRef(0);
  const inspectedDefectsRef                 = useRef(new Set());
  const cracksDataRef                       = useRef([]);
  useEffect(() => { cracksDataRef.current = cracksData; }, [cracksData]);

  const [telemetry, setTelemetry] = useState({
    x: 0, y: -0.6, z: 6.0, speed: 0, chainage: 6.0, heading: 0, depth: 38.5,
  });

  // Rover input state — mutated directly in event handlers (no re-render needed)
  const controlsRef = useRef({
    forward: false, backward: false,
    yawLeft: false, yawRight: false,
    up: false, down: false,
    rollLeft: false, rollRight: false,
    boost: false,
    pointerDown: false, mouseX: 0, mouseY: 0,
    dx: 0, dy: 0,
  });

  const jumpTargetRef    = useRef(null);
  const sceneRef         = useRef(null);
  const roverMeshRef     = useRef(null);
  const crackMeshesRef   = useRef([]);

  // FIX #1: Keyboard handler is registered once in the Three.js effect.
  // cycleCrack and selectClosestCrack are defined later (after the effect) and
  // reference state. Calling them directly from within the effect closure creates
  // a stale-capture lint error. Solution: store latest function in a ref and
  // always call via the ref from the keyboard handler.
  const cycleCrackRef         = useRef(null);
  const selectClosestCrackRef = useRef(null);

  // ── 1. Fetch defect telemetry ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    fetch('/data/cracks.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading cracks.json`);
        return res.json();
      })
      .then(data => {
        if (active) { setCracksData(data); setLoading(false); }
      })
      .catch(err => {
        if (active) {
          console.error('Failed to fetch cracks.json:', err);
          setDataError(err.message);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  // ── 2. Initialize Three.js Engine ─────────────────────────────────────────
  useEffect(() => {
    // Bail immediately if WebGL was unavailable (determined at state-init time)
    if (webglError) return;

    const container = mountRef.current;
    if (!container) return;

    const width  = container.clientWidth;
    const height = container.clientHeight;

    // SCENE
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.fog        = new THREE.FogExp2(TUNNEL_CONFIG.water_fog.color, TUNNEL_CONFIG.water_fog.density);
    scene.background = new THREE.Color(TUNNEL_CONFIG.water_fog.color);

    // CAMERA
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 120);

    // RENDERER
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // ── TUNNEL CYLINDER (BackSide: camera navigates inside) ────────────────
    const radius    = TUNNEL_CONFIG.radius_m;
    const length    = TUNNEL_CONFIG.length_m;
    const radialSegs = TUNNEL_CONFIG.radial_segments;
    const ringLen   = TUNNEL_CONFIG.ring_length_m;
    const numRings  = Math.round(length / ringLen);

    const concreteTex = createProceduralConcreteTexture();
    concreteTex.repeat.set(8, numRings);

    const tunnelGeo = new THREE.CylinderGeometry(radius, radius, length, radialSegs, numRings, true);
    tunnelGeo.rotateX(Math.PI / 2);
    tunnelGeo.translate(0, 0, length / 2);

    const tunnelMat = new THREE.MeshStandardMaterial({
      map: concreteTex, roughness: 0.58, metalness: 0.08, side: THREE.BackSide,
    });
    const tunnelMesh = new THREE.Mesh(tunnelGeo, tunnelMat);
    scene.add(tunnelMesh);

    // Precast ring joints (instanced for performance)
    const ringJointGeo = new THREE.TorusGeometry(radius - 0.015, 0.018, 6, radialSegs);
    const ringJointMat = new THREE.MeshStandardMaterial({ color: 0x0a101d, roughness: 0.9 });
    const ringInstanced = new THREE.InstancedMesh(ringJointGeo, ringJointMat, numRings + 1);
    const _m4 = new THREE.Matrix4();
    for (let r = 0; r <= numRings; r++) {
      _m4.setPosition(0, 0, r * ringLen);
      ringInstanced.setMatrixAt(r, _m4);
    }
    ringInstanced.instanceMatrix.needsUpdate = true;
    scene.add(ringInstanced);

    // End caps
    const capGeo = new THREE.CircleGeometry(radius, radialSegs);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x111c2a, roughness: 0.8 });
    const intakeCap = new THREE.Mesh(capGeo, capMat);
    intakeCap.position.set(0, 0, 0);
    scene.add(intakeCap);
    const endCap = new THREE.Mesh(capGeo, capMat);
    endCap.position.set(0, 0, length);
    endCap.rotateY(Math.PI);
    scene.add(endCap);

    // ── MARINE SNOW (suspended particulate drift) ──────────────────────────
    const particleCount     = TUNNEL_CONFIG.particles.count;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let p = 0; p < particleCount; p++) {
      const theta = Math.random() * Math.PI * 2;
      const r     = Math.random() * (radius - 0.35);
      particlePositions[p * 3]     = Math.cos(theta) * r;
      particlePositions[p * 3 + 1] = Math.sin(theta) * r;
      particlePositions[p * 3 + 2] = Math.random() * length;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: TUNNEL_CONFIG.particles.color, size: TUNNEL_CONFIG.particles.size,
      transparent: true, opacity: 0.65, fog: true,
    });
    scene.add(new THREE.Points(particleGeo, particleMat));

    // ── ROV VEHICLE ────────────────────────────────────────────────────────
    const roverGroup = new THREE.Group();
    roverGroup.position.set(...TUNNEL_CONFIG.rover.start_pos);
    roverMeshRef.current = roverGroup;

    const roverVisuals = new THREE.Group();
    roverGroup.add(roverVisuals);

    // Chassis body
    const chassisGeo = new THREE.BoxGeometry(0.55, 0.32, 0.75);
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    roverVisuals.add(new THREE.Mesh(chassisGeo, chassisMat));

    // Buoyancy shell
    const shellGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.65, 16);
    shellGeo.rotateX(Math.PI / 2);
    shellGeo.scale(1.1, 0.45, 1);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xca8a04, roughness: 0.35, metalness: 0.1 });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.set(0, 0.18, 0);
    roverVisuals.add(shell);

    // Front camera dome
    const domeGeo = new THREE.SphereGeometry(0.1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.rotateX(-Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.9 });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(0, 0.02, 0.39);
    roverVisuals.add(dome);

    // Thruster cowlings
    const thrusterGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12);
    thrusterGeo.rotateX(Math.PI / 2);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.4 });
    [[-0.34, 0.02, -0.2], [0.34, 0.02, -0.2], [-0.34, 0.02, 0.2], [0.34, 0.02, 0.2]]
      .forEach(([tx, ty, tz]) => {
        const t = new THREE.Mesh(thrusterGeo, thrusterMat);
        t.position.set(tx, ty, tz);
        roverVisuals.add(t);
      });

    // ── ROV LIGHTING ──────────────────────────────────────────────────────
    const spotTarget = new THREE.Object3D();
    scene.add(spotTarget);

    // Primary High-Lumens Inspection Spotlights
    const headlight = new THREE.SpotLight(0xf8fafc, 580);
    headlight.position.set(0, 0.12, 0.38);
    headlight.target  = spotTarget;
    headlight.angle   = Math.PI / 3.0;
    headlight.penumbra = 0.45;
    headlight.decay   = 1.0;
    headlight.distance = 68.0;
    roverGroup.add(headlight);

    // Forward broad flood fill
    const fillLight = new THREE.PointLight(0x7dd3fc, 45, 28.0);
    fillLight.position.set(0, 0.0, 0.45);
    roverGroup.add(fillLight);

    // Rear vehicle halo & chase camera illumination
    const chaseFillLight = new THREE.PointLight(0xa5f3fc, 42, 18.0);
    chaseFillLight.position.set(0, 0.65, -0.6);
    roverGroup.add(chaseFillLight);

    scene.add(roverGroup);

    // Global Aquatic Environmental Lighting
    // Radiant water cyan from tunnel crown, deep indigo navy from invert
    scene.add(new THREE.HemisphereLight(0x38bdf8, 0x0c1e2e, 1.8));
    scene.add(new THREE.AmbientLight(0x1e3a5f, 1.25));

    // Tunnel Architecture Guide Beacons (every 25m along +Z)
    for (let bz = 20; bz < length; bz += 25) {
      const guideLight = new THREE.PointLight(0x38bdf8, 12, 22.0);
      guideLight.position.set(0, 2.7, bz);
      scene.add(guideLight);
    }

    // ── RAYCASTER ─────────────────────────────────────────────────────────
    const raycaster  = new THREE.Raycaster();
    const mouseCoord = new THREE.Vector2();
    const getHitboxes = () => crackMeshesRef.current.map(c => c.hitMesh);

    const handleCanvasClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseCoord.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseCoord, camera);
      const hits = raycaster.intersectObjects(getHitboxes(), false);
      if (hits.length > 0) {
        const found = crackMeshesRef.current.find(c => c.hitMesh === hits[0].object);
        if (found) setSelectedCrack(found.data);
      }
    };

    // Hover cursor: pointer over defect hitboxes, grab elsewhere
    const handleMouseHover = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseCoord.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseCoord, camera);
      const hits = raycaster.intersectObjects(getHitboxes(), false);
      renderer.domElement.style.cursor =
        hits.length > 0
          ? 'pointer'
          : (controlsRef.current.pointerDown ? 'grabbing' : 'grab');
    };

    // ── MOUSE DRAG LOOK ───────────────────────────────────────────────────
    const onMouseDown = (e) => {
      if (e.button === 0) {
        controlsRef.current.pointerDown = true;
        controlsRef.current.mouseX = e.clientX;
        controlsRef.current.mouseY = e.clientY;
      }
    };
    const onMouseMove = (e) => {
      if (!controlsRef.current.pointerDown) return;
      controlsRef.current.dx += (e.clientX - controlsRef.current.mouseX);
      controlsRef.current.dy += (e.clientY - controlsRef.current.mouseY);
      controlsRef.current.mouseX = e.clientX;
      controlsRef.current.mouseY = e.clientY;
    };
    const onMouseUp = () => { controlsRef.current.pointerDown = false; };

    const domEl = renderer.domElement;
    domEl.addEventListener('click', handleCanvasClick);
    domEl.addEventListener('mousemove', handleMouseHover);
    domEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // ── KEYBOARD ──────────────────────────────────────────────────────────
    const onKeyDown = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp')    controlsRef.current.forward   = true;
      if (c === 'KeyS' || c === 'ArrowDown')  controlsRef.current.backward  = true;
      if (c === 'KeyA' || c === 'ArrowLeft')  controlsRef.current.yawLeft   = true;
      if (c === 'KeyD' || c === 'ArrowRight') controlsRef.current.yawRight  = true;
      if (c === 'KeyR' || c === 'Space')      controlsRef.current.up        = true;
      if (c === 'KeyF' || c === 'ControlLeft')controlsRef.current.down      = true;
      if (c === 'KeyQ') controlsRef.current.rollLeft  = true;
      if (c === 'KeyE') controlsRef.current.rollRight = true;
      if (c === 'ShiftLeft' || c === 'ShiftRight') controlsRef.current.boost = true;
      if (c === 'KeyC') {
        setCameraMode(prev => {
          const next = prev === 'first' ? 'chase' : 'first';
          cameraModeRef.current = next;
          return next;
        });
      }
      if (c === 'KeyH') setShowControlsHint(prev => !prev);
      // FIX #1: Call via ref — avoids capturing stale closures of cycleCrack/selectClosestCrack
      if (c === 'BracketLeft')  cycleCrackRef.current?.(-1);
      if (c === 'BracketRight') cycleCrackRef.current?.(1);
      if (c === 'Enter')        selectClosestCrackRef.current?.();
    };
    const onKeyUp = (e) => {
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp')    controlsRef.current.forward   = false;
      if (c === 'KeyS' || c === 'ArrowDown')  controlsRef.current.backward  = false;
      if (c === 'KeyA' || c === 'ArrowLeft')  controlsRef.current.yawLeft   = false;
      if (c === 'KeyD' || c === 'ArrowRight') controlsRef.current.yawRight  = false;
      if (c === 'KeyR' || c === 'Space')      controlsRef.current.up        = false;
      if (c === 'KeyF' || c === 'ControlLeft')controlsRef.current.down      = false;
      if (c === 'KeyQ') controlsRef.current.rollLeft  = false;
      if (c === 'KeyE') controlsRef.current.rollRight = false;
      if (c === 'ShiftLeft' || c === 'ShiftRight') controlsRef.current.boost = false;
    };
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', handleResize);

    // ── FIX #4: Pre-allocate all Vector3/Quaternion used in the rAF loop ──
    // No `new THREE.Vector3()` inside requestAnimationFrame to avoid GC churn.
    const _fwd       = new THREE.Vector3();
    const _thrust    = new THREE.Vector3();
    const _roverFwd  = new THREE.Vector3();
    const _noseOff   = new THREE.Vector3();
    const _chaseOff  = new THREE.Vector3();
    const _lookAt    = new THREE.Vector3();

    // ROVER PHYSICS STATE (owned by the rAF loop, not React state)
    const roverVelocity = new THREE.Vector3();
    let roverYaw   = 0;
    let roverPitch = 0;
    let roverRoll  = 0;
    let lastTime   = performance.now();
    let animId     = null;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── RENDER LOOP ────────────────────────────────────────────────────────
    const animate = (currentTime) => {
      animId = requestAnimationFrame(animate);
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      const ctrl = controlsRef.current;
      const cfg  = TUNNEL_CONFIG.rover;

      // --- AUTONOMOUS SURVEY FLY-THROUGH LOGIC ---
      if (autoPilotRef.current) {
        const curZ = roverGroup.position.z;
        const now = performance.now();

        if (now < autoPilotPauseUntilRef.current) {
          roverVelocity.set(0, 0, 0);
        } else {
          const upcoming = cracksDataRef.current.find(c => {
            const dz = c.chainage_m - curZ;
            return dz > 0 && dz < 3.0 && !inspectedDefectsRef.current.has(c.id);
          });

          if (upcoming) {
            autoPilotPauseUntilRef.current = now + 2400;
            inspectedDefectsRef.current.add(upcoming.id);
            setSelectedCrack(upcoming);

            const defectTheta = (upcoming.angle_deg * Math.PI) / 180;
            const targetYaw = -defectTheta + Math.PI / 2;
            roverYaw = THREE.MathUtils.lerp(roverYaw, targetYaw, delta * 4.0);
          } else {
            roverGroup.position.x = THREE.MathUtils.lerp(roverGroup.position.x, 0, delta * 2.0);
            roverGroup.position.y = THREE.MathUtils.lerp(roverGroup.position.y, -0.4, delta * 2.0);
            roverYaw = THREE.MathUtils.lerp(roverYaw, 0, delta * 3.0);
            roverPitch = THREE.MathUtils.lerp(roverPitch, 0, delta * 3.0);
            roverVelocity.set(0, 0, 3.5);
            roverGroup.position.z += 3.5 * delta;

            if (roverGroup.position.z >= length - 2.0) {
              roverGroup.position.z = 2.0;
              inspectedDefectsRef.current.clear();
            }
          }
        }
      } else
      // Smooth LERP fly-to when a jump target is active
      if (jumpTargetRef.current) {
        const tgt = jumpTargetRef.current;
        roverGroup.position.lerp(tgt.pos, delta * 3.2);
        roverYaw   = THREE.MathUtils.lerp(roverYaw,   tgt.yaw,   delta * 3.5);
        roverPitch = THREE.MathUtils.lerp(roverPitch, tgt.pitch, delta * 3.5);
        roverVelocity.set(0, 0, 0);
        if (roverGroup.position.distanceTo(tgt.pos) < 0.25) {
          jumpTargetRef.current = null;
        }
      } else {
        const speedMax = ctrl.boost ? cfg.max_speed * cfg.boost_mult : cfg.max_speed;

        // Smooth mouse look handling
        if (ctrl.dx !== 0 || ctrl.dy !== 0) {
          roverYaw   -= ctrl.dx * 0.0025;
          roverPitch  = Math.max(-0.85, Math.min(0.85, roverPitch - ctrl.dy * 0.0025));
          ctrl.dx = 0;
          ctrl.dy = 0;
        }

        if (ctrl.yawLeft)   roverYaw  += cfg.turn_speed * delta;
        if (ctrl.yawRight)  roverYaw  -= cfg.turn_speed * delta;
        if (ctrl.rollLeft)  roverRoll += 1.8 * delta;
        if (ctrl.rollRight) roverRoll -= 1.8 * delta;
        roverRoll  = THREE.MathUtils.lerp(roverRoll,  0, delta * 2.5);
        if (!ctrl.pointerDown && Math.abs(roverPitch) > 0.01) {
          roverPitch = THREE.MathUtils.lerp(roverPitch, 0, delta * 1.5);
        }

        // Forward thrust direction — reusing pre-allocated _fwd
        _fwd.set(
          -Math.sin(roverYaw) * Math.cos(roverPitch),
           Math.sin(roverPitch),
           Math.cos(roverYaw) * Math.cos(roverPitch)
        );

        // Accumulated thrust — reusing pre-allocated _thrust
        _thrust.set(0, 0, 0);
        if (ctrl.forward)  _thrust.addScaledVector(_fwd,  speedMax);
        if (ctrl.backward) _thrust.addScaledVector(_fwd, -speedMax * 0.6);
        if (ctrl.up)   _thrust.y += cfg.vertical_speed;
        if (ctrl.down) _thrust.y -= cfg.vertical_speed;

        roverVelocity.lerp(_thrust, delta * cfg.acceleration);
        roverGroup.position.addScaledVector(roverVelocity, delta);
      }

      // Radial wall collision clamp
      const maxR = cfg.max_radial_distance;
      const rx = roverGroup.position.x;
      const ry = roverGroup.position.y;
      const curR = Math.sqrt(rx * rx + ry * ry);
      if (curR > maxR) {
        const f = maxR / curR;
        roverGroup.position.x *= f;
        roverGroup.position.y *= f;
        const nx = roverGroup.position.x / maxR;
        const ny = roverGroup.position.y / maxR;
        const radVel = roverVelocity.x * nx + roverVelocity.y * ny;
        if (radVel > 0) {
          roverVelocity.x -= radVel * nx;
          roverVelocity.y -= radVel * ny;
        }
      }
      roverGroup.position.z = Math.max(1.2, Math.min(length - 1.2, roverGroup.position.z));
      roverGroup.rotation.set(roverPitch, roverYaw, roverRoll, 'YXZ');

      // Spotlight aim — reusing pre-allocated _roverFwd
      _roverFwd.set(0, 0, 24.0).applyQuaternion(roverGroup.quaternion);
      spotTarget.position.copy(roverGroup.position).add(_roverFwd);

      roverVisuals.visible = (cameraModeRef.current === 'chase');

      // Camera — forward oriented for both 1st and 3rd person
      if (cameraModeRef.current === 'first') {
        _noseOff.set(0, 0.08, 0.42).applyQuaternion(roverGroup.quaternion);
        camera.position.copy(roverGroup.position).add(_noseOff);
        _lookAt.set(0, 0, 15.0).applyQuaternion(roverGroup.quaternion).add(roverGroup.position);
        camera.lookAt(_lookAt);
      } else {
        _chaseOff.set(0, 0.65, -2.4).applyQuaternion(roverGroup.quaternion);
        camera.position.copy(roverGroup.position).add(_chaseOff);
        _lookAt.set(0, 0.15, 8.0).applyQuaternion(roverGroup.quaternion).add(roverGroup.position);
        camera.lookAt(_lookAt);
      }

      // Particle drift (marine snow flowing down the tunnel)
      if (!prefersReducedMotion) {
        const pAttr = particleGeo.attributes.position;
        const pArr  = pAttr.array;
        for (let p = 0; p < particleCount; p++) {
          pArr[p * 3 + 2] -= delta * TUNNEL_CONFIG.particles.drift_speed;
          if (pArr[p * 3 + 2] < 0) pArr[p * 3 + 2] = length;
        }
        pAttr.needsUpdate = true;
      }

      // Defect marker pulse — sphere emissive + halo opacity
      const roverPos = roverGroup.position;
      crackMeshesRef.current.forEach(cm => {
        const dist  = cm.anchorPos.distanceTo(roverPos);
        const isNear = dist <= 18.0;
        const isSel  = selectedCrackRef.current?.id === cm.data.id;

        if (isSel || isNear) {
          const pulse = Math.sin(currentTime * 0.006) * 0.5 + 0.5;
          // Halo ring
          cm.haloMesh.visible    = true;
          cm.haloMat.opacity     = isSel ? 0.95 : 0.4 + pulse * 0.5;
          // Sphere emissive glow
          cm.sphereMesh.visible  = true;
          cm.sphereMat.emissiveIntensity = isSel ? 1.2 : 0.65 + pulse * 0.45;
          // Legacy reticle indicator
          cm.indicatorMesh.visible = true;
          cm.indicatorMat.opacity  = isSel ? 1.0 : 0.5 + pulse * 0.4;
          cm.highlightMesh.visible = isSel;
        } else {
          cm.haloMesh.visible      = false;
          cm.indicatorMesh.visible = false;
          cm.highlightMesh.visible = false;
          // Keep sphere clearly visible as navigational beacon up to 90m
          cm.sphereMesh.visible = dist <= 90.0;
          if (cm.sphereMesh.visible) cm.sphereMat.emissiveIntensity = 0.55;
        }
      });

      // Telemetry HUD update throttled to ~10 Hz
      if (Math.floor(currentTime / 100) % 2 === 0) {
        setTelemetry({
          x: roverGroup.position.x,
          y: roverGroup.position.y,
          z: roverGroup.position.z,
          speed: roverVelocity.length(),
          chainage: roverGroup.position.z,
          heading: ((-roverYaw * (180 / Math.PI)) % 360 + 360) % 360,
          depth: 38.5 + (roverGroup.position.y * 0.1),
        });
      }

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    // ── CLEANUP: dispose all GPU resources (FIX #3) ────────────────────────
    return () => {
      cancelAnimationFrame(animId);

      domEl.removeEventListener('click', handleCanvasClick);
      domEl.removeEventListener('mousemove', handleMouseHover);
      domEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);

      tunnelGeo.dispose();    tunnelMat.dispose();    concreteTex.dispose();
      ringJointGeo.dispose(); ringJointMat.dispose();
      capGeo.dispose();       capMat.dispose();
      particleGeo.dispose();  particleMat.dispose();
      chassisGeo.dispose();   chassisMat.dispose();
      shellGeo.dispose();     shellMat.dispose();
      domeGeo.dispose();      domeMat.dispose();
      thrusterGeo.dispose();  thrusterMat.dispose();

      crackMeshesRef.current.forEach(cm => {
        cm.crackGeo?.dispose();     cm.crackMat?.dispose();
        cm.highlightGeo?.dispose(); cm.highlightMat?.dispose();
        cm.indicatorGeo?.dispose(); cm.indicatorMat?.dispose();
        cm.sphereGeo?.dispose();    cm.sphereMat?.dispose();
        cm.haloGeo?.dispose();      cm.haloMat?.dispose();
        cm.hitGeo?.dispose();       cm.hitMat?.dispose();
      });

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [webglError]); // webglError is set once at init and never changes — stable dep

  // ── 3. Build 3D defect markers whenever cracksData changes ────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cracksData.length) return;

    // Dispose and remove previous markers
    crackMeshesRef.current.forEach(cm => {
      scene.remove(cm.group);
      cm.crackGeo?.dispose();     cm.crackMat?.dispose();
      cm.highlightGeo?.dispose(); cm.highlightMat?.dispose();
      cm.indicatorGeo?.dispose(); cm.indicatorMat?.dispose();
      cm.sphereGeo?.dispose();    cm.sphereMat?.dispose();
      cm.haloGeo?.dispose();      cm.haloMat?.dispose();
      cm.hitGeo?.dispose();       cm.hitMat?.dispose();
    });
    crackMeshesRef.current = [];

    const rSurface = TUNNEL_CONFIG.radius_m - 0.025; // 2.5cm inset from wall

    cracksData.forEach((crack, idx) => {
      const group  = new THREE.Group();
      const baseRad = (crack.angle_deg * Math.PI) / 180;
      const baseZ   = crack.chainage_m;
      const crackLen = Math.max(0.35, crack.length_mm / 1000);
      const sev = SEVERITY_CONFIG[crack.severity] || SEVERITY_CONFIG.Minor;
      const orientAngle = (idx % 3 === 0) ? 0 : (idx % 3 === 1 ? Math.PI / 2 : Math.PI / 4);

      // ── Crack tube (wall-conforming tube geometry) ─────────────────────
      const pts = [];
      const N   = 9;
      for (let i = 0; i <= N; i++) {
        const u    = (i / N - 0.5) * crackLen;
        const dZ   = u * Math.cos(orientAngle);
        const dArc = u * Math.sin(orientAngle);
        const curRad = baseRad + (dArc / rSurface);
        const jitter = (i > 0 && i < N) ? (Math.random() - 0.5) * 0.025 : 0;
        pts.push(new THREE.Vector3(
          (rSurface - jitter) * Math.sin(curRad),
          (rSurface - jitter) * Math.cos(curRad),
          baseZ + dZ + (Math.random() - 0.5) * 0.015
        ));
      }
      const curve      = new THREE.CatmullRomCurve3(pts);
      const tubeRad    = Math.max(0.012, (crack.width_mm / 1000) * 3.5);
      const crackGeo   = new THREE.TubeGeometry(curve, 24, tubeRad, 6, false);
      const crackMat   = new THREE.MeshStandardMaterial({ color: 0x05080f, roughness: 0.95, metalness: 0.05 });
      group.add(new THREE.Mesh(crackGeo, crackMat));

      // Wireframe highlight overlay (visible when selected/near)
      const highlightGeo  = new THREE.TubeGeometry(curve, 24, tubeRad * 1.9, 6, false);
      const highlightMat  = new THREE.MeshBasicMaterial({
        color: sev.threeColor, transparent: true, opacity: 0.75, wireframe: true,
      });
      const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
      highlightMesh.visible = false;
      group.add(highlightMesh);

      // Technical reticle ring (indicator at crack midpoint)
      const centerPt     = pts[Math.floor(N / 2)];
      const indicatorGeo = new THREE.RingGeometry(0.25, 0.28, 24);
      const indicatorMat = new THREE.MeshBasicMaterial({
        color: sev.threeColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      });
      const indicatorMesh = new THREE.Mesh(indicatorGeo, indicatorMat);
      indicatorMesh.position.copy(centerPt);
      indicatorMesh.lookAt(0, 0, centerPt.z);
      indicatorMesh.visible = false;
      group.add(indicatorMesh);

      // ── Sphere defect marker (Req 2) ─────────────────────────────────────
      // Cylindrical projection: X=r·sin(θ), Y=r·cos(θ), Z=chainage
      const mx        = DEFECT_R * Math.sin(baseRad);
      const my        = DEFECT_R * Math.cos(baseRad);
      const mz        = crack.chainage_m;
      const anchorPos = new THREE.Vector3(mx, my, mz);

      const sphereGeo = new THREE.SphereGeometry(0.22, 16, 12);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: sev.threeColor,
        emissive: sev.threeColor,
        emissiveIntensity: 0.75,
        roughness: 0.25,
        metalness: 0.05,
      });
      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      sphereMesh.position.copy(anchorPos);
      group.add(sphereMesh);

      // ── Halo torus ring (Req 2 — pulses when hovered / selected) ─────────
      const haloGeo  = new THREE.TorusGeometry(0.32, 0.022, 8, 32);
      const haloMat  = new THREE.MeshBasicMaterial({
        color: sev.threeColor, transparent: true, opacity: 0.0,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.copy(anchorPos);
      haloMesh.lookAt(0, 0, mz); // face inward toward the tunnel axis
      haloMesh.visible = false;
      group.add(haloMesh);

      // ── Invisible hit sphere for raycasting ───────────────────────────────
      const hitRadius = Math.max(0.45, crackLen * 0.6);
      const hitGeo    = new THREE.SphereGeometry(hitRadius, 8, 8);
      const hitMat    = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh   = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.position.copy(anchorPos);
      group.add(hitMesh);

      scene.add(group);

      crackMeshesRef.current.push({
        data: crack,
        group,
        anchorPos,
        hitMesh,
        sphereMesh, sphereMat, sphereGeo,
        haloMesh,   haloMat,   haloGeo,
        highlightMesh, highlightMat, highlightGeo,
        indicatorMesh, indicatorMat, indicatorGeo,
        crackGeo, crackMat,
        hitGeo,   hitMat,
      });
    });
  }, [cracksData]);

  // ── Jump to defect (smooth LERP fly-to, ~1.5m from wall) ─────────────────
  const handleJumpToCrack = useCallback((crack) => {
    setSelectedCrack(crack);
    setShowInventory(false);

    const rad    = (crack.angle_deg * Math.PI) / 180;
    const targetZ = Math.max(2.0, crack.chainage_m - 1.5);
    // Offset rover toward the wall where the defect is
    const targetX = Math.sin(rad) * 1.0;
    const targetY = Math.cos(rad) * 1.0 - 0.15;

    jumpTargetRef.current = {
      pos: new THREE.Vector3(targetX, targetY, targetZ),
      yaw: 0,
      pitch: 0,
    };
  }, []);

  // ── Cycle defects with [ / ] keys ─────────────────────────────────────────
  const cycleCrack = useCallback((direction) => {
    if (!cracksData.length) return;
    const sorted = [...cracksData].sort((a, b) => a.chainage_m - b.chainage_m);
    const cur    = selectedCrackRef.current;
    let nextIdx  = 0;
    if (cur) {
      const curIdx = sorted.findIndex(c => c.id === cur.id);
      nextIdx = (curIdx + direction + sorted.length) % sorted.length;
    } else if (direction < 0) {
      nextIdx = sorted.length - 1;
    }
    handleJumpToCrack(sorted[nextIdx]);
  }, [cracksData, handleJumpToCrack]);

  // Sync latest cycleCrack into ref (FIX #1)
  useEffect(() => { cycleCrackRef.current = cycleCrack; }, [cycleCrack]);

  // ── Target nearest defect on Enter ────────────────────────────────────────
  const selectClosestCrack = useCallback(() => {
    if (!roverMeshRef.current || !cracksData.length) return;
    const z = roverMeshRef.current.position.z;
    let closest = null, minDist = Infinity;
    cracksData.forEach(c => {
      const d = Math.abs(c.chainage_m - z);
      if (d < minDist) { minDist = d; closest = c; }
    });
    if (closest && minDist <= 15.0) setSelectedCrack(closest);
  }, [cracksData]);

  // Sync latest selectClosestCrack into ref (FIX #1)
  useEffect(() => { selectClosestCrackRef.current = selectClosestCrack; }, [selectClosestCrack]);

  // ── Reset camera to start / chase mode ────────────────────────────────────
  const toggleAutoPilot = useCallback(() => {
    setAutoPilot(prev => {
      const next = !prev;
      autoPilotRef.current = next;
      if (next) {
        inspectedDefectsRef.current.clear();
        autoPilotPauseUntilRef.current = 0;
      }
      return next;
    });
  }, []);

  const handleResetCamera = useCallback(() => {
    jumpTargetRef.current = {
      pos: new THREE.Vector3(...TUNNEL_CONFIG.rover.start_pos),
      yaw: 0, pitch: 0,
    };
    setSelectedCrack(null);
    setCameraMode('first');
    cameraModeRef.current = 'first';
  }, []);

  // ── Sorted crack list for inventory drawer ─────────────────────────────────
  const sortedCracks = useMemo(() => {
    const list = [...cracksData];
    if (sortBy === 'chainage') return list.sort((a, b) => a.chainage_m - b.chainage_m);
    const order = { Critical: 0, Major: 1, Minor: 2, Info: 3 };
    return list.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [cracksData, sortBy]);

  // ── Mobile virtual joystick ────────────────────────────────────────────────
  const handleTouchControl = (action, isStart) => {
    const ctrl = controlsRef.current;
    if (action === 'fwd')   ctrl.forward  = isStart;
    if (action === 'back')  ctrl.backward = isStart;
    if (action === 'left')  ctrl.yawLeft  = isStart;
    if (action === 'right') ctrl.yawRight = isStart;
    if (action === 'up')    ctrl.up       = isStart;
    if (action === 'down')  ctrl.down     = isStart;
    if (action === 'boost') ctrl.boost    = isStart;
  };

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="twin-root" role="region" aria-label="Head Race Tunnel 3D Digital Twin Rover Simulator">

      {/* 3D WebGL Canvas Viewport */}
      <div ref={mountRef} className="twin-viewport" tabIndex={0} />

      {/* WebGL Failure Fallback */}
      {webglError && (
        <div className="twin-fallback">
          <div className="twin-fallback-box">
            <h2>WebGL Acceleration Required</h2>
            <p>{webglError}</p>
            <p className="twin-fallback-sub">
              Your browser or hardware environment does not currently have WebGL enabled.
              Please enable hardware acceleration or return to the 2D dashboard.
            </p>
            <button className="twin-btn-primary" onClick={() => navigate('/dashboard/tunnel')}>
              Return to 3D Tunnel Overview
            </button>
          </div>
        </div>
      )}

      {/* Loading Screen */}
      {loading && (
        <div className="twin-loading">
          <div className="twin-loading-spinner" />
          <p>INITIALIZING 3D DIGITAL TWIN &amp; OPTICAL HYDRODYNAMICS...</p>
          <span className="twin-loading-sub">Generating parametric concrete lining &amp; loading telemetry</span>
        </div>
      )}

      {/* Error Banner (cracks.json fetch failure) */}
      {dataError && (
        <div className="twin-error-banner" role="alert">
          <span>Failed to load detection logs: {dataError}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {/* ── TOP HUD HEADER ── */}
      <header className="twin-hud-header">
        <div className="twin-brand-block">
          <div className="twin-brand-title">
            <span>HRT 3D DIGITAL TWIN</span>
            <span className="twin-badge-sample">SAMPLE DATA</span>
          </div>
          <p className="twin-disclaimer">Parametric model — not a survey-accurate reconstruction.</p>
        </div>

        <div className="twin-telemetry-strip" aria-label="Rover Live Telemetry">
          <div className="twin-telem-item">
            <span className="twin-telem-k">CHAINAGE</span>
            <span className="twin-telem-v">{telemetry.chainage.toFixed(1)} m</span>
          </div>
          <div className="twin-telem-item">
            <span className="twin-telem-k">COORDINATES (XYZ)</span>
            <span className="twin-telem-v">
              {telemetry.x.toFixed(2)}, {telemetry.y.toFixed(2)}, {telemetry.z.toFixed(2)}
            </span>
          </div>
          <div className="twin-telem-item">
            <span className="twin-telem-k">SPEED</span>
            <span className="twin-telem-v">{telemetry.speed.toFixed(1)} m/s</span>
          </div>
          <div className="twin-telem-item">
            <span className="twin-telem-k">SIM. DEPTH</span>
            <span className="twin-telem-v">{(-telemetry.depth).toFixed(1)} m</span>
          </div>
        </div>

        <div className="twin-header-actions">
          <button
            className={`twin-btn-hud ${autoPilot ? 'twin-btn-hud--active' : ''}`}
            onClick={toggleAutoPilot}
            title="Toggle Autonomous Inspection Fly-Through"
            id="twin-autopilot-btn"
            style={{
              background: autoPilot ? '#0d9488' : 'rgba(15, 23, 42, 0.75)',
              color: '#ffffff',
              border: autoPilot ? '1px solid #14b8a6' : '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: autoPilot ? '0 0 12px rgba(20, 184, 166, 0.6)' : 'none',
              fontWeight: 700
            }}
          >
            AUTONOMOUS: {autoPilot ? 'ENGAGED 🚀' : 'OFF'}
          </button>
          <button
            className="twin-btn-hud"
            onClick={() => {
              setCameraMode(prev => {
                const next = prev === 'first' ? 'chase' : 'first';
                cameraModeRef.current = next;
                return next;
              });
            }}
            title="Press [C] to toggle camera perspective"
            id="twin-cam-toggle"
          >
            CAM: {cameraMode === 'first' ? '1ST PERSON' : '3RD CHASE'}
          </button>
          <button
            className="twin-btn-hud"
            onClick={() => setShowInventory(prev => !prev)}
            id="twin-inventory-toggle"
          >
            CRACK LIST ({cracksData.length})
          </button>
          <Link to="/dashboard/tunnel" className="twin-btn-hud twin-btn-exit" id="twin-back-btn">
            ← BACK TO DASHBOARD
          </Link>
        </div>
      </header>

      {/* ── CONTROLS HINT (dismissible) ── */}
      {showControlsHint && (
        <aside className="twin-controls-card" aria-label="Rover flight controls">
          <div className="twin-controls-head">
            <span>ROV FLIGHT CONTROLS</span>
            <button
              className="twin-close-btn"
              onClick={() => setShowControlsHint(false)}
              aria-label="Dismiss controls hint"
            >
              &times;
            </button>
          </div>
          <div className="twin-controls-grid">
            <div><kbd>W</kbd>/<kbd>&uarr;</kbd> <kbd>S</kbd>/<kbd>&darr;</kbd> Forward/Back</div>
            <div><kbd>A</kbd>/<kbd>&larr;</kbd> <kbd>D</kbd>/<kbd>&rarr;</kbd> Yaw Steer</div>
            <div><kbd>Space</kbd>/<kbd>R</kbd> Up &bull; <kbd>Ctrl</kbd>/<kbd>F</kbd> Down</div>
            <div><kbd>Shift</kbd> Hydrodynamic Boost</div>
            <div><kbd>Mouse</kbd> Drag to Look</div>
            <div><kbd>C</kbd> Toggle 1st / 3rd Camera</div>
            <div><kbd>[</kbd> <kbd>]</kbd> Cycle Defects</div>
            <div><kbd>Enter</kbd> Target Nearest Defect</div>
          </div>
          <div className="twin-dpad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Interactive Steer D-Pad</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="twin-btn-hud"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onMouseDown={() => handleTouchControl('fwd', true)}
                onMouseUp={() => handleTouchControl('fwd', false)}
                onMouseLeave={() => handleTouchControl('fwd', false)}
                title="Forward (W / Up)"
              >
                &uarr; FWD
              </button>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="twin-btn-hud"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onMouseDown={() => handleTouchControl('left', true)}
                onMouseUp={() => handleTouchControl('left', false)}
                onMouseLeave={() => handleTouchControl('left', false)}
                title="Steer Left (A / Left)"
              >
                &larr; LEFT
              </button>
              <button
                className="twin-btn-hud"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onMouseDown={() => handleTouchControl('back', true)}
                onMouseUp={() => handleTouchControl('back', false)}
                onMouseLeave={() => handleTouchControl('back', false)}
                title="Reverse (S / Down)"
              >
                &darr; REV
              </button>
              <button
                className="twin-btn-hud"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onMouseDown={() => handleTouchControl('right', true)}
                onMouseUp={() => handleTouchControl('right', false)}
                onMouseLeave={() => handleTouchControl('right', false)}
                title="Steer Right (D / Right)"
              >
                RIGHT &rarr;
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
              <button
                className="twin-btn-hud"
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onMouseDown={() => handleTouchControl('up', true)}
                onMouseUp={() => handleTouchControl('up', false)}
                onMouseLeave={() => handleTouchControl('up', false)}
                title="Ascend (Space / R)"
              >
                &and; UP
              </button>
              <button
                className="twin-btn-hud"
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onMouseDown={() => handleTouchControl('down', true)}
                onMouseUp={() => handleTouchControl('down', false)}
                onMouseLeave={() => handleTouchControl('down', false)}
                title="Descend (Ctrl / F)"
              >
                &or; DOWN
              </button>
            </div>
          </div>
          <p className="twin-controls-note" style={{ marginTop: '6px' }}>Press <kbd>H</kbd> to toggle this help HUD</p>
        </aside>
      )}

      {/* ── MOBILE TOUCH CONTROLS ── */}
      <div className="twin-mobile-controls" aria-hidden="true">
        <div className="twin-touch-pad">
          <button
            onTouchStart={() => handleTouchControl('fwd', true)}
            onTouchEnd={() => handleTouchControl('fwd', false)}
          >&#9650;</button>
          <div className="twin-touch-row">
            <button onTouchStart={() => handleTouchControl('left', true)} onTouchEnd={() => handleTouchControl('left', false)}>&#9664;</button>
            <button onTouchStart={() => handleTouchControl('back', true)} onTouchEnd={() => handleTouchControl('back', false)}>&#9660;</button>
            <button onTouchStart={() => handleTouchControl('right', true)} onTouchEnd={() => handleTouchControl('right', false)}>&#9654;</button>
          </div>
        </div>
        <div className="twin-touch-aux">
          <button onTouchStart={() => handleTouchControl('up', true)} onTouchEnd={() => handleTouchControl('up', false)}>UP</button>
          <button onTouchStart={() => handleTouchControl('down', true)} onTouchEnd={() => handleTouchControl('down', false)}>DOWN</button>
          <button
            className="twin-touch-boost"
            onTouchStart={() => handleTouchControl('boost', true)}
            onTouchEnd={() => handleTouchControl('boost', false)}
          >BOOST</button>
        </div>
      </div>

      {/* ── CHAINAGE QUICK-JUMP BAR ── */}
      <div className="twin-chainage-bar" aria-label="Tunnel Chainage Quick-Jump Bar">
        <span className="twin-chainage-label">CH 0.0m (INTAKE)</span>
        <input
          type="range"
          min={2}
          max={248}
          step={0.5}
          value={telemetry.chainage}
          onChange={(e) => {
            const z = parseFloat(e.target.value);
            jumpTargetRef.current = {
              pos: new THREE.Vector3(roverMeshRef.current?.position.x || 0, roverMeshRef.current?.position.y || -0.4, z),
              yaw: 0,
              pitch: 0
            };
          }}
          className="twin-chainage-slider"
          aria-label="Chainage position slider"
        />
        <span className="twin-chainage-label">CH 250.0m (OUTLET)</span>
      </div>

      {/* ── DEFECT INSPECTOR PANEL ── */}
      {selectedCrack && (
        <aside className="twin-crack-inspector" aria-label="Selected Defect Telemetry">
          <div className="twin-inspector-head">
            <div>
              <span className="twin-inspect-sub">DEFECT TELEMETRY</span>
              <h3 className="twin-inspect-id">{selectedCrack.id}</h3>
            </div>
            <button
              className="twin-close-btn"
              onClick={() => setSelectedCrack(null)}
              aria-label="Close defect panel"
            >
              &times;
            </button>
          </div>

          <div className="twin-inspect-status">
            <span
              className="twin-sev-pill"
              style={{
                borderColor: SEVERITY_CONFIG[selectedCrack.severity]?.color,
                color:       SEVERITY_CONFIG[selectedCrack.severity]?.color,
              }}
            >
              {selectedCrack.severity.toUpperCase()}
            </span>
            <span className="twin-source-pill">SOURCE: {selectedCrack.source.toUpperCase()}</span>
          </div>

          <div className="twin-inspect-table">
            <div className="twin-row">
              <span>Defect ID</span>
              <strong className="twin-mono">{selectedCrack.id}</strong>
            </div>
            <div className="twin-row">
              <span>Chainage Position</span>
              <strong>{selectedCrack.chainage_m.toFixed(1)} m</strong>
            </div>
            <div className="twin-row">
              <span>Clock-face Position</span>
              <strong>{formatClockPosition(selectedCrack.angle_deg)}</strong>
            </div>
            <div className="twin-row">
              <span>Severity</span>
              <strong style={{ color: SEVERITY_CONFIG[selectedCrack.severity]?.color }}>
                {SEVERITY_CONFIG[selectedCrack.severity]?.label}
              </strong>
            </div>
            <div className="twin-row">
              <span>Estimated Dimensions</span>
              <strong>{selectedCrack.length_mm} mm &times; {selectedCrack.width_mm} mm</strong>
            </div>
            <div className="twin-row">
              <span>Model Cartesian (XYZ)</span>
              <strong className="twin-mono">
                {(DEFECT_R * Math.sin(selectedCrack.angle_deg * Math.PI / 180)).toFixed(2)},{' '}
                {(DEFECT_R * Math.cos(selectedCrack.angle_deg * Math.PI / 180)).toFixed(2)},{' '}
                {selectedCrack.chainage_m.toFixed(2)}
              </strong>
            </div>
          </div>

          {selectedCrack.notes && (
            <div className="twin-inspect-notes">
              <span className="twin-notes-label">INSPECTION LOG</span>
              <p>{selectedCrack.notes}</p>
            </div>
          )}

          <div className="twin-inspect-actions">
            <button
              className="twin-btn-primary"
              onClick={() => handleJumpToCrack(selectedCrack)}
              id="twin-jump-btn"
            >
              JUMP ROVER TO DEFECT
            </button>
            <button
              className="twin-btn-hud"
              onClick={handleResetCamera}
              id="twin-reset-cam-btn"
              style={{ width: '100%', marginTop: 0 }}
            >
              &#8635; RESET CAMERA / CHASE MODE
            </button>
          </div>
        </aside>
      )}

      {/* ── CRACK INVENTORY DRAWER ── */}
      {showInventory && (
        <aside className="twin-inventory-drawer" aria-label="Crack Detection Inventory">
          <div className="twin-inventory-head">
            <div>
              <h3>TUNNEL DEFECT LOG ({cracksData.length})</h3>
              <p className="twin-inventory-sub">Interactive defect chainage catalogue</p>
            </div>
            <button
              className="twin-close-btn"
              onClick={() => setShowInventory(false)}
              aria-label="Close inventory"
            >
              &times;
            </button>
          </div>

          <div className="twin-sort-bar">
            <span>Sort by:</span>
            <button
              className={`twin-sort-btn ${sortBy === 'chainage' ? 'active' : ''}`}
              onClick={() => setSortBy('chainage')}
            >
              Chainage
            </button>
            <button
              className={`twin-sort-btn ${sortBy === 'severity' ? 'active' : ''}`}
              onClick={() => setSortBy('severity')}
            >
              Severity
            </button>
          </div>

          <div className="twin-inventory-list" role="list">
            {sortedCracks.map(crack => {
              const sev = SEVERITY_CONFIG[crack.severity] || SEVERITY_CONFIG.Minor;
              const isSelected = selectedCrack?.id === crack.id;
              return (
                <div
                  key={crack.id}
                  className={`twin-inv-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleJumpToCrack(crack)}
                  role="listitem"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJumpToCrack(crack); }}
                >
                  <div className="twin-inv-top">
                    <span className="twin-inv-id">{crack.id}</span>
                    <span className="twin-inv-sev" style={{ color: sev.color }}>
                      &#9679; {crack.severity}
                    </span>
                  </div>
                  <div className="twin-inv-details">
                    <span>Ch {crack.chainage_m.toFixed(1)} m</span>
                    <span>{formatClockPosition(crack.angle_deg)}</span>
                    <span>{crack.length_mm}&times;{crack.width_mm} mm</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* ── BOTTOM CHAINAGE STRIP ── */}
      <footer className="twin-bottom-strip" aria-label="Linear chainage inspection minimap">
        <div className="twin-strip-meta">
          <span className="twin-strip-label">INTAKE (0.0 m)</span>
          <span className="twin-strip-coords">{TUNNEL_CONFIG.coordinate_frame}</span>
          <span className="twin-strip-label">OUTLET ({TUNNEL_CONFIG.length_m.toFixed(0)} m)</span>
        </div>

        <div className="twin-strip-track">
          {[0, 50, 100, 150, 200, 250].map(m => (
            <div
              key={m}
              className="twin-strip-tick"
              style={{ left: `${(m / TUNNEL_CONFIG.length_m) * 100}%` }}
            >
              <span className="twin-tick-line" />
              <span className="twin-tick-text">{m}m</span>
            </div>
          ))}

          {cracksData.map(crack => {
            const pct   = Math.max(0, Math.min(100, (crack.chainage_m / TUNNEL_CONFIG.length_m) * 100));
            const sev   = SEVERITY_CONFIG[crack.severity] || SEVERITY_CONFIG.Minor;
            const isSel = selectedCrack?.id === crack.id;
            return (
              <button
                key={crack.id}
                className={`twin-crack-pin ${isSel ? 'selected' : ''}`}
                style={{ left: `${pct}%`, backgroundColor: sev.color }}
                onClick={() => handleJumpToCrack(crack)}
                title={`${crack.id} (${crack.severity}) at Ch ${crack.chainage_m}m`}
                aria-label={`${crack.severity} crack at chainage ${crack.chainage_m} meters`}
              />
            );
          })}

          <div
            className="twin-rover-pin"
            style={{ left: `${Math.max(0, Math.min(100, (telemetry.chainage / TUNNEL_CONFIG.length_m) * 100))}%` }}
            aria-label="Rover Current Location"
          >
            <div className="twin-rover-cone" />
            <span className="twin-rover-label">ROV {telemetry.chainage.toFixed(1)}m</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
