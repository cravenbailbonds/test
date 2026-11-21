// One place to raise an alert: always lands in the in-app feed, and is emailed when the
// project has an alert email set and the email provider is configured.
import { addAlert, getProject, getSettings } from '../store.js';
import { sendEmail } from '../providers/messaging.js';
import { providerStatus } from '../config.js';

export async function notify(projectId, kind, title, detail = '', link = '', { email = false } = {}) {
  const a = addAlert(projectId, kind, title, detail, link);
  const p = getProject(projectId);
  const to = p?.alertEmail || getSettings().alertEmail;
  if (email && to && providerStatus().email) {
    try { await sendEmail({ to, subject: `[${p.name}] ${title}`, html: `<p><b>${esc(title)}</b></p><p>${esc(detail)}</p>`, text: `${title}\n\n${detail}` }); } catch (e) { console.error('[alert email]', e.message); }
  }
  return a;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
