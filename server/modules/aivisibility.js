// AI answer-engine visibility: are you recommended when people ask AI assistants?
import { aiAvailable, generateJSON } from '../providers/ai.js';
import { ENGINES, liveEngines, extractBusinessesHeuristic } from '../providers/engines.js';
import { isSameBusiness, normalizeName, normalizeDomain, mapLimit, rng } from '../lib/util.js';
import { demoCompetitors } from '../providers/demo.js';
import { addRun, latestRun } from '../store.js';
import { notify } from './notify.js';

export function defaultPrompts(project) {
  const svc = (project.category || 'service').toLowerCase();
  const city = project.city || 'my area';
  return [
    `Who is the best ${svc} in ${city}?`,
    `I need a ${svc} near ${city} right now - who should I call?`,
    `What are the most trusted ${svc} companies in ${city}?`,
    `How much does a ${svc} cost in ${city}, and who is affordable?`,
    `Is ${project.name} in ${city} any good?`,
  ];
}

/** Find where (if anywhere) the brand appears in an AI answer. */
export function locateBrand(answer, businesses, project) {
  const idx = businesses.findIndex(b => isSameBusiness({ name: b }, project));
  const nm = normalizeName(project.name);
  const mentioned = idx >= 0 || (nm.length > 3 && normalizeName(answer).includes(nm));
  return { mentioned, position: idx >= 0 ? idx + 1 : mentioned ? businesses.length + 1 : null };
}

export const ATTRS = ['Speed / availability', 'Price / value', 'Reviews / reputation', 'Expertise / experience', 'Customer service', 'Trust / honesty', 'Range of services', 'Location / convenience'];

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['businesses', 'sentimentTowardTarget', 'reasonsGiven', 'attributes'],
  properties: {
    businesses: { type: 'array', items: { type: 'string' }, description: 'Business names recommended, in the order they appear' },
    sentimentTowardTarget: { type: 'string', enum: ['positive', 'neutral', 'negative', 'not_mentioned'] },
    reasonsGiven: { type: 'array', items: { type: 'string' }, description: 'Attributes the answer credits recommended businesses for (e.g. 24/7, reviews, price)' },
    attributes: {
      type: 'array', description: 'Every claim the answer makes about a named business, mapped to one of the fixed attributes',
      items: { type: 'object', additionalProperties: false, required: ['business', 'attribute', 'sentiment'], properties: { business: { type: 'string' }, attribute: { type: 'string', enum: ATTRS }, sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] } } },
    },
  },
};

const ATTR_RE = {
  'Speed / availability': /24\/7|24 hours|fast|quick|same[- ]day|respons|available|emergency/i,
  'Price / value': /price|afford|cost|cheap|value|fee|quote/i,
  'Reviews / reputation': /review|rated|rating|reputation|star/i,
  'Expertise / experience': /experi|expert|licens|certif|years|skilled|professional/i,
  'Customer service': /friendly|service|courteous|helpful|caring/i,
  'Trust / honesty': /trust|honest|reliab|transparent/i,
  'Range of services': /full range|variety|offer|services include|wide/i,
  'Location / convenience': /located|near|convenient|downtown|close to/i,
};

async function checkPrompt(project, prompt, engine) {
  const { answer, citedUrls } = await ENGINES[engine].ask(prompt, { city: (project.city || '').split(',')[0], region: project.state, country: 'US' });
  let ex;
  if (aiAvailable()) {
    ex = await generateJSON('Extract structured facts from an AI assistant answer. Do not add anything not in the text.',
      `Target business: "${project.name}" (website ${project.domain || 'n/a'}).\n\nANSWER:\n${answer}`, EXTRACT_SCHEMA, { effort: 'low' });
  } else {
    const businesses = extractBusinessesHeuristic(answer);
    const attributes = [];
    for (const b of businesses) {
      const line = answer.split('\n').find(l => l.includes(b)) || '';
      for (const [attr, re] of Object.entries(ATTR_RE)) if (re.test(line)) attributes.push({ business: b, attribute: attr, sentiment: /not|poor|bad|slow|expensive|complain/i.test(line) ? 'negative' : 'positive' });
    }
    ex = { businesses, sentimentTowardTarget: 'positive', reasonsGiven: [], attributes };
  }
  const loc = locateBrand(answer, ex.businesses, project);
  const citedDomains = [...new Set(citedUrls.map(normalizeDomain))];
  return { prompt, engine, answer, businesses: ex.businesses, ...loc, sentiment: loc.mentioned ? ex.sentimentTowardTarget : 'not_mentioned', reasons: ex.reasonsGiven, attributes: ex.attributes || [], citedDomains, citesYourSite: citedDomains.includes(normalizeDomain(project.domain || '')) };
}

function demoCheck(project, prompt, engine = 'claude') {
  const r = rng(`ai|${project.id}|${prompt}|${engine}`);
  const comps = demoCompetitors(project, project.category || 'service', 8).map(c => c.name);
  const list = comps.slice(0, 3 + Math.floor(r() * 3));
  const mentioned = r() > 0.45 || prompt.includes(project.name);
  if (mentioned) list.splice(Math.floor(r() * list.length), 0, project.name);
  const cited = ['yelp.com', 'google.com', 'bbb.org', 'reddit.com', 'facebook.com', comps[0].toLowerCase().replace(/[^a-z]/g, '') + '.com'].filter(() => r() > 0.4);
  return {
    prompt, answer: `Here are some well-reviewed options: ${list.map((b, i) => `${i + 1}. ${b}`).join(' ')}.\n\n(Demo answer - connect ANTHROPIC_API_KEY for live AI answers.)`,
    businesses: list, mentioned, position: mentioned ? list.indexOf(project.name) + 1 : null,
    sentiment: mentioned ? (r() > 0.2 ? 'positive' : 'neutral') : 'not_mentioned', reasons: ['24/7 availability', 'strong reviews', 'fast response'].filter(() => r() > 0.3),
    citedDomains: cited, citesYourSite: mentioned && r() > 0.6, engine,
    attributes: list.flatMap(b => ATTRS.filter(() => r() > 0.72).map(attribute => ({ business: b, attribute, sentiment: r() > 0.18 ? 'positive' : r() > 0.5 ? 'neutral' : 'negative' }))),
  };
}

/**
 * Brand perception matrix: for you and the most-mentioned competitors, how AI answers talk
 * about each selling point (net sentiment), and where you trail.
 */
export function perception(results, project) {
  const brands = new Map();
  const keyFor = name => isSameBusiness({ name }, project) ? project.name : name;
  for (const r of results) for (const a of r.attributes || []) {
    const b = keyFor(a.business);
    const m = brands.get(b) || {}; const c = m[a.attribute] || { positive: 0, neutral: 0, negative: 0 };
    c[a.sentiment]++; m[a.attribute] = c; brands.set(b, m);
  }
  const mentions = b => Object.values(brands.get(b) || {}).reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  const others = [...brands.keys()].filter(b => b !== project.name).sort((a, b) => mentions(b) - mentions(a)).slice(0, 4);
  const cols = [project.name, ...others];
  const rows = ATTRS.map(attr => ({
    attribute: attr,
    cells: cols.map(b => { const c = brands.get(b)?.[attr]; if (!c) return null; const n = c.positive + c.neutral + c.negative; return { n, net: Math.round((100 * (c.positive - c.negative)) / n) }; }),
  }));
  // A gap = a competitor is clearly ahead: you're never credited for it, they're credited
  // twice as often, or their net sentiment is 30+ points better (with at least 2 mentions).
  const gaps = rows.filter(r => {
    const mine = r.cells[0];
    const best = r.cells.slice(1).filter(c => c && c.n >= 2).sort((a, b) => b.n - a.n)[0];
    if (!best) return false;
    return !mine || mine.n * 2 <= best.n || best.net - mine.net >= 30;
  }).map(r => `AI credits competitors for "${r.attribute}" more than you. Earn that association with reviews that mention it, a page section about it, and GBP posts.`);
  const strengths = rows.filter(r => r.cells[0] && r.cells[0].net >= 50 && r.cells[0].n >= Math.max(1, ...r.cells.slice(1).map(c => c?.n || 0))).map(r => r.attribute);
  return { brands: cols, rows, gaps: gaps.slice(0, 3), strengths };
}

export function summarize(results, project) {
  const n = results.length || 1;
  const mentioned = results.filter(r => r.mentioned);
  const comp = {};
  results.forEach(r => r.businesses.forEach((b, i) => { if (!isSameBusiness({ name: b }, project)) { (comp[b] ||= { name: b, mentions: 0, posSum: 0 }); comp[b].mentions++; comp[b].posSum += i + 1; } }));
  const sources = {};
  results.forEach(r => r.citedDomains.forEach(d => { sources[d] = (sources[d] || 0) + 1; }));
  const avgPos = mentioned.filter(r => r.position).reduce((a, r) => a + r.position, 0) / (mentioned.filter(r => r.position).length || 1);
  // AI Visibility Score: mention rate (60%) + prominence (25%) + sentiment (15%)
  const prominence = mentioned.length ? Math.max(0, 1 - (avgPos - 1) / 5) : 0;
  const sentimentScore = mentioned.length ? mentioned.filter(r => r.sentiment === 'positive').length / mentioned.length : 0;
  const score = Math.round(100 * (0.6 * mentioned.length / n + 0.25 * prominence + 0.15 * sentimentScore));
  const engines = [...new Set(results.map(r => r.engine || 'claude'))].map(e => {
    const rs = results.filter(r => (r.engine || 'claude') === e), m = rs.filter(r => r.mentioned);
    return { engine: e, label: ENGINES[e]?.label || e, answers: rs.length, mentionRate: Math.round((100 * m.length) / (rs.length || 1)), avgPosition: m.length ? +(m.reduce((a, r) => a + (r.position || 0), 0) / m.length).toFixed(1) : null };
  });
  return {
    score, mentionRate: Math.round((100 * mentioned.length) / n), engines, avgPosition: mentioned.length ? +avgPos.toFixed(1) : null,
    shareOfVoice: (() => { const total = results.reduce((a, r) => a + r.businesses.length, 0) || 1; return Math.round((100 * mentioned.length) / total); })(),
    competitors: Object.values(comp).map(c => ({ name: c.name, mentions: c.mentions, avgPosition: +(c.posSum / c.mentions).toFixed(1) })).sort((a, b) => b.mentions - a.mentions).slice(0, 10),
    sources: Object.entries(sources).map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

export async function runAiVisibility(project, prompts, engines) {
  prompts = (prompts?.length ? prompts : project.aiPrompts?.length ? project.aiPrompts : defaultPrompts(project)).slice(0, 20);
  const live = liveEngines();
  const useDemo = !live.length;
  engines = (engines?.length ? engines : useDemo ? Object.keys(ENGINES) : live).filter(e => ENGINES[e] && (useDemo || ENGINES[e].available()));
  if (!engines.length) throw new Error('None of the selected AI engines has an API key configured.');
  const jobs = prompts.flatMap(p => engines.map(e => ({ p, e })));
  const results = await mapLimit(jobs, useDemo ? 20 : 4, async ({ p, e }) => {
    if (useDemo) return demoCheck(project, p, e);
    try { return await checkPrompt(project, p, e); } catch (err) { return { prompt: p, engine: e, error: err.message, businesses: [], citedDomains: [], attributes: [], mentioned: false, position: null, sentiment: 'not_mentioned' }; }
  });
  const summary = summarize(results.filter(r => !r.error), project);
  // Cross-signal: which recommendation sources you're missing from (citation gap)
  const audit = latestRun(project.id, 'audit');
  const recommendations = [];
  if (summary.mentionRate < 50) recommendations.push('You are missing from most AI answers. AI assistants lean on review sites, directories and your own site\'s clarity - fix listings on the top cited sources below and add an FAQ + LocalBusiness schema.');
  const top = summary.sources.filter(s => s.domain !== normalizeDomain(project.domain || '')).slice(0, 5).map(s => s.domain);
  if (top.length) recommendations.push(`Most-cited sources for your category: ${top.join(', ')}. Make sure you have a complete, well-reviewed presence on each.`);
  if (audit?.data.aiBotsBlocked?.length) recommendations.push(`Your robots.txt blocks ${audit.data.aiBotsBlocked.join(', ')} - those engines can't read your site.`);
  if (summary.competitors[0]) recommendations.push(`${summary.competitors[0].name} is the most-recommended competitor (${summary.competitors[0].mentions}/${results.length} answers). Study what reasons the AI gives for them and match them in your reviews and content.`);
  const perc = perception(results.filter(r => !r.error), project);
  recommendations.push(...perc.gaps);
  const prev = latestRun(project.id, 'ai');
  if (prev && prev.data.score - summary.score >= 15) await notify(project.id, 'ai_drop', `AI visibility fell from ${prev.data.score} to ${summary.score}`, 'Check which answers stopped mentioning you in the AI Visibility tab.', 'ai', { email: true });
  return addRun(project.id, 'ai', { prompts, engines, results, ...summary, perception: perc, recommendations, source: useDemo ? 'demo' : engines.map(e => ENGINES[e].label).join(' + ') });
}
