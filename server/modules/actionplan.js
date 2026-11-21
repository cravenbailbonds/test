// Unified, prioritized to-do list built from every module's latest results.
// This is the "just tell me what to do next" layer.
import { latestRun, listRuns, listContacts } from '../store.js';
import { aiAvailable, generate } from '../providers/ai.js';

const IMPACT = { high: 3, medium: 2, low: 1 };
const EFFORT = { quick: 1, moderate: 2, project: 3 };

export function buildPlan(project) {
  const tasks = [];
  const add = (t) => tasks.push({ ...t, priority: Math.round((IMPACT[t.impact] * 10) / EFFORT[t.effort]) });
  const grid = latestRun(project.id, 'grid');
  const gbp = latestRun(project.id, 'gbp');
  const rev = latestRun(project.id, 'reviews');
  const audit = latestRun(project.id, 'audit');
  const ai = latestRun(project.id, 'ai');
  const org = latestRun(project.id, 'organic');
  const cit = latestRun(project.id, 'citations');

  if (!grid) add({ area: 'Maps', impact: 'high', effort: 'quick', title: 'Run your first map grid scan', detail: 'See exactly where you show up in the Google Maps 3-pack across your service area.', link: 'maps' });
  if (!audit && project.domain) add({ area: 'Website', impact: 'high', effort: 'quick', title: 'Run a site audit', detail: 'Crawl your site for technical, local and AI-readiness issues.', link: 'audit' });
  if (!ai) add({ area: 'AI search', impact: 'high', effort: 'quick', title: 'Check your AI visibility', detail: 'Find out whether AI assistants recommend you.', link: 'ai' });

  const GBP_FIX = { description: 'content?type=gbp_description', reviews: 'requests', review_gap: 'requests', rating: 'reviews' };
  if (gbp) for (const c of gbp.data.checks.filter(c => !c.pass)) add({ area: 'Google Business Profile', impact: c.weight >= 10 ? 'high' : c.weight >= 7 ? 'medium' : 'low', effort: 'quick', title: c.label, detail: c.fix, link: GBP_FIX[c.id] || 'gbp' });
  if (rev) {
    if (rev.data.unreplied > 0) add({ area: 'Reviews', impact: 'medium', effort: 'quick', title: `Reply to ${rev.data.unreplied} unanswered review(s)`, detail: 'One-click AI drafts in the Reviews tab. Replies signal activity and convert readers.', link: 'reviews' });
    if (rev.data.velocity90d < 6) add({ area: 'Reviews', impact: 'high', effort: 'moderate', title: 'Increase review velocity', detail: `Only ${rev.data.velocity90d} reviews in the last 90 days. Recency is a ranking and conversion factor - set up an automatic SMS/email review request after every job.`, link: 'requests' });
    const badTheme = (rev.data.themeStats || []).filter(t => t.avgSentiment !== null && t.avgSentiment < 0).sort((a, b) => a.avgSentiment - b.avgSentiment)[0];
    if (badTheme) add({ area: 'Reviews', impact: 'medium', effort: 'project', title: `Fix the "${badTheme.theme}" complaint pattern`, detail: `Customers mention it ${badTheme.mentions}x with negative sentiment. Operational fix > marketing fix.`, link: 'reviews' });
  }
  if (grid) {
    const m = grid.data.metrics;
    if (m.solv < 50) add({ area: 'Maps', impact: 'high', effort: 'project', title: `Grow 3-pack coverage for "${grid.data.config.keyword}" (now ${m.solv}%)`, detail: grid.data.insights.map(i => i.text).join(' '), link: 'maps' });
    const delta = grid.data.delta;
    if (delta && delta.solv < -10) add({ area: 'Maps', impact: 'high', effort: 'moderate', title: `Map visibility dropped ${Math.abs(delta.solv)} pts since last scan`, detail: 'Check for GBP edits/suspension, a new competitor, or lost reviews. Compare scans in the Maps tab.', link: 'maps' });
  }
  const AUDIT_FIX = { no_local_schema: 'content?type=schema', schema_incomplete: 'content?type=schema', no_llms_txt: 'content?type=llms_txt', no_faq: 'content?type=faq', no_description: 'content?type=meta', thin: 'content?type=service_page' };
  if (audit) for (const i of audit.data.issues.filter(i => i.severity !== 'notice' || AUDIT_FIX[i.id]).slice(0, 14)) add({ area: i.category === 'AI search' ? 'AI search' : 'Website', impact: i.severity === 'error' ? 'high' : 'medium', effort: i.category === 'Content' ? 'project' : i.count > 10 ? 'moderate' : 'quick', title: i.title + (i.count > 1 ? ` (${i.count})` : ''), detail: i.how, link: AUDIT_FIX[i.id] || 'audit' });
  if (ai) for (const r of ai.data.recommendations) add({ area: 'AI search', impact: ai.data.score < 40 ? 'high' : 'medium', effort: 'moderate', title: 'AI visibility: ' + r.split(/[.:]/)[0], detail: r, link: 'ai' });
  if (org) {
    const striking = org.data.rows.filter(r => r.position >= 4 && r.position <= 15).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 5);
    if (striking.length) add({ area: 'Organic', impact: 'high', effort: 'moderate', title: `Push ${striking.length} "striking distance" keywords onto page 1 / top 3`, detail: striking.map(r => `"${r.keyword}" (#${r.position})`).join(', ') + ' - improve those pages\' content depth, internal links and titles.', link: 'organic' });
  }
  if (cit) for (const d of cit.data.missing.slice(0, 6)) add({ area: 'Citations', impact: d.weight >= 7 ? 'high' : 'low', effort: 'quick', title: `Claim/create listing: ${d.name}`, detail: `Use identical name, address and phone as Google.${d.url ? ' ' + d.url : ''}`, link: 'citations' });
  else add({ area: 'Citations', impact: 'medium', effort: 'quick', title: 'Check your listings consistency', detail: 'Paste your directory profile URLs to verify name/address/phone match.', link: 'citations' });

  const la = latestRun(project.id, 'linkaudit'), gap = latestRun(project.id, 'gap'), tr = latestRun(project.id, 'traffic');
  const contacts = listContacts(project.id);
  if (!contacts.length) add({ area: 'Reviews', impact: 'high', effort: 'quick', title: 'Start sending review requests', detail: 'Text or email every customer a direct Google review link after each job. It\'s the most reliable way to grow reviews.', link: 'requests' });
  if (la?.data.counts.toxic) add({ area: 'Backlinks', impact: 'low', effort: 'quick', title: `Review ${la.data.counts.toxic} toxic backlinks`, detail: 'Check them and disavow only clear spam.', link: 'backlinks' });
  if (gap?.data.counts.missing) add({ area: 'Organic', impact: 'medium', effort: 'project', title: `${gap.data.counts.missing} keywords competitors rank for and you don't`, detail: 'Top missing: ' + gap.data.missing.slice(0, 4).map(k => `"${k.keyword}"`).join(', ') + '. Build or expand pages for them.', link: 'research' });
  if (org?.data.cannibalization?.length) add({ area: 'Organic', impact: 'medium', effort: 'moderate', title: `Fix keyword cannibalization on ${org.data.cannibalization.length} keyword(s)`, detail: 'Two of your pages compete for the same search. Merge them or point one to the other.', link: 'organic' });
  if (tr?.data.lowCtr?.length) add({ area: 'Organic', impact: 'medium', effort: 'quick', title: `Rewrite titles on ${tr.data.lowCtr.length} queries with low click-through`, detail: 'You rank top 5 but few people click: ' + tr.data.lowCtr.slice(0, 3).map(q => `"${q.key}"`).join(', '), link: 'traffic' });

  const seen = new Set();
  return tasks.filter(t => !seen.has(t.title) && seen.add(t.title)).sort((a, b) => b.priority - a.priority);
}

export function scorecard(project) {
  const g = latestRun(project.id, 'grid'), a = latestRun(project.id, 'audit'), ai = latestRun(project.id, 'ai'), gbp = latestRun(project.id, 'gbp'), org = latestRun(project.id, 'organic'), rev = latestRun(project.id, 'reviews'), cit = latestRun(project.id, 'citations');
  const parts = {
    maps: g ? g.data.metrics.visibility : null,
    gbp: gbp ? gbp.data.score : null,
    website: a ? a.data.health : null,
    ai: ai ? ai.data.score : null,
    organic: org ? org.data.visibility : null,
    citations: cit ? cit.data.score : null,
  };
  const weights = { maps: 0.28, gbp: 0.16, website: 0.16, ai: 0.16, organic: 0.14, citations: 0.1 };
  const have = Object.entries(parts).filter(([, v]) => v !== null);
  const wsum = have.reduce((s, [k]) => s + weights[k], 0);
  const overall = have.length ? Math.round(have.reduce((s, [k, v]) => s + v * weights[k], 0) / wsum) : null;
  const trend = listRuns(project.id, 'grid', 30).reverse().map(r => ({ t: r.createdAt, keyword: r.keyword, visibility: r.data.metrics.visibility, solv: r.data.metrics.solv, arp: r.data.metrics.arp }));
  return { overall, parts, rating: rev?.data.rating ?? gbp?.data.profile?.rating ?? null, reviews: rev?.data.total ?? gbp?.data.profile?.reviewCount ?? null, trend };
}

export async function narrative(project, tasks, card) {
  if (!aiAvailable()) return null;
  return generate('You are a blunt, practical local-SEO consultant writing for a busy small-business owner. Plain English, no jargon, no fluff.',
    `Business: ${project.name} (${project.category || ''}, ${project.city || ''}).\nScorecard (0-100): ${JSON.stringify(card.parts)}\nTop tasks: ${JSON.stringify(tasks.slice(0, 12).map(t => ({ area: t.area, title: t.title, detail: t.detail })))}\n\nWrite: (1) a 3-sentence diagnosis of what's holding them back, (2) a "this week" list of exactly 3 actions, (3) a "this month" list of 3 actions, (4) one sentence on what result to expect. Use Markdown headings and bullets. Under 250 words.`, { effort: 'medium' });
}
