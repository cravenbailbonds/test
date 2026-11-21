import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, providerStatus, ROOT } from './config.js';
import * as store from './store.js';
import * as places from './providers/places.js';
import { runGridScan } from './modules/maprank.js';
import { auditProfile } from './modules/gbp.js';
import { reviewSnapshot, draftReplies } from './modules/reviews.js';
import { runAudit } from './modules/audit.js';
import { research, trackOrganic, backlinkProfile } from './modules/keywords.js';
import { runAiVisibility, defaultPrompts } from './modules/aivisibility.js';
import { generateContent, contentScore, suggestTerms, CONTENT_TYPES } from './modules/content.js';
import { scanCitations, DIRECTORIES } from './modules/citations.js';
import { buildPlan, scorecard, narrative } from './modules/actionplan.js';
import { startScheduler } from './scheduler.js';
import { addCustomers, sendRequest, recordClick, requestStats, DEFAULT_SMS, DEFAULT_EMAIL, DEFAULT_EMAIL_SUBJECT } from './modules/reviewrequests.js';
import { domainOverview, keywordGap } from './modules/research.js';
import { auditBacklinks, disavowFile } from './modules/linkaudit.js';
import { buildBrief } from './modules/brief.js';
import { trafficInsights } from './modules/traffic.js';
import { reportBundle, newShare, bundleForShare, emailReport } from './modules/reports.js';
import { ENGINES } from './providers/engines.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

function project(params) { const p = store.getProject(params.pid); if (!p) throw Object.assign(new Error('Project not found'), { status: 404 }); return p; }
const slim = run => run && ({ ...run, data: run.type === 'grid' ? { ...run.data, points: run.data.points.map(p => ({ ...p, results: p.results.slice(0, 3) })) } : run.data });

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/status', () => ({ providers: providerStatus(), model: config.anthropicModel, engines: Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, { label: e.label, live: e.available() }])), contentTypes: Object.fromEntries(Object.entries(CONTENT_TYPES).map(([k, v]) => [k, v.label])) }));
route('GET', '/api/places/search', async (_, q) => {
  if (!providerStatus().places) return { results: [], note: 'Add GOOGLE_PLACES_API_KEY to search Google for your business.' };
  return { results: await places.findBusiness(q.get('q') || '') };
});

route('GET', '/api/projects', () => store.listProjects().map(p => ({ ...p, scorecard: scorecard(p) })));
route('POST', '/api/projects', (_, __, body) => {
  if (!body.name) throw Object.assign(new Error('name is required'), { status: 400 });
  const p = store.createProject(clean(body));
  if (!p.aiPrompts?.length) store.updateProject(p.id, { aiPrompts: defaultPrompts(p) });
  return store.getProject(p.id);
});
route('GET', '/api/projects/:pid', (p) => ({ ...project(p), scorecard: scorecard(project(p)) }));
route('PUT', '/api/projects/:pid', (p, _, body) => store.updateProject(project(p).id, clean(body)));
route('DELETE', '/api/projects/:pid', (p) => { store.deleteProject(project(p).id); return { ok: true }; });

route('GET', '/api/projects/:pid/runs', (p, q) => store.listRuns(project(p).id, q.get('type'), Number(q.get('limit') || 30)).map(r => ({ id: r.id, type: r.type, createdAt: r.createdAt, keyword: r.keyword, source: r.source || r.data.source, summary: summary(r) })));
route('GET', '/api/runs/:rid', (p) => { const r = store.getRun(p.rid); if (!r) throw Object.assign(new Error('Run not found'), { status: 404 }); return r; });
route('GET', '/api/projects/:pid/latest/:type', (p, q) => slim(store.latestRun(project(p).id, p.type, q.get('keyword') ? r => r.keyword === q.get('keyword').toLowerCase() : undefined)));

route('POST', '/api/projects/:pid/grid', (p, _, b) => runGridScan(project(p), b));
route('POST', '/api/projects/:pid/gbp', (p) => auditProfile(project(p)));
route('POST', '/api/projects/:pid/reviews', (p) => reviewSnapshot(project(p)));
route('POST', '/api/projects/:pid/reviews/replies', (p, _, b) => draftReplies(project(p), b.reviews || [], b.tone));
route('POST', '/api/projects/:pid/audit', (p, _, b) => runAudit(project(p), b));
route('POST', '/api/projects/:pid/keywords', (p, _, b) => research(project(p), b.seed, b.location));
route('POST', '/api/projects/:pid/organic', (p) => trackOrganic(project(p)));
route('POST', '/api/projects/:pid/backlinks', (p, _, b) => backlinkProfile(project(p), b.compare || []));
route('POST', '/api/projects/:pid/ai', (p, _, b) => runAiVisibility(project(p), b.prompts, b.engines));
route('POST', '/api/projects/:pid/content', (p, _, b) => generateContent(project(p), b.type, b));
route('POST', '/api/projects/:pid/content/score', (p, _, b) => contentScore(b.text || '', b.keyword || '', { city: project(p).city, terms: b.terms || [] }));
route('POST', '/api/projects/:pid/content/terms', async (p, _, b) => ({ terms: await suggestTerms(project(p), b.keyword || '') }));
route('GET', '/api/directories', () => DIRECTORIES);
route('POST', '/api/projects/:pid/citations', (p, _, b) => { const pr = project(p); store.updateProject(pr.id, { listings: b.listings || [] }); return scanCitations(pr, b.listings || []); });
// --- Alerts & settings
route('GET', '/api/alerts', (_, q) => store.listAlerts(q.get('pid')).slice(0, 100));
route('POST', '/api/alerts/read', (_, q) => { store.markAlertsRead(q.get('pid')); return { ok: true }; });
route('GET', '/api/settings', () => store.getSettings());
route('PUT', '/api/settings', (_, __, b) => store.updateSettings({ branding: { agencyName: String(b.branding?.agencyName || '').slice(0, 80), logoUrl: String(b.branding?.logoUrl || '').slice(0, 500), color: /^#[0-9a-f]{6}$/i.test(b.branding?.color || '') ? b.branding.color : '' }, alertEmail: String(b.alertEmail || '').trim() }));

// --- Review requests
route('GET', '/api/projects/:pid/requests', (p) => { const pr = project(p); return { contacts: store.listContacts(pr.id), stats: requestStats(pr), templates: { sms: pr.reviewSms || DEFAULT_SMS, email: pr.reviewEmail || DEFAULT_EMAIL, emailSubject: pr.reviewEmailSubject || DEFAULT_EMAIL_SUBJECT } }; });
route('POST', '/api/projects/:pid/requests', async (p, _, b, req) => {
  const pr = project(p);
  const added = addCustomers(pr, b.customers || [], { delayHours: Number(b.delayHours) || 0 });
  if (!(Number(b.delayHours) > 0)) for (const c of added) await sendRequest(pr, c, { base: baseUrl(req) });
  return { added: added.length };
});
route('POST', '/api/projects/:pid/requests/:cid/send', (p, _, __, req) => { const pr = project(p); const c = store.getContact(p.cid); if (!c || c.projectId !== pr.id) throw Object.assign(new Error('Not found'), { status: 404 }); return sendRequest(pr, c, { base: baseUrl(req) }); });
route('DELETE', '/api/projects/:pid/requests/:cid', (p) => { const c = store.getContact(p.cid); if (c?.projectId === project(p).id) store.deleteContact(c.id); return { ok: true }; });

// --- Competitor research, backlink audit, briefs, traffic
route('POST', '/api/projects/:pid/domain', (p, _, b) => domainOverview(project(p), b.domain));
route('POST', '/api/projects/:pid/gap', (p, _, b) => keywordGap(project(p), b.competitors || project(p).competitors || []));
route('POST', '/api/projects/:pid/linkaudit', (p) => auditBacklinks(project(p)));
route('POST', '/api/projects/:pid/disavow', (p, _, b) => ({ __text: disavowFile(b.domains || [], project(p)), __name: 'disavow.txt' }));
route('POST', '/api/projects/:pid/brief', (p, _, b) => buildBrief(project(p), b.keyword));
route('POST', '/api/projects/:pid/traffic', (p) => trafficInsights(project(p)));

// --- Reports, sharing, email
route('GET', '/api/projects/:pid/report', (p) => reportBundle(project(p)));
route('POST', '/api/projects/:pid/share', (p, _, __, req) => newShare(project(p), baseUrl(req)));
route('DELETE', '/api/projects/:pid/share', (p) => { store.revokeShares(project(p).id); return { ok: true }; });
route('POST', '/api/projects/:pid/report/email', (p, _, b, req) => emailReport(project(p), String(b.to || '').trim(), baseUrl(req)));
route('GET', '/api/share/:token', (p) => { const b = bundleForShare(p.token); if (!b) throw Object.assign(new Error('This report link has expired or was revoked.'), { status: 404 }); return b; });

route('GET', '/api/projects/:pid/plan', async (p, q) => {
  const pr = project(p); const tasks = buildPlan(pr); const card = scorecard(pr);
  return { tasks, scorecard: card, narrative: q.get('narrative') === '1' ? await narrative(pr, tasks, card) : null };
});

function clean(b) {
  const out = {};
  for (const k of ['name', 'domain', 'address', 'city', 'state', 'phone', 'category', 'placeId', 'about', 'schedule', 'reviewUrl', 'reviewSms', 'reviewEmail', 'reviewEmailSubject', 'gscSite', 'ga4Property', 'alertEmail', 'reportSchedule']) if (b[k] !== undefined) out[k] = typeof b[k] === 'string' ? b[k].trim() : b[k];
  for (const k of ['lat', 'lng']) if (b[k] !== undefined && b[k] !== '') out[k] = Number(b[k]);
  if (b.reviewFollowupDays !== undefined && b.reviewFollowupDays !== '') out.reviewFollowupDays = Math.max(0, Math.min(30, Number(b.reviewFollowupDays) || 0));
  for (const k of ['keywords', 'competitors', 'aiPrompts', 'gridKeywords', 'devices', 'trackLocations', 'reportRecipients']) if (b[k] !== undefined) out[k] = (Array.isArray(b[k]) ? b[k] : String(b[k]).split('\n')).map(s => String(s).trim()).filter(Boolean);
  if (out.domain) out.domain = out.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return out;
}

function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Optional password protection for the whole app (except customer review links and shared reports).
function authorized(req, pathname) {
  if (!config.appPassword) return true;
  if (pathname.startsWith('/r/') || pathname.startsWith('/api/share/') || pathname === '/api/health' || pathname === '/manifest.webmanifest' || pathname.startsWith('/icons/')) return true;
  const h = req.headers.authorization || '';
  const [, b64] = h.split(' ');
  const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  return pass.length === config.appPassword.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(config.appPassword));
}

function summary(r) {
  const d = r.data;
  switch (r.type) {
    case 'grid': return `${d.config.size}x${d.config.size} · SoLV ${d.metrics.solv}% · ARP ${d.metrics.arp ?? '-'}`;
    case 'audit': return `Health ${d.health} · ${d.pagesCrawled} pages · ${d.counts.error} errors`;
    case 'ai': return `AI score ${d.score} · mentioned ${d.mentionRate}%`;
    case 'gbp': return `Profile ${d.score}/100`;
    case 'organic': return `Visibility ${d.visibility}% · ${d.top10} in top 10`;
    case 'reviews': return `${d.rating ?? '-'}★ · ${d.total ?? 0} reviews`;
    case 'citations': return `Listings ${d.score}/100`;
    case 'keywords': return `"${d.seed}" · ${d.rows.length} ideas`;
    case 'backlinks': return `${d.profiles[0]?.referringDomains ?? 0} ref. domains`;
    case 'domain': return `${d.domain} · ${d.summary.keywords} keywords`;
    case 'gap': return `${d.domains.length} domains · ${d.counts.missing} missing keywords`;
    case 'linkaudit': return `${d.counts.toxic} toxic · ${d.counts.suspicious} suspicious links`;
    case 'brief': return `Brief: "${d.keyword}"`;
    case 'traffic': return `${d.totals.clicks} clicks (28d)`;
    default: return '';
  }
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 2e6) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!authorized(req, url.pathname)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="RankPilot"', 'Content-Type': 'text/plain' });
      return res.end('Password required');
    }
    // Tracked review-request link -> Google review form
    const rm = url.pathname.match(/^\/r\/([\w-]+)$/);
    if (rm) {
      const dest = recordClick(rm[1]);
      if (!dest) return send(res, 404, 'Link not found', 'text/plain');
      res.writeHead(302, { Location: dest }); return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      try {
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await r.handler(url.pathname.match(r.re).groups || {}, url.searchParams, body, req);
        if (out && out.__text !== undefined) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.__name}"` });
          return res.end(out.__text);
        }
        return send(res, 200, out ?? null);
      } catch (e) {
        if (!e.status) console.error(e);
        return send(res, e.status || 500, { error: e.message });
      }
    }
    // Static files with SPA fallback
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) {
  createServer().listen(config.port, () => {
    const s = providerStatus();
    console.log(`RankPilot running at http://localhost:${config.port}`);
    console.log(`Providers: ${Object.entries(s).map(([k, v]) => `${k}=${v ? 'live' : 'off'}`).join('  ')}  site-audit=live`);
    if (!config.appPassword) console.log('Tip: set APP_PASSWORD in .env before exposing this server to the internet.');
    startScheduler();
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
}
