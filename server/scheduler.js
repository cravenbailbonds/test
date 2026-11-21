// Automatic re-scans so trends build up without anyone remembering to click "run".
// A project's `schedule` is "off" | "daily" | "weekly" (default weekly). Runs in-process, checks hourly.
import { listProjects, latestRun } from './store.js';
import { runGridScan } from './modules/maprank.js';
import { reviewSnapshot } from './modules/reviews.js';
import { runAiVisibility } from './modules/aivisibility.js';
import { trackOrganic } from './modules/keywords.js';
import { runAudit } from './modules/audit.js';
import { processQueue } from './modules/reviewrequests.js';
import { sendScheduledReports } from './modules/reports.js';

const DAY = 86400000;
const due = (run, every) => !run || Date.now() - new Date(run.createdAt) > every - 3600000;

export async function tick() {
  for (const p of listProjects()) {
    const every = p.schedule === 'daily' ? DAY : p.schedule === 'off' ? null : 7 * DAY;
    if (!every) continue;
    const jobs = [];
    for (const kw of p.gridKeywords || []) {
      const last = latestRun(p.id, 'grid', r => r.keyword === kw.toLowerCase());
      if (last && due(last, every)) jobs.push(() => runGridScan(p, { ...last.data.config, keyword: kw }));
    }
    if (latestRun(p.id, 'reviews') && due(latestRun(p.id, 'reviews'), every)) jobs.push(() => reviewSnapshot(p));
    if (latestRun(p.id, 'ai') && due(latestRun(p.id, 'ai'), every)) jobs.push(() => runAiVisibility(p));
    if (p.keywords?.length && latestRun(p.id, 'organic') && due(latestRun(p.id, 'organic'), every)) jobs.push(() => trackOrganic(p));
    const lastAudit = latestRun(p.id, 'audit');
    if (p.domain && lastAudit && due(lastAudit, 7 * DAY)) jobs.push(() => runAudit(p, { maxPages: lastAudit.data.pagesCrawled || 60 }));
    for (const j of jobs) { try { await j(); } catch (e) { console.error(`[scheduler] ${p.name}: ${e.message}`); } }
  }

  try { await sendScheduledReports(); } catch (e) { console.error('[scheduler] reports:', e.message); }
}

export function startScheduler() {
  setTimeout(tick, 30000);
  setInterval(tick, 3600000).unref();
  // Review requests go out close to the scheduled time, so they run on a short cycle.
  setInterval(() => processQueue().catch(e => console.error('[scheduler] review requests:', e.message)), 5 * 60000).unref();
}
