import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { angleOf, chainageOf, DEFECT_RADIUS_M, TUNNEL_LENGTH_M } from '../../utils/defectHistory';
import './console.css';

const RADIUS = 3;
const SEV = { Critical: 0xff5d5d, Major: 0xffb347, Minor: 0xffd66b };

/**
 * A small 3D view from inside the tunnel, looking down the axis at a chainage. Every defect is a dot on the wall at its
 * clock position; the focused one gets a larger halo. Moves smoothly when `chainage` changes and frees its GPU
 * resources on unmount.
 */
export default function MiniTwin({ chainage, defects, focusId = null, height = 260 }) {
  const mount = useRef(null);
  const live = useRef({ chainage, defects, focusId });
  useEffect(() => { live.current = { chainage, defects, focusId }; });

  useEffect(() => {
    const el = mount.current;
    if (!el) return undefined;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return undefined; }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070a, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.scale.x = -1; // mirror for display: 3 o'clock appears on the observer's right when looking downstream, like the radar
    scene.fog = new THREE.FogExp2(0x05070a, 0.045);
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);

    const circle = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * RADIUS, Math.sin((i / 64) * Math.PI * 2) * RADIUS, 0)));
    const ringMat = new THREE.LineBasicMaterial({ color: 0x2b7fb0, transparent: true, opacity: 0.8 });
    const majorMat = new THREE.LineBasicMaterial({ color: 0x8fd3ff });
    for (let z = 0; z <= TUNNEL_LENGTH_M; z += 2.5) {
      const ring = new THREE.LineLoop(circle, z % 25 === 0 ? majorMat : ringMat);
      ring.position.z = z;
      scene.add(ring);
    }
    const seamPts = [];
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      seamPts.push(new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0), new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, TUNNEL_LENGTH_M));
    }
    const seamGeo = new THREE.BufferGeometry().setFromPoints(seamPts);
    const seamMat = new THREE.LineBasicMaterial({ color: 0x14486a, transparent: true, opacity: 0.6 });
    scene.add(new THREE.LineSegments(seamGeo, seamMat));

    const dotGeo = new THREE.SphereGeometry(0.1, 12, 12);
    const haloGeo = new THREE.RingGeometry(0.28, 0.36, 40);
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const mats = new Map();
    const matFor = (color, halo) => {
      const key = `${color}:${halo}`;
      if (!mats.has(key)) {
        mats.set(key, halo
          ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
          : new THREE.MeshBasicMaterial({ color }));
      }
      return mats.get(key);
    };
    let builtFor = null;
    let builtFocus = null;
    const halos = [];
    const rebuild = () => {
      markerGroup.clear();
      halos.length = 0;
      for (const d of live.current.defects) {
        const a = (angleOf(d) * Math.PI) / 180;
        const g = new THREE.Group();
        g.position.set(Math.sin(a) * DEFECT_RADIUS_M, Math.cos(a) * DEFECT_RADIUS_M, chainageOf(d));
        const focus = live.current.focusId != null && String(d.id) === String(live.current.focusId);
        const color = SEV[d.severity] || 0x8fd3ff;
        const core = new THREE.Mesh(dotGeo, matFor(color, false));
        core.scale.setScalar(focus ? 1.9 : 1);
        g.add(core);
        const halo = new THREE.Mesh(haloGeo, matFor(color, true));
        halo.lookAt(-g.position.x, -g.position.y, 0);
        halos.push({ halo, base: focus ? 1.5 : 0.8 });
        g.add(halo);
        markerGroup.add(g);
      }
      builtFor = live.current.defects;
      builtFocus = live.current.focusId;
    };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => { pointer.x = 0; pointer.y = 0; };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);

    let z = live.current.chainage;
    let raf = 0;
    const frame = (now) => {
      if (builtFor !== live.current.defects || builtFocus !== live.current.focusId) rebuild();
      z += (live.current.chainage - z) * (reduced ? 1 : 0.08);
      pointer.sx += (pointer.x - pointer.sx) * 0.06;
      pointer.sy += (pointer.y - pointer.sy) * 0.06;
      camera.position.set(pointer.sx * 0.5, -pointer.sy * 0.3, z - 6);
      camera.lookAt(pointer.sx * 0.4, -pointer.sy * 0.25, z + 8);
      if (!reduced) halos.forEach(({ halo, base }, i) => halo.scale.setScalar(base * (1 + 0.12 * Math.sin(now / 380 + i))));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      ro.disconnect();
      [circle, seamGeo, dotGeo, haloGeo, ringMat, majorMat, seamMat].forEach((o) => o.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="mt" style={{ height }} role="img" aria-label={`Inside view of the tunnel at ${Math.round(chainage)} metres`}>
      <div className="mt__canvas" ref={mount} />
      <span className="mt__tag">{Number(chainage).toFixed(0)} m</span>
    </div>
  );
}
