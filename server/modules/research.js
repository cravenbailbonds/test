// Competitor research: Domain Overview, Top Pages, Compare Domains and Keyword Gap.
import { providerStatus } from '../config.js';
import * as dfs from '../providers/dataforseo.js';
import { demoKeywordIdeas } from '../providers/demo.js';
import { normalizeDomain, mapLimit, rng, hash, dfsLocation } from '../lib/util.js';
import { ctrFor } from '../lib/metrics.js';
import { addRun } from '../store.js';

const loc = p => dfsLocation(p.city, p.state);

/** Demo: deterministic keyword portfolio per domain built from the project's niche. */
function demoRanked(domain, project) {
  const r = rng('rk|' + domain);
  const seeds = [project.category || 'service', ...(project.keywords || []).slice(0, 3)].filter(Boolean);
  const pool = seeds.flatMap(s => demoKeywordIdeas(s.toLowerCase(), project.city));
  const seen = new Set();
  return pool.filter(k => !seen.has(k.keyword) && seen.add(k.keyword) && r() > 0.35).map(k => {
    const position = Math.max(1, Math.round(1 + r() ** 1.4 * 60));
    const page = ['/', '/services/', '/about/', '/contact/', '/blog/' + k.keyword.split(' ').slice(0, 3).join('-') + '/'][hash(domain + k.keyword) % 5];
    return { ...k, position, url: `https://${domain}${page}`, traffic: Math.round(ctrFor(position) * k.volume) };
  });
}

async function ranked(domain, project) {
  if (providerStatus().dataforseo) return { rows: await dfs.rankedKeywords(domain, loc(project)), source: 'dataforseo' };
  return { rows: demoRanked(domain, project), source: 'demo' };
}

function pagesFrom(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.url) continue;
    const p = m.get(r.url) || { url: r.url, keywords: 0, traffic: 0, top: null };
    p.keywords++; p.traffic += r.traffic || 0;
    if (!p.top || (r.traffic || 0) > (p.top.traffic || 0)) p.top = { keyword: r.keyword, position: r.position, traffic: r.traffic };
    m.set(r.url, p);
  }
  return [...m.values()].sort((a, b) => b.traffic - a.traffic);
}

export async function domainOverview(project, domain) {
  domain = normalizeDomain(domain || project.domain);
  const { rows, source } = await ranked(domain, project);
  let summary;
  if (source === 'dataforseo') { try { summary = await dfs.domainOverview(domain, loc(project)); } catch { } }
  summary ||= {
    keywords: rows.length, traffic: rows.reduce((a, r) => a + (r.traffic || 0), 0),
    pos1: rows.filter(r => r.position === 1).length, pos2_3: rows.filter(r => r.position >= 2 && r.position <= 3).length,
    pos4_10: rows.filter(r => r.position >= 4 && r.position <= 10).length, pos11_20: rows.filter(r => r.position >= 11 && r.position <= 20).length,
  };
  const intents = {};
  rows.forEach(r => { intents[r.intent] = (intents[r.intent] || 0) + 1; });
  return addRun(project.id, 'domain', { domain, summary, intents, keywords: rows.slice(0, 300), pages: pagesFrom(rows).slice(0, 50), source }, { keyword: domain });
}

/**
 * Keyword Gap across you + up to 4 competitors.
 *  missing  - competitors rank, you don't
 *  weak     - you rank, but lower than every competitor that ranks
 *  strong   - you outrank every competitor that ranks
 *  untapped - exactly one competitor ranks, you don't (easier wins)
 *  shared   - everyone ranks
 */
export function computeGap(me, sets) {
  const all = new Map();
  sets.forEach((s, i) => s.rows.forEach(r => {
    if (!r.keyword || !r.position) return;
    const e = all.get(r.keyword) || { keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, intent: r.intent, cpc: r.cpc, positions: Array(sets.length).fill(null) };
    e.positions[i] = Math.min(e.positions[i] ?? 999, r.position);
    all.set(r.keyword, e);
  }));
  const out = { missing: [], weak: [], strong: [], untapped: [], shared: [] };
  for (const e of all.values()) {
    const mine = e.positions[0], others = e.positions.slice(1).filter(Boolean);
    if (!others.length) { if (mine) out.strong.push(e); continue; }
    if (!mine) (others.length === 1 ? out.untapped : out.missing).push(e);
    else if (others.every(o => mine > o)) out.weak.push(e);
    else if (others.every(o => mine < o)) out.strong.push(e);
    if (mine && others.length === sets.length - 1) out.shared.push(e);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  return out;
}

export async function keywordGap(project, competitors = []) {
  const domains = [project.domain, ...competitors].filter(Boolean).map(normalizeDomain).slice(0, 5);
  if (domains.length < 2) throw new Error('Add at least one competitor domain');
  const sets = await mapLimit(domains, 2, d => ranked(d, project));
  const gap = computeGap(domains[0], sets);
  const counts = Object.fromEntries(Object.entries(gap).map(([k, v]) => [k, v.length]));
  const trimmed = Object.fromEntries(Object.entries(gap).map(([k, v]) => [k, v.slice(0, 200)]));
  return addRun(project.id, 'gap', { domains, counts, ...trimmed, source: sets[0].source });
}
