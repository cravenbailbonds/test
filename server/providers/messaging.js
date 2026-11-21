// Email (Resend) + SMS (Twilio). Without keys, messages are recorded as "simulated" so the
// workflow can be tested end to end without sending anything.
import { config, providerStatus } from '../config.js';
import { fetchWithTimeout } from '../lib/util.js';

export async function sendEmail({ to, subject, html, text }) {
  if (!providerStatus().email) return { simulated: true };
  const res = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed: ${json.message || res.status}`);
  return { id: json.id };
}

export async function sendSms({ to, body }) {
  if (!providerStatus().sms) return { simulated: true };
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
  const res = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: config.twilioFrom, Body: body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SMS failed: ${json.message || res.status}`);
  return { id: json.sid };
}

/** E.164-ish normalisation for US numbers. */
export function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length > 7 ? '+' + d : null;
}
