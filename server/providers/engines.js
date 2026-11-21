// Other AI answer engines, called over their public REST APIs, each with live web search
// so answers match what a consumer sees. Claude lives in ai.js.
import { config, providerStatus } from '../config.js';
import { fetchWithTimeout } from '../lib/util.js';
import { aiAvailable, answerWithSearch } from './ai.js';

async function postJSON(url, headers, body) {
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, 90000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || json.message || `HTTP ${res.status}`);
  return json;
}

async function openai(question) {
  const j = await postJSON('https://api.openai.com/v1/responses', { Authorization: `Bearer ${config.openaiKey}` },
    { model: config.openaiModel, tools: [{ type: 'web_search' }], input: question });
  let answer = '', urls = [];
  for (const item of j.output || []) for (const c of item.content || []) if (c.type === 'output_text') {
    answer += c.text; urls.push(...(c.annotations || []).filter(a => a.url).map(a => a.url));
  }
  return { answer: answer.trim(), citedUrls: [...new Set(urls)] };
}

async function gemini(question) {
  const j = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, { 'x-goog-api-key': config.geminiKey },
    { contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ google_search: {} }] });
  const cand = j.candidates?.[0];
  const answer = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
  // Grounding URIs are Google redirect links; the chunk title carries the source domain.
  const urls = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web?.title ? `https://${c.web.title}` : c.web?.uri).filter(Boolean);
  return { answer, citedUrls: [...new Set(urls)] };
}

async function perplexity(question) {
  const j = await postJSON('https://api.perplexity.ai/chat/completions', { Authorization: `Bearer ${config.perplexityKey}` },
    { model: config.perplexityModel, messages: [{ role: 'user', content: question }] });
  const urls = j.search_results?.map(r => r.url) || j.citations || [];
  return { answer: (j.choices?.[0]?.message?.content || '').trim(), citedUrls: [...new Set(urls)] };
}

export const ENGINES = {
  claude: { label: 'Claude', available: () => aiAvailable(), ask: (q, loc) => answerWithSearch(q, loc) },
  chatgpt: { label: 'ChatGPT', available: () => providerStatus().openai, ask: q => openai(q) },
  gemini: { label: 'Gemini', available: () => providerStatus().gemini, ask: q => gemini(q) },
  perplexity: { label: 'Perplexity', available: () => providerStatus().perplexity, ask: q => perplexity(q) },
};

export const liveEngines = () => Object.keys(ENGINES).filter(k => ENGINES[k].available());

/** Pull business names out of an answer without an LLM: numbered/bulleted list items and bold names. */
export function extractBusinessesHeuristic(answer) {
  const names = [];
  const push = n => { n = n.replace(/[*_`#]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').split(/\s[-–—:(]\s?|:\s/)[0].trim(); if (n.length > 2 && n.length < 70 && /[A-Z]/.test(n[0]) && !names.includes(n)) names.push(n); };
  for (const line of answer.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (m) push(m[1]);
  }
  for (const m of answer.matchAll(/\*\*([^*]{3,60})\*\*/g)) push(m[1]);
  return names;
}
