import { aiAvailable, generate, generateJSON } from '../providers/ai.js';

/** Fast, deterministic on-page content score for a draft against a target keyword. */
export function contentScore(text, keyword, { terms = [], city } = {}) {
  const t = text.toLowerCase(), kw = keyword.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+\s/).filter(s => s.trim());
  const avgSentence = words.length / Math.max(1, sentences.length);
  const kwCount = t.split(kw).length - 1;
  const density = words.length ? (kwCount * kw.split(/\s+/).length) / words.length : 0;
  const firstPara = t.slice(0, 600);
  const termHits = terms.filter(x => t.includes(x.toLowerCase()));
  const checks = [
    { label: 'Length 600+ words', pass: words.length >= 600, value: words.length },
    { label: 'Keyword used 2+ times', pass: kwCount >= 2, value: kwCount },
    { label: 'Keyword density 0.5-2.5%', pass: density >= 0.005 && density <= 0.025, value: (density * 100).toFixed(2) + '%' },
    { label: 'Keyword in first paragraph', pass: firstPara.includes(kw) },
    { label: 'Readable sentences (avg < 22 words)', pass: avgSentence < 22, value: avgSentence.toFixed(1) },
    { label: 'Uses headings', pass: /^#{1,3} |<h[23]/im.test(text) },
    { label: 'Has FAQ / questions', pass: /\?\s/.test(text) },
    { label: 'Call to action', pass: /\b(call|contact|book|schedule|get a quote|reach out)\b/i.test(text) },
  ];
  if (city) checks.push({ label: `Mentions ${city}`, pass: t.includes(city.toLowerCase().split(',')[0]) });
  if (terms.length) checks.push({ label: `Related terms covered (${termHits.length}/${terms.length})`, pass: termHits.length / terms.length >= 0.6, value: termHits.length });
  return { score: Math.round((100 * checks.filter(c => c.pass).length) / checks.length), checks, missingTerms: terms.filter(x => !termHits.includes(x)) };
}

const BRIEF = p => `Business: ${p.name}. Category: ${p.category || 'local business'}. City: ${p.city || ''}${p.state ? ', ' + p.state : ''}. Phone: ${p.phone || ''}. Website: ${p.domain || ''}.${p.about ? ' About: ' + p.about : ''}`;
const SYSTEM = 'You are an expert local SEO copywriter. Write helpful, specific, people-first content that is factually careful: never invent licenses, awards, prices, years in business or statistics that were not provided - use [placeholders] for facts the owner must fill in. Natural keyword use, no stuffing.';

export const CONTENT_TYPES = {
  gbp_post: { label: 'Google Business Profile post', prompt: (p, i) => `Write 3 alternative Google Business Profile "What's new" posts (each 150-280 characters, with a call to action) about: ${i.topic || 'our services'}. Target keyword: ${i.keyword || ''}. Separate them with ---.` },
  service_page: { label: 'Service / location landing page', prompt: (p, i) => `Write a complete landing page in Markdown targeting "${i.keyword}". Include: SEO title (<=60 chars) and meta description (<=155 chars) at top, H1, intro answering the searcher's need in the first 2 sentences, how it works, why choose us, service area (neighborhoods/nearby towns), pricing factors, 5-question FAQ, strong CTA with phone. ${i.topic ? 'Notes: ' + i.topic : ''}` },
  blog: { label: 'Blog article', prompt: (p, i) => `Write an 900-1200 word blog article in Markdown targeting "${i.keyword}". Answer the core question directly in the first paragraph (AI answer engines quote this), use H2s phrased as questions, include a short FAQ and a local CTA. ${i.topic ? 'Angle: ' + i.topic : ''}` },
  meta: { label: 'Title & meta descriptions', prompt: (p, i) => `Write 5 SEO title tag (<=60 chars) + meta description (140-155 chars) pairs for a page targeting "${i.keyword}". Include the city and a click-worthy hook. Number them.` },
  gbp_description: { label: 'GBP business description', prompt: (p, i) => `Write a Google Business Profile description (650-750 characters, no URLs, no phone numbers, no promotional ALL CAPS) covering services, area served and differentiators. ${i.topic || ''}` },
  faq: { label: 'FAQ + FAQPage schema', prompt: (p, i) => `Write 8 FAQs real customers ask about "${i.keyword || p.category}" in ${p.city}. Concise, quotable answers (40-70 words). Then output valid FAQPage JSON-LD in a \`\`\`json block.` },
  llms_txt: { label: 'llms.txt for AI engines', prompt: (p, i) => `Write an /llms.txt file (llmstxt.org format: H1 name, > summary blockquote, then sections with Markdown link lists) for this business so AI assistants understand who it is, what it offers, areas served and key pages on https://${p.domain}. Use [placeholders] for unknown URLs.` },
  schema: { label: 'LocalBusiness schema', prompt: (p, i) => `Output complete LocalBusiness JSON-LD (use the most specific schema.org subtype) for this business in a \`\`\`json block: name, url, telephone, address, geo (${p.lat}, ${p.lng}), openingHoursSpecification placeholder, areaServed, sameAs placeholders for Google Business Profile, Facebook, Yelp, BBB. Then 3 bullets on where to place it.` },
  review_request: { label: 'Review request messages', prompt: (p, i) => `Write a short SMS (<=300 chars) and a short email asking a satisfied customer for a Google review, including a [review link] placeholder. Friendly, compliant (no incentives, no review gating).` },
};

export async function generateContent(project, type, input = {}) {
  const t = CONTENT_TYPES[type]; if (!t) throw new Error('Unknown content type');
  if (!aiAvailable()) return { text: `DEMO MODE - add ANTHROPIC_API_KEY to generate real ${t.label.toLowerCase()} content.\n\nWhat you'd get: ${t.prompt(project, input)}`, source: 'demo' };
  const text = await generate(SYSTEM, `${BRIEF(project)}\n\nTask: ${t.prompt(project, input)}`, { effort: type === 'service_page' || type === 'blog' ? 'high' : 'medium' });
  const score = input.keyword ? contentScore(text, input.keyword, { city: project.city }) : null;
  return { text, score, source: 'ai' };
}

export async function suggestTerms(project, keyword) {
  if (!aiAvailable()) return ['cost', 'near me', 'how it works', 'reviews', 'licensed', 'same day', 'process', 'faq'].map(x => `${keyword.split(' ')[0]} ${x}`);
  const out = await generateJSON('You are an SEO content strategist.', `List 15 related terms/entities a top-ranking page about "${keyword}" in ${project.city || 'the US'} should cover.`, { type: 'object', additionalProperties: false, required: ['terms'], properties: { terms: { type: 'array', items: { type: 'string' } } } }, { effort: 'low' });
  return out.terms;
}
