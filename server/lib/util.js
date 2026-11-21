// Deterministic PRNG so demo data is stable across reloads (same input -> same output).
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function normalizeName(s = '') {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(llc|inc|co|corp|ltd|the)\b/g, '').replace(/\s+/g, ' ').trim();
}
export function normalizeDomain(u = '') {
  try { return new URL(u.includes('://') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return String(u).replace(/^www\./, '').toLowerCase(); }
}
export function normalizePhone(s = '') { const d = String(s).replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }

/** Fuzzy "is this listing the tracked business?" match on name, domain or phone. */
export function isSameBusiness(listing, project) {
  if (!listing) return false;
  if (project.placeId && listing.placeId && listing.placeId === project.placeId) return true;
  if (project.domain && listing.domain && normalizeDomain(listing.domain) === normalizeDomain(project.domain)) return true;
  if (project.phone && listing.phone && normalizePhone(listing.phone) === normalizePhone(project.phone)) return true;
  const a = normalizeName(listing.name), b = normalizeName(project.name);
  return Boolean(a && b && (a === b || (b.length > 5 && a.includes(b)) || (a.length > 5 && b.includes(a))));
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers); return out;
}

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

/** "Springfield, OH" / "Springfield" + "OH" -> "Springfield,Ohio,United States" (DataForSEO location_name). ZIP codes pass through. */
export function dfsLocation(cityOrZip, state) {
  const s = String(cityOrZip || '').trim();
  if (!s) return 'United States';
  if (/^\d{5}$/.test(s)) return `${s},United States`;
  if (/united states/i.test(s)) return s;
  let [city, st] = s.split(',').map(x => x.trim());
  st = st || state || '';
  st = STATES[st.toUpperCase()] || st;
  return [city, st, 'United States'].filter(Boolean).join(',');
}
