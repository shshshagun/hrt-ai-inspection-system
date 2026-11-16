import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const DEPTH = 120;       // metres of tunnel kept alive
const SPACING = 2.5;     // distance between lining rings
const RADIUS = 3;
const DEFECT_R = 2.95;   // same convention as the digital twin
const SPEED = 5;         // m/s of the camera drifting down the tunnel

/**
 * Full-bleed Three.js backdrop for the sign-in pages: a slow flight down the
 * tunnel, with lining rings, a sonar sweep and glowing defect markers.
 * Decorative only; it pauses when the tab is hidden and frees every GPU resource on unmount.
 */
export default function TunnelScene() {
  const mount = useRef(null);
  const chainageRef = useRef(null);
  const countRef = useRef(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      return undefined; // no WebGL: the CSS gradient behind the canvas is the fallback
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x040d17, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x040d17, 0.032);
    const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 200);

    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };

    // lining rings: a shared circle, recycled as they pass the camera
    const circle = track(new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 73 }, (_, i) => new THREE.Vector3(Math.cos((i / 72) * Math.PI * 2) * RADIUS, Math.sin((i / 72) * Math.PI * 2) * RADIUS, 0)),
    ));
    const ringMat = track(new THREE.LineBasicMaterial({ color: 0x2b7fb0, transparent: true, opacity: 0.85 }));
    const accentMat = track(new THREE.LineBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 1 }));
    const rings = [];
    const count = Math.floor(DEPTH / SPACING);
    for (let i = 0; i < count; i += 1) {
      const line = new THREE.LineLoop(circle, i % 6 === 0 ? accentMat : ringMat);
      line.position.z = -i * SPACING;
      scene.add(line);
      rings.push(line);
    }

    // longitudinal seams along the lining
    const seamPts = [];
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      seamPts.push(new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 6), new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, -DEPTH));
    }
    const seams = new THREE.LineSegments(
      track(new THREE.BufferGeometry().setFromPoints(seamPts)),
      track(new THREE.LineBasicMaterial({ color: 0x14486a, transparent: true, opacity: 0.55 })),
    );
    scene.add(seams);

    // defect markers pinned to the wall, scrolling with the rings
    const markerGeo = track(new THREE.SphereGeometry(0.07, 12, 12));
    const haloGeo = track(new THREE.RingGeometry(0.16, 0.2, 40));
    const palette = [0xff5d5d, 0xffb347, 0xffb347, 0xffd66b];
    const defects = [];
    for (let i = 0; i < 16; i += 1) {
      const color = palette[i % palette.length];
      const core = new THREE.Mesh(markerGeo, track(new THREE.MeshBasicMaterial({ color })));
      const halo = new THREE.Mesh(haloGeo, track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })));
      const g = new THREE.Group();
      g.add(core, halo);
      const place = (z) => {
        const a = Math.random() * Math.PI * 2;
        g.position.set(Math.sin(a) * DEFECT_R, Math.cos(a) * DEFECT_R, z);
        g.lookAt(0, 0, z); // halo faces the tunnel axis, like a defect lying on the lining
      };
      place(-Math.random() * DEPTH);
      g.userData = { place, phase: Math.random() * 6, halo };
      scene.add(g);
      defects.push(g);
    }

    // sonar sweep: a glowing ring racing down the tunnel
    const sweepMat = track(new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sweep = new THREE.Mesh(track(new THREE.TorusGeometry(RADIUS - 0.02, 0.045, 8, 96)), sweepMat);
    scene.add(sweep);

    // drifting particles (suspended dust in the light)
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i += 1) {
      const r = Math.sqrt(Math.random()) * (RADIUS - 0.4);
      const a = Math.random() * Math.PI * 2;
      pos.set([Math.cos(a) * r, Math.sin(a) * r, -Math.random() * DEPTH], i * 3);
    }
    const dustGeo = track(new THREE.BufferGeometry());
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.028, transparent: true, opacity: 0.55, depthWrite: false })));
    scene.add(dust);

    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    let last = performance.now();
    let travelled = 0;
    let readoutAt = 0;
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const step = reduced ? 0 : SPEED * dt;
      travelled += step;

      for (const r of rings) {
        r.position.z += step;
        if (r.position.z > 2) r.position.z -= DEPTH;
      }
      for (const d of defects) {
        d.position.z += step;
        if (d.position.z > 2) d.userData.place(d.position.z - DEPTH);
        d.userData.halo.scale.setScalar(1 + 0.35 * Math.sin(now / 420 + d.userData.phase));
      }
      const pa = dustGeo.attributes.position;
      for (let i = 0; i < N; i += 1) {
        let z = pa.getZ(i) + step * 1.15;
        if (z > 2) z -= DEPTH;
        pa.setZ(i, z);
      }
      pa.needsUpdate = true;

      const cycle = (now / 1000) % 7; // one sweep every 7 s
      const t = Math.min(cycle / 4.5, 1);
      sweep.position.z = -DEPTH * 0.7 * (1 - t) - 1;
      sweepMat.opacity = cycle < 4.5 ? Math.sin(t * Math.PI) * 0.85 : 0;

      pointer.sx += (pointer.x - pointer.sx) * 0.04;
      pointer.sy += (pointer.y - pointer.sy) * 0.04;
      camera.position.set(pointer.sx * 0.55, -pointer.sy * 0.35, 0);
      camera.rotation.set(-pointer.sy * 0.05, -pointer.sx * 0.09, Math.sin(now / 5200) * 0.03 + pointer.sx * 0.03);
      renderer.render(scene, camera);

      if (now - readoutAt > 120) {
        readoutAt = now;
        if (chainageRef.current) chainageRef.current.textContent = `${(travelled % 250).toFixed(1).padStart(5, '0')} m`;
        if (countRef.current) countRef.current.textContent = String(defects.filter((d) => d.position.z > -DEPTH * 0.45).length).padStart(2, '0');
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="auth-scene" aria-hidden="true">
      <div className="auth-scene__canvas" ref={mount} />
      <div className="auth-scene__vignette" />
      <div className="auth-hud">
        <div><span>Chainage</span><b ref={chainageRef}>000.0 m</b></div>
        <div><span>Defects in range</span><b ref={countRef}>00</b></div>
        <div><span>Model</span><b>YOLOv8n-seg</b></div>
      </div>
    </div>
  );
}
