import * as THREE from 'three';

/** Procedural damp hydraulic concrete (diffuse + bump). Seeded so the surface looks the same every visit. */
export function createConcreteTextures(size = 1024) {
  const dCanvas = document.createElement('canvas');
  const bCanvas = document.createElement('canvas');
  dCanvas.width = size; dCanvas.height = size;
  bCanvas.width = size; bCanvas.height = size;
  const dCtx = dCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const dImg = dCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const dData = dImg.data;
  const bData = bImg.data;

  let seed = 1337;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const wave1 = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 12;
      const wave2 = Math.sin(y * 0.05 + x * 0.01) * 8;
      const speckle = (rand() - 0.5) * 22;
      const base = 104 + wave1 + wave2 + speckle;
      dData[idx] = Math.max(0, Math.min(255, base - 8));
      dData[idx + 1] = Math.max(0, Math.min(255, base + 2));
      dData[idx + 2] = Math.max(0, Math.min(255, base + 9));
      dData[idx + 3] = 255;
      const h = Math.max(0, Math.min(255, 128 + speckle * 1.5));
      bData[idx] = h; bData[idx + 1] = h; bData[idx + 2] = h; bData[idx + 3] = 255;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  [dCtx, bCtx].forEach((ctx, isBump) => {
    ctx.strokeStyle = isBump ? 'rgb(40, 40, 40)' : 'rgba(10, 18, 30, 0.75)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    ctx.strokeStyle = isBump ? 'rgb(60, 60, 60)' : 'rgba(15, 23, 42, 0.6)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i += 1) {
      const lx = (size / 6) * i;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, size); ctx.stroke();
      ctx.fillStyle = isBump ? 'rgb(30, 30, 30)' : 'rgba(8, 14, 24, 0.8)';
      ctx.beginPath();
      ctx.arc(lx + 24, size / 2 - 20, 7, 0, Math.PI * 2);
      ctx.arc(lx + 24, size / 2 + 20, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const map = new THREE.CanvasTexture(dCanvas);
  const bump = new THREE.CanvasTexture(bCanvas);
  [map, bump].forEach((t) => { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; });
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump, canvases: [dCanvas, bCanvas] };
}

const HEAT_COLORS = { Critical: [239, 68, 68], Major: [249, 115, 22], Minor: [234, 179, 8], Info: [56, 189, 248] };

export const HEAT_W = 256; // around the lining: x = angle / 360
export const HEAT_H = 512; // along the tunnel:   y = 1 - chainage / length (canvas top is the far end)

/** Paints soft severity glows for each located defect onto the heat canvas. */
export function paintHeat(canvas, defects, length) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, HEAT_W, HEAT_H);
  ctx.globalCompositeOperation = 'lighter';
  for (const d of defects) {
    const [r, g, b] = HEAT_COLORS[d.severity] || HEAT_COLORS.Minor;
    const cy = (1 - d.chainage_m / length) * HEAT_H;
    const cx0 = (d.angle_deg / 360) * HEAT_W;
    // a soft patch about 1.4 m around and 3 m along the tunnel (the canvas is 0.07 m per px around and 0.49 m per px along)
    const rx = 12 + Math.min(10, Math.sqrt(d.area_mm2 || 800) / 8);
    const ry = rx * 0.28;
    for (const cx of [cx0, cx0 - HEAT_W, cx0 + HEAT_W]) { // repeat across the 0 / 360 seam
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},0.16)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}
