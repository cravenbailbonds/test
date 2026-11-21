import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGrid, haversine } from '../server/lib/geo.js';
import { gridMetrics, competitorLeaderboard, organicVisibility } from '../server/lib/metrics.js';
import { isSameBusiness, normalizePhone } from '../server/lib/util.js';
import { parsePage, analyze, robotsAllows } from '../server/modules/audit.js';
import { contentScore } from '../server/modules/content.js';
import { sentiment, analyzeReviews } from '../server/modules/reviews.js';
import { locateBrand, summarize } from '../server/modules/aivisibility.js';
import { clusterKeywords, opportunity } from '../server/modules/keywords.js';
import { checkNap } from '../server/modules/citations.js';
import * as store from '../server/store.js';

const center = { lat: 39.9242, lng: -83.8088 };

test('square grid has size^2 points, spans radius, centre at origin', () => {
  const g = buildGrid(center, { size: 7, radiusMiles: 3 });
  assert.equal(g.length, 49);
  const mid = g.find(p => p.row === 3 && p.col === 3);
  assert.ok(haversine(mid, center) < 1);
  const corner = g.find(p => p.row === 0 && p.col === 3);
  assert.ok(Math.abs(haversine(corner, center) - 3 * 1609.344) < 5, 'north edge at 3 miles');
  assert.throws(() => buildGrid(center, { size: 6 }));
});

test('circle grid drops corners, rings grid counts 1 + 8+16+24', () => {
  assert.ok(buildGrid(center, { size: 7, shape: 'circle' }).length < 49);
  assert.equal(buildGrid(center, { size: 7, shape: 'rings' }).length, 1 + 8 + 16 + 24);
});

test('grid metrics: ARP, ATRP, SoLV', () => {
  const m = gridMetrics([1, 2, 3, 10, null]);
  assert.equal(m.arp, 4);
  assert.equal(m.atrp, (1 + 2 + 3 + 10 + 21) / 5);
  assert.equal(m.solv, 60);
  assert.equal(m.found, 4);
  assert.equal(gridMetrics([1, 1, 1]).visibility, 100);
  assert.equal(gridMetrics([null, null]).visibility, 0);
});

test('competitor leaderboard ranks by visibility and flags target', () => {
  const pts = [{ results: [{ name: 'A' }, { name: 'Me' }] }, { results: [{ name: 'Me' }, { name: 'A' }] }, { results: [{ name: 'A' }] }];
  const lb = competitorLeaderboard(pts, r => r.name === 'Me');
  assert.equal(lb[0].name, 'A');
  assert.equal(lb.find(x => x.name === 'Me').isTarget, true);
  assert.equal(lb.find(x => x.name === 'Me').appearances, 2);
});

test('business matching by name, phone, domain', () => {
  const p = { name: 'Craven Bail Bonds LLC', phone: '(937) 555-0101', domain: 'www.example.com' };
  assert.ok(isSameBusiness({ name: 'Craven Bail Bonds' }, p));
  assert.ok(isSameBusiness({ name: 'Other', phone: '+1 937-555-0101' }, p));
  assert.ok(isSameBusiness({ name: 'Other', domain: 'example.com' }, p));
  assert.ok(!isSameBusiness({ name: 'Liberty Bail Bonds' }, p));
  assert.equal(normalizePhone('+1 (937) 555-0101'), '9375550101');
});

test('page parser extracts SEO elements and schema', () => {
  const html = `<html lang="en"><head><title>Plumber in Springfield | Acme</title><meta name="description" content="Fast plumbing"><meta name="viewport" content="width=device-width"><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"Plumber","sameAs":["https://g.page/x"]}</script></head><body><h1>Plumber</h1><img src="a.jpg"><a href="/contact">c</a><a href="tel:9375550101">call</a></body></html>`;
  const p = parsePage(html, 'https://acme.com/');
  assert.equal(p.title, 'Plumber in Springfield | Acme');
  assert.equal(p.canonical, 'https://acme.com/');
  assert.deepEqual(p.schemaTypes, ['Plumber']);
  assert.equal(p.imgs[0].alt, null);
  assert.ok(p.links.some(l => l.tel));
  assert.equal(p.lang, 'en');
});

test('audit analysis flags local + AI issues', () => {
  const page = html => ({ url: 'https://acme.com/', status: 200, ms: 100, bytes: 1000, redirects: 0, xRobots: '', parsed: parsePage(html, 'https://acme.com/') });
  const res = analyze({ start: 'https://acme.com/', pages: [page('<html><head><title>Home</title></head><body>hello</body></html>')], broken: [], robots: 'User-agent: GPTBot\nDisallow: /\n', sitemap: null, llms: null }, { phone: '937-555-0101', city: 'Springfield' });
  const ids = res.issues.map(i => i.id);
  for (const id of ['no_local_schema', 'nap_phone', 'ai_blocked', 'no_sitemap', 'no_viewport', 'no_city']) assert.ok(ids.includes(id), id);
  assert.deepEqual(res.aiBotsBlocked, ['GPTBot']);
  assert.ok(res.health < 100);
});

test('robots.txt parsing honours specific agent groups', () => {
  const r = 'User-agent: *\nDisallow: /private\n\nUser-agent: ClaudeBot\nDisallow: /\n';
  assert.equal(robotsAllows(r, 'ClaudeBot', '/'), false);
  assert.equal(robotsAllows(r, 'GPTBot', '/'), true);
  assert.equal(robotsAllows(r, 'GPTBot', '/private/x'), false);
});

test('content score rewards keyword use and structure', () => {
  const good = '## Emergency plumber in Springfield\nNeed an emergency plumber? ' + 'We fix leaks fast. '.repeat(150) + 'emergency plumber available. Call us today. What does it cost? It depends.';
  const s = contentScore(good, 'emergency plumber', { city: 'Springfield' });
  assert.ok(s.score >= 70, String(s.score));
  assert.ok(contentScore('short text', 'emergency plumber').score < 40);
});

test('review sentiment and themes', () => {
  assert.equal(sentiment({ rating: 5, text: 'Great fast service' }).label, 'positive');
  assert.equal(sentiment({ rating: 1, text: 'Rude and slow' }).label, 'negative');
  const a = analyzeReviews([{ rating: 1, text: 'too expensive fee', replied: false, time: new Date().toISOString() }]);
  assert.equal(a.unreplied, 1);
  assert.ok(a.themeStats.find(t => t.theme === 'Price / fees'));
});

test('AI visibility locates brand and summarizes', () => {
  const proj = { name: 'Acme Plumbing', domain: 'acme.com' };
  assert.deepEqual(locateBrand('...', ['Best Plumbers', 'Acme Plumbing LLC'], proj), { mentioned: true, position: 2 });
  assert.equal(locateBrand('nothing', ['X'], proj).mentioned, false);
  const s = summarize([{ businesses: ['Acme Plumbing'], mentioned: true, position: 1, sentiment: 'positive', citedDomains: ['yelp.com'] }, { businesses: ['Other'], mentioned: false, position: null, sentiment: 'not_mentioned', citedDomains: [] }], proj);
  assert.equal(s.mentionRate, 50);
  assert.equal(s.competitors[0].name, 'Other');
  assert.ok(s.score > 0 && s.score <= 100);
});

test('keyword clustering and opportunity', () => {
  const rows = [{ keyword: 'bail bonds near me', volume: 500, intent: 'transactional', difficulty: 30 }, { keyword: 'cheap bail bonds', volume: 100, intent: 'transactional', difficulty: 20 }, { keyword: 'how does bail work', volume: 900, intent: 'informational', difficulty: 40 }];
  const c = clusterKeywords(rows);
  assert.ok(c.find(x => x.name === 'bail bonds').keywords.length === 2);
  assert.ok(opportunity({ volume: 1000, difficulty: 10, intent: 'transactional' }) > opportunity({ volume: 1000, difficulty: 80, intent: 'navigational' }));
});

test('NAP check on a listing page', () => {
  const r = checkNap('Acme Plumbing · 100 S Fountain Ave, Springfield · (937) 555-0142', { name: 'Acme Plumbing', address: '100 S Fountain Avenue, Springfield, OH', phone: '937-555-0142' });
  assert.deepEqual([r.nameOk, r.addrOk, r.phoneOk], [true, true, true]);
});

test('store + demo end-to-end: grid scan, gbp, plan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
  store.resetForTests(dir);
  const { runGridScan } = await import('../server/modules/maprank.js');
  const { auditProfile } = await import('../server/modules/gbp.js');
  const { buildPlan, scorecard } = await import('../server/modules/actionplan.js');
  const p = store.createProject({ name: 'Acme Plumbing', lat: center.lat, lng: center.lng, city: 'Springfield', category: 'Plumber' });
  const run = await runGridScan(p, { keyword: 'plumber', size: 5, radiusMiles: 2, source: 'demo' });
  assert.equal(run.data.points.length, 25);
  assert.equal(run.data.config.source, 'demo');
  assert.ok(run.data.leaderboard.some(c => c.isTarget));
  const again = await runGridScan(p, { keyword: 'plumber', size: 5, radiusMiles: 2, source: 'demo' });
  assert.ok(again.data.delta, 'second scan has delta vs first');
  await auditProfile(p);
  assert.ok(buildPlan(p).length > 0);
  assert.ok(scorecard(p).overall !== null);
  store.flush();
});
