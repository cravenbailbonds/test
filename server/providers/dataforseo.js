// DataForSEO v3 live endpoints. Docs: https://docs.dataforseo.com/v3/
import { config } from '../config.js';
import { fetchWithTimeout, normalizeDomain } from '../lib/util.js';

async function post(path, task) {
  const auth = Buffer.from(`${config.dfsLogin}:${config.dfsPassword}`).toString('base64');
  const res = await fetchWithTimeout('https://api.dataforseo.com/v3' + path, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify([task]),
  }, 60000);
  const json = await res.json().catch(() => ({}));
  const t = json.tasks?.[0];
  if (!res.ok || !t || t.status_code >= 40000) throw new Error(`DataForSEO ${path}: ${t?.status_message || json.status_message || res.status}`);
  return t.result || [];
}

/** Google Maps results as seen from exact GPS coordinates - the most faithful local-grid source. */
export async function mapsAt(keyword, point, zoom = 15) {
  const [r] = await post('/serp/google/maps/live/advanced', {
    keyword, location_coordinate: `${point.lat.toFixed(7)},${point.lng.toFixed(7)},${zoom}z`, language_code: 'en', depth: 20,
  });
  return (r?.items || []).filter(i => i.type === 'maps_search').map(i => ({
    name: i.title, placeId: i.place_id || i.cid, address: i.address, lat: i.latitude, lng: i.longitude,
    rating: i.rating?.value ?? null, reviews: i.rating?.votes_count ?? 0, category: i.category, domain: i.domain ? normalizeDomain(i.domain) : null, phone: i.phone,
  }));
}

/** Organic SERP incl. SERP features and AI Overview references. */
export async function organic(keyword, { location, point, device = 'desktop' } = {}) {
  const task = { keyword, language_code: 'en', depth: 100, device };
  if (point) task.location_coordinate = `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`;
  else task.location_name = location || 'United States';
  const [r] = await post('/serp/google/organic/live/advanced', task);
  const items = r?.items || [];
  const ai = items.find(i => i.type === 'ai_overview');
  return {
    items: items.filter(i => i.type === 'organic').map(i => ({ position: i.rank_group, domain: normalizeDomain(i.domain), url: i.url, title: i.title })),
    features: [...new Set(items.map(i => i.type).filter(t => t !== 'organic'))],
    aiOverview: ai ? { present: true, cited: (ai.references || []).map(x => normalizeDomain(x.domain || x.url || '')) } : { present: false },
  };
}

export async function keywordIdeas(seed, location) {
  const [r] = await post('/dataforseo_labs/google/keyword_ideas/live', { keywords: [seed], location_name: location || 'United States', language_code: 'en', limit: 100 });
  return (r?.items || []).map(i => ({
    keyword: i.keyword, volume: i.keyword_info?.search_volume ?? 0, cpc: i.keyword_info?.cpc ?? 0, competition: i.keyword_info?.competition ?? 0,
    difficulty: i.keyword_properties?.keyword_difficulty ?? null, intent: i.search_intent_info?.main_intent || 'unknown',
    trend: (i.keyword_info?.monthly_searches || []).slice(0, 12).reverse().map(m => m.search_volume), source: 'dataforseo',
  }));
}

export async function searchVolume(keywords, location) {
  const r = await post('/keywords_data/google_ads/search_volume/live', { keywords, location_name: location || 'United States', language_code: 'en' });
  return r.map(i => ({ keyword: i.keyword, volume: i.search_volume ?? 0, cpc: i.cpc ?? 0, competition: i.competition_index != null ? i.competition_index / 100 : 0, trend: (i.monthly_searches || []).slice(0, 12).reverse().map(m => m.search_volume), source: 'dataforseo' }));
}

export async function backlinks(domain) {
  const [s] = await post('/backlinks/summary/live', { target: domain, include_subdomains: true });
  let top = [];
  try {
    const [rd] = await post('/backlinks/referring_domains/live', { target: domain, limit: 25, order_by: ['rank,desc'] });
    top = (rd?.items || []).map(i => ({ domain: i.domain, authority: Math.round((i.rank || 0) / 10), links: i.backlinks, dofollow: (i.backlinks_spam_score ?? 0) < 50 }));
  } catch { /* summary is enough */ }
  return {
    domain, backlinks: s?.backlinks ?? 0, referringDomains: s?.referring_domains ?? 0, authority: Math.round((s?.rank || 0) / 10),
    spamScore: s?.backlinks_spam_score ?? null, dofollowPct: s?.backlinks ? Math.round(100 * (1 - (s.referring_links_attributes?.nofollow || 0) / s.backlinks)) : null,
    topReferrers: top, source: 'dataforseo',
  };
}

/** Every keyword a domain ranks for (Domain Overview / Organic Rankings / Keyword Gap source). */
export async function rankedKeywords(domain, location, limit = 500) {
  const [r] = await post('/dataforseo_labs/google/ranked_keywords/live', { target: domain, location_name: location || 'United States', language_code: 'en', limit, order_by: ['keyword_data.keyword_info.search_volume,desc'] });
  return (r?.items || []).map(i => ({
    keyword: i.keyword_data?.keyword, volume: i.keyword_data?.keyword_info?.search_volume ?? 0, cpc: i.keyword_data?.keyword_info?.cpc ?? 0,
    difficulty: i.keyword_data?.keyword_properties?.keyword_difficulty ?? null, intent: i.keyword_data?.search_intent_info?.main_intent || 'unknown',
    position: i.ranked_serp_element?.serp_item?.rank_group ?? null, url: i.ranked_serp_element?.serp_item?.url ?? null, traffic: Math.round(i.ranked_serp_element?.serp_item?.etv ?? 0),
  }));
}

export async function domainOverview(domain, location) {
  const [r] = await post('/dataforseo_labs/google/domain_rank_overview/live', { target: domain, location_name: location || 'United States', language_code: 'en' });
  const o = r?.items?.[0]?.metrics?.organic || {};
  return { keywords: o.count ?? 0, traffic: Math.round(o.etv ?? 0), trafficCost: Math.round(o.estimated_paid_traffic_cost ?? 0), pos1: o.pos_1 ?? 0, pos2_3: o.pos_2_3 ?? 0, pos4_10: o.pos_4_10 ?? 0, pos11_20: o.pos_11_20 ?? 0 };
}

/** Individual backlinks (one per referring domain) for the Backlink Audit. */
export async function backlinkList(domain, limit = 500) {
  const [r] = await post('/backlinks/backlinks/live', { target: domain, mode: 'one_per_domain', limit, include_subdomains: true });
  return (r?.items || []).map(i => ({ domainFrom: i.domain_from, urlFrom: i.url_from, urlTo: i.url_to, anchor: i.anchor || '', dofollow: Boolean(i.dofollow), spamScore: i.backlink_spam_score ?? i.backlinks_spam_score ?? null, authority: Math.round((i.domain_from_rank || 0) / 10), firstSeen: i.first_seen, tld: (i.domain_from || '').split('.').pop() }));
}
