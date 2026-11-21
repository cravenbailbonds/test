import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Existing env vars win.
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  placesKey: process.env.GOOGLE_PLACES_API_KEY || '',
  dfsLogin: process.env.DATAFORSEO_LOGIN || '',
  dfsPassword: process.env.DATAFORSEO_PASSWORD || '',
  auditMaxPages: Number(process.env.AUDIT_MAX_PAGES || 60),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5-mini',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  perplexityKey: process.env.PERPLEXITY_API_KEY || '',
  perplexityModel: process.env.PERPLEXITY_MODEL || 'sonar',
  resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: process.env.TWILIO_FROM || '',
  googleSaFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
  pagespeedKey: process.env.PAGESPEED_API_KEY || '',
  appPassword: process.env.APP_PASSWORD || '',
};

export function providerStatus() {
  return {
    ai: Boolean(config.anthropicKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE),
    places: Boolean(config.placesKey),
    dataforseo: Boolean(config.dfsLogin && config.dfsPassword),
    openai: Boolean(config.openaiKey),
    gemini: Boolean(config.geminiKey),
    perplexity: Boolean(config.perplexityKey),
    email: Boolean(config.resendKey && config.emailFrom),
    sms: Boolean(config.twilioSid && config.twilioToken && config.twilioFrom),
    google: Boolean(config.googleSaFile),
  };
}
