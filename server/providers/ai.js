// Claude integration. Uses the official SDK; credentials resolve from ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
import Anthropic from '@anthropic-ai/sdk';
import { config, providerStatus } from '../config.js';

let client = null;
function getClient() {
  if (!client) client = new Anthropic(config.anthropicKey ? { apiKey: config.anthropicKey } : {});
  return client;
}

export const aiAvailable = () => providerStatus().ai;

// Server-side refusal fallback is enabled so a classifier decline on the primary model
// is retried transparently instead of failing the user's request.
function baseParams(extra) {
  return { model: config.anthropicModel, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', ...extra };
}

function textOf(msg) {
  if (msg.stop_reason === 'refusal') throw new Error('The AI model declined this request.');
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

/** Plain text generation. */
export async function generate(system, prompt, { effort = 'medium' } = {}) {
  const msg = await getClient().beta.messages.create(baseParams({
    system, output_config: { effort }, messages: [{ role: 'user', content: prompt }],
  }));
  return textOf(msg);
}

/** Structured JSON output validated against a JSON schema. */
export async function generateJSON(system, prompt, schema, { effort = 'medium' } = {}) {
  const msg = await getClient().beta.messages.create(baseParams({
    system, output_config: { effort, format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: prompt }],
  }));
  return JSON.parse(textOf(msg));
}

/**
 * Answer a question the way an AI search assistant would: with live web search, as a consumer would see it.
 * Returns the answer text and the domains it cited.
 */
export async function answerWithSearch(question, userLocation) {
  const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: 4 };
  if (userLocation?.city) tool.user_location = { type: 'approximate', city: userLocation.city, region: userLocation.region, country: userLocation.country || 'US' };
  let messages = [{ role: 'user', content: question }];
  let msg;
  for (let i = 0; i < 3; i++) { // resume pause_turn
    msg = await getClient().beta.messages.create(baseParams({
      system: 'You are a helpful AI search assistant answering a consumer. Recommend specific businesses by name when the question asks for providers, in a ranked order, with a short reason for each. Be concise.',
      output_config: { effort: 'low' }, tools: [tool], messages,
    }));
    if (msg.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: msg.content }];
  }
  const cited = new Set();
  for (const b of msg.content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => r.url && cited.add(r.url));
    if (b.type === 'text') (b.citations || []).forEach(c => c.url && cited.add(c.url));
  }
  return { answer: textOf(msg), citedUrls: [...cited] };
}
