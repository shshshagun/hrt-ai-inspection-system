/**
 * The Three.js side of the digital twin: scene, lining, defects, cameras and tools. No React in here.
 * Stored coordinates are used throughout (+X = 3 o'clock); the `world` group is mirrored on X for display so that
 * 3 o'clock appears on the observer's right when looking downstream (see geometry.js).
 */
import * as THREE from 'three';
import { TUNNEL_CONFIG } from './tunnel.config.js';
import { createConcreteTextures, paintHeat, HEAT_W, HEAT_H } from './textures.js';
import {
  MIRROR_X_FOR_VIEWER, defectPosition, makeRadiusAt, surfacePoint, clusterCoincident, describeDefect,
} from './geometry.js';

const SEVERITY_COLOR = { Critical: 0xef4444, Major: 0xf97316, Minor: 0xeab308, Info: 0x38bdf8 };
const LENGTH = TUNNEL_CONFIG.length_m;
const SLAB_M = 8;
const ATMOSPHERE = {
  water: { fog: 0x061521, density: 0.016, hemiSky: 0x38bdf8, hemiGround: 0x05101a, hemi: 0.5, ambient: 0x0a1e2d, ambientI: 0.35, particles: true },
  dry: { fog: 0x0b0f14, density: 0.009, hemiSky: 0xcfd8e3, hemiGround: 0x10151b, hemi: 0.55, ambient: 0x1a222c, ambientI: 0.5, particles: false },
};
const QUALITY = {
  high: { pixelRatio: 2, textureSize: 1024, segments: 128, bump: true },
  balanced: { pixelRatio: 1.25, textureSize: 512, segments: 96, bump: true },
  low: { pixelRatio: 1, textureSize: 256, segments: 64, bump: false },
};

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createTwinEngine(container, callbacks = {}) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cb = (name, ...args) => callbacks[name]?.(...args);

  // ───────────── renderer, scene, camera ─────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 140);
  const dolly = new THREE.Group(); // moved by the rig only while a VR session runs
  dolly.add(camera);
  scene.add(dolly);

  const world = new THREE.Group();
  if (MIRROR_X_FOR_VIEWER) world.scale.x = -1;
  scene.add(world);

  const owned = []; // everything with a dispose() that we created, freed in destroy()
  const track = (o) => { owned.push(o); return o; };

  const state = {
    quality: 'balanced', atmosphere: 'water', shape: 'circular', radiusAt: makeRadiusAt(null), profileRows: null,
    heat: true, inspectionId: null, ghosts: true, selectedId: null, measure: false, light: true, section: null,
  };

  // ───────────── lights ─────────────
  const hemi = new THREE.HemisphereLight(0x38bdf8, 0x05101a, 0.5);
  const ambient = new THREE.AmbientLight(0x0a1e2d, 0.35);
  scene.add(hemi, ambient);
  const headlight = new THREE.SpotLight(0xf0fdf4, 14, 40, 0.5, 0.6, 1.4);
  headlight.position.set(0, 0, 0);
  const headTarget = new THREE.Object3D();
  headTarget.position.set(0, 0, -10);
  headlight.target = headTarget;
  camera.add(headlight, headTarget);
  const fill = new THREE.PointLight(0x7dd3fc, 3, 12, 1.4);
  camera.add(fill);

  // ───────────── lining ─────────────
  let concrete = null;
  let tunnelMesh = null;
  let tunnelMat = null;
  let ringJoints = null;
  const clipPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), LENGTH)];
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = HEAT_W; heatCanvas.height = HEAT_H;
  const heatTex = track(new THREE.CanvasTexture(heatCanvas));
  heatTex.colorSpace = THREE.SRGBColorSpace;
  const heatUniforms = { uHeat: { value: heatTex }, uHeatAmt: { value: 1 } };

  function buildTunnelGeometry(segs) {
    const dz = 1.25;
    const rings = Math.round(LENGTH / dz);
    const pos = new Float32Array((segs + 1) * (rings + 1) * 3);
    const uv = new Float32Array((segs + 1) * (rings + 1) * 2);
    let p = 0; let t = 0;
    for (let j = 0; j <= rings; j += 1) {
      for (let i = 0; i <= segs; i += 1) {
        const a = (i / segs) * 360;
        const s = surfacePoint(a, j * dz, { radiusAt: state.radiusAt, shape: state.shape });
        pos[p++] = s.x; pos[p++] = s.y; pos[p++] = s.z;
        uv[t++] = i / segs; uv[t++] = j / rings;
      }
    }
    const index = [];
    for (let j = 0; j < rings; j += 1) {
      for (let i = 0; i < segs; i += 1) {
        const a = j * (segs + 1) + i; const b = a + 1; const c = a + segs + 1; const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    // normals must point inward for BackSide lighting to match; if the winding gave outward ones, they are fine as they are
    // because three flips the normal for back faces, so nothing more is needed.
    return { geometry: g, rings };
  }

  function buildLining() {
    const q = QUALITY[state.quality];
    if (tunnelMesh) { world.remove(tunnelMesh); tunnelMesh.geometry.dispose(); }
    if (ringJoints) { world.remove(ringJoints); ringJoints.geometry.dispose(); ringJoints.material.dispose(); }
    if (!concrete || concrete.size !== q.textureSize) {
      if (concrete) { concrete.map.dispose(); concrete.bump.dispose(); concrete.canvases.forEach((c) => { c.width = 0; c.height = 0; }); }
      concrete = { ...createConcreteTextures(q.textureSize), size: q.textureSize };
    }
    const { geometry, rings } = buildTunnelGeometry(q.segments);
    concrete.map.repeat.set(6, rings / 2);
    concrete.bump.repeat.set(6, rings / 2);
    if (tunnelMat) tunnelMat.dispose();
    tunnelMat = new THREE.MeshStandardMaterial({
      map: concrete.map, bumpMap: q.bump ? concrete.bump : null, bumpScale: 0.035, roughness: 0.64, metalness: 0.04, side: THREE.BackSide,
      clippingPlanes: state.section == null ? [] : clipPlanes,
    });
    tunnelMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeat = heatUniforms.uHeat;
      shader.uniforms.uHeatAmt = heatUniforms.uHeatAmt;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHeatUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeatUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uHeat;\nuniform float uHeatAmt;\nvarying vec2 vHeatUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 heatSample = texture2D(uHeat, vHeatUv);\nfloat heatA = min(heatSample.a, 0.45);\ndiffuseColor.rgb = mix(diffuseColor.rgb, heatSample.rgb, heatA * 0.3 * uHeatAmt);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += heatSample.rgb * heatA * 0.18 * uHeatAmt;');
    };
    tunnelMesh = new THREE.Mesh(geometry, tunnelMat);
    world.add(tunnelMesh);

    // precast ring joints every 2.5 m as thin loops that follow the profile
    const jointPts = [];
    const segs = q.segments;
    for (let z = 0; z <= LENGTH + 0.01; z += TUNNEL_CONFIG.ring_length_m) {
      for (let i = 0; i < segs; i += 1) {
        const a = surfacePoint((i / segs) * 360, z, { radiusAt: state.radiusAt, shape: state.shape, inset: 0.012 });
        const b = surfacePoint(((i + 1) / segs) * 360, z, { radiusAt: state.radiusAt, shape: state.shape, inset: 0.012 });
        jointPts.push(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z));
      }
    }
    const jg = new THREE.BufferGeometry().setFromPoints(jointPts);
    ringJoints = new THREE.LineSegments(jg, new THREE.LineBasicMaterial({ color: 0x0a101d, clippingPlanes: state.section == null ? [] : clipPlanes }));
    world.add(ringJoints);
  }

  // crown guide strips every 25 m (cheap emissive boxes instead of many point lights)
  const stripGeo = track(new THREE.BoxGeometry(0.5, 0.04, 0.2));
  const stripMat = track(new THREE.MeshBasicMaterial({ color: 0x8fd3ff }));
  const strips = new THREE.InstancedMesh(stripGeo, stripMat, Math.floor(LENGTH / 25));
  const _m = new THREE.Matrix4();
  for (let i = 0; i < strips.count; i += 1) { _m.setPosition(0, 2.9, (i + 1) * 25); strips.setMatrixAt(i, _m); }
  world.add(strips);

  // marine snow
  const PCOUNT = TUNNEL_CONFIG.particles.count;
  const pPos = new Float32Array(PCOUNT * 3);
  for (let i = 0; i < PCOUNT; i += 1) {
    const th = Math.random() * Math.PI * 2; const r = Math.random() * 2.6;
    pPos[i * 3] = Math.cos(th) * r; pPos[i * 3 + 1] = Math.sin(th) * r; pPos[i * 3 + 2] = Math.random() * LENGTH;
  }
  const pGeo = track(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = track(new THREE.PointsMaterial({ color: TUNNEL_CONFIG.particles.color, size: TUNNEL_CONFIG.particles.size, transparent: true, opacity: 0.65 }));
  const particles = new THREE.Points(pGeo, pMat);
  world.add(particles);

  // ───────────── defects ─────────────
  const markers = new Map(); // id -> { d, group, pin, ring, halo, hit, base }
  const markerGroup = new THREE.Group();
  world.add(markerGroup);
  let defects = [];
  let clusters = [];

  const pinGeo = track(new THREE.SphereGeometry(0.07, 14, 10));
  const haloGeo = track(new THREE.TorusGeometry(1, 0.03, 8, 40));
  const hitGeo = track(new THREE.SphereGeometry(0.45, 8, 8));
  const hitMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const pinMats = {}; const ringMats = {}; const ghostMats = {}; const haloMats = {};
  Object.entries(SEVERITY_COLOR).forEach(([sev, color]) => {
    pinMats[sev] = track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.75, roughness: 0.3 }));
    ringMats[sev] = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ghostMats[sev] = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    haloMats[sev] = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
  });
  const matFor = (map, sev) => map[sev] || map.Minor;

  function clearMarkers() {
    markers.forEach((m) => { markerGroup.remove(m.group); m.ringGeo.dispose(); });
    markers.clear();
  }

  function rebuildMarkers() {
    clearMarkers();
    for (const d of defects) {
      if (!d.located) continue;
      const g = new THREE.Group();
      const p = defectPosition(d, { radiusAt: state.radiusAt, shape: state.shape });
      g.position.set(p.x, p.y, p.z);
      const inward = new THREE.Vector3(-p.x, -p.y, 0).normalize();
      // footprint ring: diameter equals the measured crack length (true scale); a nominal ring when the size is not measured
      const extent = d.sizeMeasured ? Math.max(0.1, d.length_mm / 1000) : 0.3;
      const ringGeo = new THREE.RingGeometry(extent / 2 - 0.012, extent / 2, 40);
      const ring = new THREE.Mesh(ringGeo, matFor(ringMats, d.severity));
      ring.lookAt(inward.clone().multiplyScalar(5)); // faces the tunnel axis
      g.add(ring);
      const pin = new THREE.Mesh(pinGeo, matFor(pinMats, d.severity));
      g.add(pin);
      const halo = new THREE.Mesh(haloGeo, matFor(haloMats, d.severity));
      halo.lookAt(inward.clone().multiplyScalar(5));
      halo.visible = false;
      g.add(halo);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.defectId = d.id;
      g.add(hit);
      markerGroup.add(g);
      markers.set(d.id, { d, group: g, pin, ring, halo, hit, ringGeo, inward, pos: new THREE.Vector3(p.x, p.y, p.z) });
    }
    clusters = clusterCoincident(defects.filter((d) => d.located));
    applyVisibility();
    updateHeat();
  }

  function visibleInView(d) {
    if (state.section != null && (d.chainage_m < state.section || d.chainage_m > state.section + SLAB_M)) return false;
    return true;
  }

  function applyVisibility() {
    markers.forEach((m) => {
      const inView = state.inspectionId == null || m.d.inspectionId === state.inspectionId;
      const show = visibleInView(m.d);
      m.group.visible = show && (inView || state.ghosts);
      m.pin.visible = inView;
      m.ring.material = inView ? matFor(ringMats, m.d.severity) : matFor(ghostMats, m.d.severity);
      m.hit.visible = inView; // invisible material, but the flag keeps ghosts out of picking
    });
  }

  function updateHeat() {
    const shown = defects.filter((d) => d.located && (state.inspectionId == null || d.inspectionId === state.inspectionId) && visibleInView(d));
    paintHeat(heatCanvas, shown, LENGTH);
    heatTex.needsUpdate = true;
  }

  // snapshot on the wall for the selected defect only
  let decal = null;
  function clearDecal() {
    if (!decal) return;
    markerGroup.remove(decal.mesh);
    decal.mesh.geometry.dispose(); decal.mesh.material.map?.dispose(); decal.mesh.material.dispose();
    decal.frame.geometry.dispose(); decal.frame.material.dispose();
    decal = null;
  }
  function showDecal(m) {
    clearDecal();
    if (!m?.d.imageUrl) return;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const id = m.d.id;
    loader.load(m.d.imageUrl, (tex) => {
      if (state.selectedId !== id) { tex.dispose(); return; } // selection moved on while it loaded
      tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = tex.image.width / tex.image.height || 1.33;
      const w = 1.1; const h = w / aspect;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false }));
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: SEVERITY_COLOR[m.d.severity] || 0x8fd3ff }));
      mesh.add(frame);
      mesh.position.copy(m.pos).addScaledVector(m.inward, 0.02);
      mesh.lookAt(m.pos.clone().add(m.inward.clone().multiplyScalar(5)));
      markerGroup.add(mesh);
      decal = { mesh, frame };
    }, undefined, () => { /* a failed or blocked image simply leaves no snapshot */ });
  }

  // ───────────── camera rig ─────────────
  const rig = {
    mode: 'fly',
    pos: new THREE.Vector3(0, -0.4, 6), yaw: 0, pitch: 0,
    target: new THREE.Vector3(0, 0, 20), az: 0.6, pol: 1.2, dist: 14,
    tween: null,
  };
  const keys = {};
  const drag = { down: false, x: 0, y: 0, dx: 0, dy: 0, moved: 0 };
  const _f = new THREE.Vector3(); const _r = new THREE.Vector3(); const _up = new THREE.Vector3(0, 1, 0); const _v = new THREE.Vector3();

  const toDisplay = (v) => { const o = v.clone(); if (MIRROR_X_FOR_VIEWER) o.x *= -1; return o; };

  function lookAngles(from, to) {
    const dx = to.x - from.x; const dy = to.y - from.y; const dz = to.z - from.z;
    return { yaw: Math.atan2(dx, dz), pitch: Math.asin(THREE.MathUtils.clamp(dy / (Math.hypot(dx, dy, dz) || 1), -1, 1)) };
  }

  function goTo(pos, lookAt, seconds = 1.6) {
    const a = lookAngles(pos, lookAt);
    rig.mode = 'fly';
    rig.tween = {
      t: 0, dur: reducedMotion ? 0.01 : seconds,
      fromPos: rig.pos.clone(), toPos: pos.clone(),
      fromYaw: rig.yaw, toYaw: a.yaw, fromPitch: rig.pitch, toPitch: a.pitch,
    };
  }

  function boreLimit(z) { return Math.max(0.5, state.radiusAt(THREE.MathUtils.clamp(z, 0, LENGTH)) - 0.35); }

  function stepRig(dt) {
    if (rig.tween) {
      const tw = rig.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = ease(tw.t);
      rig.pos.lerpVectors(tw.fromPos, tw.toPos, k);
      rig.yaw = tw.fromYaw + wrapAngle(tw.toYaw - tw.fromYaw) * k;
      rig.pitch = tw.fromPitch + (tw.toPitch - tw.fromPitch) * k;
      if (tw.t >= 1) rig.tween = null;
    } else if (rig.mode === 'fly') {
      if (drag.dx || drag.dy) {
        rig.yaw -= drag.dx * 0.0025;
        rig.pitch = THREE.MathUtils.clamp(rig.pitch - drag.dy * 0.0025, -1.2, 1.2);
        drag.dx = 0; drag.dy = 0;
      }
      if (keys.ArrowLeft) rig.yaw += 1.6 * dt;
      if (keys.ArrowRight) rig.yaw -= 1.6 * dt;
      _f.set(Math.sin(rig.yaw) * Math.cos(rig.pitch), Math.sin(rig.pitch), Math.cos(rig.yaw) * Math.cos(rig.pitch));
      _r.crossVectors(_f, _up).normalize();
      const speed = (keys.Shift ? 14 : 5) * dt;
      if (keys.KeyW || keys.ArrowUp) rig.pos.addScaledVector(_f, speed);
      if (keys.KeyS || keys.ArrowDown) rig.pos.addScaledVector(_f, -speed * 0.7);
      if (keys.KeyD) rig.pos.addScaledVector(_r, speed * 0.7);
      if (keys.KeyA) rig.pos.addScaledVector(_r, -speed * 0.7);
      if (keys.Space || keys.KeyR) rig.pos.y += speed * 0.6;
      if (keys.ControlLeft || keys.KeyF) rig.pos.y -= speed * 0.6;
      // stay inside the bore
      rig.pos.z = THREE.MathUtils.clamp(rig.pos.z, 0.6, LENGTH - 0.6);
      const maxR = boreLimit(rig.pos.z);
      const r = Math.hypot(rig.pos.x, rig.pos.y);
      if (r > maxR) { rig.pos.x *= maxR / r; rig.pos.y *= maxR / r; }
      if (state.shape === 'horseshoe') rig.pos.y = Math.max(rig.pos.y, -0.8 * state.radiusAt(rig.pos.z) + 0.35);
    } else if (rig.mode === 'orbit') {
      if (drag.dx || drag.dy) {
        rig.az -= drag.dx * 0.006;
        rig.pol = THREE.MathUtils.clamp(rig.pol - drag.dy * 0.006, 0.15, Math.PI - 0.15);
        drag.dx = 0; drag.dy = 0;
      }
      if (keys.KeyW || keys.ArrowUp) rig.target.z = THREE.MathUtils.clamp(rig.target.z + 12 * dt, 1, LENGTH - 1);
      if (keys.KeyS || keys.ArrowDown) rig.target.z = THREE.MathUtils.clamp(rig.target.z - 12 * dt, 1, LENGTH - 1);
      if (keys.ArrowLeft) rig.az += 1.2 * dt;
      if (keys.ArrowRight) rig.az -= 1.2 * dt;
    }

    if (rig.mode === 'orbit' && !rig.tween) {
      camera.position.set(
        rig.target.x + rig.dist * Math.sin(rig.pol) * Math.sin(rig.az),
        rig.target.y + rig.dist * Math.cos(rig.pol),
        rig.target.z + rig.dist * Math.sin(rig.pol) * Math.cos(rig.az),
      );
      camera.lookAt(rig.target);
    } else if (!renderer.xr.isPresenting) {
      camera.position.copy(rig.pos);
      _v.set(Math.sin(rig.yaw) * Math.cos(rig.pitch), Math.sin(rig.pitch), Math.cos(rig.yaw) * Math.cos(rig.pitch)).add(rig.pos);
      camera.lookAt(_v);
    }
  }

  // ───────────── picking ─────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const setRay = (e) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  function pickDefect(e) {
    setRay(e);
    const hits = raycaster.intersectObjects([...markers.values()].filter((m) => m.group.visible && m.hit.visible).map((m) => m.hit), false);
    const ids = [...new Set(hits.map((h) => h.object.userData.defectId))];
    if (!ids.length) return null;
    // stacked defects: clicking again cycles through the ones under the cursor
    const at = ids.indexOf(state.selectedId);
    if (at >= 0) return ids[(at + 1) % ids.length];
    const stack = clusters.find((c) => c.members.some((x) => x.id === ids[0]));
    if (stack && stack.members.length > 1) return stack.members[0].id;
    return ids[0];
  }

  // ───────────── measure ─────────────
  const measureGroup = new THREE.Group();
  world.add(measureGroup);
  let measurePts = [];
  const measureMat = track(new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
  const measureDot = track(new THREE.SphereGeometry(0.05, 10, 8));
  const measureDotMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  function clearMeasure() {
    measureGroup.children.slice().forEach((c) => { measureGroup.remove(c); c.geometry?.dispose?.(); });
    measurePts = [];
    cb('onMeasure', null);
  }
  function addMeasurePoint(e) {
    setRay(e);
    const hit = raycaster.intersectObject(tunnelMesh, false)[0];
    if (!hit) return;
    if (measurePts.length >= 2) clearMeasure();
    const local = world.worldToLocal(hit.point.clone());
    measurePts.push(local);
    const dot = new THREE.Mesh(measureDot, measureDotMat);
    dot.position.copy(local); dot.renderOrder = 10;
    measureGroup.add(dot);
    if (measurePts.length === 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePts), measureMat);
      line.renderOrder = 10;
      measureGroup.add(line);
      const [a, b] = measurePts;
      cb('onMeasure', { distance: a.distanceTo(b), dChainage: Math.abs(b.z - a.z), a: a.clone(), b: b.clone() });
    }
  }

  // ───────────── section slab ─────────────
  const sectionRing = new THREE.Mesh(track(new THREE.TorusGeometry(1, 0.02, 6, 96)), track(new THREE.MeshBasicMaterial({ color: 0x8fd3ff })));
  sectionRing.visible = false;
  world.add(sectionRing);

  function setSection(z) {
    state.section = z == null ? null : THREE.MathUtils.clamp(z, 0, LENGTH - SLAB_M);
    const on = state.section != null;
    if (on) {
      clipPlanes[0].constant = -state.section;
      clipPlanes[1].constant = state.section + SLAB_M;
    }
    [tunnelMat, ringJoints?.material].forEach((m) => { if (m) { m.clippingPlanes = on ? clipPlanes : []; m.needsUpdate = true; } });
    sectionRing.visible = on;
    if (on) {
      const R = state.radiusAt(state.section);
      sectionRing.scale.setScalar(R);
      sectionRing.position.set(0, 0, state.section);
      rig.mode = 'orbit';
      rig.tween = null;
      rig.target.set(0, 0, state.section + SLAB_M / 2);
      rig.dist = 11; rig.pol = 1.1; rig.az = Math.PI + 0.5; // look at the cut face from the intake side
    }
    applyVisibility();
    updateHeat();
  }

  // ───────────── replay (extends the old auto-pilot survey) ─────────────
  const replay = { active: false, paused: false, list: [], i: -1, holdUntil: 0 };
  function replayGoto(i) {
    replay.i = i;
    const d = replay.list[i];
    if (!d) { replay.active = false; cb('onReplay', { active: false }); return; }
    selectDefect(d.id, { silent: false });
    flyToDefect(d.id, 2.2);
    replay.holdUntil = performance.now() + (reducedMotion ? 1500 : 2200 + 2600);
    cb('onReplay', { active: true, paused: replay.paused, index: i, total: replay.list.length, defect: d, caption: describeDefect(d) });
  }

  // ───────────── public actions ─────────────
  function selectDefect(id, { silent = true } = {}) {
    state.selectedId = id;
    clearDecal();
    markers.forEach((m, key) => { m.halo.visible = key === id; });
    if (id && markers.has(id)) showDecal(markers.get(id));
    if (!silent) cb('onSelect', id);
  }

  function flyToDefect(id, seconds = 1.6) {
    const m = markers.get(id);
    if (!m) return false;
    const p = m.pos;
    const cam = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(m.inward, 1.6);
    cam.z = Math.max(0.8, p.z - 1.6);
    goTo(toDisplay(cam), toDisplay(p), seconds);
    return true;
  }

  function flyToChainage(z, seconds = 1.4) {
    const zz = THREE.MathUtils.clamp(z, 0.8, LENGTH - 0.8);
    if (rig.mode === 'orbit') { rig.target.z = zz; return; }
    goTo(new THREE.Vector3(0, -0.3, zz), new THREE.Vector3(0, -0.1, zz + 12), seconds);
  }

  function setMode(mode) {
    if (mode === rig.mode) return;
    if (mode === 'orbit') {
      rig.target.set(0, 0, THREE.MathUtils.clamp(rig.pos.z + 6, 1, LENGTH - 1));
      rig.dist = 16; rig.pol = 1.15; rig.az = 0.7;
      rig.tween = null;
      rig.mode = 'orbit';
    } else {
      rig.pos.set(0, -0.4, THREE.MathUtils.clamp(rig.target.z - 5, 0.8, LENGTH - 0.8));
      rig.yaw = 0; rig.pitch = 0; rig.tween = null; rig.mode = 'fly';
      if (state.section != null) setSection(null);
    }
    cb('onMode', rig.mode);
  }

  function applyAtmosphere() {
    const a = ATMOSPHERE[state.atmosphere];
    scene.fog = new THREE.FogExp2(a.fog, a.density);
    scene.background = new THREE.Color(a.fog);
    hemi.color.setHex(a.hemiSky); hemi.groundColor.setHex(a.hemiGround); hemi.intensity = a.hemi;
    ambient.color.setHex(a.ambient); ambient.intensity = a.ambientI;
    particles.visible = a.particles;
  }

  function resize() {
    const w = container.clientWidth || 1; const h = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[state.quality].pixelRatio));
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // ───────────── input ─────────────
  const onKeyDown = (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    keys[e.code] = true;
    if (e.shiftKey) keys.Shift = true;
    if (e.code === 'Space') e.preventDefault();
    cb('onKey', e);
  };
  const onKeyUp = (e) => { keys[e.code] = false; if (!e.shiftKey) keys.Shift = false; };
  const onDown = (e) => { if (e.button !== 0) return; drag.down = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0; canvas.style.cursor = 'grabbing'; };
  const onMove = (e) => {
    if (drag.down) {
      drag.dx += e.clientX - drag.x; drag.dy += e.clientY - drag.y; drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    setRay(e);
    const over = raycaster.intersectObjects([...markers.values()].filter((m) => m.group.visible && m.hit.visible).map((m) => m.hit), false).length > 0;
    canvas.style.cursor = state.measure ? 'crosshair' : over ? 'pointer' : 'grab';
  };
  const onUp = (e) => {
    const wasClick = drag.down && drag.moved < 5;
    drag.down = false; canvas.style.cursor = state.measure ? 'crosshair' : 'grab';
    if (!wasClick || e.target !== canvas) return;
    if (state.measure) { addMeasurePoint(e); return; }
    const id = pickDefect(e);
    selectDefect(id, { silent: false });
  };
  const onWheel = (e) => {
    if (rig.mode === 'orbit') { e.preventDefault(); rig.dist = THREE.MathUtils.clamp(rig.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 70); }
  };
  const onLost = (e) => { e.preventDefault(); renderer.setAnimationLoop(null); };
  const onRestored = () => renderer.setAnimationLoop(frame);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ───────────── frame loop ─────────────
  let last = performance.now();
  let tickAt = 0;
  const _w = new THREE.Vector3();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    stepRig(dt);

    // keep the headlight and the follow light on the camera
    const orbiting = rig.mode === 'orbit';
    headlight.visible = state.light && !orbiting;
    fill.visible = state.light && !orbiting;
    const atmo = ATMOSPHERE[state.atmosphere];
    hemi.intensity = atmo.hemi * (orbiting ? 3 : 1); // an outside view needs more ambient light than the inspection light gives
    ambient.intensity = atmo.ambientI * (orbiting ? 2.5 : 1);

    if (!reducedMotion && particles.visible) {
      const arr = pGeo.attributes.position.array;
      for (let i = 0; i < PCOUNT; i += 1) { arr[i * 3 + 2] -= dt * TUNNEL_CONFIG.particles.drift_speed; if (arr[i * 3 + 2] < 0) arr[i * 3 + 2] = LENGTH; }
      pGeo.attributes.position.needsUpdate = true;
    }

    heatUniforms.uHeatAmt.value += ((state.heat ? 1 : 0) - heatUniforms.uHeatAmt.value) * Math.min(1, dt * 6);

    camera.getWorldPosition(_w);
    const pulse = reducedMotion ? 0.5 : Math.sin(now * 0.006) * 0.5 + 0.5;
    markers.forEach((m) => {
      if (!m.group.visible) return;
      const dist = _w.distanceTo(m.group.getWorldPosition(_v));
      const sel = m.d.id === state.selectedId;
      m.pin.scale.setScalar(THREE.MathUtils.clamp(dist / 7, 1, 5) * (sel ? 1.6 : 1)); // visibility marker, deliberately not to scale
      const mat = m.pin.material;
      mat.emissiveIntensity = sel ? 1.3 : dist < 18 ? 0.6 + pulse * 0.4 : 0.55;
      if (sel) m.halo.scale.setScalar(0.3 + pulse * 0.06);
    });

    // replay: hold at each defect, then move on
    if (replay.active && !replay.paused && !rig.tween && performance.now() > replay.holdUntil) replayGoto(replay.i + 1);

    if (now - tickAt > 100) {
      tickAt = now;
      const p = rig.mode === 'orbit' ? rig.target : rig.pos;
      cb('onCamera', { chainage: p.z, mode: rig.mode, x: p.x, y: p.y });
    }
    renderer.render(scene, camera);
  }

  // ───────────── start ─────────────
  applyAtmosphere();
  buildLining();
  resize();
  renderer.setAnimationLoop(frame);

  const api = {
    setDefects(list) { defects = list; rebuildMarkers(); if (state.selectedId && !markers.has(state.selectedId)) selectDefect(null, { silent: false }); },
    setSelected(id) { selectDefect(id); },
    setView({ inspectionId, ghosts, heat }) {
      if (inspectionId !== undefined) state.inspectionId = inspectionId;
      if (ghosts !== undefined) state.ghosts = ghosts;
      if (heat !== undefined) state.heat = heat;
      applyVisibility(); updateHeat();
    },
    setShape(shape) { state.shape = shape; buildLining(); rebuildMarkers(); },
    setProfile(rows) { state.profileRows = rows; state.radiusAt = makeRadiusAt(rows); buildLining(); rebuildMarkers(); },
    setAtmosphere(name) { state.atmosphere = name; applyAtmosphere(); },
    setQuality(name) { state.quality = name; buildLining(); resize(); },
    setLight(on) { state.light = on; },
    setMode, setSection, flyToDefect, flyToChainage,
    setMeasure(on) { state.measure = on; canvas.style.cursor = on ? 'crosshair' : 'grab'; if (!on) clearMeasure(); },
    clearMeasure,
    input(name, on) { keys[name] = on; },
    replay: {
      start(list) { replay.list = list; replay.active = list.length > 0; replay.paused = false; if (replay.active) replayGoto(0); },
      pause(p) { replay.paused = p; cb('onReplay', { active: replay.active, paused: p, index: replay.i, total: replay.list.length, defect: replay.list[replay.i], caption: replay.list[replay.i] ? describeDefect(replay.list[replay.i]) : '' }); },
      next() { if (replay.active) replayGoto(Math.min(replay.i + 1, replay.list.length)); },
      prev() { if (replay.active) replayGoto(Math.max(replay.i - 1, 0)); },
      stop() { replay.active = false; cb('onReplay', { active: false }); },
    },
    screenshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    async vrSupported() { try { return Boolean(await navigator.xr?.isSessionSupported?.('immersive-vr')); } catch { return false; } },
    async enterVR() {
      renderer.xr.enabled = true;
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      renderer.xr.setReferenceSpaceType('local-floor');
      session.addEventListener('end', () => { dolly.position.set(0, 0, 0); renderer.xr.enabled = false; });
      await renderer.xr.setSession(session);
      dolly.position.copy(rig.mode === 'fly' ? rig.pos : new THREE.Vector3(0, -0.4, rig.target.z - 6));
    },
    stats() { return { ...renderer.info.memory, calls: renderer.info.render.calls }; },
    describe() { return { markers: markers.size, clusters: clusters.length, mode: rig.mode }; },
    destroy() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      clearDecal(); clearMeasure(); clearMarkers();
      tunnelMesh?.geometry.dispose(); tunnelMat?.dispose();
      ringJoints?.geometry.dispose(); ringJoints?.material.dispose();
      concrete?.map.dispose(); concrete?.bump.dispose(); concrete?.canvases.forEach((c) => { c.width = 0; c.height = 0; });
      owned.forEach((o) => o.dispose?.());
      heatCanvas.width = 0; heatCanvas.height = 0;
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(canvas)) container.removeChild(canvas);
    },
  };
  // handy for the leak check and manual debugging in the browser console
  api.debug = { rig, state, camera, markers };
  return api;
}

export { SEVERITY_COLOR, SLAB_M, ATMOSPHERE, QUALITY };
