import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../server/store.js';
import { computeGap } from '../server/modules/research.js';
import { toxicity, disavowFile } from '../server/modules/linkaudit.js';
import { analyzeCompetitors } from '../server/modules/brief.js';
import { parsePage, analyze } from '../server/modules/audit.js';
import { classifySources } from '../server/modules/traffic.js';
import { perception } from '../server/modules/aivisibility.js';
import { extractBusinessesHeuristic } from '../server/providers/engines.js';
import { fill, reviewUrl } from '../server/modules/reviewrequests.js';
import { toE164 } from '../server/providers/messaging.js';
import { dfsLocation } from '../server/lib/util.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp2-'));
store.resetForTests(dir);

test('keyword gap buckets', () => {
  const g = computeGap('me.com', [
    { rows: [{ keyword: 'a', position: 5 }, { keyword: 'b', position: 1 }, { keyword: 'c', position: 20 }] },
    { rows: [{ keyword: 'a', position: 2 }, { keyword: 'b', position: 4 }, { keyword: 'c', position: 3 }, { keyword: 'd', position: 1 }, { keyword: 'e', position: 7 }] },
    { rows: [{ keyword: 'c', position: 9 }, { keyword: 'd', position: 3 }] },
  ]);
  assert.deepEqual(g.missing.map(k => k.keyword), ['d']);
  assert.deepEqual(g.untapped.map(k => k.keyword), ['e']);
  assert.ok(g.weak.some(k => k.keyword === 'c'));
  assert.ok(g.strong.some(k => k.keyword === 'b'));
});

test('backlink toxicity + disavow file', () => {
  const bad = toxicity({ domainFrom: 'free-seo-links.xyz', anchor: 'best online casino', spamScore: 80, authority: 1, tld: 'xyz', dofollow: true });
  const good = toxicity({ domainFrom: 'bbb.org', anchor: 'Acme Plumbing', spamScore: 2, authority: 70, tld: 'org', dofollow: true }, ['acme']);
  assert.equal(bad.level, 'toxic');
  assert.equal(good.level, 'ok');
  const li = toxicity({ domainFrom: 'linkedin.com', anchor: 'Acme', spamScore: 3, authority: 80, tld: 'com', dofollow: false }, ['acme']);
  assert.ok(!li.reasons.some(r => r.includes('directory')), 'linkedin is not a link directory');
  assert.ok(toxicity({ domainFrom: 'a1.weblinks.biz', anchor: 'x', spamScore: 0, authority: 5, tld: 'biz', dofollow: true }).reasons.some(r => r.includes('directory')));
  const f = disavowFile(['a.xyz', 'a.xyz', 'b.top'], { domain: 'me.com' });
  assert.match(f, /^domain:a\.xyz$/m);
  assert.equal(f.match(/domain:/g).length, 2);
});

test('content brief competitor analysis', () => {
  const page = (h2s, body) => ({ parsed: parsePage(`<html><body><h1>Emergency plumber</h1>${h2s.map(h => `<h2>${h}</h2>`).join('')}<p>${body}</p></body></html>`, 'https://x.com/') });
  const body = 'water heater repair drain cleaning licensed technicians same day service upfront pricing '.repeat(20);
  const a = analyzeCompetitors([page(['How much does it cost?', 'Our process'], body), page(['How much does it cost?', 'Service area'], body), page(['Why choose us'], body)], 'emergency plumber');
  assert.equal(a.pagesAnalyzed, 3);
  assert.equal(a.headings[0].heading, 'how much does it cost?');
  assert.ok(a.terms.some(t => t.term === 'water heater'));
  assert.ok(a.recommendedWords >= 600);
  assert.ok(a.questions.includes('How much does it cost?'));
});

test('new audit checks fire', () => {
  const html = `<html><head><title>Home page title for test</title><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script><meta http-equiv="refresh" content="0;url=/x"></head><body><font>old</font><a href="http://acme.com/x">click here</a><img src="a.png"><img src="b.png"><img src="c.png"></body></html>`;
  const page = { url: 'https://acme.com/', status: 200, ms: 50, bytes: 30000, redirects: 0, xRobots: '', encoding: '', hsts: false, depth: 0, parsed: parsePage(html, 'https://acme.com/') };
  const res = analyze({ start: 'https://acme.com/', pages: [page], broken: [], robots: null, sitemap: null, sitemapUrls: [], llms: null }, {});
  const ids = new Set(res.issues.map(i => i.id));
  for (const id of ['render_blocking', 'img_dims', 'no_compression', 'no_hsts', 'meta_refresh', 'http_links', 'generic_anchor', 'deprecated_html', 'no_favicon']) assert.ok(ids.has(id), id);
  assert.ok(res.themeScores.Performance < 100);
});

test('AI traffic classification', () => {
  const s = classifySources([{ source: 'google', medium: 'organic', sessions: 90 }, { source: 'chatgpt.com', medium: 'referral', sessions: 8 }, { source: 'perplexity.ai', medium: 'referral', sessions: 2 }]);
  assert.equal(s.aiSessions, 10);
  assert.equal(s.aiShare, 10);
  assert.equal(s.organicSessions, 90);
});

test('perception matrix finds gaps and strengths', () => {
  const p = { name: 'Acme Plumbing' };
  const r = perception([{ attributes: [
    { business: 'Acme Plumbing', attribute: 'Price / value', sentiment: 'positive' },
    { business: 'Rival Co', attribute: 'Speed / availability', sentiment: 'positive' },
    { business: 'Rival Co', attribute: 'Speed / availability', sentiment: 'negative' },
  ] }], p);
  assert.equal(r.brands[0], 'Acme Plumbing');
  assert.equal(r.rows.find(x => x.attribute === 'Speed / availability').cells[1].net, 0);
  assert.ok(r.gaps[0].includes('Speed / availability'));
  assert.deepEqual(r.strengths, ['Price / value']);
});

test('heuristic business extraction from AI answers', () => {
  const names = extractBusinessesHeuristic('Top picks:\n1. **Acme Plumbing** - fast and fair\n2. Rival Co: great reviews\n- Valley Pros (24/7)');
  assert.deepEqual(names, ['Acme Plumbing', 'Rival Co', 'Valley Pros']);
});

test('review request templates, links and phone numbers', () => {
  const p = store.createProject({ name: 'Acme Plumbing', city: 'Springfield, OH', placeId: 'ChIJabc' });
  const c = store.addContact(p.id, { name: 'Jane Doe', phone: '937-555-0100', channel: 'sms' });
  const msg = fill('Hi {first} from {business} in {city}: {link}', p, c, 'https://app.example');
  assert.equal(msg, `Hi Jane from Acme Plumbing in Springfield: https://app.example/r/${c.token}`);
  assert.match(reviewUrl(p), /writereview\?placeid=ChIJabc/);
  assert.equal(toE164('(937) 555-0100'), '+19375550100');
  assert.equal(toE164('123'), null);
});

test('review queue sends due requests (simulated) and click tracking redirects', async () => {
  const { addCustomers, processQueue, recordClick, requestStats } = await import('../server/modules/reviewrequests.js');
  const p = store.createProject({ name: 'Queue Co', city: 'Dayton' });
  addCustomers(p, [{ name: 'A', phone: '9375550101' }, { name: 'B', email: 'b@example.com' }, { name: 'Nope' }], { delayHours: 1 });
  assert.equal(store.listContacts(p.id).length, 2, 'rows without contact info are skipped');
  assert.equal(await processQueue(Date.now()), 0, 'not due yet');
  assert.equal(await processQueue(Date.now() + 2 * 3600000), 2);
  const c = store.listContacts(p.id)[0];
  assert.equal(c.status, 'sent');
  assert.equal(c.simulated, true);
  assert.ok(recordClick(c.token).startsWith('https://'));
  assert.equal(requestStats(p).clicked, 1);
  assert.equal(await processQueue(Date.now() + 5 * 86400000), 1, 'one follow-up for the unclicked contact');
});

test('DataForSEO location names', () => {
  assert.equal(dfsLocation('Springfield, OH'), 'Springfield,Ohio,United States');
  assert.equal(dfsLocation('45502'), '45502,United States');
  assert.equal(dfsLocation(''), 'United States');
});

test('demo pipelines: research, link audit, organic devices, AI engines, reports', async () => {
  const { domainOverview, keywordGap } = await import('../server/modules/research.js');
  const { auditBacklinks } = await import('../server/modules/linkaudit.js');
  const { trackOrganic } = await import('../server/modules/keywords.js');
  const { runAiVisibility } = await import('../server/modules/aivisibility.js');
  const { reportBundle, newShare, bundleForShare } = await import('../server/modules/reports.js');
  const p = store.createProject({ name: 'Acme Plumbing', domain: 'acme.example', city: 'Springfield', state: 'OH', category: 'Plumber', lat: 39.9, lng: -83.8, keywords: ['plumber springfield', 'drain cleaning'], devices: ['desktop', 'mobile'], competitors: ['rival.com'] });
  assert.ok((await domainOverview(p, 'rival.com')).data.keywords.length > 0);
  assert.ok((await keywordGap(p, ['rival.com'])).data.counts);
  assert.ok((await auditBacklinks(p)).data.counts.toxic > 0);
  const org = await trackOrganic(p);
  assert.equal(org.data.rows.length, 4, '2 keywords x 2 devices');
  assert.ok(org.data.shareOfVoice.some(x => x.domain === 'rival.com'));
  const ai = await runAiVisibility(p);
  assert.equal(ai.data.engines.length, 4, 'all four engines simulated in demo');
  assert.ok(ai.data.perception.rows.length === 8);
  const share = newShare(p, 'https://x.test');
  assert.match(share.url, /^https:\/\/x\.test\/#\/share\//);
  assert.equal(bundleForShare(share.token).project.name, 'Acme Plumbing');
  assert.equal(bundleForShare('nope'), null);
  assert.ok(reportBundle(p).scorecard);
  store.flush();
});
