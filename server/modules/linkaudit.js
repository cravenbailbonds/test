// Backlink Audit: score every referring domain for toxicity and build a Google disavow file.
import { providerStatus } from '../config.js';
import * as dfs from '../providers/dataforseo.js';
import { rng } from '../lib/util.js';
import { addRun } from '../store.js';

const SPAM_TLDS = new Set(['xyz', 'top', 'click', 'loan', 'win', 'bid', 'work', 'party', 'review', 'stream', 'gq', 'ml', 'cf', 'tk', 'ga', 'cyou', 'icu', 'rest', 'buzz']);
const SPAM_ANCHOR = /\b(casino|poker|slots?|viagra|cialis|porn|xxx|escort|payday|loan|crypto|bitcoin|forex|replica|cheap pills|essay|betting|bet\b)/i;
// Match whole hostname parts ("free-seo-directory.xyz") or known compound spam names, never
// substrings of real brands ("linkedin.com" must not match "link").
const SPAM_TOKENS = new Set(['seo', 'backlink', 'backlinks', 'link', 'links', 'directory', 'submit', 'bookmark', 'bookmarks', 'webstats', 'ranker', 'freelinks']);
const SPAM_COMPOUND = /(webstats|statvoo|siteprice|websitevalue|linkbookmark|weblinks|seodirectory|freeseo|backlinkchecker|siteworth)/i;
const spamDomain = d => d.toLowerCase().split(/[.-]/).some(t => SPAM_TOKENS.has(t)) || SPAM_COMPOUND.test(d);

export function toxicity(link, brandTerms = []) {
  const reasons = [];
  let score = 0;
  if (link.spamScore != null) { score += link.spamScore * 0.6; if (link.spamScore >= 50) reasons.push(`spam score ${link.spamScore}`); }
  if (SPAM_TLDS.has(link.tld)) { score += 25; reasons.push(`.${link.tld} domain`); }
  if (SPAM_ANCHOR.test(link.anchor)) { score += 45; reasons.push('spammy anchor text'); }
  if (spamDomain(link.domainFrom)) { score += 20; reasons.push('link-directory / SEO-stats site'); }
  if ((link.authority ?? 0) <= 2) { score += 10; reasons.push('near-zero authority'); }
  const anchor = link.anchor.toLowerCase();
  const branded = brandTerms.some(t => t && anchor.includes(t));
  if (anchor.split(/\s+/).length >= 4 && !branded && !/https?:|www\./.test(anchor) && link.dofollow) { score += 8; reasons.push('exact-match commercial anchor'); }
  if (/\d{4,}/.test(link.domainFrom) || link.domainFrom.split('.').length > 4) { score += 10; reasons.push('auto-generated looking domain'); }
  score = Math.min(100, Math.round(score));
  return { score, level: score >= 60 ? 'toxic' : score >= 35 ? 'suspicious' : 'ok', reasons };
}

function demoLinks(domain) {
  const r = rng('ba|' + domain);
  const good = ['yelp.com', 'bbb.org', 'facebook.com', 'chamberofcommerce.com', 'local-news.com', 'nextdoor.com', 'mapquest.com', 'patch.com', 'cityguide.org', 'linkedin.com', 'yellowpages.com', 'manta.com'];
  const bad = ['free-seo-directory.xyz', 'webstatsdomain.org', 'casino-bonus-777.top', 'linkbookmark24.click', 'siteprice.org', 'best-payday-loans.win', 'a8273641.weblinks.biz', 'statvoo.com'];
  const anchors = ['Riverside', 'click here', 'website', 'best cheap online casino bonus', 'payday loan fast', 'https://' + domain, 'plumber in springfield', 'emergency plumber springfield ohio affordable'];
  return [...good, ...bad].map(d => ({
    domainFrom: d, urlFrom: `https://${d}/${Math.floor(r() * 9999)}`, urlTo: `https://${domain}/`,
    anchor: bad.includes(d) ? anchors[3 + Math.floor(r() * 2)] : anchors[Math.floor(r() * 3)] === 'Riverside' ? domain.split('.')[0] : anchors[[0, 1, 2, 5, 6][Math.floor(r() * 5)]],
    dofollow: r() > 0.3, spamScore: bad.includes(d) ? Math.round(40 + r() * 55) : Math.round(r() * 15),
    authority: bad.includes(d) ? Math.round(r() * 4) : Math.round(30 + r() * 60), tld: d.split('.').pop(),
  }));
}

export async function auditBacklinks(project) {
  if (!project.domain) throw new Error('Project has no domain');
  const live = providerStatus().dataforseo;
  const links = live ? await dfs.backlinkList(project.domain) : demoLinks(project.domain);
  const brand = [project.name, project.domain.split('.')[0]].map(s => (s || '').toLowerCase().split(/\s+/)[0]);
  const scored = links.map(l => ({ ...l, ...toxicity(l, brand) })).sort((a, b) => b.score - a.score);
  const counts = { toxic: scored.filter(l => l.level === 'toxic').length, suspicious: scored.filter(l => l.level === 'suspicious').length, ok: scored.filter(l => l.level === 'ok').length };
  const anchors = {};
  scored.forEach(l => { const a = (l.anchor || '(empty)').toLowerCase().slice(0, 60); anchors[a] = (anchors[a] || 0) + 1; });
  return addRun(project.id, 'linkaudit', { links: scored, counts, anchors: Object.entries(anchors).map(([anchor, n]) => ({ anchor, n })).sort((a, b) => b.n - a.n).slice(0, 15), source: live ? 'dataforseo' : 'demo' });
}

/** Google disavow file (https://search.google.com/search-console/disavow-links). */
export function disavowFile(domains, project) {
  return `# Disavow file for ${project.domain} generated ${new Date().toISOString().slice(0, 10)}\n# Review every line before uploading. Disavowing good links can hurt rankings.\n` + [...new Set(domains)].map(d => `domain:${d}`).join('\n') + '\n';
}
