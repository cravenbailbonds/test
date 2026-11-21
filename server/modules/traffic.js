// Organic Traffic Insights: Google Search Console queries/pages + GA4 sources, including
// visits referred by AI assistants (ChatGPT, Perplexity, Gemini, Claude, Copilot).
import { providerStatus } from '../config.js';
import * as google from '../providers/google.js';
import { rng } from '../lib/util.js';
import { addRun } from '../store.js';

export const AI_SOURCES = /chatgpt|openai|perplexity|gemini|bard|claude|anthropic|copilot|bing\.com\/chat|you\.com|phind|meta\.ai|deepseek|grok/i;

export function classifySources(rows) {
  const total = rows.reduce((a, r) => a + r.sessions, 0) || 1;
  const ai = rows.filter(r => AI_SOURCES.test(r.source));
  const organic = rows.filter(r => r.medium === 'organic');
  return {
    total, aiSessions: ai.reduce((a, r) => a + r.sessions, 0), aiShare: +(100 * ai.reduce((a, r) => a + r.sessions, 0) / total).toFixed(2),
    organicSessions: organic.reduce((a, r) => a + r.sessions, 0), aiSources: ai.sort((a, b) => b.sessions - a.sessions),
    topSources: rows.slice().sort((a, b) => b.sessions - a.sessions).slice(0, 12),
  };
}

function demo(project) {
  const r = rng('tr|' + project.id);
  const kws = [...(project.keywords || []), `${project.name.toLowerCase()}`, `${(project.category || 'service').toLowerCase()} near me`];
  const queries = kws.map(k => { const impressions = Math.round(50 + r() * 2500); const position = +(1 + r() * 25).toFixed(1); const ctr = Math.max(0.005, 0.3 / position); return { key: k, impressions, clicks: Math.round(impressions * ctr), ctr, position }; });
  const pages = ['/', '/services/', '/contact/', '/about/', '/blog/'].map(p => ({ key: `https://${project.domain}${p}`, clicks: Math.round(r() * 300), impressions: Math.round(r() * 6000), ctr: r() * 0.1, position: +(2 + r() * 20).toFixed(1) }));
  const daily = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.now() - (92 - i) * 86400000).toISOString().slice(0, 10), clicks: Math.round(20 + i * 0.3 + r() * 15), impressions: Math.round(600 + i * 6 + r() * 200), position: +(12 - i * 0.03 + r()).toFixed(1) }));
  const sources = [['google', 'organic', 1400], ['(direct)', '(none)', 600], ['bing', 'organic', 120], ['chatgpt.com', 'referral', 45], ['perplexity.ai', 'referral', 14], ['gemini.google.com', 'referral', 8], ['facebook.com', 'referral', 90], ['yelp.com', 'referral', 60]]
    .map(([source, medium, s]) => ({ source, medium, sessions: Math.round(s * (0.8 + r() * 0.4)), conversions: Math.round(s * 0.04 * r()) }));
  return { queries, pages, daily, sources };
}

export async function trafficInsights(project) {
  const live = providerStatus().google && (project.gscSite || project.ga4Property);
  let d;
  if (live) {
    const errors = [];
    const safe = async (f, fallback) => { try { return await f(); } catch (e) { errors.push(e.message); return fallback; } };
    d = {
      queries: project.gscSite ? await safe(() => google.searchConsole(project.gscSite, 'query'), []) : [],
      pages: project.gscSite ? await safe(() => google.searchConsole(project.gscSite, 'page'), []) : [],
      daily: project.gscSite ? await safe(() => google.searchConsoleDaily(project.gscSite), []) : [],
      sources: project.ga4Property ? await safe(() => google.ga4Sources(project.ga4Property), []) : [],
      errors,
    };
  } else d = demo(project);
  // Striking distance: queries with impressions but position 8-20 = cheapest wins.
  const opportunities = d.queries.filter(q => q.position >= 8 && q.position <= 20 && q.impressions >= 50).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  const lowCtr = d.queries.filter(q => q.position <= 5 && q.ctr < 0.05 && q.impressions >= 100).slice(0, 10);
  return addRun(project.id, 'traffic', {
    ...d, sourcesSummary: d.sources.length ? classifySources(d.sources) : null,
    totals: { clicks: d.queries.reduce((a, q) => a + q.clicks, 0), impressions: d.queries.reduce((a, q) => a + q.impressions, 0) },
    opportunities, lowCtr, source: live ? 'google' : 'demo',
  });
}
