import { fetchProfile } from './gbp.js';
import { aiAvailable, generateJSON } from '../providers/ai.js';
import { addRun } from '../store.js';

const NEG = /\b(rude|slow|never|worst|terrible|awful|scam|overcharg|late|ignored|unprofessional|didn'?t|won'?t|no one|nobody|waste|refund|higher than)\b/i;
const POS = /\b(great|excellent|amazing|fast|professional|recommend|helpful|kind|friendly|best|quick|honest|responsive|thank)\b/i;

export function sentiment(review) {
  let s = (review.rating - 3) / 2; // -1..1
  if (NEG.test(review.text)) s -= 0.3;
  if (POS.test(review.text)) s += 0.2;
  s = Math.max(-1, Math.min(1, s));
  return { score: +s.toFixed(2), label: s > 0.25 ? 'positive' : s < -0.15 ? 'negative' : 'neutral' };
}

const THEMES = {
  'Speed / responsiveness': /\b(fast|quick|slow|wait|respon|call back|answer|hours|minutes|late)/i,
  'Staff / service': /\b(staff|kind|rude|friendly|professional|helpful|team|polite)/i,
  'Price / fees': /\b(price|cost|fee|expensive|cheap|affordable|overcharg|quote)/i,
  'Communication': /\b(explain|communicat|clear|updated|informed|told)/i,
  'Trust / honesty': /\b(honest|trust|scam|fair|transparent)/i,
};

export function analyzeReviews(reviews) {
  const enriched = reviews.map(r => ({ ...r, sentiment: sentiment(r), themes: Object.entries(THEMES).filter(([, re]) => re.test(r.text)).map(([t]) => t) }));
  const themeStats = Object.keys(THEMES).map(t => {
    const rs = enriched.filter(r => r.themes.includes(t));
    return { theme: t, mentions: rs.length, avgSentiment: rs.length ? +(rs.reduce((a, r) => a + r.sentiment.score, 0) / rs.length).toFixed(2) : null };
  }).filter(t => t.mentions);
  const dist = [1, 2, 3, 4, 5].map(s => ({ stars: s, count: enriched.filter(r => r.rating === s).length }));
  const last90 = enriched.filter(r => r.time && Date.now() - new Date(r.time) < 90 * 86400000).length;
  const unreplied = enriched.filter(r => r.replied === false).length;
  return { reviews: enriched, themeStats, distribution: dist, velocity90d: last90, unreplied };
}

export async function reviewSnapshot(project) {
  const profile = await fetchProfile(project);
  const analysis = analyzeReviews(profile.reviews || []);
  return addRun(project.id, 'reviews', { rating: profile.rating, total: profile.reviewCount, ...analysis, source: profile.source });
}

/** Drafts on-brand review replies. Without AI, uses solid templates. */
export async function draftReplies(project, reviews, tone = 'warm and professional') {
  if (!aiAvailable()) return reviews.map(r => ({ id: r.id, reply: templateReply(project, r), source: 'template' }));
  const schema = { type: 'object', additionalProperties: false, required: ['replies'], properties: { replies: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'reply'], properties: { id: { type: 'string' }, reply: { type: 'string' } } } } } };
  const out = await generateJSON(
    `You write Google review replies for ${project.name}${project.city ? ' in ' + project.city : ''}. Tone: ${tone}. Rules: under 90 words; thank by first name; reference something specific in the review; for negative reviews apologize without admitting legal liability, take it offline with the business phone ${project.phone || ''}; naturally mention the service and city once where it reads naturally (helps local relevance) but never keyword-stuff; never invent facts; never reveal private customer details.`,
    `Write a reply for each review:\n${JSON.stringify(reviews.map(r => ({ id: r.id, author: r.author, rating: r.rating, text: r.text })))}`,
    schema, { effort: 'low' });
  return out.replies.map(r => ({ ...r, source: 'ai' }));
}

function templateReply(project, r) {
  const first = (r.author || '').split(' ')[0] || 'there';
  if (r.rating >= 4) return `Thank you so much, ${first}! We're glad we could help, and we really appreciate you taking the time to share your experience with ${project.name}.`;
  if (r.rating === 3) return `Thanks for the feedback, ${first}. We'd love to hear how we could have earned five stars - please reach out at ${project.phone || 'our office'}.`;
  return `${first}, we're sorry your experience fell short. This isn't the standard we hold ourselves to. Please call us at ${project.phone || 'our office'} so we can make it right.`;
}
