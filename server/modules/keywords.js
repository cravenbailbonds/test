import { providerStatus } from '../config.js';
import * as dfs from '../providers/dataforseo.js';
import { demoKeywordIdeas, demoOrganic, demoBacklinks, demoKeywordMetrics } from '../providers/demo.js';
import { aiAvailable, generateJSON } from '../providers/ai.js';
import { organicVisibility, estimatedTraffic } from '../lib/metrics.js';
import { normalizeDomain, mapLimit, rng, dfsLocation } from '../lib/util.js';
import { notify } from './notify.js';
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
  location = location ? dfsLocation(location) : dfsLocation(project.city, project.state);
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

/**
 * Organic rank tracking for the project's keywords across devices and locations, with
 * competitor positions, share of voice, cannibalization detection and drop alerts.
 */
export async function trackOrganic(project) {
  const kws = (project.keywords || []).slice(0, 100);
  if (!kws.length) throw new Error('Add keywords to the project first');
  const live = providerStatus().dataforseo;
  const me = normalizeDomain(project.domain || '');
  const comps = (project.competitors || []).map(normalizeDomain).slice(0, 20);
  const devices = project.devices?.length ? project.devices : ['desktop'];
  const locations = project.trackLocations?.length ? project.trackLocations : [project.city ? `${project.city}${project.state ? ', ' + project.state : ''}` : 'United States'];
  const prev = listRuns(project.id, 'organic', 1)[0];
  const key = r => `${r.keyword}|${r.device || 'desktop'}|${r.location || locations[0]}`;
  const prevPos = new Map((prev?.data.rows || []).map(r => [key(r), r.position]));
  const vols = new Map();
  if (live) { try { (await dfs.searchVolume(kws, toDfsLocation(locations[0]))).forEach(v => vols.set(v.keyword, v.volume)); } catch { } }
  const jobs = kws.flatMap(keyword => devices.flatMap(device => locations.map(location => ({ keyword, device, location }))));
  const isMine = d => d === me || d.endsWith('.' + me);
  const rows = await mapLimit(jobs, live ? 4 : 25, async ({ keyword, device, location }) => {
    try {
      let s;
      if (live) {
        const useGps = location === locations[0] && project.lat != null && !project.trackLocations?.length;
        s = await dfs.organic(keyword, useGps ? { point: { lat: project.lat, lng: project.lng }, device } : { location: toDfsLocation(location), device });
      } else {
        const d = demoOrganic(project, keyword + (device === 'mobile' ? ' m' : '') + (location === locations[0] ? '' : ' ' + location));
        const extra = comps.map((c, i) => ({ position: 2 + ((hashStr(c + keyword + device) + i) % 40), domain: c, url: `https://${c}/` }));
        if (d.position && rng(keyword + device)() > 0.85) extra.push({ position: d.position + 3, domain: me, url: `https://${me}/blog/` });
        s = { items: [...d.items, ...extra].sort((a, b) => a.position - b.position), features: d.features, aiOverview: d.aiOverview, myPos: d.position, myUrl: d.url };
      }
      const mine = s.items.filter(i => isMine(i.domain));
      const position = s.myPos !== undefined ? s.myPos : mine[0]?.position ?? null;
      const competitorPositions = Object.fromEntries(comps.map(c => [c, s.items.find(i => i.domain === c || i.domain.endsWith('.' + c))?.position ?? null]));
      const urls = [...new Set(mine.map(i => i.url))];
      return {
        keyword, device, location, position, url: s.myUrl ?? mine[0]?.url ?? null, volume: vols.get(keyword) ?? demoKeywordMetrics(keyword, true).volume,
        features: s.features, aiOverview: { ...s.aiOverview, citesYou: (s.aiOverview?.cited || []).some(isMine) || Boolean(s.aiOverview?.citesYou) },
        competitorPositions, cannibalized: urls.length > 1 ? urls : null, top: s.items.filter(i => i.position <= 5).slice(0, 5),
      };
    } catch (e) { return { keyword, device, location, position: null, error: e.message }; }
  });
  const alerts = [];
  rows.forEach(r => {
    const p = prevPos.get(key(r));
    r.change = p && r.position ? p - r.position : p && !r.position ? -(101 - p) : null;
    if (p && p <= 10 && (!r.position || r.position - p >= 3)) alerts.push(`"${r.keyword}" (${r.device}, ${r.location}) fell from #${p} to ${r.position ? '#' + r.position : 'out of the top 100'}`);
  });
  for (const a of alerts.slice(0, 10)) await notify(project.id, 'rank_drop', 'Ranking drop', a, 'organic', { email: alerts.length <= 3 });
  const sov = [me, ...comps].map(d => ({ domain: d, you: d === me, visibility: organicVisibility(rows.map(r => ({ position: d === me ? r.position : r.competitorPositions?.[d], volume: r.volume })).filter(r => r.position)) })).sort((a, b) => b.visibility - a.visibility);
  const competitorShare = {};
  rows.forEach(r => (r.top || []).forEach(t => { if (!isMine(t.domain)) competitorShare[t.domain] = (competitorShare[t.domain] || 0) + 1; }));
  return addRun(project.id, 'organic', {
    rows, devices, locations, visibility: organicVisibility(rows.filter(r => r.position)), traffic: estimatedTraffic(rows),
    top3: rows.filter(r => r.position && r.position <= 3).length, top10: rows.filter(r => r.position && r.position <= 10).length,
    aiOverviews: rows.filter(r => r.aiOverview?.present).length, aiOverviewCitations: rows.filter(r => r.aiOverview?.citesYou).length,
    shareOfVoice: sov, cannibalization: rows.filter(r => r.cannibalized).map(r => ({ keyword: r.keyword, device: r.device, urls: r.cannibalized })),
    competitors: Object.entries(competitorShare).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, n]) => ({ domain, appearances: n })),
    source: live ? 'dataforseo' : 'demo',
  });
}

const toDfsLocation = l => dfsLocation(l);
const hashStr = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

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
