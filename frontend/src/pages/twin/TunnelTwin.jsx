import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import * as THREE from 'three';
import { TUNNEL_CONFIG } from './tunnel.config';
import './TunnelTwin.css';

// Severity visual tokens (restrained, technical palette)
const SEVERITY_CONFIG = {
  Critical: { color: '#ef4444', threeColor: 0xef4444, label: 'CRITICAL' },
  Major:    { color: '#f97316', threeColor: 0xf97316, label: 'MAJOR' },
  Minor:    { color: '#eab308', threeColor: 0xeab308, label: 'MINOR' },
  Info:     { color: '#38bdf8', threeColor: 0x38bdf8, label: 'INFO' },
};

function formatClockPosition(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized === 0 || normalized === 360) return "12 o'clock (Crown)";
  if (normalized === 90) return "3 o'clock (Right Wall)";
  if (normalized === 180) return "6 o'clock (Invert / Floor)";
  if (normalized === 270) return "9 o'clock (Left Wall)";
  const clock = Math.round(normalized / 30) || 12;
  return `${clock} o'clock (${normalized}°)`;
}

// Procedural high-res concrete texture generator with damp mottled look
function createProceduralConcreteTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base concrete dark grey
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(0, 0, size, size);

  // Perlin-like pseudo noise layers
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Macro variation (damp patches)
      const damp = Math.sin(x * 0.015) * Math.cos(y * 0.015) * 18;
      // Micro aggregate grain
      const noise = (Math.random() - 0.5) * 32;
      const base = 85 + damp + noise;
      // Cold submerged water tone shift
      data[idx]     = Math.max(0, Math.min(255, base - 8));    // R
      data[idx + 1] = Math.max(0, Math.min(255, base + 2));    // G
      data[idx + 2] = Math.max(0, Math.min(255, base + 8));    // B
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Concrete segment ring joint grooves & formwork seam marks
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // Subtle longitudinal formwork lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 2;
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

export default function TunnelTwin() {
  const navigate = useNavigate();
  const mountRef = useRef(null);

  // State
  const [loading, setLoading] = useState(true);
  const [webglError, setWebglError] = useState(null);
  const [cracksData, setCracksData] = useState([]);
  const [dataError, setDataError] = useState(null);
  const [selectedCrack, setSelectedCrack] = useState(null);
  const selectedCrackRef = useRef(null);
  useEffect(() => {
    selectedCrackRef.current = selectedCrack;
  }, [selectedCrack]);
  const [cameraMode, setCameraMode] = useState('first'); // 'first' | 'chase'
  const cameraModeRef = useRef('first');
  const [showControlsHint, setShowControlsHint] = useState(true);
  const [showInventory, setShowInventory] = useState(false);
  const [sortBy, setSortBy] = useState('chainage'); // 'chainage' | 'severity'
  
  // Real-time telemetry state for HUD
  const [telemetry, setTelemetry] = useState({
    x: 0,
    y: -0.6,
    z: 6.0,
    speed: 0,
    chainage: 6.0,
    heading: 0,
    depth: 38.5,
  });

  // Rover controls and jump ref
  const controlsRef = useRef({
    forward: false,
    backward: false,
    yawLeft: false,
    yawRight: false,
    up: false,
    down: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    pointerDown: false,
    mouseX: 0,
    mouseY: 0,
    pitchDelta: 0,
    yawDelta: 0,
  });

  const jumpTargetRef = useRef(null);
  const sceneRef = useRef(null);
  const roverMeshRef = useRef(null);
  const crackMeshesRef = useRef([]);

  // 1. Fetch cracks data
  useEffect(() => {
    let active = true;
    fetch('/data/cracks.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading cracks.json`);
        return res.json();
      })
      .then(data => {
        if (active) {
          setCracksData(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          console.error("Failed to fetch cracks.json:", err);
          setDataError(err.message);
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, []);

  // 2. Check WebGL support
  const isWebGLAvailable = useCallback(() => {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch {
      return false;
    }
  }, []);

  // 3. Initialize Three.js Engine
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    if (!isWebGLAvailable()) {
      setWebglError('WebGL is unavailable or disabled in your browser environment. Three.js hardware acceleration is required.');
      return;
    }

    const width = container.clientWidth;
    const height = container.clientHeight;

    // SCENE
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Underwater optical exponential fog (deep blue-green)
    scene.fog = new THREE.FogExp2(
      TUNNEL_CONFIG.water_fog.color,
      TUNNEL_CONFIG.water_fog.density
    );
    scene.background = new THREE.Color(TUNNEL_CONFIG.water_fog.color);

    // CAMERA
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 120);

    // RENDERER
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // TUNNEL GEOMETRY & MATERIAL
    const radius = TUNNEL_CONFIG.radius_m;
    const length = TUNNEL_CONFIG.length_m;
    const radialSegs = TUNNEL_CONFIG.radial_segments;
    const ringLen = TUNNEL_CONFIG.ring_length_m;
    const numRings = Math.round(length / ringLen);

    // Procedural concrete texture
    const concreteTex = createProceduralConcreteTexture();
    concreteTex.repeat.set(8, numRings);

    // Tunnel cylinder (BackSide so inside is rendered cleanly with correct lighting)
    const tunnelGeo = new THREE.CylinderGeometry(
      radius,
      radius,
      length,
      radialSegs,
      numRings,
      true
    );
    // Align cylinder length along +Z axis
    tunnelGeo.rotateX(Math.PI / 2);
    tunnelGeo.translate(0, 0, length / 2);

    const tunnelMat = new THREE.MeshStandardMaterial({
      map: concreteTex,
      roughness: 0.58,     // Damp, slightly reflective concrete
      metalness: 0.08,
      side: THREE.BackSide, // Clean inside rendering
    });

    const tunnelMesh = new THREE.Mesh(tunnelGeo, tunnelMat);
    scene.add(tunnelMesh);

    // Visible precast concrete ring joint lines
    const ringJointGeo = new THREE.TorusGeometry(radius - 0.015, 0.018, 6, radialSegs);
    const ringJointMat = new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      roughness: 0.9,
    });
    const ringInstanced = new THREE.InstancedMesh(ringJointGeo, ringJointMat, numRings + 1);
    const dummyMat = new THREE.Matrix4();
    for (let r = 0; r <= numRings; r++) {
      dummyMat.setPosition(0, 0, r * ringLen);
      ringInstanced.setMatrixAt(r, dummyMat);
    }
    ringInstanced.instanceMatrix.needsUpdate = true;
    scene.add(ringInstanced);

    // End caps (intake at z=0, bulkhead at z=length)
    const capGeo = new THREE.CircleGeometry(radius, radialSegs);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x111c2a,
      roughness: 0.8,
    });
    // Intake grill cap
    const intakeCap = new THREE.Mesh(capGeo, capMat);
    intakeCap.position.set(0, 0, 0);
    scene.add(intakeCap);

    // Bulkhead end cap
    const endCap = new THREE.Mesh(capGeo, capMat);
    endCap.position.set(0, 0, length);
    endCap.rotateY(Math.PI);
    scene.add(endCap);

    // SUSPENDED PARTICULATE MATTER (Marine Snow)
    const particleCount = TUNNEL_CONFIG.particles.count;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let p = 0; p < particleCount; p++) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.random() * (radius - 0.35);
      particlePositions[p * 3]     = Math.cos(theta) * r;
      particlePositions[p * 3 + 1] = Math.sin(theta) * r;
      particlePositions[p * 3 + 2] = Math.random() * length;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: TUNNEL_CONFIG.particles.color,
      size: TUNNEL_CONFIG.particles.size,
      transparent: true,
      opacity: 0.65,
      fog: true,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // INSPECTION ROVER MODEL
    const roverGroup = new THREE.Group();
    roverGroup.position.set(
      TUNNEL_CONFIG.rover.start_pos[0],
      TUNNEL_CONFIG.rover.start_pos[1],
      TUNNEL_CONFIG.rover.start_pos[2]
    );
    roverMeshRef.current = roverGroup;

    // Sub-group for vehicle visual geometry (hidden in 1st person nose cam, visible in chase cam)
    const roverVisuals = new THREE.Group();
    roverGroup.add(roverVisuals);

    // Rover chassis body (marine aluminum frame)
    const chassisGeo = new THREE.BoxGeometry(0.55, 0.32, 0.75);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.3,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    roverVisuals.add(chassis);

    // Acrylic yellow buoyancy top shell
    const shellGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.65, 16);
    shellGeo.rotateX(Math.PI / 2);
    shellGeo.scale(1.1, 0.45, 1);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04,
      roughness: 0.35,
      metalness: 0.1,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.set(0, 0.18, 0);
    roverVisuals.add(shell);

    // Front HD camera dome
    const domeGeo = new THREE.SphereGeometry(0.1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.rotateX(-Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(0, 0.02, 0.39);
    roverVisuals.add(dome);

    // Thruster cowlings (4 vector thrusters)
    const thrusterGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12);
    thrusterGeo.rotateX(Math.PI / 2);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.4 });
    const thrusterPositions = [
      [-0.34, 0.02, -0.2],
      [ 0.34, 0.02, -0.2],
      [-0.34, 0.02,  0.2],
      [ 0.34, 0.02,  0.2],
    ];
    thrusterPositions.forEach(tp => {
      const tMesh = new THREE.Mesh(thrusterGeo, thrusterMat);
      tMesh.position.set(tp[0], tp[1], tp[2]);
      roverVisuals.add(tMesh);
    });

    // ROVER LIGHTING
    // Spotlight target added to scene
    const spotTarget = new THREE.Object3D();
    scene.add(spotTarget);

    const headlight = new THREE.SpotLight(0xf8fafc, 240);
    headlight.position.set(0, 0.1, 0.38);
    headlight.target = spotTarget;
    headlight.angle = Math.PI / 3.2;
    headlight.penumbra = 0.45;
    headlight.decay = 1.3;
    headlight.distance = 48.0;
    roverGroup.add(headlight);

    // Wide forward fill point light
    const fillLight = new THREE.PointLight(0x7dd3fc, 28, 22.0);
    fillLight.position.set(0, 0.0, 0.45);
    roverGroup.add(fillLight);

    scene.add(roverGroup);

    // Ambient light so underwater tunnel geometry is visible within the fog
    const ambientLight = new THREE.AmbientLight(0x0e232e, 0.95);
    scene.add(ambientLight);

    // RAYCASTER FOR CRACK CLICK SELECTION
    const raycaster = new THREE.Raycaster();
    const mouseCoord = new THREE.Vector2();

    const handleCanvasClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseCoord.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseCoord, camera);

      const interactables = crackMeshesRef.current.map(c => c.hitMesh);
      const intersects = raycaster.intersectObjects(interactables, false);

      if (intersects.length > 0) {
        const found = crackMeshesRef.current.find(c => c.hitMesh === intersects[0].object);
        if (found) {
          setSelectedCrack(found.data);
        }
      }
    };
    renderer.domElement.addEventListener('click', handleCanvasClick);

    // MOUSE DRAG / LOOK HANDLERS
    const onMouseDown = (e) => {
      if (e.button === 0) {
        controlsRef.current.pointerDown = true;
        controlsRef.current.mouseX = e.clientX;
        controlsRef.current.mouseY = e.clientY;
      }
    };
    const onMouseMove = (e) => {
      if (!controlsRef.current.pointerDown) return;
      const dx = e.clientX - controlsRef.current.mouseX;
      const dy = e.clientY - controlsRef.current.mouseY;
      controlsRef.current.mouseX = e.clientX;
      controlsRef.current.mouseY = e.clientY;

      controlsRef.current.yawDelta -= dx * 0.0035;
      controlsRef.current.pitchDelta -= dy * 0.0035;
      // Clamp pitch look angle
      controlsRef.current.pitchDelta = Math.max(-0.6, Math.min(0.6, controlsRef.current.pitchDelta));
    };
    const onMouseUp = () => {
      controlsRef.current.pointerDown = false;
    };

    const domEl = renderer.domElement;
    domEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // KEYBOARD LISTENER
    const onKeyDown = (e) => {
      // Don't capture when user is in input/select
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const code = e.code;
      if (code === 'KeyW') controlsRef.current.forward = true;
      if (code === 'KeyS') controlsRef.current.backward = true;
      if (code === 'KeyA') controlsRef.current.yawLeft = true;
      if (code === 'KeyD') controlsRef.current.yawRight = true;
      if (code === 'KeyR') controlsRef.current.up = true;
      if (code === 'KeyF') controlsRef.current.down = true;
      if (code === 'KeyQ') controlsRef.current.rollLeft = true;
      if (code === 'KeyE') controlsRef.current.rollRight = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') controlsRef.current.boost = true;

      // C: Toggle camera view
      if (code === 'KeyC') {
        setCameraMode(prev => {
          const next = prev === 'first' ? 'chase' : 'first';
          cameraModeRef.current = next;
          return next;
        });
      }
      // H: Toggle controls hint
      if (code === 'KeyH') {
        setShowControlsHint(prev => !prev);
      }
      // [ : Previous crack
      if (code === 'BracketLeft') {
        cycleCrack(-1);
      }
      // ] : Next crack
      if (code === 'BracketRight') {
        cycleCrack(1);
      }
      // Enter : Select closest crack if within 12m
      if (code === 'Enter') {
        selectClosestCrack();
      }
    };

    const onKeyUp = (e) => {
      const code = e.code;
      if (code === 'KeyW') controlsRef.current.forward = false;
      if (code === 'KeyS') controlsRef.current.backward = false;
      if (code === 'KeyA') controlsRef.current.yawLeft = false;
      if (code === 'KeyD') controlsRef.current.yawRight = false;
      if (code === 'KeyR') controlsRef.current.up = false;
      if (code === 'KeyF') controlsRef.current.down = false;
      if (code === 'KeyQ') controlsRef.current.rollLeft = false;
      if (code === 'KeyE') controlsRef.current.rollRight = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') controlsRef.current.boost = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // RESIZE LISTENER
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // ROVER PHYSICS STATE
    const roverVelocity = new THREE.Vector3();
    let roverYaw = 0;
    let roverPitch = 0;
    let roverRoll = 0;
    let lastTime = performance.now();
    let animId = null;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // RENDER LOOP
    const animate = (currentTime) => {
      animId = requestAnimationFrame(animate);

      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      const ctrl = controlsRef.current;
      const cfg = TUNNEL_CONFIG.rover;

      // Handle smooth jump interpolation if active
      if (jumpTargetRef.current) {
        const tgt = jumpTargetRef.current;
        roverGroup.position.lerp(tgt.pos, delta * 3.2);
        roverYaw = THREE.MathUtils.lerp(roverYaw, tgt.yaw, delta * 3.5);
        roverPitch = THREE.MathUtils.lerp(roverPitch, tgt.pitch, delta * 3.5);
        roverVelocity.set(0, 0, 0);

        if (roverGroup.position.distanceTo(tgt.pos) < 0.25) {
          jumpTargetRef.current = null;
        }
      } else {
        // Dynamic ROV steering & throttle
        const currentSpeedMax = ctrl.boost ? cfg.max_speed * cfg.boost_mult : cfg.max_speed;

        // Yaw rotation
        if (ctrl.yawLeft) roverYaw += cfg.turn_speed * delta;
        if (ctrl.yawRight) roverYaw -= cfg.turn_speed * delta;

        // Roll
        if (ctrl.rollLeft) roverRoll += 1.8 * delta;
        if (ctrl.rollRight) roverRoll -= 1.8 * delta;
        roverRoll = THREE.MathUtils.lerp(roverRoll, 0, delta * 2.5); // passive stabilizing buoyant righting moment

        // Pitch & yaw from mouse look (smooth return to center when released)
        roverPitch = THREE.MathUtils.lerp(roverPitch, ctrl.pitchDelta, delta * 6.0);

        // Forward / backward thrust vector
        const forwardVector = new THREE.Vector3(
          -Math.sin(roverYaw) * Math.cos(roverPitch),
          Math.sin(roverPitch),
          Math.cos(roverYaw) * Math.cos(roverPitch)
        );

        const targetThrust = new THREE.Vector3();
        if (ctrl.forward) targetThrust.add(forwardVector.clone().multiplyScalar(currentSpeedMax));
        if (ctrl.backward) targetThrust.add(forwardVector.clone().multiplyScalar(-currentSpeedMax * 0.6));

        // Vertical R/F thrust
        if (ctrl.up) targetThrust.y += cfg.vertical_speed;
        if (ctrl.down) targetThrust.y -= cfg.vertical_speed;

        // Accelerate velocity toward targetThrust with hydrodynamic damping
        roverVelocity.lerp(targetThrust, delta * cfg.acceleration);
        roverGroup.position.addScaledVector(roverVelocity, delta);
      }

      // Hard collision detection
      const maxR = cfg.max_radial_distance;
      const currentR = Math.sqrt(roverGroup.position.x ** 2 + roverGroup.position.y ** 2);
      if (currentR > maxR) {
        const factor = maxR / currentR;
        roverGroup.position.x *= factor;
        roverGroup.position.y *= factor;
        const normalX = roverGroup.position.x / maxR;
        const normalY = roverGroup.position.y / maxR;
        const radialVel = roverVelocity.x * normalX + roverVelocity.y * normalY;
        if (radialVel > 0) {
          roverVelocity.x -= radialVel * normalX;
          roverVelocity.y -= radialVel * normalY;
        }
      }

      // Clamp along length (z)
      roverGroup.position.z = Math.max(1.2, Math.min(length - 1.2, roverGroup.position.z));

      // Apply rover orientation
      roverGroup.rotation.set(roverPitch, roverYaw + ctrl.yawDelta, roverRoll, 'YXZ');

      // Aim spotlight forward ahead of rover in world space
      const roverForward = new THREE.Vector3(0, 0, 24.0).applyQuaternion(roverGroup.quaternion);
      spotTarget.position.copy(roverGroup.position).add(roverForward);

      // Rover visual mesh: hidden in 1st person nose cam, visible in 3rd person chase view
      roverVisuals.visible = (cameraModeRef.current === 'chase');

      // Update Camera based on active mode
      if (cameraModeRef.current === 'first') {
        const noseOffset = new THREE.Vector3(0, 0.08, 0.42).applyQuaternion(roverGroup.quaternion);
        camera.position.copy(roverGroup.position).add(noseOffset);
        camera.rotation.copy(roverGroup.rotation);
      } else {
        const chaseOffset = new THREE.Vector3(0, 0.55, -2.1).applyQuaternion(roverGroup.quaternion);
        camera.position.copy(roverGroup.position).add(chaseOffset);
        const lookTarget = roverGroup.position.clone().add(
          new THREE.Vector3(0, 0, 5.0).applyQuaternion(roverGroup.quaternion)
        );
        camera.lookAt(lookTarget);
      }

      // Particle drift (marine snow)
      if (!prefersReducedMotion) {
        const pAttr = particleGeo.attributes.position;
        const pArr = pAttr.array;
        for (let p = 0; p < particleCount; p++) {
          pArr[p * 3 + 2] -= delta * TUNNEL_CONFIG.particles.drift_speed;
          if (pArr[p * 3 + 2] < 0) pArr[p * 3 + 2] = length;
        }
        pAttr.needsUpdate = true;
      }

      // Pulse highlights on nearby cracks or selected crack
      const roverPos = roverGroup.position;
      crackMeshesRef.current.forEach(c => {
        const dist = c.anchorPos.distanceTo(roverPos);
        const isNear = dist <= 16.0;
        const isSel = selectedCrackRef.current?.id === c.data.id;

        if (isSel || isNear) {
          const pulse = Math.sin(currentTime * 0.006) * 0.5 + 0.5;
          c.highlightMat.opacity = isSel ? 0.95 : 0.35 + pulse * 0.45;
          c.highlightMesh.visible = true;
          c.indicatorMesh.visible = true;
          c.indicatorMat.opacity = isSel ? 1.0 : 0.6 + pulse * 0.4;
        } else {
          c.highlightMesh.visible = false;
          c.indicatorMesh.visible = false;
        }
      });

      // Update Telemetry State
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

    // CLEANUP
    return () => {
      cancelAnimationFrame(animId);
      domEl.removeEventListener('click', handleCanvasClick);
      domEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);

      tunnelGeo.dispose();
      tunnelMat.dispose();
      concreteTex.dispose();
      ringJointGeo.dispose();
      ringJointMat.dispose();
      capGeo.dispose();
      capMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      chassisGeo.dispose();
      chassisMat.dispose();
      shellGeo.dispose();
      shellMat.dispose();
      domeGeo.dispose();
      domeMat.dispose();
      thrusterGeo.dispose();
      thrusterMat.dispose();

      crackMeshesRef.current.forEach(c => {
        c.crackGeo.dispose();
        c.crackMat.dispose();
        c.highlightGeo.dispose();
        c.highlightMat.dispose();
        c.indicatorGeo.dispose();
        c.indicatorMat.dispose();
        c.hitGeo.dispose();
        c.hitMat.dispose();
      });

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isWebGLAvailable]);

  // 4. Build 3D Crack Visualizations directly on the cylinder wall
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cracksData.length) return;

    crackMeshesRef.current.forEach(c => {
      scene.remove(c.group);
      c.crackGeo.dispose();
      c.crackMat.dispose();
      c.highlightGeo.dispose();
      c.highlightMat.dispose();
      c.indicatorGeo.dispose();
      c.indicatorMat.dispose();
      c.hitGeo.dispose();
      c.hitMat.dispose();
    });
    crackMeshesRef.current = [];

    const radius = TUNNEL_CONFIG.radius_m;
    const rSurface = radius - 0.025; // 2.5cm inward from concrete surface

    cracksData.forEach((crack, idx) => {
      const group = new THREE.Group();

      const baseRad = (crack.angle_deg * Math.PI) / 180;
      const baseZ = crack.chainage_m;
      const crackLen = Math.max(0.35, (crack.length_mm / 1000));
      const sev = SEVERITY_CONFIG[crack.severity] || SEVERITY_CONFIG.Minor;

      // Crack orientation: alternate longitudinal, transverse, diagonal
      const orientationAngle = (idx % 3 === 0) ? 0 : (idx % 3 === 1 ? Math.PI / 2 : Math.PI / 4);

      // Generate points directly conforming to the cylindrical wall curvature
      const points = [];
      const numPts = 9;
      for (let i = 0; i <= numPts; i++) {
        const u = (i / numPts - 0.5) * crackLen;
        const dZ = u * Math.cos(orientationAngle);
        const dArc = u * Math.sin(orientationAngle);
        const currentRad = baseRad + (dArc / rSurface);
        const jitter = (i > 0 && i < numPts) ? (Math.random() - 0.5) * 0.025 : 0;

        const px = (rSurface - jitter) * Math.sin(currentRad);
        const py = (rSurface - jitter) * Math.cos(currentRad);
        const pz = baseZ + dZ + (Math.random() - 0.5) * 0.015;
        points.push(new THREE.Vector3(px, py, pz));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const tubeRadius = Math.max(0.012, (crack.width_mm / 1000) * 3.5);
      
      // 1. Core fracture crack mesh
      const crackGeo = new THREE.TubeGeometry(curve, 24, tubeRadius, 6, false);
      const crackMat = new THREE.MeshStandardMaterial({
        color: 0x05080f,
        roughness: 0.95,
        metalness: 0.05,
      });
      const crackMesh = new THREE.Mesh(crackGeo, crackMat);
      group.add(crackMesh);

      // 2. High-contrast outline highlight wireframe
      const highlightGeo = new THREE.TubeGeometry(curve, 24, tubeRadius * 1.9, 6, false);
      const highlightMat = new THREE.MeshBasicMaterial({
        color: sev.threeColor,
        transparent: true,
        opacity: 0.75,
        wireframe: true,
      });
      const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
      highlightMesh.visible = false;
      group.add(highlightMesh);

      // 3. Technical inspection reticle bracket / marker ring on the wall
      const centerPt = points[Math.floor(numPts / 2)];
      const indicatorGeo = new THREE.RingGeometry(0.25, 0.28, 24);
      const indicatorMat = new THREE.MeshBasicMaterial({
        color: sev.threeColor,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const indicatorMesh = new THREE.Mesh(indicatorGeo, indicatorMat);
      indicatorMesh.position.copy(centerPt);
      // Face inward toward tunnel axis
      indicatorMesh.lookAt(0, 0, centerPt.z);
      indicatorMesh.visible = false;
      group.add(indicatorMesh);

      // 4. Click hit sphere for raycasting
      const hitRadius = Math.max(0.55, crackLen * 0.7);
      const hitGeo = new THREE.SphereGeometry(hitRadius, 8, 8);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.position.copy(centerPt);
      group.add(hitMesh);

      scene.add(group);

      crackMeshesRef.current.push({
        data: crack,
        group,
        anchorPos: centerPt,
        hitMesh,
        highlightMesh,
        highlightMat,
        indicatorMesh,
        indicatorMat,
        crackGeo,
        crackMat,
        highlightGeo,
        indicatorGeo,
        hitGeo,
        hitMat,
      });
    });
  }, [cracksData]);

  // Jump to specific crack smoothly
  const handleJumpToCrack = (crack) => {
    setSelectedCrack(crack);
    setShowInventory(false);

    // Position rover ~3.2m before the crack facing down the tunnel towards it
    const rad = (crack.angle_deg * Math.PI) / 180;
    const targetZ = Math.max(2.0, crack.chainage_m - 3.2);
    // Align slightly towards center so crack is in spotlight cone
    const targetX = Math.sin(rad) * 0.8;
    const targetY = Math.cos(rad) * 0.8 - 0.2;

    jumpTargetRef.current = {
      pos: new THREE.Vector3(targetX, targetY, targetZ),
      yaw: 0,
      pitch: 0,
    };
  };

  // Cycle crack with [ and ] keys
  const cycleCrack = (direction) => {
    if (!cracksData.length) return;
    const sorted = [...cracksData].sort((a, b) => a.chainage_m - b.chainage_m);
    let nextIdx = 0;
    if (selectedCrack) {
      const curIdx = sorted.findIndex(c => c.id === selectedCrack.id);
      nextIdx = (curIdx + direction + sorted.length) % sorted.length;
    } else if (direction < 0) {
      nextIdx = sorted.length - 1;
    }
    handleJumpToCrack(sorted[nextIdx]);
  };

  // Select closest crack within 12m on Enter
  const selectClosestCrack = () => {
    if (!roverMeshRef.current || !cracksData.length) return;
    const currentZ = roverMeshRef.current.position.z;
    let closest = null;
    let minDist = Infinity;
    cracksData.forEach(c => {
      const d = Math.abs(c.chainage_m - currentZ);
      if (d < minDist) {
        minDist = d;
        closest = c;
      }
    });
    if (closest && minDist <= 15.0) {
      setSelectedCrack(closest);
    }
  };

  // Sorted cracks list
  const sortedCracks = useMemo(() => {
    const list = [...cracksData];
    if (sortBy === 'chainage') {
      return list.sort((a, b) => a.chainage_m - b.chainage_m);
    }
    const order = { Critical: 0, Major: 1, Minor: 2, Info: 3 };
    return list.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [cracksData, sortBy]);

  // Touch virtual buttons for mobile support
  const handleTouchControl = (action, isStart) => {
    const ctrl = controlsRef.current;
    if (action === 'fwd') ctrl.forward = isStart;
    if (action === 'back') ctrl.backward = isStart;
    if (action === 'left') ctrl.yawLeft = isStart;
    if (action === 'right') ctrl.yawRight = isStart;
    if (action === 'up') ctrl.up = isStart;
    if (action === 'down') ctrl.down = isStart;
    if (action === 'boost') ctrl.boost = isStart;
  };

  return (
    <div className="twin-root" role="region" aria-label="Head Race Tunnel 3D Digital Twin Rover Simulator">
      {/* 3D WebGL Canvas Viewport */}
      <div ref={mountRef} className="twin-viewport" tabIndex={0} />

      {/* WebGL Failure Fallback Screen */}
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
          <p>INITIALIZING 3D DIGITAL TWIN & OPTICAL HYDRODYNAMICS...</p>
          <span className="twin-loading-sub">Generating parametric concrete lining & loading telemetry</span>
        </div>
      )}

      {/* Error Banner if cracks.json failed */}
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
          <p className="twin-disclaimer">
            Parametric model — not a survey-accurate reconstruction.
          </p>
        </div>

        {/* Telemetry Stream */}
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
            <span className="twin-telem-v">{-telemetry.depth.toFixed(1)} m</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="twin-header-actions">
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

      {/* ── CONTROLS HINT (Bottom Left, dismissible) ── */}
      {showControlsHint && (
        <aside className="twin-controls-card" aria-label="Rover flight controls">
          <div className="twin-controls-head">
            <span>ROV FLIGHT CONTROLS</span>
            <button
              className="twin-close-btn"
              onClick={() => setShowControlsHint(false)}
              aria-label="Dismiss controls hint"
            >
              ×
            </button>
          </div>
          <div className="twin-controls-grid">
            <div><kbd>W</kbd> <kbd>S</kbd> Forward / Reverse</div>
            <div><kbd>A</kbd> <kbd>D</kbd> Yaw Steer</div>
            <div><kbd>R</kbd> <kbd>F</kbd> Vertical Elevate</div>
            <div><kbd>Shift</kbd> Hydrodynamic Boost</div>
            <div><kbd>Mouse</kbd> Drag to Look</div>
            <div><kbd>C</kbd> Toggle 1st/3rd Camera</div>
            <div><kbd>[</kbd> <kbd>]</kbd> Cycle Cracks</div>
            <div><kbd>Enter</kbd> Target Nearest</div>
          </div>
          <p className="twin-controls-note">Press <kbd>H</kbd> to toggle this help HUD</p>
        </aside>
      )}

      {/* ── MOBILE TOUCH CONTROLS (Only visible on small touch screens) ── */}
      <div className="twin-mobile-controls" aria-hidden="true">
        <div className="twin-touch-pad">
          <button
            onTouchStart={() => handleTouchControl('fwd', true)}
            onTouchEnd={() => handleTouchControl('fwd', false)}
          >▲</button>
          <div className="twin-touch-row">
            <button
              onTouchStart={() => handleTouchControl('left', true)}
              onTouchEnd={() => handleTouchControl('left', false)}
            >◀</button>
            <button
              onTouchStart={() => handleTouchControl('back', true)}
              onTouchEnd={() => handleTouchControl('back', false)}
            >▼</button>
            <button
              onTouchStart={() => handleTouchControl('right', true)}
              onTouchEnd={() => handleTouchControl('right', false)}
            >▶</button>
          </div>
        </div>
        <div className="twin-touch-aux">
          <button
            onTouchStart={() => handleTouchControl('up', true)}
            onTouchEnd={() => handleTouchControl('up', false)}
          >UP</button>
          <button
            onTouchStart={() => handleTouchControl('down', true)}
            onTouchEnd={() => handleTouchControl('down', false)}
          >DOWN</button>
          <button
            className="twin-touch-boost"
            onTouchStart={() => handleTouchControl('boost', true)}
            onTouchEnd={() => handleTouchControl('boost', false)}
          >BOOST</button>
        </div>
      </div>

      {/* ── RIGHT PANEL: SELECTED CRACK INSPECTOR ── */}
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
              ×
            </button>
          </div>

          <div className="twin-inspect-status">
            <span
              className="twin-sev-pill"
              style={{
                borderColor: SEVERITY_CONFIG[selectedCrack.severity]?.color,
                color: SEVERITY_CONFIG[selectedCrack.severity]?.color,
              }}
            >
              {selectedCrack.severity.toUpperCase()}
            </span>
            <span className="twin-source-pill">SOURCE: {selectedCrack.source.toUpperCase()}</span>
          </div>

          <div className="twin-inspect-table">
            <div className="twin-row">
              <span>Chainage Position</span>
              <strong>{selectedCrack.chainage_m.toFixed(1)} m</strong>
            </div>
            <div className="twin-row">
              <span>Radial Angle / Clock</span>
              <strong>{formatClockPosition(selectedCrack.angle_deg)}</strong>
            </div>
            <div className="twin-row">
              <span>Estimated Dimensions</span>
              <strong>{selectedCrack.length_mm} mm × {selectedCrack.width_mm} mm</strong>
            </div>
            <div className="twin-row">
              <span>Model Cartesian (XYZ)</span>
              <strong className="twin-mono">
                {(TUNNEL_CONFIG.radius_m * Math.sin(selectedCrack.angle_deg * Math.PI / 180)).toFixed(2)},{' '}
                {(TUNNEL_CONFIG.radius_m * Math.cos(selectedCrack.angle_deg * Math.PI / 180)).toFixed(2)},{' '}
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
              JUMP ROVER TO CRACK
            </button>
          </div>
        </aside>
      )}

      {/* ── CRACK INVENTORY DRAWER (Collapsible) ── */}
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
              ×
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
                      ● {crack.severity}
                    </span>
                  </div>
                  <div className="twin-inv-details">
                    <span>Ch {crack.chainage_m.toFixed(1)} m</span>
                    <span>{formatClockPosition(crack.angle_deg)}</span>
                    <span>{crack.length_mm}×{crack.width_mm} mm</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* ── BOTTOM STRIP: LINEAR CHAINAGE STRIP & MINIMAP ── */}
      <footer className="twin-bottom-strip" aria-label="Linear chainage inspection minimap">
        <div className="twin-strip-meta">
          <span className="twin-strip-label">INTAKE (0.0 m)</span>
          <span className="twin-strip-coords">{TUNNEL_CONFIG.coordinate_frame}</span>
          <span className="twin-strip-label">OUTLET ({TUNNEL_CONFIG.length_m.toFixed(0)} m)</span>
        </div>

        <div className="twin-strip-track">
          {/* Major tick markers */}
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

          {/* Crack defect pin indicators */}
          {cracksData.map(crack => {
            const pct = Math.max(0, Math.min(100, (crack.chainage_m / TUNNEL_CONFIG.length_m) * 100));
            const sev = SEVERITY_CONFIG[crack.severity] || SEVERITY_CONFIG.Minor;
            const isSel = selectedCrack?.id === crack.id;

            return (
              <button
                key={crack.id}
                className={`twin-crack-pin ${isSel ? 'selected' : ''}`}
                style={{
                  left: `${pct}%`,
                  backgroundColor: sev.color,
                }}
                onClick={() => handleJumpToCrack(crack)}
                title={`${crack.id} (${crack.severity}) at Ch ${crack.chainage_m}m`}
                aria-label={`${crack.severity} crack at chainage ${crack.chainage_m} meters`}
              />
            );
          })}

          {/* Rover position indicator */}
          <div
            className="twin-rover-pin"
            style={{
              left: `${Math.max(0, Math.min(100, (telemetry.chainage / TUNNEL_CONFIG.length_m) * 100))}%`,
            }}
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
