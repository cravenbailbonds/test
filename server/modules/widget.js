// Embeddable reviews widget for the business's own website (iframe). Shows the most recent
// reviews whatever their rating: hiding negative reviews on your own site counts as review
// gating under Google's rules and the FTC's 2024 rule on consumer reviews.
import { latestRun } from '../store.js';
import { reviewUrl } from './reviewrequests.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function widgetHtml(project, params = new URLSearchParams()) {
  const run = latestRun(project.id, 'reviews');
  const d = run?.data || {};
  const limit = Math.min(10, Math.max(1, Number(params.get('n')) || 5));
  const dark = params.get('theme') === 'dark';
  const reviews = (d.reviews || []).filter(r => r.text).slice(0, limit);
  const stars = n => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));
  const googleLink = project.placeId && !project.placeId.startsWith('demo') ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(project.placeId)}` : `https://www.google.com/search?q=${encodeURIComponent(project.name + ' reviews')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(project.name)} reviews</title>
<style>:root{--bg:${dark ? '#1a1a19' : '#fff'};--fg:${dark ? '#f0efec' : '#111'};--mut:${dark ? '#a8a7a0' : '#666'};--bd:${dark ? '#33332f' : '#e5e5e0'};--star:#e0a100}
body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
.w{padding:14px;display:flex;flex-direction:column;gap:10px}.h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.big{font-size:28px;font-weight:700}.s{color:var(--star);letter-spacing:1px}
.r{border:1px solid var(--bd);border-radius:10px;padding:10px 12px}.a{font-weight:600}.m{color:var(--mut);font-size:12px}a{color:inherit}.btns{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-block;padding:7px 12px;border-radius:8px;border:1px solid var(--bd);text-decoration:none;font-weight:600}</style></head><body><div class="w">
<div class="h"><span class="big">${d.rating ?? '–'}</span><span class="s" aria-label="${d.rating} out of 5">${stars(d.rating)}</span><span class="m">${d.total ?? 0} Google reviews</span></div>
${reviews.map(r => `<div class="r"><div><span class="a">${esc(r.author || 'Customer')}</span> <span class="s">${stars(r.rating)}</span></div><div>${esc(r.text.length > 320 ? r.text.slice(0, 317) + '…' : r.text)}</div>${r.time ? `<div class="m">${new Date(r.time).toLocaleDateString()}</div>` : ''}</div>`).join('') || '<div class="m">No reviews yet.</div>'}
<div class="btns"><a class="btn" href="${esc(googleLink)}" target="_blank" rel="noopener">Read all reviews</a><a class="btn" href="${esc(reviewUrl(project))}" target="_blank" rel="noopener">Write a review</a></div>
<div class="m">Most recent reviews, shown unfiltered.</div></div></body></html>`;
}
