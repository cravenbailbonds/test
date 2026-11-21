// Keyword Overview + SEO content brief built from the pages that currently rank.
import { providerStatus } from '../config.js';
import * as dfs from '../providers/dataforseo.js';
import { demoOrganic, demoKeywordMetrics } from '../providers/demo.js';
import { fetchPage, parsePage } from './audit.js';
import { aiAvailable, generateJSON } from '../providers/ai.js';
import { mapLimit } from '../lib/util.js';
import { addRun } from '../store.js';

const STOP = new Set('the a an and or of to in for on with at by from is are be your you we our it this that as can will was have has not but if all more about how what when who which near me best top get one also any us its than into out so up do does just'.split(' '));
const tokens = t => t.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

/** Analyse competitor pages: length, shared headings, shared terms and questions. */
export function analyzeCompetitors(pages, keyword) {
  const ok = pages.filter(p => p.parsed && p.parsed.wordCount > 100);
  const words = ok.map(p => p.parsed.wordCount).sort((a, b) => a - b);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;
  const docFreq = new Map(), bigrams = new Map();
  for (const p of ok) {
    const t = tokens(p.parsed.text);
    new Set(t).forEach(w => docFreq.set(w, (docFreq.get(w) || 0) + 1));
    const bg = new Set(); for (let i = 0; i < t.length - 1; i++) bg.add(t[i] + ' ' + t[i + 1]);
    bg.forEach(b => bigrams.set(b, (bigrams.get(b) || 0) + 1));
  }
  const need = Math.max(2, Math.ceil(ok.length * 0.5));
  const kwTokens = new Set(tokens(keyword));
  const terms = [...bigrams.entries()].filter(([b, n]) => n >= need && !b.split(' ').every(w => kwTokens.has(w))).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([term, pages]) => ({ term, pages }))
    .concat([...docFreq.entries()].filter(([w, n]) => n >= need && !kwTokens.has(w)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([term, pages]) => ({ term, pages })));
  const headingCount = new Map();
  ok.forEach(p => new Set(p.parsed.h2s.map(h => h.toLowerCase().replace(/[^a-z0-9 ?]/g, '').trim()).filter(h => h.length > 3 && h.length < 90)).forEach(h => headingCount.set(h, (headingCount.get(h) || 0) + 1)));
  const headings = [...headingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([h, n]) => ({ heading: h, pages: n }));
  const questions = [...new Set(ok.flatMap(p => p.parsed.h2s.concat(p.parsed.h1s)).filter(h => /\?$/.test(h.trim())))].slice(0, 15);
  return {
    pagesAnalyzed: ok.length, medianWords: median, recommendedWords: Math.round(Math.max(600, median * 1.1) / 50) * 50,
    hasFaqPct: ok.length ? Math.round((100 * ok.filter(p => p.parsed.hasFaq).length) / ok.length) : 0,
    schemaTypes: [...new Set(ok.flatMap(p => p.parsed.schemaTypes))].slice(0, 12),
    terms: terms.slice(0, 40), headings, questions,
    titles: ok.map(p => p.parsed.title).filter(Boolean),
  };
}

const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'metaDescription', 'h1', 'searchIntent', 'outline', 'mustInclude', 'faqs', 'localAngle'],
  properties: {
    title: { type: 'string' }, metaDescription: { type: 'string' }, h1: { type: 'string' }, searchIntent: { type: 'string' },
    outline: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['h2', 'notes'], properties: { h2: { type: 'string' }, notes: { type: 'string' } } } },
    mustInclude: { type: 'array', items: { type: 'string' } }, faqs: { type: 'array', items: { type: 'string' } }, localAngle: { type: 'string' },
  },
};

export async function buildBrief(project, keyword) {
  if (!keyword) throw new Error('keyword is required');
  const live = providerStatus().dataforseo;
  let serp, metrics;
  if (live) {
    serp = await dfs.organic(keyword, { point: project.lat != null ? { lat: project.lat, lng: project.lng } : null });
    try { [metrics] = await dfs.searchVolume([keyword]); } catch { }
  } else {
    serp = demoOrganic(project, keyword);
  }
  metrics ||= demoKeywordMetrics(keyword, true);
  const top = serp.items.slice(0, 8);
  const pages = await mapLimit(top, 4, async it => {
    try { const r = await fetchPage(it.url); return { url: it.url, parsed: r.html ? parsePage(r.html, r.finalUrl) : null }; } catch { return { url: it.url, parsed: null }; }
  });
  const analysis = analyzeCompetitors(pages, keyword);
  let brief = null;
  if (aiAvailable()) {
    brief = await generateJSON('You are a senior SEO content strategist writing briefs for local businesses. Never invent facts about the business.',
      `Business: ${project.name} (${project.category || ''}) in ${project.city || ''}. Target keyword: "${keyword}".\nCompetitor analysis of the ranking pages: ${JSON.stringify({ ...analysis, titles: analysis.titles.slice(0, 6) })}\nSERP features present: ${serp.features?.join(', ')}.\n\nWrite a content brief that beats these pages: title (<=60 chars), meta description (<=155), H1, the search intent in one sentence, an outline of 6-10 H2 sections with notes, terms that must be included, 5-8 FAQs, and a local angle that competitors miss.`,
      BRIEF_SCHEMA, { effort: 'medium' });
  } else {
    const city = (project.city || '').split(',')[0];
    brief = {
      title: `${keyword.replace(/\b\w/g, c => c.toUpperCase())}${city && !keyword.includes(city.toLowerCase()) ? ' in ' + city : ''} | ${project.name}`.slice(0, 60),
      metaDescription: `Looking for ${keyword}? ${project.name} serves ${city || 'your area'}. See pricing, process and FAQs, then call ${project.phone || 'us'} today.`.slice(0, 155),
      h1: keyword.replace(/\b\w/g, c => c.toUpperCase()), searchIntent: metrics.intent || 'commercial',
      outline: (analysis.headings.length ? analysis.headings.slice(0, 8).map(h => ({ h2: h.heading, notes: `Covered by ${h.pages} ranking pages` })) : ['What to expect', 'How it works', 'Pricing and costs', 'Why choose us', `Areas we serve near ${city}`, 'Frequently asked questions'].map(h2 => ({ h2, notes: '' }))),
      mustInclude: analysis.terms.length ? analysis.terms.slice(0, 15).map(t => t.term) : ['cost', 'how long it takes', 'licensed', 'insured', 'same-day', 'service area', city, 'reviews', 'warranty', 'emergency'].filter(Boolean),
      faqs: analysis.questions.length ? analysis.questions.slice(0, 6) : [`How much does ${keyword} cost?`, `How fast can you get here?`, `Are you licensed and insured?`, `Do you serve areas near ${city || 'me'}?`, 'Do you offer a warranty?'],
      localAngle: `Name neighborhoods and landmarks in ${city || 'your city'}, show local reviews, and embed your map.`,
      note: (analysis.pagesAnalyzed ? '' : live ? 'The ranking pages could not be read (they may block crawlers), so this brief uses best-practice defaults. ' : 'Demo mode: the competitor pages are simulated, so none could be read and this brief uses best-practice defaults. With DataForSEO it analyzes the real ranking pages. ') + 'Add ANTHROPIC_API_KEY for an AI-written brief.',
    };
  }
  return addRun(project.id, 'brief', { keyword, metrics, serp: { features: serp.features, aiOverview: serp.aiOverview, top: top.map(t => ({ position: t.position, domain: t.domain, url: t.url, title: t.title })) }, analysis: { ...analysis, titles: undefined }, brief, source: live ? 'dataforseo' : 'demo' }, { keyword: keyword.toLowerCase() });
}
