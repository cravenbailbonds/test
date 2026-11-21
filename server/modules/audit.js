// Real site crawler + technical / on-page / local / AI-readiness audit. No API keys required.
import { config } from '../config.js';
import { fetchWithTimeout, normalizePhone, normalizeDomain } from '../lib/util.js';
import crypto from 'node:crypto';
import { addRun, latestRun } from '../store.js';
import { notify } from './notify.js';

const UA = 'Mozilla/5.0 (compatible; RankPilotAudit/1.0; +https://github.com/)';
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const strip = h => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null; };
function meta(html, key) {
  for (const t of html.match(/<meta\b[^>]*>/gi) || []) {
    const n = (attr(t, 'name') || attr(t, 'property') || '').toLowerCase();
    if (n === key) return attr(t, 'content');
  }
  return null;
}

function extraSignals(html, url) {
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
  const blockingScripts = (head.match(/<script\b[^>]*\bsrc=[^>]*>/gi) || []).filter(t => !/\b(async|defer)\b/i.test(t) && !/type\s*=\s*["']?module/i.test(t)).length;
  const blockingCss = (head.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi) || []).length;
  const imgsNoDims = (html.match(/<img\b[^>]*>/gi) || []).filter(t => !/\bwidth\s*=/.test(t) || !/\bheight\s*=/.test(t)).length;
  const hreflang = (html.match(/<link\b[^>]*hreflang[^>]*>/gi) || []).map(t => ({ lang: attr(t, 'hreflang'), href: attr(t, 'href') }));
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ href: attr('<a ' + m[1] + '>', 'href'), text: strip(m[2]), rel: attr('<a ' + m[1] + '>', 'rel') || '' }));
  const generic = anchors.filter(a => /^(click here|here|read more|more|learn more|this|link)$/i.test(a.text)).length;
  let host = ''; try { host = new URL(url).hostname; } catch { }
  const httpInternal = anchors.filter(a => a.href && a.href.startsWith('http://' + host)).length;
  const nofollowInternal = anchors.filter(a => /nofollow/i.test(a.rel) && a.href && (a.href.startsWith('/') || a.href.includes(host))).length;
  const text = strip(html);
  return {
    blockingScripts, blockingCss, imgsNoDims, hreflang, genericAnchors: generic, httpInternal, nofollowInternal, linkCount: anchors.length,
    favicon: /<link\b[^>]*rel\s*=\s*["']?[^"'>]*icon/i.test(head),
    metaRefresh: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(head),
    deprecated: /<(font|center|marquee|blink)\b/i.test(html),
    textRatio: html.length ? text.length / html.length : 0,
    bodyHash: text.length > 200 ? crypto.createHash('md5').update(text.slice(0, 5000)).digest('hex') : null,
    iframes: (html.match(/<iframe\b/gi) || []).length,
  };
}

export function parsePage(html, url) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1]));
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => strip(m[1]));
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["']?canonical[^>]*>/i) || [])[0];
  const imgs = (html.match(/<img\b[^>]*>/gi) || []).map(t => ({ src: attr(t, 'src'), alt: attr(t, 'alt') }));
  const links = [];
  for (const t of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(t, 'href'); if (!href || /^(#|javascript:|mailto:|data:)/i.test(href)) continue;
    if (/^tel:/i.test(href)) { links.push({ tel: href.slice(4) }); continue; }
    try { links.push({ href: new URL(href, url).href.split('#')[0], nofollow: /nofollow/i.test(attr(t, 'rel') || '') }); } catch { }
  }
  const jsonld = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); jsonld.push(...(Array.isArray(j) ? j : j['@graph'] || [j])); } catch { jsonld.push({ '@invalid': true }); }
  }
  const types = jsonld.flatMap(j => [].concat(j['@type'] || [])).map(String);
  const text = strip(html.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' '));
  const fullText = strip(html);
  return {
    title: title ? strip(title) : null,
    description: meta(html, 'description'),
    robots: meta(html, 'robots') || '',
    viewport: Boolean(meta(html, 'viewport')),
    ogTitle: meta(html, 'og:title'), ogImage: meta(html, 'og:image'),
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i) || [])[1] || null,
    canonical: canonicalTag ? (() => { try { return new URL(attr(canonicalTag, 'href'), url).href; } catch { return null; } })() : null,
    h1s, h2s, imgs, links, jsonld, schemaTypes: types,
    wordCount: text ? text.split(/\s+/).length : 0,
    text: fullText.slice(0, 20000),
    hasMapEmbed: /google\.com\/maps\/embed|maps\.google\.com\/maps\?|<iframe[^>]+maps/i.test(html),
    mixedContent: url.startsWith('https:') && /\b(src)\s*=\s*["']http:\/\//i.test(html),
    hasFaq: types.some(t => /FAQPage/i.test(t)) || /<(details|summary)\b/i.test(html) || /frequently asked/i.test(fullText),
    ...extraSignals(html, url),
  };
}

export async function fetchPage(url) {
  const t0 = Date.now();
  let res, redirects = 0, current = url;
  for (; redirects < 6; redirects++) {
    res = await fetchWithTimeout(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } }, 15000);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
    break;
  }
  const type = res.headers.get('content-type') || '';
  const body = type.includes('html') ? await res.text() : '';
  return { url, finalUrl: current, status: res.status, redirects, ms: Date.now() - t0, bytes: body.length, type, html: body, xRobots: res.headers.get('x-robots-tag') || '', encoding: res.headers.get('content-encoding') || '', hsts: Boolean(res.headers.get('strict-transport-security')) };
}

function robotsAllows(robotsTxt, agent, path = '/') {
  if (!robotsTxt) return true;
  const groups = []; let cur = null;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...v] = line.split(':'); const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') { if (!cur || cur.rules.length) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(val.toLowerCase()); }
    else if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const g = groups.find(g => g.agents.includes(agent.toLowerCase())) || groups.find(g => g.agents.includes('*'));
  if (!g) return true;
  let best = null;
  for (const r of g.rules) if (r.path && path.startsWith(r.path.replace(/\*$/, '')) && (!best || r.path.length > best.path.length)) best = r;
  return best ? best.allow : true;
}
export { robotsAllows };

export async function crawl(startUrl, maxPages = config.auditMaxPages, onProgress = () => { }) {
  const start = new URL(startUrl.includes('://') ? startUrl : 'https://' + startUrl);
  const host = start.hostname.replace(/^www\./, '');
  const queue = [start.href], seen = new Set(queue), pages = [], depth = new Map([[start.href, 0]]);
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, 6);
    const results = await Promise.all(batch.map(async u => {
      try { return await fetchPage(u); } catch (e) { return { url: u, status: 0, error: e.name === 'AbortError' ? 'timed out' : (e.cause?.code || e.cause?.message || e.message), html: '' }; }
    }));
    for (const r of results) {
      const parsed = r.html ? parsePage(r.html, r.finalUrl || r.url) : null;
      pages.push({ ...r, html: undefined, parsed, depth: depth.get(r.url) ?? 0 });
      if (parsed && r.status < 400 && !/noindex/i.test(parsed.robots)) {
        for (const l of parsed.links) {
          if (!l.href) continue;
          let u; try { u = new URL(l.href); } catch { continue; }
          if (u.hostname.replace(/^www\./, '') !== host || !/^https?:$/.test(u.protocol)) continue;
          if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?)$/i.test(u.pathname)) continue;
          u.hash = ''; const key = u.href;
          if (!seen.has(key) && seen.size < maxPages * 4) { seen.add(key); queue.push(key); depth.set(key, (depth.get(r.url) ?? 0) + 1); }
        }
      }
    }
    onProgress(pages.length);
  }
  // Status-check internal links we discovered but didn't crawl (broken link detection).
  const linkTargets = new Map();
  for (const p of pages) for (const l of p.parsed?.links || []) if (l.href && seen.has(l.href)) (linkTargets.get(l.href) || linkTargets.set(l.href, []).get(l.href)).push(p.url);
  const crawled = new Map(pages.map(p => [p.url, p.status]));
  const unchecked = [...linkTargets.keys()].filter(u => !crawled.has(u)).slice(0, 60);
  await Promise.all(unchecked.map(async u => {
    try { const r = await fetchWithTimeout(u, { method: 'HEAD', headers: { 'User-Agent': UA } }, 8000); crawled.set(u, r.status === 405 ? 200 : r.status); } catch { crawled.set(u, 0); }
  }));
  const broken = [...linkTargets.entries()].filter(([u]) => crawled.get(u) >= 400 || crawled.get(u) === 0).map(([u, from]) => ({ url: u, status: crawled.get(u), from: [...new Set(from)].slice(0, 5) }));

  const origin = start.origin;
  const [robots, sitemap, llms] = await Promise.all(['/robots.txt', '/sitemap.xml', '/llms.txt'].map(async p => {
    try { const r = await fetchWithTimeout(origin + p, { headers: { 'User-Agent': UA } }, 8000); return r.ok ? await r.text() : null; } catch { return null; }
  }));
  const sitemapUrls = sitemap ? [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1])).filter(u => !/\.xml$/i.test(u)).slice(0, 2000) : [];
  return { start: start.href, origin, host, pages, broken, robots, sitemap: sitemap && /<(urlset|sitemapindex)/i.test(sitemap) ? sitemap : (robots && /sitemap:/i.test(robots) ? 'declared-in-robots' : null), sitemapUrls, llms };
}

const SEV = { error: 10, warning: 4, notice: 1 };
const CHECK_COUNT = 61; // 58 crawl checks + 3 Core Web Vitals checks

export function analyze(crawlResult, project = {}) {
  const issues = [];
  const add = (id, severity, category, title, how, urls = []) => issues.push({ id, severity, category, title, how, count: urls.length || 1, urls: urls.slice(0, 50) });
  const html = crawlResult.pages.filter(p => p.parsed && p.status >= 200 && p.status < 300);
  const urlsWhere = fn => html.filter(fn).map(p => p.url);

  // --- Crawlability / technical
  const errs = crawlResult.pages.filter(p => p.status >= 400 || p.status === 0);
  if (errs.length) add('http_errors', 'error', 'Crawlability', 'Pages returning 4xx/5xx or failing to load', 'Fix or 301-redirect these URLs and update links pointing at them.', errs.map(p => `${p.url} (${p.status || p.error})`));
  if (crawlResult.broken.length) add('broken_links', 'error', 'Crawlability', 'Broken internal links', 'Update or remove links to these URLs.', crawlResult.broken.map(b => `${b.url} (${b.status || 'failed'}) linked from ${b.from[0]}`));
  const chains = crawlResult.pages.filter(p => p.redirects >= 2);
  if (chains.length) add('redirect_chains', 'warning', 'Crawlability', 'Redirect chains (2+ hops)', 'Point links straight at the final URL.', chains.map(p => p.url));
  if (!crawlResult.start.startsWith('https')) add('no_https', 'error', 'Security', 'Site not served over HTTPS', 'Install a TLS certificate and redirect all HTTP to HTTPS.');
  const mixed = urlsWhere(p => p.parsed.mixedContent);
  if (mixed.length) add('mixed_content', 'warning', 'Security', 'Mixed content (HTTP resources on HTTPS pages)', 'Load all images/scripts over HTTPS.', mixed);
  if (!crawlResult.robots) add('no_robots', 'notice', 'Crawlability', 'robots.txt missing', 'Add a robots.txt with a Sitemap: line.');
  if (!crawlResult.sitemap) add('no_sitemap', 'warning', 'Crawlability', 'XML sitemap not found', 'Publish /sitemap.xml and submit it in Google Search Console.');
  const slow = crawlResult.pages.filter(p => p.ms > 1500);
  if (slow.length) add('slow', 'warning', 'Performance', 'Slow server response (>1.5s)', 'Enable caching/CDN, optimize hosting, reduce server work.', slow.map(p => `${p.url} (${p.ms}ms)`));
  const heavy = html.filter(p => p.bytes > 400000);
  if (heavy.length) add('heavy_html', 'notice', 'Performance', 'Large HTML documents (>400KB)', 'Trim inline scripts/styles and page builder bloat.', heavy.map(p => p.url));
  const noindex = urlsWhere(p => /noindex/i.test(p.parsed.robots + p.xRobots));
  if (noindex.length) add('noindex', 'notice', 'Indexability', 'Pages set to noindex', 'Confirm each is intentional - noindexed pages cannot rank.', noindex);
  const noVp = urlsWhere(p => !p.parsed.viewport);
  if (noVp.length) add('no_viewport', 'error', 'Mobile', 'Missing mobile viewport tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', noVp);
  const noLang = urlsWhere(p => !p.parsed.lang);
  if (noLang.length) add('no_lang', 'notice', 'Accessibility', 'Missing <html lang>', 'Add lang="en" (or your language) to the <html> tag.', noLang);
  const canonOff = urlsWhere(p => p.parsed.canonical && normalizeDomain(p.parsed.canonical) !== normalizeDomain(p.url));
  if (canonOff.length) add('canonical_offsite', 'warning', 'Indexability', 'Canonical points to another domain', 'Canonical should reference this site unless deliberately syndicated.', canonOff);
  const noCanon = urlsWhere(p => !p.parsed.canonical);
  if (noCanon.length) add('no_canonical', 'notice', 'Indexability', 'No canonical tag', 'Add a self-referencing canonical to prevent duplicate-URL dilution.', noCanon);

  // --- On-page
  const noTitle = urlsWhere(p => !p.parsed.title);
  if (noTitle.length) add('no_title', 'error', 'On-page', 'Missing <title>', 'Write a unique title: Primary Service + City | Brand (50-60 chars).', noTitle);
  const longT = urlsWhere(p => p.parsed.title && p.parsed.title.length > 60);
  if (longT.length) add('long_title', 'notice', 'On-page', 'Title longer than 60 characters (truncated in results)', 'Front-load the keyword and shorten.', longT);
  const shortT = urlsWhere(p => p.parsed.title && p.parsed.title.length < 25);
  if (shortT.length) add('short_title', 'warning', 'On-page', 'Title too short (<25 chars)', 'Use the space to include service + location.', shortT);
  const dupe = (key) => { const m = new Map(); html.forEach(p => { const v = p.parsed[key]; if (v) (m.get(v) || m.set(v, []).get(v)).push(p.url); }); return [...m.values()].filter(a => a.length > 1).flat(); };
  const dT = dupe('title'); if (dT.length) add('dup_title', 'warning', 'On-page', 'Duplicate titles', 'Every page needs a unique title describing that page.', dT);
  const noDesc = urlsWhere(p => !p.parsed.description);
  if (noDesc.length) add('no_description', 'warning', 'On-page', 'Missing meta description', 'Write a 140-160 char description with a call to action and phone/city.', noDesc);
  const dD = dupe('description'); if (dD.length) add('dup_description', 'notice', 'On-page', 'Duplicate meta descriptions', 'Make each description specific to the page.', dD);
  const noH1 = urlsWhere(p => !p.parsed.h1s.length);
  if (noH1.length) add('no_h1', 'warning', 'On-page', 'Missing H1', 'Add one H1 that states the page topic.', noH1);
  const multiH1 = urlsWhere(p => p.parsed.h1s.length > 1);
  if (multiH1.length) add('multi_h1', 'notice', 'On-page', 'Multiple H1s', 'Use a single H1; demote the rest to H2.', multiH1);
  const thin = urlsWhere(p => p.parsed.wordCount < 250 && !/noindex/i.test(p.parsed.robots));
  if (thin.length) add('thin', 'warning', 'Content', 'Thin content (<250 words)', 'Expand with genuinely useful detail: process, pricing factors, FAQs, service area, proof.', thin);
  const noAlt = html.filter(p => p.parsed.imgs.some(i => i.alt === null)).map(p => `${p.url} (${p.parsed.imgs.filter(i => i.alt === null).length} images)`);
  if (noAlt.length) add('img_alt', 'warning', 'Accessibility', 'Images missing alt text', 'Describe each image; include location naturally where accurate.', noAlt);
  const noOg = urlsWhere(p => !p.parsed.ogTitle || !p.parsed.ogImage);
  if (noOg.length) add('no_og', 'notice', 'Social', 'Missing Open Graph tags', 'Add og:title and og:image for better link previews.', noOg);
  // internal link depth / orphan-ish pages
  const inbound = new Map(html.map(p => [p.url, 0]));
  html.forEach(p => p.parsed.links.forEach(l => l.href && inbound.has(l.href) && l.href !== p.url && inbound.set(l.href, inbound.get(l.href) + 1)));
  const weak = [...inbound.entries()].filter(([u, n]) => n <= 1 && u !== crawlResult.start).map(([u]) => u);
  if (weak.length) add('weak_internal', 'notice', 'Internal linking', 'Pages with 0-1 internal links pointing to them', 'Link to these from relevant pages/nav so they get crawled and pass authority.', weak);

  // --- Local SEO (things generic SEO tools skip)
  const allText = html.map(p => p.parsed.text).join(' ');
  const schemaTypes = new Set(html.flatMap(p => p.parsed.schemaTypes));
  const localTypes = [...schemaTypes].filter(t => /LocalBusiness|Organization|Store|Service|Professional|Attorney|Dentist|Restaurant|Plumber|Electrician|RealEstate|Insurance|Legal|HomeAndConstruction|Contractor|Bail/i.test(t));
  if (!localTypes.length) add('no_local_schema', 'error', 'Local SEO', 'No LocalBusiness structured data', 'Add LocalBusiness JSON-LD (name, address, phone, geo, hours, sameAs links to GBP/Yelp/Facebook) on the homepage and location pages.');
  if ([...schemaTypes].includes('@invalid') || html.some(p => p.parsed.jsonld.some(j => j['@invalid']))) add('bad_schema', 'error', 'Local SEO', 'Invalid JSON-LD (fails to parse)', 'Fix syntax errors in structured data - validate with Google Rich Results Test.');
  if (project.phone) {
    const ph = normalizePhone(project.phone);
    const phones = [...new Set((allText.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) || []).map(normalizePhone))];
    if (!phones.includes(ph)) add('nap_phone', 'error', 'Local SEO', `Your phone (${project.phone}) does not appear on the site`, 'Show the exact same phone as your Google Business Profile in the header/footer of every page.');
    const others = phones.filter(p => p !== ph && p.length === 10);
    if (others.length) add('nap_phone_other', 'notice', 'Local SEO', `Other phone numbers found: ${others.slice(0, 3).join(', ')}`, 'Inconsistent phone numbers weaken NAP consistency - use one primary number (call tracking numbers should be secondary in schema).');
  }
  if (project.city && !new RegExp(project.city.split(',')[0], 'i').test(allText)) add('no_city', 'warning', 'Local SEO', `City "${project.city}" not mentioned in site content`, 'Mention your city and the neighborhoods you serve naturally in headings and body copy.');
  const telLinks = html.some(p => p.parsed.links.some(l => l.tel));
  if (!telLinks) add('no_click_to_call', 'warning', 'Local SEO', 'No click-to-call (tel:) links', 'Wrap phone numbers in <a href="tel:...">  - most local searches are mobile.');
  if (!html.some(p => p.parsed.hasMapEmbed)) add('no_map', 'notice', 'Local SEO', 'No embedded Google Map', 'Embed your GBP map on the contact/location page.');
  const homeTitle = html[0]?.parsed.title || '';
  if (project.city && homeTitle && !new RegExp(project.city.split(',')[0], 'i').test(homeTitle)) add('home_title_city', 'warning', 'Local SEO', 'Homepage title does not include your city', `e.g. "${project.category || 'Service'} in ${project.city.split(',')[0]} | ${project.name}"`);

  // --- AI search readiness (generative engine optimization)
  const blocked = AI_BOTS.filter(b => !robotsAllows(crawlResult.robots, b, '/'));
  if (blocked.length) add('ai_blocked', 'error', 'AI search', `AI crawlers blocked in robots.txt: ${blocked.join(', ')}`, 'Allow the AI search crawlers you want to be cited by (OAI-SearchBot, Claude-SearchBot, PerplexityBot at minimum).');
  if (!crawlResult.llms) add('no_llms_txt', 'notice', 'AI search', 'No /llms.txt', 'Publish an llms.txt summarizing who you are, services, areas served and key URLs - generated for you in the Content tab.');
  if (!html.some(p => p.parsed.hasFaq)) add('no_faq', 'warning', 'AI search', 'No FAQ content', 'AI answers quote concise Q&A. Add an FAQ section (with FAQPage schema) answering real customer questions.');
  if (!html.some(p => p.parsed.jsonld.some(j => j.sameAs))) add('no_sameas', 'warning', 'AI search', 'No sameAs entity links in schema', 'List your GBP, Yelp, Facebook, LinkedIn, BBB URLs in schema sameAs so AI systems connect your entity.');

  // --- Performance & UX
  const blocking = html.filter(p => p.parsed.blockingScripts >= 3).map(p => `${p.url} (${p.parsed.blockingScripts} scripts)`);
  if (blocking.length) add('render_blocking', 'warning', 'Performance', 'Render-blocking scripts in <head>', 'Add defer/async to scripts or move them before </body>; this delays first paint.', blocking);
  const noDims = html.filter(p => p.parsed.imgsNoDims >= 3).map(p => `${p.url} (${p.parsed.imgsNoDims} images)`);
  if (noDims.length) add('img_dims', 'notice', 'Performance', 'Images without width/height (layout shift)', 'Set width and height attributes so the page does not jump while loading (CLS).', noDims);
  const uncompressed = html.filter(p => p.bytes > 20000 && !p.encoding).map(p => p.url);
  if (uncompressed.length) add('no_compression', 'warning', 'Performance', 'HTML served without compression', 'Enable gzip or Brotli on your server/CDN.', uncompressed);
  if (crawlResult.start.startsWith('https') && html[0] && !html[0].hsts) add('no_hsts', 'notice', 'Security', 'No HSTS header', 'Add Strict-Transport-Security so browsers always use HTTPS.');
  const lowRatio = urlsWhere(p => p.parsed.textRatio < 0.08 && p.parsed.wordCount < 400);
  if (lowRatio.length) add('text_ratio', 'notice', 'Content', 'Low text-to-HTML ratio (heavy code, little content)', 'Pages built mostly from scripts or page-builder markup may not render content for crawlers - make sure key text is in the HTML.', lowRatio);
  // --- Crawlability extras
  const deep = crawlResult.pages.filter(p => p.depth > 3).map(p => `${p.url} (depth ${p.depth})`);
  if (deep.length) add('deep_pages', 'notice', 'Internal linking', 'Pages more than 3 clicks from the homepage', 'Link important pages from the homepage or navigation.', deep);
  const refresh = urlsWhere(p => p.parsed.metaRefresh);
  if (refresh.length) add('meta_refresh', 'warning', 'Crawlability', 'Meta refresh redirects', 'Replace with a server-side 301 redirect.', refresh);
  const httpLinks = urlsWhere(p => p.parsed.httpInternal > 0);
  if (httpLinks.length) add('http_links', 'warning', 'Security', 'Internal links pointing to HTTP', 'Update links to the HTTPS version to avoid redirects and mixed content.', httpLinks);
  const nfInt = urlsWhere(p => p.parsed.nofollowInternal > 0);
  if (nfInt.length) add('nofollow_internal', 'notice', 'Internal linking', 'Nofollow on internal links', 'Remove rel="nofollow" from links to your own pages.', nfInt);
  const manyLinks = urlsWhere(p => p.parsed.linkCount > 250);
  if (manyLinks.length) add('too_many_links', 'notice', 'Internal linking', 'More than 250 links on a page', 'Trim navigation and footers to focus link equity.', manyLinks);
  const badUrls = crawlResult.pages.map(p => p.url).filter(u => { try { const x = new URL(u); return /[A-Z_]/.test(x.pathname) || u.length > 115 || x.search; } catch { return false; } });
  if (badUrls.length) add('url_format', 'notice', 'Crawlability', 'URLs with uppercase, underscores, parameters or >115 characters', 'Use short, lowercase, hyphenated URLs.', badUrls);
  const canonBroken = html.filter(p => p.parsed.canonical && crawlResult.pages.some(q => q.url === p.parsed.canonical && q.status >= 400)).map(p => p.url);
  if (canonBroken.length) add('canonical_broken', 'error', 'Indexability', 'Canonical points to a broken page', 'Point the canonical at a live 200 URL.', canonBroken);
  // hreflang
  const hrefBad = html.filter(p => p.parsed.hreflang.length && (p.parsed.hreflang.some(h => !/^([a-z]{2,3}(-[a-z0-9]{2,4})?|x-default)$/i.test(h.lang || '')) || !p.parsed.hreflang.some(h => { try { return new URL(h.href, p.url).href === p.url; } catch { return false; } }))).map(p => p.url);
  if (hrefBad.length) add('hreflang', 'warning', 'Indexability', 'hreflang errors (invalid code or missing self-reference)', 'Use valid ISO codes and include a self-referencing hreflang on every language version.', hrefBad);
  // sitemap consistency
  if (crawlResult.sitemapUrls?.length) {
    const crawledSet = new Map(crawlResult.pages.map(p => [p.url.replace(/\/$/, ''), p]));
    const inSitemapBad = crawlResult.sitemapUrls.map(u => crawledSet.get(u.replace(/\/$/, ''))).filter(p => p && (p.status >= 300 || /noindex/i.test(p.parsed?.robots || ''))).map(p => `${p.url} (${p.status >= 300 ? p.status : 'noindex'})`);
    if (inSitemapBad.length) add('sitemap_bad', 'warning', 'Crawlability', 'Sitemap lists redirected, broken or noindex URLs', 'Only list live, indexable, canonical URLs in your sitemap.', inSitemapBad);
    const smSet = new Set(crawlResult.sitemapUrls.map(u => u.replace(/\/$/, '')));
    const notIn = html.filter(p => !/noindex/i.test(p.parsed.robots) && !smSet.has(p.url.replace(/\/$/, ''))).map(p => p.url);
    if (notIn.length && notIn.length < html.length) add('not_in_sitemap', 'notice', 'Crawlability', 'Indexable pages missing from the sitemap', 'Add these pages to sitemap.xml.', notIn);
  }
  // duplicate content
  const byHash = new Map(); html.forEach(p => { if (p.parsed.bodyHash) (byHash.get(p.parsed.bodyHash) || byHash.set(p.parsed.bodyHash, []).get(p.parsed.bodyHash)).push(p.url); });
  const dupBodies = [...byHash.values()].filter(a => a.length > 1).flat();
  if (dupBodies.length) add('dup_content', 'warning', 'Content', 'Duplicate page content', 'Consolidate duplicates with a 301 or canonical, or make each page unique (common with copy-pasted city pages).', dupBodies);
  const generic = urlsWhere(p => p.parsed.genericAnchors > 0);
  if (generic.length) add('generic_anchor', 'notice', 'On-page', 'Non-descriptive link text ("click here", "read more")', 'Describe the destination in the link text.', generic);
  const deprecated = urlsWhere(p => p.parsed.deprecated);
  if (deprecated.length) add('deprecated_html', 'notice', 'On-page', 'Deprecated HTML tags (<font>, <center>, <marquee>)', 'Replace with CSS.', deprecated);
  if (html[0] && !html[0].parsed.favicon) add('no_favicon', 'notice', 'On-page', 'No favicon', 'Add a favicon - it shows next to your result on mobile Google.');
  // Local schema quality
  const lb = html.flatMap(p => p.parsed.jsonld).filter(j => [].concat(j['@type'] || []).some(t => /LocalBusiness|Organization|Store|Service|Professional|Plumber|Attorney|Dentist|Electrician|Bail|Contractor/i.test(t)));
  if (lb.length) {
    const missing = ['address', 'telephone', 'openingHoursSpecification', 'geo', 'url', 'image'].filter(k => !lb.some(j => j[k] || (k === 'openingHoursSpecification' && j.openingHours)));
    if (missing.length) add('schema_incomplete', 'warning', 'Local SEO', `LocalBusiness schema missing: ${missing.join(', ')}`, 'Complete these properties so Google and AI systems can trust your business details.');
  }

  // Health score: weighted penalty normalised by site size.
  const penalty = issues.reduce((a, i) => a + SEV[i.severity] * Math.min(1, i.count / Math.max(1, html.length)) * (i.count > 1 ? 1 : 0.8), 0);
  const health = Math.round(100 * Math.exp(-penalty / 40)); // smooth decay: never negative, still separates bad from terrible
  const byCategory = {};
  for (const i of issues) { byCategory[i.category] ||= { error: 0, warning: 0, notice: 0 }; byCategory[i.category][i.severity]++; }
  issues.sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.count - a.count);
  const themes = {};
  for (const i of issues) themes[i.category] = (themes[i.category] || 0) + SEV[i.severity] * Math.min(1, i.count / Math.max(1, html.length)) * (i.count > 1 ? 1 : 0.8);
  const themeScores = Object.fromEntries(['Crawlability', 'Indexability', 'On-page', 'Content', 'Performance', 'Security', 'Mobile', 'Internal linking', 'Local SEO', 'AI search', 'Accessibility', 'Social'].map(c => [c, Math.round(100 * Math.exp(-(themes[c] || 0) / 15))]));
  return {
    health, pagesCrawled: crawlResult.pages.length, issues, byCategory, themeScores, checksRun: CHECK_COUNT,
    counts: { error: issues.filter(i => i.severity === 'error').length, warning: issues.filter(i => i.severity === 'warning').length, notice: issues.filter(i => i.severity === 'notice').length },
    aiBotsBlocked: blocked, schemaTypes: [...schemaTypes].filter(t => t !== '@invalid'), hasLlmsTxt: Boolean(crawlResult.llms),
    pages: crawlResult.pages.map(p => ({ url: p.url, status: p.status, ms: p.ms, title: p.parsed?.title, words: p.parsed?.wordCount, h1: p.parsed?.h1s?.[0] })),
  };
}

export async function runAudit(project, { url, maxPages } = {}) {
  const target = url || project.domain;
  if (!target) throw new Error('Project has no website/domain');
  const c = await crawl(target, Math.min(500, Number(maxPages) || config.auditMaxPages));
  if (!c.pages.some(p => p.status >= 200 && p.status < 300)) throw new Error(`Could not reach ${target} (${c.pages[0]?.error || 'HTTP ' + c.pages[0]?.status}). Check the domain is correct and the site is online.`);
  const result = analyze(c, project);
  result.vitals = await coreWebVitals(c.start).catch(e => ({ error: e.message }));
  if (result.vitals?.mobile) {
    const v = result.vitals.mobile;
    if (v.lcp > 4000) result.issues.unshift({ id: 'cwv_lcp', severity: 'error', category: 'Performance', title: `Slow Largest Contentful Paint on mobile (${(v.lcp / 1000).toFixed(1)}s)`, how: 'Compress and properly size the hero image, preload it, reduce server time and render-blocking resources. Target < 2.5s.', count: 1, urls: [c.start] });
    else if (v.lcp > 2500) result.issues.push({ id: 'cwv_lcp', severity: 'warning', category: 'Performance', title: `LCP needs improvement on mobile (${(v.lcp / 1000).toFixed(1)}s)`, how: 'Target under 2.5s: optimize the largest above-the-fold image or text block.', count: 1, urls: [c.start] });
    if (v.cls > 0.25) result.issues.push({ id: 'cwv_cls', severity: 'warning', category: 'Performance', title: `High layout shift (CLS ${v.cls})`, how: 'Reserve space for images, ads and embeds; avoid inserting content above existing content.', count: 1, urls: [c.start] });
    if (v.score != null && v.score < 50) result.issues.push({ id: 'cwv_score', severity: 'warning', category: 'Performance', title: `Mobile PageSpeed score ${v.score}/100`, how: 'Follow the PageSpeed Insights opportunities for your homepage.', count: 1, urls: [c.start] });
  }
  const prev = latestRun(project.id, 'audit');
  if (prev && prev.data.health - result.health >= 8) await notify(project.id, 'audit_drop', `Site health dropped from ${prev.data.health} to ${result.health}`, 'New technical issues were found on your website.', 'audit', { email: true });
  return addRun(project.id, 'audit', result, { source: 'crawler' });
}

/** Core Web Vitals + Lighthouse score for the homepage via Google PageSpeed Insights (mobile). */
export async function coreWebVitals(url) {
  const q = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' });
  if (config.pagespeedKey) q.set('key', config.pagespeedKey);
  const res = await fetchWithTimeout('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + q, {}, 60000);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || 'PageSpeed failed');
  const a = j.lighthouseResult?.audits || {}, field = j.loadingExperience?.metrics || {};
  return { mobile: {
    score: j.lighthouseResult?.categories?.performance?.score != null ? Math.round(j.lighthouseResult.categories.performance.score * 100) : null,
    lcp: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? Math.round(a['largest-contentful-paint']?.numericValue ?? 0),
    cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : +(a['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3),
    inp: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, fieldData: Boolean(field.LARGEST_CONTENTFUL_PAINT_MS),
  } };
}
