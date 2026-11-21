// Client reports: one data bundle used by the in-app report, public share links and email.
import { config, providerStatus } from '../config.js';
import { latestRun, getSettings, createShare, getShare, getProject, listProjects } from '../store.js';
import { buildPlan, scorecard } from './actionplan.js';
import { sendEmail } from '../providers/messaging.js';

const TYPES = ['grid', 'gbp', 'reviews', 'audit', 'ai', 'organic', 'citations', 'traffic'];

export function reportBundle(project) {
  const latest = Object.fromEntries(TYPES.map(t => [t, latestRun(project.id, t)]));
  const slimLatest = Object.fromEntries(Object.entries(latest).map(([t, r]) => [t, r && { createdAt: r.createdAt, data: slimData(t, r.data) }]));
  const { name, city, state, category, domain } = project;
  return { project: { name, city, state, category, domain }, branding: getSettings().branding || {}, scorecard: scorecard(project), tasks: buildPlan(project).slice(0, 10), latest: slimLatest, generatedAt: new Date().toISOString() };
}
function slimData(t, d) {
  if (t === 'grid') return { config: d.config, metrics: d.metrics, delta: d.delta, insights: d.insights, leaderboard: d.leaderboard.slice(0, 5), points: d.points.map(p => ({ lat: p.lat, lng: p.lng, rank: p.rank })) };
  if (t === 'ai') return { score: d.score, mentionRate: d.mentionRate, avgPosition: d.avgPosition, competitors: d.competitors.slice(0, 5), engines: d.engines, results: { length: d.results.length } };
  if (t === 'audit') return { health: d.health, pagesCrawled: d.pagesCrawled, counts: d.counts, issues: d.issues.filter(i => i.severity === 'error').slice(0, 8).map(i => ({ title: i.title })) };
  if (t === 'organic') return { visibility: d.visibility, top3: d.top3, top10: d.top10, traffic: d.traffic, rows: d.rows.slice(0, 25).map(r => ({ keyword: r.keyword, device: r.device, position: r.position, change: r.change })) };
  if (t === 'reviews') return { rating: d.rating, total: d.total, velocity90d: d.velocity90d };
  if (t === 'traffic') return { totals: d.totals, sourcesSummary: d.sourcesSummary && { aiSessions: d.sourcesSummary.aiSessions, aiShare: d.sourcesSummary.aiShare, organicSessions: d.sourcesSummary.organicSessions } };
  return d;
}

export function shareUrl(token, base) { return `${base || config.publicUrl || `http://localhost:${config.port}`}/#/share/${token}`; }
export function newShare(project, base) { const s = createShare(project.id); return { token: s.token, url: shareUrl(s.token, base) }; }
export function bundleForShare(token) { const s = getShare(token); const p = s && getProject(s.projectId); if (!p) return null; return reportBundle(p); }

export function reportEmailHtml(b, link) {
  const c = b.scorecard, brand = b.branding.agencyName || 'RankPilot', color = b.branding.color || '#2a78d6';
  const row = (k, v) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${k}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right"><b>${v ?? '–'}</b></td></tr>`;
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:600px;margin:auto">
  ${b.branding.logoUrl ? `<img src="${b.branding.logoUrl}" alt="${brand}" style="max-height:48px">` : `<h2 style="color:${color}">${brand}</h2>`}
  <h1 style="font-size:22px">${b.project.name}: search visibility report</h1>
  <p>Overall visibility score: <b style="font-size:20px;color:${color}">${c.overall ?? '–'}/100</b></p>
  <table style="border-collapse:collapse;width:100%">${row('Google Maps visibility', c.parts.maps)}${row('Business Profile', c.parts.gbp)}${row('Website health', c.parts.website)}${row('AI assistant visibility', c.parts.ai)}${row('Organic visibility', c.parts.organic)}${row('Listings', c.parts.citations)}</table>
  <h3>Priorities</h3><ol>${b.tasks.slice(0, 5).map(t => `<li><b>${t.title}</b><br><span style="color:#555">${t.detail}</span></li>`).join('')}</ol>
  ${link ? `<p><a href="${link}" style="background:${color};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">View the full report</a></p>` : ''}</div>`;
}

export async function emailReport(project, to, base) {
  if (!to) throw new Error('Add at least one recipient');
  const { url } = newShare(project, base);
  const b = reportBundle(project);
  const res = await sendEmail({ to, subject: `${project.name} - search visibility report`, html: reportEmailHtml(b, url), text: `Your report: ${url}` });
  return { sent: !res.simulated, simulated: Boolean(res.simulated), url };
}

/** Scheduler hook: send each project's report on its schedule (weekly / monthly). */
export async function sendScheduledReports(now = new Date()) {
  if (!providerStatus().email) return 0;
  let n = 0;
  for (const p of listProjects()) {
    const sched = p.reportSchedule || 'off';
    if (sched === 'off' || !p.reportRecipients?.length) continue;
    const last = p.lastReportAt ? new Date(p.lastReportAt) : null;
    const gap = sched === 'weekly' ? 7 : 30;
    if (last && now - last < (gap - 0.5) * 86400000) continue;
    for (const to of p.reportRecipients) { try { await emailReport(p, to); n++; } catch (e) { console.error('[report email]', e.message); } }
    const { updateProject } = await import('../store.js');
    updateProject(p.id, { lastReportAt: now.toISOString() });
  }
  return n;
}
