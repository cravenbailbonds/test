// Deterministic simulated data used when a live provider key isn't configured.
// Every response is tagged `source: "demo"` and the UI shows a DEMO badge, so it is never mistaken for real data.
import { rng, hash, clamp, normalizeName } from '../lib/util.js';
import { haversine, offset } from '../lib/geo.js';

const PREFIX = ['Premier', 'Elite', 'Metro', 'Liberty', 'Rapid', 'Citywide', 'Ace', 'Summit', 'Freedom', 'Allied', 'First Choice', 'Patriot', 'Keystone', 'Northside', 'Valley'];
const SUFFIX = ['Group', 'Pros', 'Services', 'Co.', 'Experts', 'Solutions', '& Associates', 'Partners'];

function category(keyword) {
  return keyword.replace(/\b(near me|best|top|cheap|24 hour|24\/7|in [a-z ]+|[a-z]+,? ?[a-z]{2})$/gi, '').trim() || keyword;
}

/** A stable cast of competitors positioned around the target business. */
export function demoCompetitors(project, keyword, count = 18) {
  const r = rng(`${project.id}|${normalizeName(category(keyword))}`);
  const cat = category(keyword).replace(/\b\w/g, c => c.toUpperCase());
  const used = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    let name;
    do { name = `${PREFIX[Math.floor(r() * PREFIX.length)]} ${cat} ${SUFFIX[Math.floor(r() * SUFFIX.length)]}`; } while (used.has(name));
    used.add(name);
    const pos = offset({ lat: project.lat, lng: project.lng }, 600 + r() * 9000, r() * 360);
    out.push({
      name, placeId: `demo_${hash(name)}`, ...pos,
      rating: Math.round((3.6 + r() * 1.4) * 10) / 10,
      reviews: Math.floor(5 + r() ** 2 * 420),
      strength: 0.3 + r() * 0.9,
      domain: name.toLowerCase().replace(/[^a-z]+/g, '') + '.com',
      category: cat,
      address: `${Math.floor(100 + r() * 9000)} ${['Main', 'Market', 'High', 'Limestone', 'Fountain', 'Columbia'][Math.floor(r() * 6)]} St`,
    });
  }
  return out;
}

/** Simulate a local pack / Maps result list at one grid point. */
export function demoMapResults(project, keyword, point) {
  const comps = demoCompetitors(project, keyword);
  const target = {
    name: project.name, placeId: project.placeId || 'demo_target', lat: project.lat, lng: project.lng,
    rating: project.demoRating ?? 4.7, reviews: project.demoReviews ?? 86, strength: 1.1,
    domain: project.domain, category: category(keyword), address: project.address, isTarget: true,
  };
  const r = rng(`${project.id}|${keyword}|${point.lat.toFixed(4)},${point.lng.toFixed(4)}`);
  const kwPenalty = (hash(keyword) % 7) / 20; // some keywords are harder
  const scored = [target, ...comps].map(b => {
    const km = haversine(point, b) / 1000;
    const prominence = Math.log10(10 + b.reviews) * b.rating / 5;
    // Proximity dominates the local algorithm, so rank decays with distance from the business.
    const score = b.strength * 2.2 + prominence * 1.4 - km * (b.isTarget ? 0.7 : 0.55) - (b.isTarget ? kwPenalty : 0) + (r() - 0.5) * 1.1;
    return { b, score };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
  return scored.map(({ b }) => ({
    name: b.name, placeId: b.placeId, rating: b.rating, reviews: b.reviews, domain: b.domain,
    category: b.category, address: b.address, lat: b.lat, lng: b.lng,
  }));
}

export function demoKeywordMetrics(keyword, local = true) {
  const r = rng('kw|' + keyword.toLowerCase());
  const words = keyword.trim().split(/\s+/).length;
  const base = local ? 40 : 400;
  const volume = Math.round((base * Math.pow(10, r() * 2.2)) / Math.max(1, words - 1) / 10) * 10 || 10;
  const intent = /near me|cost|price|hire|best|buy|service|company|24/i.test(keyword) ? 'transactional'
    : /how|what|why|can|does|guide|vs/i.test(keyword) ? 'informational'
      : /\.com|login|website/i.test(keyword) ? 'navigational' : 'commercial';
  return {
    keyword, volume, cpc: Math.round(r() * 1800) / 100, competition: Math.round(r() * 100) / 100,
    difficulty: Math.round(clamp(15 + r() * 70 - words * 4, 1, 100)), intent,
    trend: Array.from({ length: 12 }, (_, i) => Math.round(volume * (0.75 + 0.5 * Math.sin((i + r() * 6) / 2) * r() + 0.25 * r()))),
    source: 'demo',
  };
}

export function demoKeywordIdeas(seed, location = '') {
  const mods = ['near me', 'best', 'cheap', '24 hour', 'cost', 'how much does', 'reviews', 'open now', 'emergency', 'top rated', 'affordable', 'how to find', 'what is', 'vs', 'services', 'company', 'local'];
  const city = (location || '').split(',')[0].trim().toLowerCase();
  const ideas = new Set([seed]);
  const before = new Set(['best', 'cheap', '24 hour', 'emergency', 'top rated', 'affordable', 'local', 'how much does', 'how to find', 'what is']);
  for (const m of mods) {
    const phrase = m === 'vs' ? `${seed} vs alternatives` : m === 'how much does' ? `how much does a ${seed} cost` : before.has(m) ? `${m} ${seed}` : `${seed} ${m}`;
    ideas.add(phrase);
    if (city && !['near me', 'open now', 'vs', 'what is'].includes(m)) ideas.add(m === 'how much does' ? `how much does a ${seed} cost in ${city}` : `${phrase} ${city}`);
  }
  if (city) ideas.add(`${seed} in ${city}`);
  return [...ideas].map(k => demoKeywordMetrics(k, Boolean(city)));
}

export function demoOrganic(project, keyword) {
  const r = rng(`org|${project.id}|${keyword}`);
  const found = r() > 0.18;
  const position = found ? Math.max(1, Math.round(1 + r() ** 1.6 * 45)) : null;
  const comps = demoCompetitors(project, keyword, 10);
  const items = comps.slice(0, 10).map((c, i) => ({ position: i + 1, domain: c.domain, url: `https://${c.domain}/`, title: `${c.name} | ${c.category}` }));
  if (position && position <= 10) items.splice(position - 1, 0, { position, domain: project.domain, url: `https://${project.domain}/`, title: project.name });
  return {
    keyword, position, url: position ? `https://${project.domain}/` : null,
    items: items.slice(0, 10).map((x, i) => ({ ...x, position: i + 1 })),
    features: ['local_pack', ...(r() > 0.5 ? ['ai_overview'] : []), ...(r() > 0.6 ? ['people_also_ask'] : [])],
    aiOverview: r() > 0.5 ? { present: true, citesYou: r() > 0.7, cited: comps.slice(0, 3).map(c => c.domain) } : { present: false },
    source: 'demo',
  };
}

export function demoBacklinks(domain) {
  const r = rng('bl|' + domain);
  const refDomains = Math.floor(8 + r() ** 2 * 600);
  const sample = ['yelp.com', 'facebook.com', 'bbb.org', 'yellowpages.com', 'nextdoor.com', 'chamberofcommerce.com', 'mapquest.com', 'linkedin.com', 'patch.com', 'manta.com', 'local-news.com', 'cityguide.org', 'reddit.com', 'angi.com', 'foursquare.com'];
  return {
    domain, backlinks: refDomains * Math.floor(2 + r() * 9), referringDomains: refDomains,
    authority: Math.round(clamp(5 + Math.log10(refDomains) * 18 + r() * 8, 1, 100)),
    spamScore: Math.round(r() * 30), dofollowPct: Math.round(55 + r() * 35),
    topReferrers: sample.map(d => ({ domain: d, authority: Math.round(30 + r() * 65), links: Math.ceil(r() * 4), dofollow: r() > 0.4 })).sort((a, b) => b.authority - a.authority),
    source: 'demo',
  };
}

export function demoPlaceDetails(project) {
  const r = rng('gbp|' + project.id);
  return {
    placeId: project.placeId || 'demo_target', name: project.name, address: project.address, phone: project.phone,
    website: project.domain ? `https://${project.domain}` : null, rating: project.demoRating ?? 4.7, reviewCount: project.demoReviews ?? 86,
    primaryCategory: project.category || 'Local business', categories: [project.category || 'Local business'],
    hours: r() > 0.3 ? ['Monday: Open 24 hours', 'Tuesday: Open 24 hours', 'Wednesday: Open 24 hours', 'Thursday: Open 24 hours', 'Friday: Open 24 hours', 'Saturday: Open 24 hours', 'Sunday: Open 24 hours'] : null,
    photoCount: Math.floor(r() * 40), description: r() > 0.5 ? `${project.name} serves ${project.city || 'the area'}.` : '',
    businessStatus: 'OPERATIONAL', mapsUrl: null,
    reviews: demoReviews(project),
    source: 'demo',
  };
}

export function demoReviews(project) {
  const r = rng('rev|' + project.id);
  const pos = ['Fast and professional, they got everything handled in hours.', 'Super responsive at 2am when we needed help. Highly recommend.', 'Very kind staff and they explained the whole process clearly.', 'Fair price and honest. Will use again.', 'Great communication from start to finish.'];
  const neg = ['Took a long time to call back.', 'Fees were higher than quoted on the phone.', 'Nobody answered the first two times I called.'];
  const names = ['Jordan P.', 'Alex R.', 'Sam T.', 'Chris M.', 'Taylor B.', 'Morgan K.', 'Jamie L.', 'Casey D.'];
  return Array.from({ length: 8 }, (_, i) => {
    const good = r() > 0.22;
    const rating = good ? (r() > 0.3 ? 5 : 4) : (r() > 0.5 ? 2 : 1);
    return {
      id: `demo_rev_${i}`, author: names[i], rating, text: good ? pos[Math.floor(r() * pos.length)] : neg[Math.floor(r() * neg.length)],
      time: new Date(Date.now() - Math.floor(r() * 120) * 86400000).toISOString(), replied: r() > 0.6,
    };
  }).sort((a, b) => b.time.localeCompare(a.time));
}
