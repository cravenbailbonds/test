// Google Places API (New). Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
import { config } from '../config.js';
import { fetchWithTimeout, normalizeDomain } from '../lib/util.js';

const BASE = 'https://places.googleapis.com/v1';

async function call(path, { method = 'GET', body, fields }) {
  const res = await fetchWithTimeout(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.placesKey, 'X-Goog-FieldMask': fields },
    body: body ? JSON.stringify(body) : undefined,
  }, 20000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${json.error?.message || res.statusText}`);
  return json;
}

const LIST_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.websiteUri,places.nationalPhoneNumber';

function mapPlace(p) {
  return {
    name: p.displayName?.text, placeId: p.id, address: p.formattedAddress,
    lat: p.location?.latitude, lng: p.location?.longitude, rating: p.rating ?? null, reviews: p.userRatingCount ?? 0,
    category: p.primaryTypeDisplayName?.text, domain: p.websiteUri ? normalizeDomain(p.websiteUri) : null, phone: p.nationalPhoneNumber,
  };
}

/** Ranked Maps-style results for a query as seen from a GPS point (tight location bias). */
export async function searchAt(query, point, radiusM = 1500) {
  const json = await call('/places:searchText', {
    method: 'POST', fields: LIST_FIELDS,
    body: { textQuery: query, pageSize: 20, rankPreference: 'RELEVANCE', locationBias: { circle: { center: { latitude: point.lat, longitude: point.lng }, radius: Math.min(50000, Math.max(200, radiusM)) } } },
  });
  return (json.places || []).map(mapPlace);
}

/** Find a business (used by the "connect your Google Business Profile" step). */
export async function findBusiness(text) {
  const json = await call('/places:searchText', { method: 'POST', fields: LIST_FIELDS, body: { textQuery: text, pageSize: 5 } });
  return (json.places || []).map(mapPlace);
}

export async function placeDetails(placeId) {
  const p = await call(`/places/${encodeURIComponent(placeId)}`, {
    fields: 'id,displayName,formattedAddress,location,rating,userRatingCount,primaryTypeDisplayName,types,websiteUri,nationalPhoneNumber,regularOpeningHours,photos,editorialSummary,businessStatus,googleMapsUri,reviews',
  });
  return {
    placeId: p.id, name: p.displayName?.text, address: p.formattedAddress, phone: p.nationalPhoneNumber, website: p.websiteUri,
    lat: p.location?.latitude, lng: p.location?.longitude,
    rating: p.rating ?? null, reviewCount: p.userRatingCount ?? 0, primaryCategory: p.primaryTypeDisplayName?.text, categories: p.types || [],
    hours: p.regularOpeningHours?.weekdayDescriptions || null, photoCount: (p.photos || []).length, description: p.editorialSummary?.text || '',
    businessStatus: p.businessStatus, mapsUrl: p.googleMapsUri,
    reviews: (p.reviews || []).map((r, i) => ({ id: r.name || String(i), author: r.authorAttribution?.displayName, rating: r.rating, text: r.text?.text || r.originalText?.text || '', time: r.publishTime, replied: null })),
    source: 'google_places',
  };
}
