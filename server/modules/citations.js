// Listing / citation consistency checker. Fetches each listing URL the user supplies and checks NAP on it.
import { fetchWithTimeout, normalizePhone, normalizeName, mapLimit } from '../lib/util.js';
import { addRun } from '../store.js';

export const DIRECTORIES = [
  { name: 'Google Business Profile', domain: 'google.com', weight: 10 },
  { name: 'Apple Business Connect', domain: 'apple.com', weight: 8, url: 'https://businessconnect.apple.com' },
  { name: 'Bing Places', domain: 'bing.com', weight: 8, url: 'https://www.bingplaces.com' },
  { name: 'Yelp', domain: 'yelp.com', weight: 8, url: 'https://biz.yelp.com' },
  { name: 'Facebook', domain: 'facebook.com', weight: 7, url: 'https://www.facebook.com/pages/create' },
  { name: 'BBB', domain: 'bbb.org', weight: 6, url: 'https://www.bbb.org/get-accredited' },
  { name: 'Nextdoor', domain: 'nextdoor.com', weight: 5, url: 'https://business.nextdoor.com' },
  { name: 'Yellow Pages', domain: 'yellowpages.com', weight: 4, url: 'https://adsolutions.yp.com/free-listing' },
  { name: 'Foursquare', domain: 'foursquare.com', weight: 4, url: 'https://foursquare.com/add-place' },
  { name: 'MapQuest', domain: 'mapquest.com', weight: 3 },
  { name: 'Manta', domain: 'manta.com', weight: 3, url: 'https://www.manta.com/claim' },
  { name: 'Chamber of Commerce', domain: 'chamberofcommerce.com', weight: 3 },
  { name: 'Angi', domain: 'angi.com', weight: 3 },
  { name: 'LinkedIn', domain: 'linkedin.com', weight: 3 },
  { name: 'Data aggregator: Data Axle', domain: 'data-axle.com', weight: 6, url: 'https://www.data-axle.com/our-data/business-data/' },
  { name: 'Data aggregator: Neustar Localeze', domain: 'neustarlocaleze.biz', weight: 6, url: 'https://www.neustarlocaleze.biz' },
];

export function checkNap(text, project) {
  const t = text.toLowerCase();
  const name = normalizeName(project.name);
  const nameOk = name ? normalizeName(text).includes(name) : null;
  const phones = (text.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) || []).map(normalizePhone);
  const phoneOk = project.phone ? phones.includes(normalizePhone(project.phone)) : null;
  const street = (project.address || '').split(',')[0].toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|suite|ste)\b\.?/g, '').replace(/\s+/g, ' ').trim();
  const addrOk = street ? t.replace(/\b(street|st|avenue|ave|road|rd|suite|ste)\b\.?/g, '').replace(/\s+/g, ' ').includes(street) : null;
  return { nameOk, phoneOk, addrOk, otherPhones: [...new Set(phones.filter(p => p !== normalizePhone(project.phone || '')))].slice(0, 3) };
}

export async function scanCitations(project, listings = []) {
  const results = await mapLimit(listings.filter(l => l.url), 5, async l => {
    try {
      const r = await fetchWithTimeout(l.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RankPilot/1.0)' } }, 15000);
      const html = await r.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return { ...l, status: r.status, ...checkNap(text, project) };
    } catch (e) { return { ...l, status: 0, error: e.message }; }
  });
  const known = new Set(listings.map(l => { try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch { return ''; } }));
  const missing = DIRECTORIES.filter(d => ![...known].some(h => h.endsWith(d.domain)));
  const ok = results.filter(r => r.nameOk !== false && r.phoneOk !== false && r.addrOk !== false && r.status && r.status < 400);
  const possible = DIRECTORIES.reduce((a, d) => a + d.weight, 0);
  const covered = DIRECTORIES.filter(d => [...known].some(h => h.endsWith(d.domain))).reduce((a, d) => a + d.weight, 0);
  const score = Math.round(100 * (0.6 * covered / possible + 0.4 * (results.length ? ok.length / results.length : 0)));
  return addRun(project.id, 'citations', { results, missing, score, consistent: ok.length, checked: results.length });
}
