import { round } from './util.js';

/**
 * Local grid metrics.
 *  ARP   Average Rank Position over points where the business was found (1..20).
 *  ATRP  Average Total Rank Position - unfound points count as 21, so it punishes gaps.
 *  SoLV  Share of Local Voice - % of points where business is in the 3-pack.
 *  Top10 % of points ranking 1-10.
 *  VisibilityScore 0-100 - CTR-weighted visibility (rank 1 earns far more than rank 9).
 */
const CTR = [0, 0.32, 0.22, 0.16, 0.06, 0.045, 0.035, 0.028, 0.022, 0.018, 0.015];
export function ctrFor(rank) {
  if (!rank || rank < 1) return 0;
  if (rank <= 10) return CTR[rank];
  return Math.max(0.002, 0.015 * Math.pow(0.8, rank - 10));
}

export function gridMetrics(ranks, notFound = 21) {
  const n = ranks.length || 1;
  const found = ranks.filter(r => r && r > 0);
  const arp = found.length ? found.reduce((a, b) => a + b, 0) / found.length : null;
  const atrp = ranks.reduce((a, r) => a + (r && r > 0 ? r : notFound), 0) / n;
  const top3 = ranks.filter(r => r && r <= 3).length;
  const top10 = ranks.filter(r => r && r <= 10).length;
  const vis = ranks.reduce((a, r) => a + ctrFor(r), 0) / (n * CTR[1]);
  return {
    points: ranks.length,
    found: found.length,
    arp: arp === null ? null : round(arp, 2),
    atrp: round(atrp, 2),
    solv: round((top3 / n) * 100, 1),
    top3Pct: round((top3 / n) * 100, 1),
    top10Pct: round((top10 / n) * 100, 1),
    visibility: round(vis * 100, 1),
  };
}

/** Aggregate every business that appeared anywhere on the grid -> competitor leaderboard. */
export function competitorLeaderboard(points, isTarget) {
  const map = new Map();
  for (const p of points) {
    (p.results || []).forEach((r, i) => {
      const key = r.placeId || r.name;
      if (!map.has(key)) map.set(key, { key, name: r.name, placeId: r.placeId, domain: r.domain, rating: r.rating, reviews: r.reviews, category: r.category, address: r.address, ranks: [], isTarget: isTarget(r) });
      map.get(key).ranks.push(i + 1);
    });
  }
  const total = points.length || 1;
  return [...map.values()].map(c => {
    const full = c.ranks.concat(Array(Math.max(0, total - c.ranks.length)).fill(null));
    const m = gridMetrics(full);
    return { ...c, ranks: undefined, appearances: c.ranks.length, ...m };
  }).sort((a, b) => b.visibility - a.visibility || a.atrp - b.atrp);
}

/** Organic visibility index: CTR-weighted share across tracked keywords, weighted by volume. */
export function organicVisibility(rows) {
  let num = 0, den = 0;
  for (const r of rows) {
    const vol = Math.max(10, r.volume || 10);
    num += ctrFor(r.position) * vol; den += CTR[1] * vol;
  }
  return den ? round((num / den) * 100, 1) : 0;
}

export function estimatedTraffic(rows) {
  return Math.round(rows.reduce((a, r) => a + ctrFor(r.position) * (r.volume || 0), 0));
}
