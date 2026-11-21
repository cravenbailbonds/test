// Google Search Console + GA4 Data API via a service account (no OAuth dance, no SDK).
// Setup: create a service account, download its JSON key, set GOOGLE_SERVICE_ACCOUNT_FILE,
// then add the service-account email as a user on the GSC property and the GA4 property.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { fetchWithTimeout } from '../lib/util.js';

const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly';
let cached = null;

async function token() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(fs.readFileSync(config.googleSaFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${j.error_description || j.error}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function gpost(url, body) {
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 30000);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google API: ${j.error?.message || res.status}`);
  return j;
}

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** siteUrl is "sc-domain:example.com" or "https://example.com/". */
export async function searchConsole(siteUrl, dimension = 'query', days = 28) {
  const j = await gpost(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { startDate: day(days + 2), endDate: day(2), dimensions: [dimension], rowLimit: 250 });
  return (j.rows || []).map(r => ({ key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
}

export async function searchConsoleDaily(siteUrl, days = 90) {
  const j = await gpost(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { startDate: day(days + 2), endDate: day(2), dimensions: ['date'], rowLimit: 500 });
  return (j.rows || []).map(r => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
}

export async function ga4Sources(propertyId, days = 28) {
  const j = await gpost(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }], limit: 200,
  });
  return (j.rows || []).map(r => ({ source: r.dimensionValues[0].value, medium: r.dimensionValues[1].value, sessions: +r.metricValues[0].value, conversions: +r.metricValues[1].value }));
}
