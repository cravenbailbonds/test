// AI answer-engine visibility: are you recommended when people ask AI assistants?
import { aiAvailable, answerWithSearch, generateJSON } from '../providers/ai.js';
import { isSameBusiness, normalizeName, normalizeDomain, mapLimit, rng } from '../lib/util.js';
import { demoCompetitors } from '../providers/demo.js';
import { addRun, latestRun } from '../store.js';

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

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['businesses', 'sentimentTowardTarget', 'reasonsGiven'],
  properties: {
    businesses: { type: 'array', items: { type: 'string' }, description: 'Business names recommended, in the order they appear' },
    sentimentTowardTarget: { type: 'string', enum: ['positive', 'neutral', 'negative', 'not_mentioned'] },
    reasonsGiven: { type: 'array', items: { type: 'string' }, description: 'Attributes the answer credits recommended businesses for (e.g. 24/7, reviews, price)' },
  },
};

async function checkPrompt(project, prompt) {
  const { answer, citedUrls } = await answerWithSearch(prompt, { city: (project.city || '').split(',')[0], region: project.state, country: 'US' });
  const ex = await generateJSON('Extract structured facts from an AI assistant answer. Do not add anything not in the text.',
    `Target business: "${project.name}" (website ${project.domain || 'n/a'}).\n\nANSWER:\n${answer}`, EXTRACT_SCHEMA, { effort: 'low' });
  const loc = locateBrand(answer, ex.businesses, project);
  const citedDomains = [...new Set(citedUrls.map(normalizeDomain))];
  return { prompt, answer, businesses: ex.businesses, ...loc, sentiment: loc.mentioned ? ex.sentimentTowardTarget : 'not_mentioned', reasons: ex.reasonsGiven, citedDomains, citesYourSite: citedDomains.includes(normalizeDomain(project.domain || '')) };
}

function demoCheck(project, prompt) {
  const r = rng(`ai|${project.id}|${prompt}`);
  const comps = demoCompetitors(project, project.category || 'service', 8).map(c => c.name);
  const list = comps.slice(0, 3 + Math.floor(r() * 3));
  const mentioned = r() > 0.45 || prompt.includes(project.name);
  if (mentioned) list.splice(Math.floor(r() * list.length), 0, project.name);
  const cited = ['yelp.com', 'google.com', 'bbb.org', 'reddit.com', 'facebook.com', comps[0].toLowerCase().replace(/[^a-z]/g, '') + '.com'].filter(() => r() > 0.4);
  return {
    prompt, answer: `Here are some well-reviewed options: ${list.map((b, i) => `${i + 1}. ${b}`).join(' ')}.\n\n(Demo answer - connect ANTHROPIC_API_KEY for live AI answers.)`,
    businesses: list, mentioned, position: mentioned ? list.indexOf(project.name) + 1 : null,
    sentiment: mentioned ? (r() > 0.2 ? 'positive' : 'neutral') : 'not_mentioned', reasons: ['24/7 availability', 'strong reviews', 'fast response'].filter(() => r() > 0.3),
    citedDomains: cited, citesYourSite: mentioned && r() > 0.6,
  };
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
  return {
    score, mentionRate: Math.round((100 * mentioned.length) / n), avgPosition: mentioned.length ? +avgPos.toFixed(1) : null,
    shareOfVoice: (() => { const total = results.reduce((a, r) => a + r.businesses.length, 0) || 1; return Math.round((100 * mentioned.length) / total); })(),
    competitors: Object.values(comp).map(c => ({ name: c.name, mentions: c.mentions, avgPosition: +(c.posSum / c.mentions).toFixed(1) })).sort((a, b) => b.mentions - a.mentions).slice(0, 10),
    sources: Object.entries(sources).map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

export async function runAiVisibility(project, prompts) {
  prompts = (prompts?.length ? prompts : project.aiPrompts?.length ? project.aiPrompts : defaultPrompts(project)).slice(0, 20);
  const live = aiAvailable();
  const results = await mapLimit(prompts, live ? 3 : 10, async p => {
    if (!live) return demoCheck(project, p);
    try { return await checkPrompt(project, p); } catch (e) { return { prompt: p, error: e.message, businesses: [], citedDomains: [], mentioned: false, position: null, sentiment: 'not_mentioned' }; }
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
  return addRun(project.id, 'ai', { prompts, results, ...summary, recommendations, source: live ? 'claude_web_search' : 'demo' });
}
