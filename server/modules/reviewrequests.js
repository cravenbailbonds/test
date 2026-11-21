// Review generation: post-job SMS/email requests with tracked links, automatic follow-up,
// and click-through stats. No review gating (asking only happy customers) - that breaks
// Google's policy - every customer gets the same direct link.
import { config, providerStatus } from '../config.js';
import { addContact, listContacts, updateContact, getContact, getProject, listProjects, latestRun, listRuns } from '../store.js';
import { sendEmail, sendSms, toE164 } from '../providers/messaging.js';

export const DEFAULT_SMS = 'Hi {first}, thanks for choosing {business}! Would you take 30 seconds to leave us a Google review? It really helps: {link}';
export const DEFAULT_EMAIL_SUBJECT = 'How did we do, {first}?';
export const DEFAULT_EMAIL = 'Hi {first},\n\nThank you for choosing {business}. If you have a moment, we would really appreciate a quick Google review - it helps other people in {city} find us.\n\nLeave a review: {link}\n\nThank you!\n{business}';

export function reviewUrl(project) {
  if (project.reviewUrl) return project.reviewUrl;
  if (project.placeId && !project.placeId.startsWith('demo')) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(project.placeId)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(project.name + ' ' + (project.city || '') + ' reviews')}`;
}
export const trackedLink = (c, base = config.publicUrl || `http://localhost:${config.port}`) => `${base}/r/${c.token}`;

export function fill(tpl, project, c, base) {
  return tpl.replace(/\{first\}/g, (c.name || '').split(' ')[0] || 'there').replace(/\{business\}/g, project.name)
    .replace(/\{city\}/g, (project.city || 'the area').split(',')[0]).replace(/\{link\}/g, trackedLink(c, base));
}

/** Add customers. Each can be sent now or after a delay (e.g. 2h after the job). */
export function addCustomers(project, rows, { delayHours = 0 } = {}) {
  const sendAt = new Date(Date.now() + delayHours * 3600000).toISOString();
  return rows.filter(r => r.name && (r.phone || r.email)).map(r => addContact(project.id, {
    name: String(r.name).trim(), phone: r.phone ? String(r.phone).trim() : '', email: r.email ? String(r.email).trim() : '',
    channel: r.channel || (r.phone ? 'sms' : 'email'), sendAt, followups: 0,
  }));
}

export async function sendRequest(project, c, { base } = {}) {
  const events = [...(c.events || [])];
  try {
    let res;
    if (c.channel === 'sms') {
      const to = toE164(c.phone); if (!to) throw new Error('Invalid phone number');
      res = await sendSms({ to, body: fill(project.reviewSms || DEFAULT_SMS, project, c, base) });
    } else {
      if (!/@/.test(c.email || '')) throw new Error('Invalid email');
      const text = fill(project.reviewEmail || DEFAULT_EMAIL, project, c, base);
      res = await sendEmail({ to: c.email, subject: fill(project.reviewEmailSubject || DEFAULT_EMAIL_SUBJECT, project, c, base), text, html: text.split('\n').map(l => `<p>${l.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).join('') });
    }
    events.push({ type: c.status === 'pending' ? 'sent' : 'followup', at: new Date().toISOString(), simulated: Boolean(res.simulated) });
    return updateContact(c.id, { status: c.status === 'clicked' ? 'clicked' : 'sent', sentAt: c.sentAt || new Date().toISOString(), lastSentAt: new Date().toISOString(), followups: c.status === 'pending' ? 0 : (c.followups || 0) + 1, simulated: Boolean(res.simulated), events, error: null });
  } catch (e) {
    events.push({ type: 'error', at: new Date().toISOString(), message: e.message });
    return updateContact(c.id, { status: 'failed', error: e.message, events });
  }
}

export function recordClick(token) {
  const c = getContact(token); if (!c) return null;
  updateContact(c.id, { status: 'clicked', clickedAt: c.clickedAt || new Date().toISOString(), events: [...(c.events || []), { type: 'click', at: new Date().toISOString() }] });
  const p = getProject(c.projectId);
  return p ? reviewUrl(p) : null;
}

/** Called by the scheduler every few minutes: sends due requests and one follow-up if not clicked. */
export async function processQueue(now = Date.now()) {
  let sent = 0;
  for (const p of listProjects()) {
    const followDays = p.reviewFollowupDays ?? 3;
    for (const c of listContacts(p.id)) {
      if (c.status === 'pending' && new Date(c.sendAt) <= now) { await sendRequest(p, c); sent++; }
      else if (c.status === 'sent' && followDays > 0 && (c.followups || 0) < 1 && now - new Date(c.lastSentAt) > followDays * 86400000) { await sendRequest(p, c); sent++; }
    }
  }
  return sent;
}

export function requestStats(project) {
  const cs = listContacts(project.id);
  const sent = cs.filter(c => ['sent', 'clicked'].includes(c.status)).length;
  const clicked = cs.filter(c => c.status === 'clicked').length;
  const snaps = listRuns(project.id, 'reviews', 1000).reverse();
  const firstSent = cs.map(c => c.sentAt).filter(Boolean).sort()[0];
  const before = firstSent ? snaps.filter(s => s.createdAt < firstSent).pop() : null;
  const latest = latestRun(project.id, 'reviews');
  return {
    total: cs.length, pending: cs.filter(c => c.status === 'pending').length, sent, clicked, failed: cs.filter(c => c.status === 'failed').length,
    clickRate: sent ? Math.round((100 * clicked) / sent) : 0,
    reviewsGained: before && latest ? Math.max(0, (latest.data.total || 0) - (before.data.total || 0)) : null,
    simulated: !providerStatus().sms && !providerStatus().email,
    reviewUrl: reviewUrl(project),
  };
}
