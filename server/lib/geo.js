const R = 6371000; // earth radius, m
const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Point at `meters` from origin on `bearing` (degrees). */
export function offset(origin, meters, bearing) {
  const d = meters / R, br = toRad(bearing), lat1 = toRad(origin.lat), lng1 = toRad(origin.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/**
 * Build a scan grid.
 *  shape "square":   size x size points spanning radius (miles) from center in each direction.
 *  shape "circle":   square grid clipped to a circle (fewer wasted corner pings, cheaper).
 *  shape "rings":    concentric rings (center + `size` rings, 8*ring points) - best for
 *                    "how far does my visibility reach" analysis.
 */
export function buildGrid(center, { size = 7, radiusMiles = 3, shape = 'square' } = {}) {
  const radiusM = radiusMiles * 1609.344;
  const points = [];
  if (shape === 'rings') {
    points.push({ ...center, row: 0, col: 0, ring: 0, distanceM: 0 });
    const rings = Math.max(1, Math.floor(size / 2));
    for (let r = 1; r <= rings; r++) {
      const n = 8 * r, dist = (radiusM * r) / rings;
      for (let k = 0; k < n; k++) {
        const p = offset(center, dist, (360 * k) / n);
        points.push({ ...p, row: r, col: k, ring: r, distanceM: Math.round(dist) });
      }
    }
    return points;
  }
  if (size < 1 || size % 2 === 0) throw new Error('Grid size must be an odd number');
  const half = (size - 1) / 2;
  const step = half === 0 ? 0 : radiusM / half;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dy = (half - r) * step, dx = (c - half) * step;
      const dist = Math.hypot(dx, dy);
      if (shape === 'circle' && dist > radiusM * 1.0001) continue;
      const north = offset(center, Math.abs(dy), dy >= 0 ? 0 : 180);
      const p = offset(north, Math.abs(dx), dx >= 0 ? 90 : 270);
      points.push({ ...p, row: r, col: c, distanceM: Math.round(dist) });
    }
  }
  return points;
}

/** Google-Maps-ish zoom for a given spacing between grid points (used by DataForSEO coordinate queries). */
export function zoomForSpacing(meters) {
  if (meters <= 400) return 16;
  if (meters <= 900) return 15;
  if (meters <= 2000) return 14;
  if (meters <= 4000) return 13;
  return 12;
}
