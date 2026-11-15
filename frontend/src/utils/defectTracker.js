/**
 * defectTracker.js
 * ───────────────────────────────────────────────────────────────────────────
 * Within-frame box consolidation & cross-frame spatial-angular defect tracker.
 * Prevents the same physical tunnel crack or spalling zone from being logged
 * repeatedly across consecutive video keyframes as the ROV advances.
 */

export function boxIoU(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const areaA = Math.max(1, (a.x2 - a.x1) * (a.y2 - a.y1));
  const areaB = Math.max(1, (b.x2 - b.x1) * (b.y2 - b.y1));
  return inter / (areaA + areaB - inter);
}

export function pctBoxIoU(a, b) {
  if (!a || !b || a.left_pct == null || b.left_pct == null) return 0;
  const ax2 = a.left_pct + a.width_pct;
  const ay2 = a.top_pct + a.height_pct;
  const bx2 = b.left_pct + b.width_pct;
  const by2 = b.top_pct + b.height_pct;

  const ix1 = Math.max(a.left_pct, b.left_pct);
  const iy1 = Math.max(a.top_pct, b.top_pct);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter <= 0) return 0;
  const areaA = Math.max(0.1, a.width_pct * a.height_pct);
  const areaB = Math.max(0.1, b.width_pct * b.height_pct);
  return inter / (areaA + areaB - inter);
}

export function angleDiffDeg(a, b) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

/**
 * Consolidate overlapping or adjacent same-class boxes on a single frame
 * (handles multi-tile seam splits and nested candidate boxes).
 */
export function consolidateBoxes(boxes, imgW, imgH, iouThresh = 0.35) {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const nmsKept = [];

  for (const cand of sorted) {
    let suppress = false;
    for (const k of nmsKept) {
      if (cand.class === k.class && boxIoU(cand, k) > iouThresh) {
        suppress = true;
        break;
      }
      // Nested containment check (> 65% inside larger/stronger box)
      const ix1 = Math.max(cand.x1, k.x1);
      const iy1 = Math.max(cand.y1, k.y1);
      const ix2 = Math.min(cand.x2, k.x2);
      const iy2 = Math.min(cand.y2, k.y2);
      const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
      const areaCand = Math.max(1, (cand.x2 - cand.x1) * (cand.y2 - cand.y1));
      if (cand.class === k.class && inter / areaCand > 0.65) {
        suppress = true;
        break;
      }
    }
    if (!suppress) nmsKept.push({ ...cand });
  }

  // Merge adjacent / slightly overlapping boxes of the same class (seam-split cracks)
  const gapX = imgW * 0.04;
  const gapY = imgH * 0.04;
  let merged = nmsKept;
  let changed = true;

  while (changed) {
    changed = false;
    const next = [];
    const consumed = new Set();

    for (let i = 0; i < merged.length; i++) {
      if (consumed.has(i)) continue;
      let cur = { ...merged[i] };

      for (let j = i + 1; j < merged.length; j++) {
        if (consumed.has(j)) continue;
        const other = merged[j];
        if (cur.class !== other.class) continue;

        const horizOverlapOrClose = cur.x1 - gapX <= other.x2 && other.x1 - gapX <= cur.x2;
        const vertOverlapOrClose = cur.y1 - gapY <= other.y2 && other.y1 - gapY <= cur.y2;

        if (horizOverlapOrClose && vertOverlapOrClose) {
          const unionX1 = Math.min(cur.x1, other.x1);
          const unionY1 = Math.min(cur.y1, other.y1);
          const unionX2 = Math.max(cur.x2, other.x2);
          const unionY2 = Math.max(cur.y2, other.y2);
          const unionArea = ((unionX2 - unionX1) * (unionY2 - unionY1)) / Math.max(1, imgW * imgH);

          // Guard against accidentally fusing giant unrelated regions across opposite walls
          if (unionArea <= 0.42) {
            const combinedArea = Number(((cur.area_mm2 || 0) + (other.area_mm2 || 0)).toFixed(1));
            const primary = cur.confidence >= other.confidence ? cur : other;
            cur = {
              ...primary,
              x1: unionX1,
              y1: unionY1,
              x2: unionX2,
              y2: unionY2,
              confidence: Math.max(cur.confidence, other.confidence),
              class: cur.class,
              area_mm2: combinedArea > 0 ? combinedArea : primary.area_mm2,
              maskUrl: cur.maskUrl || other.maskUrl || null,
              maskCanvas: cur.maskCanvas || other.maskCanvas || null,
              destBox: primary.destBox || cur.destBox || other.destBox || null,
            };
            consumed.add(j);
            changed = true;
          }
        }
      }
      next.push(cur);
    }
    merged = next;
  }

  return merged;
}

/**
 * Multi-frame continuous defect tracker.
 * Consolidates repeated sightings of the same crack across consecutive video
 * frames, preserving the sharpest / highest-confidence capture.
 */
export function createDefectTracker({
  maxGapSeconds = 3.5,
  maxAngleDiffDeg = 42,
  maxChainageJumpM = 5.5,
  minPctIoU = 0.06,
  maxCentroidDistPct = 24,
} = {}) {
  const tracks = [];
  let seq = 0;

  function getHitAngle(hit) {
    if (typeof hit.angle_deg === 'number') return hit.angle_deg;
    const x = hit.x ?? 0;
    const y = hit.y ?? 2.95;
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }

  function centroidDist(b1, b2) {
    if (!b1 || !b2 || b1.left_pct == null || b2.left_pct == null) return 999;
    const c1x = b1.left_pct + b1.width_pct / 2;
    const c1y = b1.top_pct + b1.height_pct / 2;
    const c2x = b2.left_pct + b2.width_pct / 2;
    const c2y = b2.top_pct + b2.height_pct / 2;
    return Math.hypot(c1x - c2x, c1y - c2y);
  }

  function findMatchingTrack(hit, excludeIds) {
    const t = hit.video_time ?? 0;
    const z = hit.chainage_z ?? 0;
    const angle = getHitAngle(hit);

    let bestTrack = null;
    let bestScore = Infinity;

    for (const tr of tracks) {
      if (excludeIds.has(tr.trackId)) continue;
      if (tr.class !== hit.class) continue;
      if (tr.exited) continue; // already exited camera view

      const timeGap = t - tr.lastTime;
      if (timeGap < 0 || timeGap > maxGapSeconds) continue;

      const aDiff = angleDiffDeg(angle, tr.angleDeg);
      const zDiff = Math.abs(z - tr.lastChainageZ);
      const iouVal = pctBoxIoU(hit.bbox, tr.lastBbox);
      const cDist = centroidDist(hit.bbox, tr.lastBbox);

      const matchesVisually = iouVal >= minPctIoU || cDist <= maxCentroidDistPct;
      const matchesCylinderZone = aDiff <= maxAngleDiffDeg && zDiff <= maxChainageJumpM;

      if (matchesVisually || matchesCylinderZone) {
        const matchScore = cDist + aDiff * 0.4;
        if (matchScore < bestScore) {
          bestScore = matchScore;
          bestTrack = tr;
        }
      }
    }
    return bestTrack;
  }

  return {
    /**
     * Ingest all detections from the current frame. Returns deduplicated manifest list.
     */
    ingestFrame(frameHits) {
      const orderedHits = [...frameHits].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      const matchedIdsThisFrame = new Set();

      for (const hit of orderedHits) {
        const hitAngle = getHitAngle(hit);
        const match = findMatchingTrack(hit, matchedIdsThisFrame);

        if (match) {
          matchedIdsThisFrame.add(match.trackId);
          match.lastTime = hit.video_time ?? match.lastTime;
          match.lastChainageZ = hit.chainage_z ?? match.lastChainageZ;
          match.lastBbox = hit.bbox || match.lastBbox;
          match.angleDeg = hitAngle;
          match.hitCount += 1;

          // Upgrade snapshot & confidence if this angle is clearer (keep persisted flag)
          if (hit.confidence >= match.bestDetection.confidence) {
            match.bestDetection = {
              ...hit,
              localId: match.trackId,
              observations: match.hitCount,
              persisted: match.persisted,
            };
          } else {
            match.bestDetection = {
              ...match.bestDetection,
              observations: match.hitCount,
              persisted: match.persisted,
            };
          }
        } else {
          seq += 1;
          const defectType = hit.class === 'spalling' ? 'SPA' : 'CRK';
          const trackId = `${defectType}-${String(seq).padStart(3, '0')}`;
          tracks.push({
            trackId,
            class: hit.class,
            angleDeg: hitAngle,
            firstTime: hit.video_time ?? 0,
            lastTime: hit.video_time ?? 0,
            lastChainageZ: hit.chainage_z ?? 0,
            lastBbox: hit.bbox || null,
            hitCount: 1,
            exited: false,
            persisted: false,
            bestDetection: {
              ...hit,
              localId: trackId,
              observations: 1,
              persisted: false,
            },
          });
        }
      }

      return this.getManifest();
    },

    /** Return tracks that have exited camera view (unseen > maxGapSeconds) and mark exited+persisted. */
    popExitedTracks(currentTime) {
      const ready = [];
      for (const tr of tracks) {
        if (!tr.exited && currentTime - tr.lastTime > maxGapSeconds) {
          tr.exited = true;
          if (!tr.persisted) {
            tr.persisted = true;
            tr.bestDetection = { ...tr.bestDetection, persisted: true };
            ready.push(tr.bestDetection);
          }
        }
      }
      return ready;
    },

    /** Immediately persist current visible un-persisted tracks WITHOUT marking exited (prevents re-logging while still in view). */
    flushPendingNow() {
      const batch = [];
      for (const tr of tracks) {
        if (!tr.persisted) {
          tr.persisted = true;
          tr.bestDetection = { ...tr.bestDetection, persisted: true };
          batch.push(tr.bestDetection);
        }
      }
      return batch;
    },

    /** Flush all remaining un-persisted tracks at end of scan / stop scan. */
    flushAll() {
      const remaining = [];
      for (const tr of tracks) {
        tr.exited = true;
        if (!tr.persisted) {
          tr.persisted = true;
          tr.bestDetection = { ...tr.bestDetection, persisted: true };
          remaining.push(tr.bestDetection);
        }
      }
      return remaining;
    },

    /** Return current unique tracked defects (newest track first). */
    getManifest() {
      return [...tracks].reverse().map((tr) => tr.bestDetection);
    },
  };
}
