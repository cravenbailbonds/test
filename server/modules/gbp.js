// Google Business Profile optimizer: completeness score + prioritized fixes + competitor benchmarks.
import { providerStatus } from '../config.js';
import * as places from '../providers/places.js';
import { demoPlaceDetails } from '../providers/demo.js';
import { latestRun, addRun } from '../store.js';

export async function fetchProfile(project) {
  if (providerStatus().places && project.placeId && !project.placeId.startsWith('demo')) return places.placeDetails(project.placeId);
  return demoPlaceDetails(project);
}

export function scoreProfile(p, benchmark = null) {
  const checks = [
    { id: 'name', label: 'Business name present', pass: Boolean(p.name), weight: 5, fix: 'Add your exact real-world business name (no keyword stuffing - it risks suspension).' },
    { id: 'category', label: 'Primary category set', pass: Boolean(p.primaryCategory), weight: 15, fix: 'Choose the most specific primary category - it is the #1 relevance factor in the local pack.' },
    { id: 'secondary', label: 'Secondary categories (3+)', pass: (p.categories || []).length >= 3, weight: 6, fix: 'Add secondary categories for every service line you genuinely offer.' },
    { id: 'website', label: 'Website linked', pass: Boolean(p.website), weight: 8, fix: 'Link your website (ideally a location landing page, not just the homepage).' },
    { id: 'phone', label: 'Phone number', pass: Boolean(p.phone), weight: 8, fix: 'Add a local phone number that matches your website and citations exactly.' },
    { id: 'hours', label: 'Opening hours', pass: Boolean(p.hours?.length), weight: 8, fix: 'Publish hours; profiles showing "Open now" get more calls. Add holiday hours too.' },
    { id: 'description', label: 'Business description (250+ chars)', pass: (p.description || '').length >= 250, weight: 6, fix: 'Write a 600-750 char description covering services, area served and what makes you different.' },
    { id: 'photos', label: '10+ photos', pass: p.photoCount >= 10, weight: 8, fix: 'Upload real photos: exterior (helps people find you), interior, team, work. Aim for 3+ new photos a month.' },
    { id: 'reviews', label: '25+ reviews', pass: p.reviewCount >= 25, weight: 12, fix: 'Ask every happy customer for a review with a direct link/QR code.' },
    { id: 'rating', label: 'Rating 4.5+', pass: (p.rating || 0) >= 4.5, weight: 10, fix: 'Reply to every review, resolve complaints quickly, and keep a steady flow of fresh reviews.' },
    { id: 'status', label: 'Profile operational', pass: !p.businessStatus || p.businessStatus === 'OPERATIONAL', weight: 14, fix: 'Your profile is not marked operational - check for suspension or a "temporarily closed" flag.' },
  ];
  if (benchmark) {
    checks.push({ id: 'review_gap', label: `Reviews vs top-3 average (${benchmark.avgReviews})`, pass: p.reviewCount >= benchmark.avgReviews, weight: 10, fix: `You need about ${Math.max(0, benchmark.avgReviews - p.reviewCount)} more reviews to match the top-3 average.` });
  }
  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.filter(c => c.pass).reduce((a, c) => a + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks };
}

export async function auditProfile(project) {
  const profile = await fetchProfile(project);
  // Benchmark against the businesses that beat you on the grid.
  const grid = latestRun(project.id, 'grid');
  let benchmark = null;
  if (grid) {
    const top = grid.data.leaderboard.filter(c => !c.isTarget).slice(0, 3);
    if (top.length) benchmark = {
      avgReviews: Math.round(top.reduce((a, c) => a + (c.reviews || 0), 0) / top.length),
      avgRating: +(top.reduce((a, c) => a + (c.rating || 0), 0) / top.length).toFixed(2),
      competitors: top.map(c => ({ name: c.name, reviews: c.reviews, rating: c.rating, category: c.category, visibility: c.visibility })),
    };
  }
  const scored = scoreProfile(profile, benchmark);
  return addRun(project.id, 'gbp', { profile: { ...profile, reviews: undefined }, ...scored, benchmark, source: profile.source });
}
