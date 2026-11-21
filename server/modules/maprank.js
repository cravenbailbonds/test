import { buildGrid, zoomForSpacing } from '../lib/geo.js';
import { gridMetrics, competitorLeaderboard } from '../lib/metrics.js';
import { isSameBusiness, mapLimit } from '../lib/util.js';
import { providerStatus } from '../config.js';
import * as places from '../providers/places.js';
import * as dfs from '../providers/dataforseo.js';
import { demoMapResults } from '../providers/demo.js';
import { addRun, listRuns } from '../store.js';

export function pickMapSource(requested) {
  const s = providerStatus();
  if (requested === 'dataforseo' && s.dataforseo) return 'dataforseo';
  if (requested === 'google_places' && s.places) return 'google_places';
  if (requested && requested !== 'auto') return 'demo';
  return s.dataforseo ? 'dataforseo' : s.places ? 'google_places' : 'demo';
}

/**
 * Geo-grid scan: checks the Maps ranking for `keyword` from every grid point.
 * Returns metrics (ARP/ATRP/SoLV/visibility), per-point top results, and a competitor leaderboard.
 */
export async function runGridScan(project, { keyword, size = 7, radiusMiles = 3, shape = 'square', source = 'auto' }) {
  if (!keyword) throw new Error('keyword is required');
  if (project.lat == null || project.lng == null) throw new Error('Project needs a location (lat/lng). Set it in project settings.');
  size = Number(size); radiusMiles = Number(radiusMiles);
  if (size > 21) throw new Error('Max grid size is 21x21');
  const src = pickMapSource(source);
  const grid = buildGrid({ lat: project.lat, lng: project.lng }, { size, radiusMiles, shape });
  const spacing = grid.length > 1 ? (radiusMiles * 1609.344 * 2) / Math.max(1, size - 1) : 1000;

  const points = await mapLimit(grid, src === 'demo' ? 50 : 6, async pt => {
    let results = [], error = null;
    try {
      if (src === 'dataforseo') results = await dfs.mapsAt(keyword, pt, zoomForSpacing(spacing));
      else if (src === 'google_places') results = await places.searchAt(keyword, pt, Math.max(400, spacing * 0.75));
      else results = demoMapResults(project, keyword, pt);
    } catch (e) { error = e.message; }
    const idx = results.findIndex(r => isSameBusiness(r, project));
    return { lat: pt.lat, lng: pt.lng, row: pt.row, col: pt.col, ring: pt.ring, distanceM: pt.distanceM, rank: idx >= 0 ? idx + 1 : null, error, results: results.slice(0, 20) };
  });

  const errors = points.filter(p => p.error);
  if (errors.length === points.length) throw new Error(`All grid points failed: ${errors[0].error}`);

  const metrics = gridMetrics(points.map(p => p.rank));
  const leaderboard = competitorLeaderboard(points, r => isSameBusiness(r, project)).slice(0, 25);
  const insights = gridInsights(points, metrics, leaderboard, radiusMiles);

  const prev = listRuns(project.id, 'grid', 200).find(r => r.keyword === keyword.toLowerCase() && r.data.config.size === size && r.data.config.radiusMiles === radiusMiles);
  const delta = prev ? {
    arp: prev.data.metrics.arp != null && metrics.arp != null ? +(prev.data.metrics.arp - metrics.arp).toFixed(2) : null,
    solv: +(metrics.solv - prev.data.metrics.solv).toFixed(1),
    visibility: +(metrics.visibility - prev.data.metrics.visibility).toFixed(1),
    since: prev.createdAt,
  } : null;

  // Keep top-3 per point in storage (full 20 only for the latest view) to keep the DB small.
  const data = { config: { keyword, size, radiusMiles, shape, source: src, center: { lat: project.lat, lng: project.lng } }, metrics, delta, insights, leaderboard, points, errors: errors.length };
  return addRun(project.id, 'grid', data, { keyword: keyword.toLowerCase(), source: src });
}

/** Plain-English findings - the "so what" competitors' tools leave to you. */
export function gridInsights(points, m, leaderboard, radiusMiles) {
  const out = [];
  const byRing = {};
  for (const p of points) {
    const band = Math.round((p.distanceM / 1609.344) * 2) / 2; // half-mile bands
    (byRing[band] ||= []).push(p.rank);
  }
  const bands = Object.keys(byRing).map(Number).sort((a, b) => a - b);
  const reach = bands.filter(b => byRing[b].filter(r => r && r <= 3).length / byRing[b].length >= 0.5).pop();
  if (reach !== undefined) out.push({ type: 'good', text: `You hold the 3-pack out to about ${reach} mi from your location.` });
  else out.push({ type: 'bad', text: 'You are not in the 3-pack at a majority of points even near your address - prioritize GBP relevance (primary category, services, name/keyword alignment) and reviews.' });

  const dirs = { N: [], S: [], E: [], W: [] };
  for (const p of points) {
    if (p.distanceM < 100) continue;
    const c = points.find(q => q.distanceM === 0) || { lat: p.lat, lng: p.lng };
    if (p.lat > c.lat + 1e-6) dirs.N.push(p.rank); if (p.lat < c.lat - 1e-6) dirs.S.push(p.rank);
    if (p.lng > c.lng + 1e-6) dirs.E.push(p.rank); if (p.lng < c.lng - 1e-6) dirs.W.push(p.rank);
  }
  const score = arr => arr.length ? arr.filter(r => r && r <= 3).length / arr.length : 0;
  const ranked = Object.entries(dirs).map(([d, a]) => [d, score(a)]).sort((a, b) => a[1] - b[1]);
  if (ranked.length && ranked[ranked.length - 1][1] - ranked[0][1] > 0.25) {
    const names = { N: 'north', S: 'south', E: 'east', W: 'west' };
    out.push({ type: 'warn', text: `Weakest direction: ${names[ranked[0][0]]} (${Math.round(ranked[0][1] * 100)}% 3-pack vs ${Math.round(ranked[ranked.length - 1][1] * 100)}% ${names[ranked[ranked.length - 1][0]]}). Build a service-area page, local links and GBP posts mentioning neighborhoods to the ${names[ranked[0][0]]}.` });
  }
  const leader = leaderboard.find(c => !c.isTarget);
  const me = leaderboard.find(c => c.isTarget);
  if (leader && (!me || leader.visibility > me.visibility)) {
    const gap = leader.reviews && me?.reviews != null ? leader.reviews - me.reviews : null;
    out.push({ type: 'warn', text: `${leader.name} owns the most map visibility (${leader.visibility} vs your ${me?.visibility ?? 0}).${gap > 0 ? ` They have ${gap} more reviews than you.` : ''}${leader.rating && me?.rating && leader.rating > me.rating ? ` Their rating is higher (${leader.rating} vs ${me.rating}).` : ''}` });
  }
  if (m.found < m.points && m.found > 0) out.push({ type: 'info', text: `Not found at all in ${m.points - m.found} of ${m.points} points (radius ${radiusMiles} mi).` });
  return out;
}
