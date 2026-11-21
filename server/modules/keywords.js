import { providerStatus } from '../config.js';
import * as dfs from '../providers/dataforseo.js';
import { demoKeywordIdeas, demoOrganic, demoBacklinks, demoKeywordMetrics } from '../providers/demo.js';
import { aiAvailable, generateJSON } from '../providers/ai.js';
import { organicVisibility, estimatedTraffic } from '../lib/metrics.js';
import { normalizeDomain, mapLimit } from '../lib/util.js';
import { addRun, listRuns } from '../store.js';

/** Group keywords into topic clusters (one page per cluster) by shared head terms. */
export function clusterKeywords(rows) {
  const stop = new Set(['near', 'me', 'best', 'top', 'cheap', 'the', 'in', 'for', 'a', 'to', 'of', 'how', 'what', 'is', 'does', 'much', 'vs', 'open', 'now', 'rated', 'local', 'affordable']);
  const clusters = new Map();
  for (const r of rows) {
    const toks = r.keyword.toLowerCase().split(/\s+/).filter(t => !stop.has(t));
    const key = r.intent === 'informational' ? 'Questions & guides' : (toks.slice(0, 2).join(' ') || r.keyword);
    if (!clusters.has(key)) clusters.set(key, { name: key, keywords: [], volume: 0 });
    const c = clusters.get(key); c.keywords.push(r); c.volume += r.volume || 0;
  }
  return [...clusters.values()].sort((a, b) => b.volume - a.volume);
}

/** Opportunity = volume x winnability x commercial intent. Surfaces what to target first. */
export function opportunity(r) {
  const intentW = { transactional: 1.3, commercial: 1.1, navigational: 0.4, informational: 0.8 }[r.intent] ?? 0.9;
  const kd = r.difficulty ?? 50;
  return Math.round(Math.log10(10 + (r.volume || 0)) * (100 - kd) * intentW / 3);
}

export async function research(project, seed, location) {
  location ||= project.city ? `${project.city}${project.state ? ',' + project.state : ''},United States` : 'United States';
  let rows, source;
  if (providerStatus().dataforseo) {
    try { rows = await dfs.keywordIdeas(seed, location); source = 'dataforseo'; } catch (e) { rows = null; }
  }
  if (!rows?.length) { rows = demoKeywordIdeas(seed, project.city); source = 'demo'; }
  rows = rows.map(r => ({ ...r, opportunity: opportunity(r) })).sort((a, b) => b.opportunity - a.opportunity);
  let questions = [];
  if (aiAvailable()) {
    try {
      const out = await generateJSON('You are a local SEO strategist. Output only real questions customers type or ask AI assistants.',
        `List 12 questions real customers ask Google or ChatGPT before hiring a "${seed}" in ${location}. Mix urgent, cost, process and trust questions.`,
        { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: { type: 'string' } } } }, { effort: 'low' });
      questions = out.questions;
    } catch { }
  }
  return addRun(project.id, 'keywords', { seed, location, rows, clusters: clusterKeywords(rows).map(c => ({ ...c, keywords: c.keywords.map(k => k.keyword) })), questions, source });
}

/** Organic rank tracking for the project's keyword list (+ AI Overview presence). */
export async function trackOrganic(project) {
  const kws = (project.keywords || []).slice(0, 100);
  if (!kws.length) throw new Error('Add keywords to the project first');
  const live = providerStatus().dataforseo;
  const me = normalizeDomain(project.domain || '');
  const prev = listRuns(project.id, 'organic', 1)[0];
  const prevPos = new Map((prev?.data.rows || []).map(r => [r.keyword, r.position]));
  let vols = new Map();
  if (live) { try { (await dfs.searchVolume(kws, project.city ? `${project.city},${project.state || ''},United States`.replace(',,', ',') : undefined)).forEach(v => vols.set(v.keyword, v.volume)); } catch { } }
  const rows = await mapLimit(kws, live ? 4 : 20, async kw => {
    try {
      if (!live) { const d = demoOrganic(project, kw); return { keyword: kw, position: d.position, url: d.url, volume: demoKeywordMetrics(kw, true).volume, features: d.features, aiOverview: d.aiOverview, top: d.items.slice(0, 5) }; }
      const s = await dfs.organic(kw, { point: project.lat != null ? { lat: project.lat, lng: project.lng } : null });
      const hit = s.items.find(i => i.domain === me || i.domain.endsWith('.' + me));
      return { keyword: kw, position: hit?.position ?? null, url: hit?.url ?? null, volume: vols.get(kw) ?? null, features: s.features, aiOverview: { ...s.aiOverview, citesYou: (s.aiOverview.cited || []).some(d => d === me) }, top: s.items.slice(0, 5) };
    } catch (e) { return { keyword: kw, position: null, error: e.message }; }
  });
  rows.forEach(r => { const p = prevPos.get(r.keyword); r.change = p && r.position ? p - r.position : null; });
  const competitorShare = {};
  rows.forEach(r => (r.top || []).forEach(t => { if (t.domain !== me) competitorShare[t.domain] = (competitorShare[t.domain] || 0) + 1; }));
  return addRun(project.id, 'organic', {
    rows, visibility: organicVisibility(rows.filter(r => r.position)), traffic: estimatedTraffic(rows),
    top3: rows.filter(r => r.position && r.position <= 3).length, top10: rows.filter(r => r.position && r.position <= 10).length,
    aiOverviews: rows.filter(r => r.aiOverview?.present).length, aiOverviewCitations: rows.filter(r => r.aiOverview?.citesYou).length,
    competitors: Object.entries(competitorShare).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, n]) => ({ domain, appearances: n })),
    source: live ? 'dataforseo' : 'demo',
  });
}

export async function backlinkProfile(project, compare = []) {
  const live = providerStatus().dataforseo;
  const doms = [project.domain, ...compare].filter(Boolean).map(normalizeDomain).slice(0, 5);
  if (!doms.length) throw new Error('Project has no domain');
  const profiles = await mapLimit(doms, 2, async d => { try { return live ? await dfs.backlinks(d) : demoBacklinks(d); } catch (e) { return { ...demoBacklinks(d), error: e.message }; } });
  // Link gap: domains linking to competitors but not to you.
  const mine = new Set((profiles[0].topReferrers || []).map(r => r.domain));
  const gap = {};
  profiles.slice(1).forEach(p => (p.topReferrers || []).forEach(r => { if (!mine.has(r.domain)) (gap[r.domain] ||= { domain: r.domain, authority: r.authority, linksTo: [] }).linksTo.push(p.domain); }));
  return addRun(project.id, 'backlinks', { profiles, gap: Object.values(gap).sort((a, b) => b.linksTo.length - a.linksTo.length || b.authority - a.authority).slice(0, 30), source: live ? 'dataforseo' : 'demo' });
}
