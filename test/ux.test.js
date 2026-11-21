import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../server/store.js';
import { planGrid, runGridScan } from '../server/modules/maprank.js';
import { gridMetrics } from '../server/lib/metrics.js';
import { suggestKeywords } from '../server/modules/keywords.js';
import { widgetHtml } from '../server/modules/widget.js';
import { buildPlan } from '../server/modules/actionplan.js';
import { haversine } from '../server/lib/geo.js';

store.resetForTests(fs.mkdtempSync(path.join(os.tmpdir(), 'rp3-')));
const P = () => store.createProject({ name: 'Acme Plumbing', lat: 39.92, lng: -83.8, city: 'Springfield', category: 'Plumber' });

test('grid plan: moved center and switched-off points', () => {
  const p = P();
  const base = planGrid(p, { size: 5, radiusMiles: 2 });
  assert.equal(base.points.length, 25);
  const moved = planGrid(p, { size: 5, radiusMiles: 2, center: { lat: 40, lng: -83.9 }, excluded: ['0,0', '4,4'] });
  assert.equal(moved.points.length, 23);
  assert.ok(haversine(moved.center, { lat: 40, lng: -83.9 }) < 1);
  assert.ok(!moved.points.some(x => x.row === 0 && x.col === 0));
});

test('scan respects center + exclusions and stores them', async () => {
  const p = P();
  const r = await runGridScan(p, { keyword: 'plumber', size: 3, radiusMiles: 1, source: 'demo', center: { lat: 39.93, lng: -83.81 }, excluded: ['1,1'] });
  assert.equal(r.data.points.length, 8);
  assert.deepEqual(r.data.config.excluded, ['1,1']);
  assert.equal(r.data.config.business.lat, 39.92);
  assert.ok(r.data.leaderboard.every(c => 'lat' in c && c.distribution));
});

test('rank distribution buckets add up', () => {
  const m = gridMetrics([1, 3, 4, 10, 11, 20, null, null]);
  assert.deepEqual(m.distribution, { good: 2, average: 2, poor: 2, out: 2 });
});

test('keyword suggestions without AI', async () => {
  const k = await suggestKeywords('Bail Bonds', 'Springfield, OH');
  assert.ok(k.includes('bail bonds springfield'));
  assert.ok(k.includes('bail bonds near me'));
  assert.deepEqual(await suggestKeywords('', 'x'), []);
});

test('review widget shows recent reviews unfiltered and escapes text', () => {
  const p = P();
  store.addRun(p.id, 'reviews', { rating: 4.2, total: 10, reviews: [{ author: 'A', rating: 1, text: 'Bad <script>x</script>', time: new Date().toISOString() }, { author: 'B', rating: 5, text: 'Great', time: new Date().toISOString() }] });
  const html = widgetHtml(p);
  assert.ok(html.includes('Bad &lt;script&gt;'), 'negative review shown, escaped');
  assert.ok(html.includes('Great'));
  assert.ok(!html.includes('<script>x'));
});

test('action plan links fixes to the right generator', async () => {
  const p = P();
  store.addRun(p.id, 'gbp', { score: 50, checks: [{ id: 'description', label: 'Business description (250+ chars)', pass: false, weight: 6, fix: 'Write one' }], profile: {} });
  const t = buildPlan(p).find(x => x.title.startsWith('Business description'));
  assert.equal(t.link, 'content?type=gbp_description');
  store.flush();
});
