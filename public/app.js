// RankPilot front end - vanilla JS SPA, no build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : Number(n).toLocaleString();
const ago = t => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Working…`;
  // Errors are shown to the user, not rethrown (a rethrow from a click handler is an unhandled rejection).
  try { return await fn(); } catch (e) { toast('⚠ ' + e.message, 6000); return undefined; } finally { btn.disabled = false; btn.innerHTML = label; }
}
const srcPill = s => !s ? '' : s === 'demo' ? '<span class="pill demo" title="Simulated data - add the provider API key in .env for live data">DEMO DATA</span>' : `<span class="pill live">LIVE · ${esc(s.replace(/_/g, ' '))}</span>`;
const ring = (v, label) => `<div class="score-ring" style="--v:${v ?? 0};--c:${v == null ? 'var(--border)' : v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--warning)' : 'var(--critical)'}"><div>${v ?? '–'}</div></div>${label ? `<div class="muted small">${label}</div>` : ''}`;

// ---------------------------------------------------------------- state & nav
const S = { status: null, projects: [], pid: store.get('pid', null), get project() { return this.projects.find(p => p.id === this.pid); } };
const NAV = [
  ['Overview', [['locations', '▦', 'All Businesses'], ['overview', '⌂', 'Dashboard'], ['plan', '✓', 'Action Plan']]],
  ['Local', [['maps', '◎', 'Map Rank Grid'], ['gbp', '★', 'Business Profile'], ['reviews', '✎', 'Reviews'], ['requests', '✉', 'Review Requests'], ['citations', '≡', 'Listings']]],
  ['Organic', [['audit', '⚙', 'Site Audit'], ['keywords', '⌕', 'Keyword Research'], ['research', '⚔', 'Competitor Research'], ['organic', '↗', 'Rank Tracking'], ['traffic', '▤', 'Traffic Insights'], ['backlinks', '⛓', 'Backlinks']]],
  ['AI Search', [['ai', '✦', 'AI Visibility'], ['content', '✍', 'Content Studio']]],
  ['Account', [['report', '⎙', 'Client Report'], ['settings', '⚑', 'Project Settings'], ['new', '+', 'Add Business']]],
];
const TITLES = { ...Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, , t]) => [k, t]))), alerts: 'Alerts', share: 'Report' };

function renderNav(active) {
  $('#nav').innerHTML = NAV.map(([g, items]) => `<div class="group">${g}</div>` + items.map(([k, ico, t]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}"><span class="ico">${ico}</span>${t}</a>`).join('')).join('');
  $('#projectSelect').innerHTML = S.projects.map(p => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option>No businesses yet</option>';
  const unread = (S.alerts || []).filter(a => !a.read).length;
  $('#nav').insertAdjacentHTML('afterbegin', `<a href="#/alerts" class="${active === 'alerts' ? 'active' : ''}"><span class="ico">🔔</span>Alerts ${unread ? `<span class="pill demo" style="margin-left:auto">${unread}</span>` : ''}</a>`);
  const pv = S.status?.providers || {};
  $('#providerBadges').innerHTML = [['Claude', pv.ai], ['ChatGPT', pv.openai], ['Gemini', pv.gemini], ['Perplexity', pv.perplexity], ['Google Places', pv.places], ['DataForSEO', pv.dataforseo], ['Search Console/GA4', pv.google], ['Email', pv.email], ['SMS', pv.sms], ['Site crawler', true]].map(([n, on]) => `<div class="provider"><span>${n}</span><span class="pill ${on ? 'live' : 'demo'}">${on ? 'live' : 'demo'}</span></div>`).join('');
}

async function refreshProjects() { S.projects = await api('/projects'); if (!S.project && S.projects[0]) S.pid = S.projects[0].id; store.set('pid', S.pid); }

const views = {};
let liveMaps = [];
const track = m => { liveMaps.push(m); return m; };
async function router() {
  const route = (location.hash.replace(/^#\//, '') || 'overview').split('?')[0];
  liveMaps.forEach(m => { try { m.remove(); } catch { } }); liveMaps = [];
  if (route.startsWith('share/')) return views.share($('#view'), route.slice(6));
  if (S.pid) S.alerts = await api('/alerts?pid=' + S.pid).catch(() => []);
  $('#sidebar').classList.remove('open');
  const view = !S.projects.length && route !== 'new' ? 'new' : route;
  renderNav(view);
  $('#pageTitle').textContent = TITLES[view] || 'RankPilot';
  $('#pageActions').innerHTML = '';
  const el = $('#view'); el.innerHTML = '<div class="muted"><span class="spinner"></span> Loading…</div>';
  try { await (views[view] || views.overview)(el, S.project); csvButtons(el); } catch (e) { el.innerHTML = `<div class="card"><b>Something went wrong:</b> ${esc(e.message)}</div>`; console.error(e); }
  el.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- CSV export for every data table
function tableToCsv(t) {
  return [...t.rows].map(r => [...r.cells].filter(c => !c.querySelector('input[type=checkbox],button')).map(c => `"${c.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(',')).join('\n');
}
function csvButtons(root) {
  const add = () => root.querySelectorAll('.card table').forEach(t => {
    if (t.dataset.csv || t.rows.length < 3) return; t.dataset.csv = 1;
    const b = document.createElement('button'); b.className = 'ghost small csvbtn no-print'; b.textContent = 'CSV'; b.title = 'Download this table as CSV';
    b.onclick = () => { const h = t.closest('.card')?.querySelector('h2')?.childNodes[0]?.textContent?.trim() || 'table'; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tableToCsv(t)], { type: 'text/csv' })); a.download = `${(S.project?.name || 'rankpilot')}-${h}`.replace(/[^\w-]+/g, '-').toLowerCase() + '.csv'; a.click(); };
    (t.closest('.table-wrap') || t).insertAdjacentElement('beforebegin', b);
  });
  add(); new MutationObserver(add).observe(root, { childList: true, subtree: true });
}

// ---------------------------------------------------------------- tiny charts
function lineChart(series, { height = 180, yMax = 100, yLabel = '', invert = false } = {}) {
  // series: [{name, color, points:[{x:Date|string, y:number}]}]
  const all = series.flatMap(s => s.points); if (!all.length) return '<div class="muted small">Run more scans to see a trend.</div>';
  const xs = [...new Set(all.map(p => +new Date(p.x)))].sort((a, b) => a - b);
  const W = 600, H = height, L = 34, R = 10, T = 10, B = 22;
  const max = yMax ?? Math.max(...all.map(p => p.y)) * 1.1;
  const xp = t => xs.length === 1 ? (L + W - R) / 2 : L + ((t - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - L - R);
  const yp = v => invert ? T + ((v - 1) / (max - 1)) * (H - T - B) : H - B - (v / max) * (H - T - B);
  const grid = [0, 0.5, 1].map(f => { const v = invert ? 1 + f * (max - 1) : f * max; return `<line x1="${L}" x2="${W - R}" y1="${yp(v)}" y2="${yp(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${yp(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(v)}</text>`; }).join('');
  const paths = series.map(s => { const pts = s.points.map(p => [xp(+new Date(p.x)), yp(p.y)]); return `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p.join(',')).join('')}" fill="none" stroke="${s.color}" stroke-width="2"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join(''); }).join('');
  const id = 'c' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const root = document.getElementById(id); if (!root) return;
    const svg = root.querySelector('svg'), tip = root.querySelector('.tip'), cross = root.querySelector('.cross');
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
      const t = xs.reduce((a, b) => Math.abs(xp(b) - x) < Math.abs(xp(a) - x) ? b : a);
      cross.setAttribute('x1', xp(t)); cross.setAttribute('x2', xp(t)); cross.style.opacity = 1;
      const rows = series.map(s => { const p = s.points.find(p => +new Date(p.x) === t); return p ? `<span style="color:${s.color}">●</span> ${esc(s.name)}: <b>${p.y}</b>` : ''; }).filter(Boolean);
      tip.innerHTML = `${new Date(t).toLocaleDateString()}<br>${rows.join('<br>')}`; tip.style.left = (xp(t) / W) * r.width + 'px'; tip.style.top = '20px'; tip.style.opacity = 1;
    });
    svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; cross.style.opacity = 0; });
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} trend">${grid}<line class="cross" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" style="opacity:0"/>${paths}<text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)">${new Date(xs[0]).toLocaleDateString()}</text><text x="${W - R}" y="${H - 4}" font-size="10" fill="var(--muted)" text-anchor="end">${new Date(xs[xs.length - 1]).toLocaleDateString()}</text></svg><div class="tip"></div></div>${legend}`;
}
function spark(vals = [], w = 80, h = 22) {
  if (!vals?.length) return '';
  const max = Math.max(...vals, 1), min = Math.min(...vals);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)}`).join(' ');
  return `<svg width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--series-1)" stroke-width="1.5"/></svg>`;
}
const hbars = (rows, max) => `<div class="bars">${rows.map(r => `<div class="bar-row" title="${esc(r.label)}: ${r.value}"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${max ? (100 * r.value) / max : 0}%;${r.color ? 'background:' + r.color : ''}"></div></div><span class="num">${fmt(r.value)}</span></div>`).join('')}</div>`;

function emptyState(el, title, text, btnLabel, onClick) {
  el.innerHTML = `<div class="card empty"><h2>${title}</h2><p>${text}</p>${btnLabel ? `<button id="emptyBtn">${btnLabel}</button>` : ''}</div>`;
  if (btnLabel) $('#emptyBtn').onclick = e => onClick(e.currentTarget);
}

// ---------------------------------------------------------------- Dashboard
views.overview = async (el, p) => {
  const [plan, runs] = await Promise.all([api(`/projects/${p.id}/plan`), api(`/projects/${p.id}/runs?limit=12`)]);
  const c = plan.scorecard;
  const tile = (k, label, link) => `<a class="card stat" href="#/${link}" style="text-decoration:none;color:inherit"><span class="label">${label}</span><span class="value">${c.parts[k] ?? '–'}</span><span class="sub">${c.parts[k] == null ? 'Not scanned yet - click to run' : 'out of 100'}</span></a>`;
  el.innerHTML = `
  <div class="grid split-r">
    <div class="card"><h2>Overall visibility</h2><div class="score-row">${ring(c.overall)}<div><div><b>${esc(p.name)}</b></div><div class="muted small">${esc([p.category, p.city].filter(Boolean).join(' · '))}</div><div class="small" style="margin-top:6px">${c.rating ? `★ ${c.rating} · ${fmt(c.reviews)} reviews` : ''}</div></div></div>
      <p class="muted small">One number blending map pack, profile, website health, AI answers, organic and listings - weighted by how much each drives calls for a local business.</p></div>
    <div class="card"><h2>Map visibility over time</h2>${lineChart(groupTrend(c.trend), { yLabel: 'Visibility' })}</div>
  </div>
  <div class="grid g6" style="margin-top:16px">${tile('maps', 'Map pack visibility', 'maps')}${tile('gbp', 'Business Profile', 'gbp')}${tile('website', 'Website health', 'audit')}${tile('ai', 'AI visibility', 'ai')}${tile('organic', 'Organic visibility', 'organic')}${tile('citations', 'Listings', 'citations')}</div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Do these next <a href="#/plan" class="small" style="margin-left:auto">Full plan →</a></h2>${plan.tasks.slice(0, 6).map(taskHtml).join('') || '<p class="muted">Nothing urgent. 🎉</p>'}</div>
    <div class="card"><h2>Recent activity</h2>${runs.length ? `<table><tbody>${runs.map(r => `<tr><td>${esc(TYPE_LABEL[r.type] || r.type)}</td><td>${esc(r.summary)}</td><td class="muted small">${ago(r.createdAt)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No scans yet. Use <b>Run full checkup</b> above.</p>'}</div>
  </div>`;
  $('#pageActions').innerHTML = '<button id="checkup">Run full checkup</button>';
  $('#checkup').onclick = e => busy(e.currentTarget, async () => {
    const kw = p.gridKeywords?.[0] || p.keywords?.[0] || [p.category, p.city?.split(',')[0]].filter(Boolean).join(' ') || p.name;
    const jobs = [['Map grid', () => api(`/projects/${p.id}/grid`, { body: { keyword: kw, size: 7, radiusMiles: 3 } })], ['Business Profile', () => api(`/projects/${p.id}/gbp`, { body: {} })], ['Reviews', () => api(`/projects/${p.id}/reviews`, { body: {} })], ['AI visibility', () => api(`/projects/${p.id}/ai`, { body: {} })]];
    if (p.domain) jobs.push(['Site audit', () => api(`/projects/${p.id}/audit`, { body: { maxPages: 30 } })]);
    if (p.keywords?.length) jobs.push(['Rank tracking', () => api(`/projects/${p.id}/organic`, { body: {} })]);
    const res = await Promise.allSettled(jobs.map(([, f]) => f()));
    const failed = res.map((r, i) => r.status === 'rejected' ? `${jobs[i][0]}: ${r.reason.message}` : null).filter(Boolean);
    toast(failed.length ? `Done with issues - ${failed.join('; ')}` : 'Checkup complete', 7000);
    await refreshProjects(); router();
  });
};
const TYPE_LABEL = { grid: 'Map grid', audit: 'Site audit', ai: 'AI visibility', gbp: 'Profile audit', organic: 'Rank tracking', reviews: 'Reviews', citations: 'Listings', keywords: 'Keyword research', backlinks: 'Backlinks' };
function groupTrend(trend) {
  const by = {}; trend.forEach(t => (by[t.keyword] ||= []).push({ x: t.t, y: t.visibility }));
  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  return Object.entries(by).slice(0, 3).map(([k, pts], i) => ({ name: k, color: colors[i], points: pts }));
}

// ---------------------------------------------------------------- Action plan
const doneKey = pid => 'done:' + pid;
function taskHtml(t) {
  const done = store.get(doneKey(S.pid), []).includes(t.title);
  return `<div class="task ${done ? 'done' : ''}"><input type="checkbox" data-task="${esc(t.title)}" ${done ? 'checked' : ''} aria-label="Mark done"><div><div class="t-title">${esc(t.title)}</div><div class="t-detail">${esc(t.detail)}</div></div><div style="text-align:right"><span class="pill">${esc(t.area)}</span><div class="small muted" style="margin-top:4px">${t.impact} impact · ${t.effort}</div>${t.link ? `<a class="small btn ${t.link.includes('?') ? '' : 'ghost'}" style="margin-top:4px;padding:3px 10px;${t.link.includes('?') ? '' : 'background:transparent;color:var(--accent);border:1px solid var(--border)'}" href="#/${t.link}">${t.link.includes('?') ? 'Do it →' : 'Open →'}</a>` : ''}</div></div>`;
}
document.addEventListener('change', e => {
  if (!e.target.matches('[data-task]')) return;
  const list = new Set(store.get(doneKey(S.pid), [])); e.target.checked ? list.add(e.target.dataset.task) : list.delete(e.target.dataset.task);
  store.set(doneKey(S.pid), [...list]); e.target.closest('.task').classList.toggle('done', e.target.checked);
});
views.plan = async (el, p) => {
  const plan = await api(`/projects/${p.id}/plan`);
  const areas = [...new Set(plan.tasks.map(t => t.area))];
  el.innerHTML = `<div class="grid split">
    <div class="card"><h2>Prioritized tasks <span class="muted small">(${plan.tasks.length}) - ranked by impact ÷ effort across every module</span></h2>
      <div class="row" style="margin-bottom:8px"><label class="shrink">Area<select id="areaF"><option value="">All areas</option>${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></label></div>
      <div id="tasks">${plan.tasks.map(taskHtml).join('')}</div></div>
    <div class="card"><h2>AI strategist summary</h2><div id="narr" class="muted small">${S.status.providers.ai ? 'Get a plain-English diagnosis and a this-week / this-month plan.' : 'Add ANTHROPIC_API_KEY to get an AI-written strategy summary.'}</div>${S.status.providers.ai ? '<button id="narrBtn" style="margin-top:12px">Write my plan</button>' : ''}</div></div>`;
  $('#areaF').onchange = e => { $('#tasks').innerHTML = plan.tasks.filter(t => !e.target.value || t.area === e.target.value).map(taskHtml).join(''); };
  $('#narrBtn') && ($('#narrBtn').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/projects/${p.id}/plan?narrative=1`); $('#narr').className = 'output'; $('#narr').textContent = r.narrative; }));
};

// ---------------------------------------------------------------- Map grid
const pinClass = r => !r ? 'nf' : r <= 3 ? 'r1' : r <= 10 ? 'r2' : r <= 15 ? 'r3' : 'r4';
const pinColor = r => !r ? '#6b6a65' : r <= 3 ? '#0ca30c' : r <= 10 ? '#b98400' : r <= 15 ? '#e0632f' : '#d03b3b';
const haversineKm = (a, b) => { const R = 6371, t = x => x * Math.PI / 180; const d = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(d)); };
function miniGrid(points, size = 64) {
  if (!points.length) return '';
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
  const [a1, a2, o1, o2] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const r = Math.max(2, size / (Math.sqrt(points.length) * 2.6));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${points.map(p => `<circle cx="${r + ((p.lng - o1) / ((o2 - o1) || 1)) * (size - 2 * r)}" cy="${r + ((a2 - p.lat) / ((a2 - a1) || 1)) * (size - 2 * r)}" r="${r}" fill="${pinColor(p.rank)}"/>`).join('')}</svg>`;
}
function distBar(dist, total) {
  const segs = [['good', '1–3 Good', '#0ca30c'], ['average', '4–10 Average', '#b98400'], ['poor', '11–20 Poor', '#e0632f'], ['out', 'Not in top 20', '#6b6a65']];
  return `<div class="distbar" role="img" aria-label="Rank distribution">${segs.filter(([k]) => dist[k]).map(([k, , c]) => `<span style="flex:${dist[k]};background:${c}" title="${dist[k]} points"></span>`).join('')}</div><div class="legend">${segs.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l}: <b>${dist[k] || 0}</b> (${Math.round((100 * (dist[k] || 0)) / (total || 1))}%)</span>`).join('')}</div>`;
}

views.maps = async (el, p) => {
  let lastGrid = null, fullCache = {};
  const runs = await api(`/projects/${p.id}/runs?type=grid&limit=40`);
  const kwOpts = [...new Set([...(p.gridKeywords || []), ...(p.keywords || [])])];
  const setup = { center: null, excluded: new Set() };
  const src = S.status.providers.dataforseo ? 'DataForSEO' : S.status.providers.places ? 'Google Places' : 'demo';
  el.innerHTML = `
  <div class="card no-print"><div class="row">
    <label style="flex:2">Keyword<input id="kw" list="kwlist" placeholder="e.g. ${esc((p.category || 'plumber').toLowerCase())} near me" value="${esc(kwOpts[0] || '')}"><datalist id="kwlist">${kwOpts.map(k => `<option value="${esc(k)}">`).join('')}</datalist></label>
    <label>Grid<select id="size">${[3, 5, 7, 9, 11, 13, 15].map(n => `<option ${n === 7 ? 'selected' : ''} value="${n}">${n}×${n}${n === 5 ? ' (recommended start)' : ''}</option>`).join('')}</select></label>
    <label>Radius<select id="radius">${[0.5, 1, 2, 3, 5, 8, 10, 15, 25].map(n => `<option ${n === 3 ? 'selected' : ''} value="${n}">${n} mi</option>`).join('')}</select></label>
    <label>Shape<select id="shape"><option value="square">Square</option><option value="circle">Circle (cheaper)</option><option value="rings">Distance rings</option></select></label>
    <label>Data source<select id="source"><option value="auto">Best available</option><option value="dataforseo">DataForSEO (GPS-exact)</option><option value="google_places">Google Places</option><option value="demo">Demo</option></select></label>
    <button id="scan">Run scan</button></div>
    <details id="prev" style="margin-top:10px"><summary class="small"><b>Adjust grid</b> - <span id="ptCount"></span></summary>
      <p class="small muted">Drag the blue center to move the grid. Tap a dot to switch it off (lakes, fields, areas you don't serve) - fewer points means cheaper scans.</p>
      <div id="prevMap" class="map small"></div><div class="row" style="margin-top:6px"><button class="ghost small shrink" id="resetGrid">Reset to my location</button></div></details>
  </div>
  <div id="gridOut" style="margin-top:16px"></div>`;

  const params = () => ({ size: +$('#size').value, radiusMiles: +$('#radius').value, shape: $('#shape').value, center: setup.center, excluded: [...setup.excluded] });
  let prevMap = null, prevLayer = null, centerMk = null;
  async function refreshPreview() {
    const plan = await api(`/projects/${p.id}/grid/preview`, { body: { ...params(), excluded: [] } });
    const active = plan.points.filter(x => !setup.excluded.has(`${x.row},${x.col}`)).length;
    $('#ptCount').textContent = `${active} points · ${active} ${src === 'demo' ? 'simulated' : src} lookups per keyword`;
    if (!$('#prev').open) return;
    if (!prevMap) {
      prevMap = track(L.map('prevMap', { scrollWheelZoom: false }));
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(prevMap);
      centerMk = L.marker([plan.center.lat, plan.center.lng], { draggable: true, title: 'Grid center' }).addTo(prevMap);
      centerMk.on('dragend', () => { const ll = centerMk.getLatLng(); setup.center = { lat: ll.lat, lng: ll.lng }; refreshPreview(); });
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(prevMap).bindTooltip('Your business');
      prevMap.fitBounds(plan.points.map(x => [x.lat, x.lng]), { padding: [20, 20] });
    }
    if (prevLayer) prevLayer.remove();
    prevLayer = L.layerGroup(plan.points.map(x => {
      const key = `${x.row},${x.col}`, off = setup.excluded.has(key);
      return L.circleMarker([x.lat, x.lng], { radius: 7, weight: 2, color: off ? '#999' : '#2a78d6', fillColor: off ? '#fff' : '#2a78d6', fillOpacity: off ? 0.4 : 0.8 })
        .on('click', () => { off ? setup.excluded.delete(key) : setup.excluded.add(key); refreshPreview(); });
    })).addTo(prevMap);
  }
  ['size', 'radius', 'shape'].forEach(id => $('#' + id).onchange = () => { setup.excluded.clear(); refreshPreview(); });
  $('#prev').addEventListener('toggle', () => { refreshPreview(); setTimeout(() => prevMap?.invalidateSize(), 50); });
  $('#resetGrid').onclick = () => { setup.center = null; setup.excluded.clear(); centerMk?.setLatLng([p.lat, p.lng]); refreshPreview(); };
  refreshPreview();

  $('#scan').onclick = e => busy(e.currentTarget, async () => {
    const body = { keyword: $('#kw').value.trim(), source: $('#source').value, ...params() };
    const run = await api(`/projects/${p.id}/grid`, { body });
    if (!(p.gridKeywords || []).includes(body.keyword)) { await api(`/projects/${p.id}`, { method: 'PUT', body: { gridKeywords: [...(p.gridKeywords || []), body.keyword] } }); await refreshProjects(); }
    fullCache[run.id] = run; showGrid(run);
  });
  const latest = await api(`/projects/${p.id}/latest/grid`);
  if (latest) showGrid(latest); else $('#gridOut').innerHTML = `<div class="card empty"><h2>See your Google Maps rankings block by block</h2><p>Pick a keyword customers search and run a scan. Each pin shows where you rank when someone searches from that exact spot. A 5×5 grid is a good place to start.</p></div>`;

  async function full(run) { if (run.data.points.every(x => x.results.length <= 3) && !fullCache[run.id]) fullCache[run.id] = await api('/runs/' + run.id); return fullCache[run.id] || run; }

  async function showGrid(run, compareId) {
    lastGrid = run;
    const d = run.data, m = d.metrics;
    const hist = await api(`/projects/${p.id}/grid/history?keyword=${encodeURIComponent(run.keyword)}`);
    const prevRun = compareId ? await api('/runs/' + compareId) : null;
    const dl = (v, invert) => v == null || v === 0 ? '' : `<span class="delta ${(invert ? -v : v) > 0 ? 'up' : (invert ? -v : v) < 0 ? 'down' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(v)}</span>`;
    const me = d.leaderboard.find(c => c.isTarget);
    const rivals = d.leaderboard.filter(c => !c.isTarget);
    $('#gridOut').innerHTML = `
      ${hist.length > 1 ? `<div class="card no-print" style="margin-bottom:16px"><h2>History - "${esc(run.keyword)}" <span class="muted small">tap a scan to open it · tap ⇆ to compare it with the one shown</span></h2><div class="hstrip">${hist.slice(0, 14).map(h => `<div class="hthumb ${h.id === run.id ? 'on' : ''}"><button class="ghost hopen" data-id="${h.id}" aria-label="Open scan from ${new Date(h.createdAt).toLocaleDateString()}">${miniGrid(h.points)}<span class="small">${new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span class="small muted">SoLV ${h.metrics.solv}%</span></button>${h.id !== run.id ? `<button class="ghost small hcmp" data-id="${h.id}" title="Compare then vs now">⇆</button>` : ''}</div>`).join('')}</div></div>` : ''}
      <div class="grid g6">
        <div class="card stat"><span class="label">Share of Local Voice</span><span class="value">${m.solv}%</span><span class="sub">of points in 3-pack ${d.delta ? dl(d.delta.solv) : ''}</span></div>
        <div class="card stat"><span class="label">Avg rank (where found)</span><span class="value">${m.arp ?? '–'}</span><span class="sub">ARP ${d.delta ? dl(d.delta.arp) : ''}</span></div>
        <div class="card stat"><span class="label">Avg total rank</span><span class="value">${m.atrp}</span><span class="sub">ATRP · not found = 21</span></div>
        <div class="card stat"><span class="label">Visibility score</span><span class="value">${m.visibility}</span><span class="sub">CTR-weighted ${d.delta ? dl(d.delta.visibility) : ''}</span></div>
        <div class="card stat"><span class="label">Top 10</span><span class="value">${m.top10Pct}%</span><span class="sub">of points</span></div>
        <div class="card stat"><span class="label">Found</span><span class="value">${m.found}/${m.points}</span><span class="sub">${srcPill(d.config.source)}</span></div>
      </div>
      <div class="grid split" style="margin-top:16px">
        <div class="card"><h2>"${esc(d.config.keyword)}" · ${d.config.size}×${d.config.size}, ${d.config.radiusMiles} mi <span class="muted small" style="margin-left:auto">${new Date(run.createdAt).toLocaleString()}</span></h2>
          ${m.distribution ? distBar(m.distribution, m.points) : ''}
          <div class="row" style="margin:10px 0"><label class="shrink" style="flex-direction:row;align-items:center;gap:8px">Show rankings for <select id="asBiz" style="width:auto;max-width:260px"><option value="">You</option>${rivals.slice(0, 12).map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('')}</select></label></div>
          ${prevRun ? `<div class="grid g2"><div><div class="small muted">Then · ${new Date(prevRun.createdAt).toLocaleDateString()} · SoLV ${prevRun.data.metrics.solv}%</div><div id="map2" class="map"></div></div><div><div class="small muted">Now · ${new Date(run.createdAt).toLocaleDateString()} · SoLV ${m.solv}% ${dl(+(m.solv - prevRun.data.metrics.solv).toFixed(1))}</div><div id="map" class="map"></div></div></div>` : '<div id="map" class="map"></div>'}
          <div class="legend"><span>Tap any pin to see the top 20 from that spot</span></div>
          <div id="pointDetail" style="margin-top:12px"></div></div>
        <div class="card"><h2>What this means</h2>${d.insights.map(i => `<div class="insight ${i.type}"><span class="i">${{ good: '✓', bad: '✕', warn: '!', info: 'i' }[i.type]}</span><span>${esc(i.text)}</span></div>`).join('')}
          <h3>Competitor leaderboard (whole grid)</h3><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>#</th><th>Business</th><th class="num">SoLV</th><th class="num">ATRP</th><th class="num">★</th><th class="num">Reviews</th></tr></thead><tbody>
          ${d.leaderboard.slice(0, 15).map((c, i) => `<tr class="${c.isTarget ? 'me' : ''}"><td>${i + 1}</td><td>${esc(c.name)}${c.isTarget ? ' <span class="pill">you</span>' : ''}</td><td class="num">${c.solv}%</td><td class="num">${c.atrp}</td><td class="num">${c.rating ?? '–'}</td><td class="num">${fmt(c.reviews)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      ${rivals.length ? factorsCard(d, me, rivals.slice(0, 3)) : ''}`;
    drawAll();
    $('#asBiz').onchange = drawAll;
    el.querySelectorAll('.hopen').forEach(b => b.onclick = async () => showGrid(await api('/runs/' + b.dataset.id)));
    el.querySelectorAll('.hcmp').forEach(b => b.onclick = () => showGrid(run, b.dataset.id));
    async function drawAll() {
      liveMaps.filter(x => x !== prevMap).forEach(x => x.remove()); liveMaps = liveMaps.filter(x => x === prevMap);
      const idx = $('#asBiz').value;
      const target = idx === '' ? null : rivals[+idx];
      const src1 = target ? await full(run) : run;
      const rankOf = target ? pt => { const i = (pt.results || []).findIndex(r => (r.placeId && r.placeId === target.placeId) || r.name === target.name); return i >= 0 ? i + 1 : null; } : pt => pt.rank;
      const m1 = drawGrid('map', src1.data, run.id, rankOf, target);
      if (prevRun) {
        const src2 = target ? await full(prevRun) : prevRun;
        const m2 = drawGrid('map2', src2.data, prevRun.id, rankOf, target);
        m1.on('move', () => m2.setView(m1.getCenter(), m1.getZoom(), { animate: false }));
      }
    }
  }

  function factorsCard(d, me, top) {
    const c = d.config.center;
    const dist = b => b?.lat != null ? haversineKm(c, b) * 0.621 : null;
    const myCat = (me?.category || p.category || '').toLowerCase();
    const cols = [{ ...(me || { name: p.name }), name: 'You', lat: me?.lat ?? p.lat, lng: me?.lng ?? p.lng }, ...top];
    const tips = [];
    for (const t of top) {
      if (me && t.reviews > (me.reviews || 0) * 1.5) tips.push(`${t.name} has ${fmt(t.reviews - (me.reviews || 0))} more reviews. Review count and recency are strong map-pack signals - send review requests after every job.`);
      if (t.category && myCat && t.category.toLowerCase() !== myCat) tips.push(`${t.name} uses the category "${t.category}". If that describes you too, add it as a secondary category (or primary, if it's your main service).`);
      if (me && t.rating > (me.rating || 0)) tips.push(`${t.name} is rated ${t.rating} vs your ${me.rating}. Reply to every review and fix the complaints that come up most.`);
    }
    const near = top.filter(t => dist(t) != null && dist(t) < (dist(cols[0]) ?? 99) - 0.3);
    if (near.length) tips.push(`${near.map(t => t.name).join(', ')} ${near.length > 1 ? 'are' : 'is'} closer to the grid center than you. You can't move, but strong relevance (categories, services, website content naming the area) and reviews can outweigh distance.`);
    const row = (label, f, better) => `<tr><td>${label}</td>${cols.map((b, i) => { const v = f(b); const win = i > 0 && better && better(b, cols[0]); return `<td class="num" ${win ? 'style="color:var(--critical);font-weight:700" title="Better than you"' : ''}>${v ?? '–'}</td>`; }).join('')}</tr>`;
    return `<div class="card" style="margin-top:16px"><h2>Why they outrank you <span class="muted small">the ranking signals you can see, side by side (red = better than you)</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Signal</th>${cols.map(b => `<th class="num">${esc(b.name)}</th>`).join('')}</tr></thead><tbody>
      ${row('Share of Local Voice', b => b.solv != null ? b.solv + '%' : null, (b, y) => b.solv > (y.solv || 0))}
      ${row('Google rating', b => b.rating, (b, y) => b.rating > (y.rating || 0))}
      ${row('Reviews', b => fmt(b.reviews), (b, y) => b.reviews > (y.reviews || 0))}
      ${row('Category', b => esc(b.category || '–'))}
      ${row('Distance from grid center', b => dist(b) != null ? dist(b).toFixed(1) + ' mi' : null, (b, y) => dist(b) != null && dist(y) != null && dist(b) < dist(y) - 0.3)}
      ${row('Website', b => esc(b.domain || '–'))}
      </tbody></table></div>
      ${tips.length ? `<h3>What to do about it</h3>${[...new Set(tips)].slice(0, 5).map(t => `<div class="insight info"><span class="i">→</span><span>${esc(t)}</span></div>`).join('')}` : ''}</div>`;
  }

  function drawGrid(id, d, runId, rankOf = pt => pt.rank, as = null) {
    const map = track(L.map(id, { scrollWheelZoom: false }).setView([d.config.center.lat, d.config.center.lng], 12));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const b = [];
    d.points.forEach(pt => {
      const rank = rankOf(pt);
      const icon = L.divIcon({ className: '', html: `<div class="rank-pin ${pinClass(rank)}" title="Rank ${rank ?? '20+'}">${rank ?? '20+'}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
      L.marker([pt.lat, pt.lng], { icon, keyboard: true, title: `Rank ${rank ?? 'not found'}` }).addTo(map).on('click', async () => {
        let results = pt.results;
        if (results.length <= 3) { const f = await api('/runs/' + runId); results = f.data.points.find(x => x.lat === pt.lat && x.lng === pt.lng)?.results || results; }
        const who = as ? as.name : 'you';
        $('#pointDetail').innerHTML = `<div class="card" style="background:var(--surface-2)"><b>From this spot</b> (${(pt.distanceM / 1609).toFixed(1)} mi from the grid center): ${rank ? `${esc(who)} rank${as ? 's' : ''} <b>#${rank}</b>` : `${esc(who)} ${as ? 'is' : 'are'} <b>not in the top 20</b>`}<ol class="small" style="margin:8px 0 0">${results.slice(0, 20).map(r => `<li ${r.name === S.project.name || (as && r.name === as.name) ? 'style="font-weight:700"' : ''}>${esc(r.name)} <span class="muted">${r.rating ? '★' + r.rating : ''} ${r.reviews ? '(' + fmt(r.reviews) + ')' : ''}</span></li>`).join('')}</ol></div>`;
      });
      b.push([pt.lat, pt.lng]);
    });
    const biz = as?.lat != null ? as : d.config.business || d.config.center;
    L.circleMarker([biz.lat, biz.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(map).bindTooltip(as ? as.name : 'Your business');
    map.fitBounds(b, { padding: [24, 24] });
    return map;
  }
};

// ---------------------------------------------------------------- GBP
views.gbp = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/gbp`);
  $('#pageActions').innerHTML = '<button id="go">Audit profile</button>';
  $('#go').onclick = e => busy(e.currentTarget, async () => { await api(`/projects/${p.id}/gbp`, { body: {} }); router(); });
  if (!run) return emptyState(el, 'Audit your Google Business Profile', 'We score completeness against what actually moves the map pack, then benchmark you against the businesses beating you on the grid.', 'Audit profile', b => busy(b, async () => { await api(`/projects/${p.id}/gbp`, { body: {} }); router(); }));
  const d = run.data, pr = d.profile;
  el.innerHTML = `<div class="grid split-r">
    <div class="card"><h2>Profile strength ${srcPill(d.source)}</h2><div class="score-row">${ring(d.score)}<div class="small"><b>${esc(pr.name)}</b><br>${esc(pr.address || '')}<br>${esc(pr.phone || '')}<br>${pr.website ? `<a href="${esc(pr.website)}" target="_blank" rel="noopener">${esc(pr.website)}</a>` : ''}<br>${pr.rating ? `★ ${pr.rating} (${fmt(pr.reviewCount)})` : ''} · ${esc(pr.primaryCategory || '')}</div></div>
      ${pr.mapsUrl ? `<p><a href="${esc(pr.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps →</a></p>` : ''}
      ${d.benchmark ? `<h3>Vs. top 3 on your grid</h3><table><thead><tr><th>Business</th><th class="num">★</th><th class="num">Reviews</th></tr></thead><tbody><tr class="me"><td>You</td><td class="num">${pr.rating ?? '–'}</td><td class="num">${fmt(pr.reviewCount)}</td></tr>${d.benchmark.competitors.map(c => `<tr><td>${esc(c.name)}<div class="muted small">${esc(c.category || '')}</div></td><td class="num">${c.rating ?? '–'}</td><td class="num">${fmt(c.reviews)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Run a map grid scan to benchmark against the competitors that beat you.</p>'}</div>
    <div class="card"><h2>Checklist</h2>${d.checks.sort((a, b) => a.pass - b.pass || b.weight - a.weight).map(c => `<div class="check"><span class="${c.pass ? 'ok' : 'no'}">${c.pass ? '✓' : '✕'}</span><div><b>${esc(c.label)}</b>${c.pass ? '' : `<div class="small muted">${esc(c.fix)}</div>`}</div></div>`).join('')}
      <p class="small"><a href="#/content">Generate a GBP description, posts or review-request messages in Content Studio →</a></p></div></div>`;
};

// ---------------------------------------------------------------- Reviews
views.reviews = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/reviews`);
  const go = b => busy(b, async () => { await api(`/projects/${p.id}/reviews`, { body: {} }); router(); });
  $('#pageActions').innerHTML = '<button id="go">Refresh reviews</button>'; $('#go').onclick = e => go(e.currentTarget);
  if (!run) return emptyState(el, 'Review intelligence', 'Pull your latest reviews, see sentiment by theme, and draft replies in one click.', 'Analyze reviews', go);
  const d = run.data, maxD = Math.max(...d.distribution.map(x => x.count), 1);
  el.innerHTML = `<div class="grid g4"><div class="card stat"><span class="label">Rating</span><span class="value">${d.rating ?? '–'}★</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Total reviews</span><span class="value">${fmt(d.total)}</span></div><div class="card stat"><span class="label">In sample, last 90 days</span><span class="value">${d.velocity90d}</span><span class="sub">review velocity</span></div><div class="card stat"><span class="label">Unreplied</span><span class="value">${d.unreplied}</span><span class="sub">${d.source === 'google_places' ? 'reply status needs GBP API access' : ''}</span></div></div>
  <div class="grid split-r" style="margin-top:16px">
    <div class="card"><h2>Star distribution</h2>${hbars(d.distribution.slice().reverse().map(x => ({ label: x.stars + ' stars', value: x.count })), maxD)}
      <h3>Themes customers mention</h3><table><thead><tr><th>Theme</th><th class="num">Mentions</th><th class="num">Sentiment</th></tr></thead><tbody>${d.themeStats.map(t => `<tr><td>${esc(t.theme)}</td><td class="num">${t.mentions}</td><td class="num"><span class="sev ${t.avgSentiment < 0 ? 'error' : t.avgSentiment < 0.3 ? 'warning' : 'notice'}"><span>${t.avgSentiment}</span></span></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No themes detected</td></tr>'}</tbody></table></div>
    <div class="card"><h2>Reviews <span class="row shrink" style="margin-left:auto;gap:6px"><select id="tone" class="shrink" style="width:auto"><option>warm and professional</option><option>short and friendly</option><option>formal</option></select><button id="draftAll" class="small">Draft replies for all</button></span></h2>
      ${d.reviews.map(r => `<div class="issue" data-id="${esc(r.id)}"><div><b>${esc(r.author || 'Anonymous')}</b> <span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <span class="pill">${r.sentiment.label}</span> ${r.replied === false ? '<span class="pill demo">needs reply</span>' : ''} <span class="muted small">${r.time ? new Date(r.time).toLocaleDateString() : ''}</span></div><div>${esc(r.text)}</div><div class="reply"></div></div>`).join('')}</div></div>`;
  const hist = await api(`/projects/${p.id}/runs?type=reviews&limit=60`);
  const full = await Promise.all(hist.slice(0, 12).map(h => api('/runs/' + h.id)));
  const series = full.reverse();
  if (d.competitors?.length) {
    const first = series[0]?.data, days = series.length > 1 ? Math.max(1, (new Date(series[series.length - 1].createdAt) - new Date(series[0].createdAt)) / 86400000) : null;
    const vel = (name, now) => { const then = first?.competitors?.find(c => c.name === name)?.reviews ?? (name === p.name ? first?.total : null); return days && then != null ? ((now - then) / days * 30).toFixed(1) : '–'; };
    el.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:16px"><h2>Competitor reviews <span class="muted small">the businesses beating you on the map grid · velocity = new reviews per month since tracking started</span></h2><table><thead><tr><th>Business</th><th class="num">Rating</th><th class="num">Reviews</th><th class="num">Gap vs you</th><th class="num">Reviews / month</th></tr></thead><tbody>
      <tr class="me"><td>${esc(p.name)} <span class="pill">you</span></td><td class="num">${d.rating ?? '–'}</td><td class="num">${fmt(d.total)}</td><td class="num">–</td><td class="num">${vel(p.name, d.total)}</td></tr>
      ${d.competitors.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.rating ?? '–'}</td><td class="num">${fmt(c.reviews)}</td><td class="num">${c.reviews != null && d.total != null ? (c.reviews > d.total ? '+' : '') + (c.reviews - d.total) : '–'}</td><td class="num">${vel(c.name, c.reviews)}</td></tr>`).join('')}</tbody></table>
      ${series.length < 2 ? '<p class="small muted">Velocity appears after the next refresh (automatic weekly).</p>' : ''}</div>`);
  }
  $('#draftAll').onclick = e => busy(e.currentTarget, async () => {
    const out = await api(`/projects/${p.id}/reviews/replies`, { body: { reviews: d.reviews, tone: $('#tone').value } });
    out.forEach(r => { const box = el.querySelector(`[data-id="${CSS.escape(r.id)}"] .reply`); if (box) box.innerHTML = `<div class="answer">${esc(r.reply)}</div><button class="ghost small copy" style="margin-top:4px">Copy</button>`; });
  });
  el.addEventListener('click', e => { if (e.target.matches('.copy')) { navigator.clipboard.writeText(e.target.previousElementSibling.textContent); toast('Copied'); } });
};

// ---------------------------------------------------------------- Citations
views.citations = async (el, p) => {
  const [dirs, run] = await Promise.all([api('/directories'), api(`/projects/${p.id}/latest/citations`)]);
  const listings = p.listings?.length ? p.listings : dirs.slice(0, 6).map(d => ({ name: d.name, url: '' }));
  el.innerHTML = `<div class="grid g2"><div class="card"><h2>Your listings</h2><p class="small muted">Paste the URL of each directory profile you have. We fetch each one and verify your name, address and phone match exactly - inconsistencies confuse Google and AI assistants.</p>
    <div id="lst">${listings.map(rowL).join('')}</div><div class="row" style="margin-top:10px"><button class="ghost shrink" id="addL">+ Add listing</button><button id="scanL" class="shrink">Check consistency</button></div></div>
    <div class="card" id="citOut">${run ? citResult(run.data) : '<p class="muted">Results appear here.</p>'}</div></div>`;
  function rowL(l) { return `<div class="row lrow" style="margin-bottom:6px"><input class="ln" placeholder="Directory" value="${esc(l.name)}" style="flex:1"><input class="lu" placeholder="https://…" value="${esc(l.url)}" style="flex:2"></div>`; }
  $('#addL').onclick = () => $('#lst').insertAdjacentHTML('beforeend', rowL({ name: '', url: '' }));
  $('#scanL').onclick = e => busy(e.currentTarget, async () => {
    const ls = [...el.querySelectorAll('.lrow')].map(r => ({ name: $('.ln', r).value.trim(), url: $('.lu', r).value.trim() })).filter(l => l.name || l.url);
    const r = await api(`/projects/${p.id}/citations`, { body: { listings: ls } }); $('#citOut').innerHTML = citResult(r.data); await refreshProjects();
  });
  function citResult(d) {
    const mark = v => v === null || v === undefined ? '<span class="muted">–</span>' : v ? '<span class="sev notice"><span>match</span></span>' : '<span class="sev error"><span>mismatch</span></span>';
    return `<h2>Listings score</h2><div class="score-row">${ring(d.score)}<div class="small">${d.consistent}/${d.checked} checked listings consistent<br>${d.missing.length} important directories missing</div></div>
    <h3>Checked</h3><table><thead><tr><th>Listing</th><th>Name</th><th>Address</th><th>Phone</th></tr></thead><tbody>${d.results.map(r => `<tr><td>${esc(r.name)}${r.error || r.status >= 400 ? ` <span class="sev error"><span>${esc(r.error || 'HTTP ' + r.status)}</span></span>` : ''}${r.otherPhones?.length ? `<div class="small muted">other phones: ${r.otherPhones.join(', ')}</div>` : ''}</td><td>${mark(r.nameOk)}</td><td>${mark(r.addrOk)}</td><td>${mark(r.phoneOk)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No URLs supplied</td></tr>'}</tbody></table>
    <p class="small muted">Some directories block automated fetches (shown as an error) - verify those by hand.</p>
    <h3>Missing - claim these next</h3><ul class="small">${d.missing.map(m => `<li>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a>` : esc(m.name)}</li>`).join('')}</ul>`;
  }
};

// ---------------------------------------------------------------- Site audit
views.audit = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/audit`);
  const go = b => busy(b, async () => { await api(`/projects/${p.id}/audit`, { body: { maxPages: +($('#maxP')?.value || 60) } }); router(); });
  $('#pageActions').innerHTML = `<select id="maxP" style="width:auto"><option value="30">30 pages</option><option value="60" selected>60 pages</option><option value="150">150 pages</option><option value="400">400 pages</option></select><button id="go">Run audit</button>`;
  $('#go').onclick = e => go(e.currentTarget);
  if (!p.domain) return emptyState(el, 'Add your website first', 'Set the domain in Project Settings to crawl it.', null);
  if (!run) return emptyState(el, `Audit ${esc(p.domain)}`, 'We crawl your site live and check 45+ technical, on-page, local-SEO and AI-search readiness factors - then explain each fix in plain English.', 'Run audit', go);
  const d = run.data;
  const cats = Object.keys(d.byCategory);
  el.innerHTML = `<div class="grid g4"><div class="card"><h2>Site health</h2><div class="score-row">${ring(d.health)}<div class="small">${d.pagesCrawled} pages crawled<br>${new Date(run.createdAt).toLocaleString()}</div></div></div>
    <div class="card stat"><span class="label">Errors</span><span class="value" style="color:var(--critical)">${d.counts.error}</span><span class="sub">fix first</span></div>
    <div class="card stat"><span class="label">Warnings</span><span class="value">${d.counts.warning}</span></div>
    <div class="card stat"><span class="label">AI search readiness</span><span class="value small" style="font-size:15px">${d.aiBotsBlocked.length ? '✕ AI bots blocked' : '✓ AI bots allowed'}<br>${d.hasLlmsTxt ? '✓' : '✕'} llms.txt<br>${d.schemaTypes.length ? '✓ Schema: ' + esc(d.schemaTypes.slice(0, 3).join(', ')) : '✕ No schema'}</span></div></div>
  ${d.themeScores ? `<div class="card" style="margin-top:16px"><h2>Scores by area <span class="muted small">${d.checksRun || ''} checks</span></h2><div class="grid g6">${Object.entries(d.themeScores).map(([k, v]) => `<div class="stat"><span class="label">${esc(k)}</span><span class="value" style="font-size:22px;color:${v >= 80 ? 'var(--good)' : v >= 50 ? 'inherit' : 'var(--critical)'}">${v}</span></div>`).join('')}</div></div>` : ''}
  ${d.vitals?.mobile ? `<div class="card" style="margin-top:16px"><h2>Core Web Vitals - homepage, mobile <span class="muted small">${d.vitals.mobile.fieldData ? 'real-user data (Chrome UX Report)' : 'lab test'}</span></h2><div class="grid g4"><div class="stat"><span class="label">PageSpeed score</span><span class="value">${d.vitals.mobile.score ?? '–'}</span></div><div class="stat"><span class="label">LCP (target < 2.5s)</span><span class="value">${(d.vitals.mobile.lcp / 1000).toFixed(1)}s</span></div><div class="stat"><span class="label">CLS (target < 0.1)</span><span class="value">${d.vitals.mobile.cls}</span></div><div class="stat"><span class="label">INP (target < 200ms)</span><span class="value">${d.vitals.mobile.inp ? d.vitals.mobile.inp + 'ms' : '–'}</span></div></div></div>` : d.vitals?.error ? `<div class="card small muted" style="margin-top:16px">Core Web Vitals unavailable: ${esc(d.vitals.error)}</div>` : ''}
  <div class="card" style="margin-top:16px"><div class="tabs" id="catTabs"><button class="active" data-c="">All (${d.issues.length})</button>${cats.map(c => `<button data-c="${esc(c)}">${esc(c)}</button>`).join('')}<button data-c="__pages">Pages</button></div><div id="issues"></div></div>`;
  const show = c => {
    if (c === '__pages') { $('#issues').innerHTML = `<div class="table-wrap"><table><thead><tr><th>URL</th><th class="num">Status</th><th class="num">ms</th><th class="num">Words</th><th>Title</th></tr></thead><tbody>${d.pages.map(pg => `<tr><td style="word-break:break-all">${esc(pg.url)}</td><td class="num">${pg.status}</td><td class="num">${pg.ms ?? ''}</td><td class="num">${pg.words ?? ''}</td><td>${esc(pg.title || '')}</td></tr>`).join('')}</tbody></table></div>`; return; }
    $('#issues').innerHTML = d.issues.filter(i => !c || i.category === c).map(i => `<div class="issue"><details><summary><span class="sev ${i.severity}"><span>${esc(i.title)}</span></span> <span class="pill">${esc(i.category)}</span> ${i.count > 1 ? `<span class="muted small">${i.count} pages</span>` : ''}</summary><div style="margin-top:6px"><b>How to fix:</b> ${esc(i.how)}</div>${i.urls.length ? `<ul>${i.urls.map(u => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}</details></div>`).join('') || '<p class="muted">No issues in this category. 🎉</p>';
  };
  $('#catTabs').onclick = e => { if (e.target.dataset.c === undefined) return; el.querySelectorAll('#catTabs button').forEach(b => b.classList.toggle('active', b === e.target)); show(e.target.dataset.c); };
  show('');
};

// ---------------------------------------------------------------- Keywords
views.keywords = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/keywords`);
  el.innerHTML = `<div class="card no-print"><div class="row"><label style="flex:2">Seed keyword<input id="seed" value="${esc(run?.data.seed || (p.category || '').toLowerCase())}" placeholder="e.g. bail bonds"></label><label style="flex:2">Location<input id="loc" value="${esc(run?.data.location || '')}" placeholder="City,State,United States (blank = project city)"></label><button id="go">Find keywords</button></div></div><div id="kwOut" style="margin-top:16px"></div>`;
  $('#go').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/projects/${p.id}/keywords`, { body: { seed: $('#seed').value.trim(), location: $('#loc').value.trim() } }); show(r.data); });
  if (run) show(run.data);
  function show(d) {
    const tracked = new Set(p.keywords || []);
    $('#kwOut').innerHTML = `<div class="grid split"><div class="card"><h2>${d.rows.length} keyword ideas ${srcPill(d.source)} <span class="muted small" style="margin-left:auto">sorted by Opportunity = volume × winnability × buyer intent</span></h2>
      <div class="table-wrap"><table><thead><tr><th></th><th>Keyword</th><th>Intent</th><th class="num">Volume</th><th>Trend</th><th class="num">KD</th><th class="num">CPC</th><th class="num">Opportunity</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td><input type="checkbox" class="trk" value="${esc(r.keyword)}" ${tracked.has(r.keyword) ? 'checked' : ''} title="Track this keyword" style="width:auto"></td><td>${esc(r.keyword)}</td><td><span class="pill">${esc(r.intent)}</span></td><td class="num">${fmt(r.volume)}</td><td>${spark(r.trend)}</td><td class="num">${r.difficulty ?? '–'}</td><td class="num">$${(r.cpc || 0).toFixed(2)}</td><td class="num"><b>${r.opportunity}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button id="saveTrk" class="shrink">Track selected keywords</button></div></div>
      <div class="card"><h2>Topic clusters</h2><p class="small muted">One page per cluster avoids cannibalization.</p>${d.clusters.slice(0, 10).map(c => `<details class="issue"><summary><b>${esc(c.name)}</b> <span class="muted small">${c.keywords.length} kw · ${fmt(c.volume)}/mo</span></summary><div class="small">${c.keywords.map(esc).join(', ')}</div></details>`).join('')}
      ${d.questions?.length ? `<h3>Questions people ask AI & Google</h3><ul class="small">${d.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul><p class="small"><a href="#/content">Turn these into an FAQ →</a></p>` : ''}</div></div>`;
    $('#saveTrk').onclick = e => busy(e.currentTarget, async () => {
      const sel = [...el.querySelectorAll('.trk')]; const keep = new Set(p.keywords || []);
      sel.forEach(c => c.checked ? keep.add(c.value) : keep.delete(c.value));
      await api(`/projects/${p.id}`, { method: 'PUT', body: { keywords: [...keep] } }); await refreshProjects(); toast(`Tracking ${keep.size} keywords`);
    });
  }
};

// ---------------------------------------------------------------- Organic rank tracking
views.organic = async (el, p) => {
  const [run, runs] = await Promise.all([api(`/projects/${p.id}/latest/organic`), api(`/projects/${p.id}/runs?type=organic&limit=30`)]);
  const go = b => busy(b, async () => { await api(`/projects/${p.id}/organic`, { body: {} }); router(); });
  $('#pageActions').innerHTML = '<button id="go">Check rankings now</button>'; $('#go').onclick = e => go(e.currentTarget);
  const setupHtml = `<details class="card no-print" style="margin-bottom:16px"><summary><b>Tracking setup</b> <span class="muted small">${(p.devices || ['desktop']).join(' + ')} · ${(p.trackLocations?.length ? p.trackLocations : [p.city || 'United States']).join(', ')} · ${(p.competitors || []).length} competitors</span></summary><form id="trkf" class="grid g3" style="margin-top:12px">
    <label>Devices<select name="devices" multiple size="2"><option ${(p.devices || ['desktop']).includes('desktop') ? 'selected' : ''}>desktop</option><option ${(p.devices || []).includes('mobile') ? 'selected' : ''}>mobile</option></select></label>
    <label>Locations - one per line (city, state or ZIP)<textarea name="trackLocations" rows="3" placeholder="${esc(p.city ? p.city + ', ' + (p.state || '') : 'Springfield, OH')}">${esc((p.trackLocations || []).join('\n'))}</textarea></label>
    <label>Competitor domains - one per line (up to 20)<textarea name="competitors" rows="3">${esc((p.competitors || []).join('\n'))}</textarea></label>
    <label class="span2">Keywords - one per line<textarea name="keywords" rows="4">${esc((p.keywords || []).join('\n'))}</textarea></label><div><button type="submit">Save</button></div></form></details>`;
  if (!p.keywords?.length) { el.innerHTML = setupHtml + '<div id="e"></div>'; bindTrk(); return emptyState($('#e'), 'Track your Google rankings', 'Add keywords above, or tick them in Keyword Research or Competitor Research.', null); }
  if (!run) { el.innerHTML = setupHtml + '<div id="e"></div>'; bindTrk(); return emptyState($('#e'), `Track ${p.keywords.length} keywords`, 'Check where you rank on desktop and mobile, across locations, against competitors - and whether Google\'s AI Overview cites you.', 'Check rankings', go); }
  const d = run.data;
  const hist = runs.slice().reverse().map(r => ({ x: r.createdAt, y: parseFloat(r.summary.match(/Visibility ([\d.]+)/)?.[1] || 0) }));
  const comps = Object.keys(d.rows.find(r => r.competitorPositions)?.competitorPositions || {});
  el.innerHTML = setupHtml + `<div class="grid g6"><div class="card stat"><span class="label">Visibility</span><span class="value">${d.visibility}%</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Est. monthly clicks</span><span class="value">${fmt(d.traffic)}</span></div><div class="card stat"><span class="label">Top 3</span><span class="value">${d.top3}</span></div><div class="card stat"><span class="label">Top 10</span><span class="value">${d.top10}</span></div><div class="card stat"><span class="label">AI Overviews shown</span><span class="value">${d.aiOverviews}</span><span class="sub">of ${d.rows.length} checks</span></div><div class="card stat"><span class="label">AI Overview cites you</span><span class="value">${d.aiOverviewCitations}</span></div></div>
  <div class="grid split" style="margin-top:16px"><div class="card"><h2>Keywords <span class="row shrink" style="margin-left:auto;gap:6px"><select id="fDev" class="shrink" style="width:auto"><option value="">All devices</option>${(d.devices || ['desktop']).map(x => `<option>${x}</option>`).join('')}</select><select id="fLoc" class="shrink" style="width:auto"><option value="">All locations</option>${(d.locations || []).map(x => `<option>${esc(x)}</option>`).join('')}</select></span></h2><div class="table-wrap" id="otbl"></div></div>
    <div class="card"><h2>Share of voice</h2><p class="small muted">Click-weighted visibility across your tracked keywords.</p>${hbars((d.shareOfVoice || []).map(x => ({ label: x.you ? 'You' : x.domain, value: x.visibility, color: x.you ? 'var(--series-1)' : 'var(--series-2)' })), Math.max(1, ...(d.shareOfVoice || []).map(x => x.visibility)))}
      <h3>Visibility trend</h3>${lineChart([{ name: 'Visibility', color: 'var(--series-1)', points: hist }], { height: 140 })}
      ${d.cannibalization?.length ? `<h3>Keyword cannibalization</h3><p class="small muted">More than one of your pages ranks for the same keyword - they compete with each other. Merge them or make one clearly the main page.</p>${d.cannibalization.map(c => `<div class="small issue"><b>${esc(c.keyword)}</b> (${c.device})<ul>${c.urls.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>`).join('')}` : ''}
      <h3>Other sites in the top 5</h3>${hbars(d.competitors.map(c => ({ label: c.domain, value: c.appearances })), Math.max(1, ...d.competitors.map(c => c.appearances)))}</div></div>`;
  const table = () => {
    const rows = d.rows.filter(r => (!$('#fDev').value || r.device === $('#fDev').value) && (!$('#fLoc').value || r.location === $('#fLoc').value));
    $('#otbl').innerHTML = `<table><thead><tr><th>Keyword</th><th>Device</th><th>Location</th><th class="num">Pos.</th><th class="num">Change</th><th class="num">Volume</th>${comps.map(c => `<th class="num" title="${esc(c)}">${esc(c.split('.')[0])}</th>`).join('')}<th>SERP features</th><th>AI Overview</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.keyword)}${r.cannibalized ? ' <span class="pill demo" title="Multiple pages of yours rank">2 URLs</span>' : ''}<div class="small muted" style="word-break:break-all">${esc((r.url || '').replace(/^https?:\/\/[^/]+/, ''))}</div></td><td>${r.device === 'mobile' ? '📱' : '🖥'}</td><td class="small">${esc(r.location || '')}</td><td class="num"><b>${r.position ?? '100+'}</b></td><td class="num">${r.change ? `<span class="delta ${r.change > 0 ? 'up' : 'down'}">${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}</span>` : ''}</td><td class="num">${fmt(r.volume)}</td>${comps.map(c => `<td class="num">${r.competitorPositions?.[c] ?? '–'}</td>`).join('')}<td class="small">${(r.features || []).map(f => `<span class="pill">${esc(f.replace(/_/g, ' '))}</span>`).join(' ')}</td><td class="small">${r.aiOverview?.present ? (r.aiOverview.citesYou ? '✓ cites you' : '✕ not cited') : '–'}${r.error ? `<span class="sev error"><span>${esc(r.error)}</span></span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  };
  $('#fDev').onchange = table; $('#fLoc').onchange = table; table(); bindTrk();
  function bindTrk() {
    $('#trkf').onsubmit = async ev => { ev.preventDefault(); const f = ev.target; await busy(f.querySelector('button'), async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: { devices: [...f.devices.selectedOptions].map(o => o.value), trackLocations: f.trackLocations.value, competitors: f.competitors.value, keywords: f.keywords.value } }); await refreshProjects(); toast('Saved - click "Check rankings now"'); router(); }); };
  }
};

// ---------------------------------------------------------------- Backlinks
views.backlinks = async (el, p) => {
  const [run, la] = await Promise.all([api(`/projects/${p.id}/latest/backlinks`), api(`/projects/${p.id}/latest/linkaudit`)]);
  el.innerHTML = `<div class="tabs" id="btabs"><button class="active" data-t="p">Profile & link gap</button><button data-t="a">Backlink audit (toxic links)</button></div><div id="bwrap"></div>`;
  $('#btabs').onclick = e => { if (!e.target.dataset.t) return; el.querySelectorAll('#btabs button').forEach(b => b.classList.toggle('active', b === e.target)); e.target.dataset.t === 'a' ? auditTab() : profileTab(); };
  profileTab();
  function auditTab() {
    const w = $('#bwrap');
    const show = d => {
      w.innerHTML = `<div class="grid g4"><div class="card stat"><span class="label">Toxic</span><span class="value" style="color:var(--critical)">${d.counts.toxic}</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Suspicious</span><span class="value">${d.counts.suspicious}</span></div><div class="card stat"><span class="label">Healthy</span><span class="value">${d.counts.ok}</span></div><div class="card"><h2>Top anchor texts</h2>${hbars(d.anchors.slice(0, 6).map(a => ({ label: a.anchor, value: a.n })), Math.max(1, ...d.anchors.map(a => a.n)))}</div></div>
      <div class="card" style="margin-top:16px"><h2>Referring domains by toxicity <button id="dl" class="small" style="margin-left:auto">Download disavow file for checked</button></h2><p class="small muted">Disavow only links you are confident are spam - for most small businesses Google already ignores them. Review before uploading in Search Console.</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>Domain</th><th class="num">Toxicity</th><th>Why</th><th>Anchor</th><th class="num">Authority</th></tr></thead><tbody>${d.links.map(l => `<tr><td><input type="checkbox" class="dv" value="${esc(l.domainFrom)}" ${l.level === 'toxic' ? 'checked' : ''} style="width:auto"></td><td>${esc(l.domainFrom)}</td><td class="num"><span class="sev ${l.level === 'toxic' ? 'error' : l.level === 'suspicious' ? 'warning' : 'notice'}"><span>${l.score}</span></span></td><td class="small">${esc(l.reasons.join(', '))}</td><td class="small">${esc(l.anchor)}</td><td class="num">${l.authority ?? '–'}</td></tr>`).join('')}</tbody></table></div></div>`;
      $('#dl').onclick = async () => {
        const domains = [...w.querySelectorAll('.dv:checked')].map(c => c.value);
        const res = await fetch(`/api/projects/${p.id}/disavow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domains }) });
        const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'disavow.txt'; a.click(); URL.revokeObjectURL(url);
      };
    };
    if (la) show(la.data); else { w.innerHTML = '<div id="e"></div>'; emptyState($('#e'), 'Find spammy links pointing at your site', 'Every referring domain is scored for spam signals, and you can download a ready-made Google disavow file.', 'Run backlink audit', b => busy(b, async () => show((await api(`/projects/${p.id}/linkaudit`, { body: {} })).data))); }
  }
  function profileTab() {
  $('#bwrap').innerHTML = `<div class="card no-print"><div class="row"><label style="flex:3">Compare with competitor domains (comma separated)<input id="cmp" value="${esc((p.competitors || []).join(', '))}" placeholder="competitor1.com, competitor2.com"></label><button id="go">Analyze backlinks</button></div></div><div id="blOut" style="margin-top:16px"></div>`;
  $('#go').onclick = e => busy(e.currentTarget, async () => { const compare = $('#cmp').value.split(',').map(s => s.trim()).filter(Boolean); await api(`/projects/${p.id}`, { method: 'PUT', body: { competitors: compare } }); const r = await api(`/projects/${p.id}/backlinks`, { body: { compare } }); await refreshProjects(); show(r.data); });
  if (run) show(run.data);
  function show(d) {
    $('#blOut').innerHTML = `<div class="card"><h2>Authority comparison ${srcPill(d.source)}</h2><table><thead><tr><th>Domain</th><th class="num">Authority</th><th class="num">Referring domains</th><th class="num">Backlinks</th><th class="num">Dofollow %</th></tr></thead><tbody>${d.profiles.map((x, i) => `<tr class="${i === 0 ? 'me' : ''}"><td>${esc(x.domain)}</td><td class="num">${x.authority}</td><td class="num">${fmt(x.referringDomains)}</td><td class="num">${fmt(x.backlinks)}</td><td class="num">${x.dofollowPct ?? '–'}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Link gap - sites linking to competitors, not you</h2>${d.gap.length ? `<table><thead><tr><th>Domain</th><th class="num">Authority</th><th>Links to</th></tr></thead><tbody>${d.gap.map(g => `<tr><td>${esc(g.domain)}</td><td class="num">${g.authority}</td><td class="small">${g.linksTo.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Add competitor domains to find link opportunities.</p>'}</div>
    <div class="card"><h2>Your top referring domains</h2><table><thead><tr><th>Domain</th><th class="num">Authority</th><th class="num">Links</th></tr></thead><tbody>${(d.profiles[0].topReferrers || []).map(r => `<tr><td>${esc(r.domain)}</td><td class="num">${r.authority}</td><td class="num">${r.links}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  }
};

// ---------------------------------------------------------------- AI visibility
views.ai = async (el, p) => {
  const [run, runs] = await Promise.all([api(`/projects/${p.id}/latest/ai`), api(`/projects/${p.id}/runs?type=ai&limit=30`)]);
  el.innerHTML = `<div class="card no-print"><h2>Prompts to test <span class="muted small">one per line - phrase them the way customers ask ChatGPT, Claude, Gemini or Perplexity</span></h2><textarea id="prompts" rows="5">${esc((p.aiPrompts || []).join('\n'))}</textarea><div class="row" style="margin-top:8px;align-items:center"><span class="shrink small">Engines:</span>${Object.entries(S.status.engines).map(([k, e]) => `<label class="shrink" style="flex-direction:row;align-items:center;gap:4px"><input type="checkbox" class="eng" value="${k}" style="width:auto" ${e.live || !Object.values(S.status.engines).some(x => x.live) ? 'checked' : ''} ${!e.live && Object.values(S.status.engines).some(x => x.live) ? 'disabled title="Add this engine\'s API key to .env"' : ''}>${esc(e.label)}${e.live ? '' : ' <span class="pill demo">demo</span>'}</label>`).join('')}</div><div class="row" style="margin-top:8px"><button id="go" class="shrink">Run AI visibility check</button><span class="small muted">${S.status.providers.ai ? 'Each prompt is answered live by Claude with web search, then analyzed for mentions, rank, sentiment and cited sources.' : 'Demo mode - add ANTHROPIC_API_KEY for live AI answers.'}</span></div></div><div id="aiOut" style="margin-top:16px"></div>`;
  $('#go').onclick = e => busy(e.currentTarget, async () => { const prompts = $('#prompts').value.split('\n').map(s => s.trim()).filter(Boolean); await api(`/projects/${p.id}`, { method: 'PUT', body: { aiPrompts: prompts } }); await refreshProjects(); const r = await api(`/projects/${p.id}/ai`, { body: { prompts, engines: [...el.querySelectorAll('.eng:checked')].map(c => c.value) } }); show(r.data); });
  if (run) show(run.data);
  function show(d) {
    const hist = runs.slice().reverse().map(r => ({ x: r.createdAt, y: +(r.summary.match(/AI score (\d+)/)?.[1] || 0) }));
    $('#aiOut').innerHTML = `<div class="grid g4"><div class="card"><h2>AI visibility score ${srcPill(d.source)}</h2><div class="score-row">${ring(d.score)}<div class="small muted">Mentions 60% · prominence 25% · sentiment 15%</div></div></div><div class="card stat"><span class="label">Mentioned in</span><span class="value">${d.mentionRate}%</span><span class="sub">of AI answers</span></div><div class="card stat"><span class="label">Avg position when mentioned</span><span class="value">${d.avgPosition ?? '–'}</span></div><div class="card stat"><span class="label">AI share of voice</span><span class="value">${d.shareOfVoice}%</span><span class="sub">of all businesses named</span></div></div>
    <div class="grid g3" style="margin-top:16px"><div class="card"><h2>How to get recommended more</h2>${d.recommendations.map(r => `<div class="insight info"><span class="i">→</span><span>${esc(r)}</span></div>`).join('')}<h3>Trend</h3>${lineChart([{ name: 'AI score', color: 'var(--series-1)', points: hist }], { height: 130 })}</div>
      <div class="card"><h2>Competitors AI recommends</h2><table><thead><tr><th>Business</th><th class="num">Mentions</th><th class="num">Avg pos.</th></tr></thead><tbody>${d.competitors.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.mentions}</td><td class="num">${c.avgPosition}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>Sources AI cites</h2><p class="small muted">Be present and well-reviewed on these.</p>${hbars(d.sources.map(s => ({ label: s.domain, value: s.count })), Math.max(1, ...d.sources.map(s => s.count)))}</div></div>
    ${d.engines?.length ? `<div class="card" style="margin-top:16px"><h2>By AI engine</h2><table><thead><tr><th>Engine</th><th class="num">Answers</th><th class="num">Mentioned</th><th class="num">Avg position</th></tr></thead><tbody>${d.engines.map(e => `<tr><td>${esc(e.label)}</td><td class="num">${e.answers}</td><td class="num">${e.mentionRate}%</td><td class="num">${e.avgPosition ?? '–'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${d.perception ? `<div class="card" style="margin-top:16px"><h2>How AI describes you vs competitors</h2><p class="small muted">Net sentiment per selling point (−100 to +100) and how often it came up. Empty = never mentioned for that business.</p><div class="table-wrap"><table class="matrix"><thead><tr><th>Selling point</th>${d.perception.brands.map((b, i) => `<th class="num">${i === 0 ? 'You' : esc(b)}</th>`).join('')}</tr></thead><tbody>${d.perception.rows.map(r => `<tr><td>${esc(r.attribute)}</td>${r.cells.map(c => `<td class="cell" style="${c ? `background:${c.net >= 50 ? '#0ca30c22' : c.net < 0 ? '#d03b3b22' : 'transparent'}` : ''}">${c ? `${c.net > 0 ? '+' : ''}${c.net} <span class="muted small">(${c.n})</span>` : '<span class="muted">·</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${d.perception.strengths.length ? `<p class="small"><b>Your AI strengths:</b> ${esc(d.perception.strengths.join(', '))}</p>` : ''}</div>` : ''}
    <div class="card" style="margin-top:16px"><h2>Answers</h2>${d.results.map(r => `<details class="issue"><summary>${r.engine ? `<span class="pill">${esc(S.status.engines[r.engine]?.label || r.engine)}</span> ` : ''}${r.mentioned ? `<span class="sev notice"><span>Mentioned${r.position ? ' #' + r.position : ''}</span></span>` : '<span class="sev error"><span>Not mentioned</span></span>'} · ${esc(r.prompt)} ${r.sentiment && r.mentioned ? `<span class="pill">${esc(r.sentiment)}</span>` : ''}</summary>${r.error ? `<p class="sev error"><span>${esc(r.error)}</span></p>` : `<div class="answer">${esc(r.answer)}</div><div class="small muted" style="margin-top:6px">Named: ${esc(r.businesses.join(', ') || 'none')}${r.reasons?.length ? ' · Reasons given: ' + esc(r.reasons.join(', ')) : ''}${r.citedDomains?.length ? ' · Sources: ' + esc(r.citedDomains.join(', ')) : ''}</div>`}</details>`).join('')}</div>`;
  }
};

// ---------------------------------------------------------------- Content studio
views.content = async (el, p) => {
  const types = S.status.contentTypes;
  const lastBrief = await api(`/projects/${p.id}/latest/brief`);
  el.innerHTML = `<div class="card" style="margin-bottom:16px"><h2>Content brief from the pages that rank</h2><p class="small muted">We read the current top results for a keyword and tell you the length, headings, terms and questions to beat them.</p><div class="row"><label style="flex:3">Keyword<input id="bkw" value="${esc(lastBrief?.data.keyword || p.keywords?.[0] || '')}"></label><button id="bgo">Build brief</button></div><div id="bout" style="margin-top:12px"></div></div>
  <div class="grid g2"><div class="card"><h2>Generate</h2><div class="grid" style="gap:10px">
    <label>What do you need?<select id="ctype">${Object.entries(types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
    <label>Target keyword<input id="ckw" value="${esc(p.keywords?.[0] || '')}" placeholder="e.g. 24 hour bail bonds springfield"></label>
    <label>Topic / notes, or the article to repurpose<textarea id="ctopic" rows="3" placeholder="Offer, angle, facts to include (license #, years in business, pricing)… For 'Repurpose', paste the full article here."></textarea></label>
    <button id="gen">Generate</button></div><h3>Output</h3><div id="cout" class="output muted">Your content appears here.</div><div class="row" style="margin-top:8px"><button class="ghost small shrink" id="ccopy">Copy</button><button class="ghost small shrink" id="cuse">Score this draft →</button></div></div>
    <div class="card"><h2>Content grader</h2><p class="small muted">Paste any page or draft to grade it against a keyword: coverage, readability, structure, local signals and related terms.</p>
    <label>Keyword<input id="skw" value="${esc(p.keywords?.[0] || '')}"></label><label style="margin-top:8px">Text<textarea id="stext" rows="12"></textarea></label>
    <div class="row" style="margin-top:8px"><button id="terms" class="ghost shrink">Suggest related terms</button><button id="score" class="shrink">Grade</button></div><div id="terms-out" class="small muted" style="margin-top:8px"></div><div id="sout" style="margin-top:8px"></div></div></div>`;
  let terms = [];
  const hq = new URLSearchParams(location.hash.split('?')[1] || '');
  if (hq.get('type') && types[hq.get('type')]) { $('#ctype').value = hq.get('type'); if (hq.get('keyword')) $('#ckw').value = hq.get('keyword'); setTimeout(() => $('#gen').scrollIntoView({ behavior: 'smooth' }), 100); }
  const showBrief = d => {
    const b = d.brief, a = d.analysis;
    terms = (b.mustInclude || []).slice(0, 20);
    $('#bout').innerHTML = `<div class="grid g4"><div class="card stat"><span class="label">Search volume</span><span class="value">${fmt(d.metrics?.volume)}</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Target length</span><span class="value">${fmt(a.recommendedWords)}</span><span class="sub">words (median of ranking pages ${fmt(a.medianWords)})</span></div><div class="card stat"><span class="label">Pages analyzed</span><span class="value">${a.pagesAnalyzed}</span></div><div class="card stat"><span class="label">SERP features</span><span class="value" style="font-size:14px">${(d.serp.features || []).map(f => esc(f.replace(/_/g, ' '))).join(', ') || '–'}</span></div></div>
    <div class="grid g2" style="margin-top:12px"><div><h3>Title</h3><div>${esc(b.title)}</div><h3>Meta description</h3><div>${esc(b.metaDescription)}</div><h3>H1</h3><div>${esc(b.h1)}</div><h3>Search intent</h3><div>${esc(b.searchIntent)}</div><h3>Outline</h3><ol>${b.outline.map(o => `<li><b>${esc(o.h2)}</b>${o.notes ? `<div class="small muted">${esc(o.notes)}</div>` : ''}</li>`).join('')}</ol><h3>Local angle</h3><div>${esc(b.localAngle)}</div>${b.note ? `<p class="small muted">${esc(b.note)}</p>` : ''}</div>
    <div><h3>Must include</h3><div>${(b.mustInclude || []).map(t => `<span class="pill" style="margin:2px">${esc(t)}</span>`).join(' ') || '<span class="muted small">–</span>'}</div><h3>Questions to answer</h3><ul class="small">${(b.faqs || []).map(q => `<li>${esc(q)}</li>`).join('') || '<li class="muted">–</li>'}</ul><h3>Currently ranking</h3><ol class="small">${d.serp.top.map(t => `<li>${esc(t.domain)} <span class="muted">${esc(t.title || '')}</span></li>`).join('')}</ol>${a.schemaTypes.length ? `<h3>Schema used by ranking pages</h3><div class="small">${esc(a.schemaTypes.join(', '))}</div>` : ''}
    <div class="row" style="margin-top:12px"><button class="ghost shrink" id="bwrite">Write the page from this brief →</button></div></div></div>`;
    $('#bwrite').onclick = () => { $('#ctype').value = 'service_page'; $('#ckw').value = d.keyword; $('#ctopic').value = `Follow this brief exactly:\n${JSON.stringify(b)}`; $('#skw').value = d.keyword; $('#terms-out').textContent = 'Brief terms: ' + terms.join(', '); $('#gen').scrollIntoView({ behavior: 'smooth' }); };
  };
  $('#bgo').onclick = e => busy(e.currentTarget, async () => showBrief((await api(`/projects/${p.id}/brief`, { body: { keyword: $('#bkw').value.trim() } })).data));
  if (lastBrief) showBrief(lastBrief.data);
  $('#gen').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/projects/${p.id}/content`, { body: { type: $('#ctype').value, keyword: $('#ckw').value, topic: $('#ctopic').value, source: $('#ctopic').value } }); $('#cout').className = 'output'; $('#cout').textContent = r.text; if (r.score) toast(`Content score: ${r.score.score}/100`); });
  $('#ccopy').onclick = () => { navigator.clipboard.writeText($('#cout').textContent); toast('Copied'); };
  $('#cuse').onclick = () => { $('#stext').value = $('#cout').textContent; $('#skw').value = $('#ckw').value; $('#score').click(); };
  $('#terms').onclick = e => busy(e.currentTarget, async () => { terms = (await api(`/projects/${p.id}/content/terms`, { body: { keyword: $('#skw').value } })).terms; $('#terms-out').textContent = 'Related terms: ' + terms.join(', '); });
  $('#score').onclick = e => busy(e.currentTarget, async () => {
    const r = await api(`/projects/${p.id}/content/score`, { body: { text: $('#stext').value, keyword: $('#skw').value, terms } });
    $('#sout').innerHTML = `<div class="score-row">${ring(r.score)}<div>${r.missingTerms.length ? `<div class="small"><b>Missing terms:</b> ${esc(r.missingTerms.join(', '))}</div>` : ''}</div></div>${r.checks.map(c => `<div class="check"><span class="${c.pass ? 'ok' : 'no'}">${c.pass ? '✓' : '✕'}</span><span>${esc(c.label)}${c.value !== undefined ? ` <span class="muted small">(${esc(c.value)})</span>` : ''}</span></div>`).join('')}`;
  });
};

// ---------------------------------------------------------------- Report
function renderReport(el, b, isPublic = false) {
  const c = b.scorecard, L = b.latest, br = b.branding || {};
  const color = br.color || 'var(--accent)';
  const pins = g => g ? `<svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Map grid ranks">${(() => { const lats = g.data.points.map(x => x.lat), lngs = g.data.points.map(x => x.lng); const [a1, a2, o1, o2] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]; return g.data.points.map(x => { const cx = 14 + ((x.lng - o1) / ((o2 - o1) || 1)) * 172, cy = 14 + ((a2 - x.lat) / ((a2 - a1) || 1)) * 172; const col = !x.rank ? '#6b6a65' : x.rank <= 3 ? '#0ca30c' : x.rank <= 10 ? '#b98400' : x.rank <= 15 ? '#e0632f' : '#d03b3b'; return `<circle cx="${cx}" cy="${cy}" r="9" fill="${col}"/><text x="${cx}" y="${cy + 3.5}" font-size="9" text-anchor="middle" fill="#fff" font-weight="700">${x.rank ?? '–'}</text>`; }).join(''); })()}</svg>` : '';
  el.innerHTML = `<div class="card"><div class="row" style="align-items:center"><div style="flex:3"><div class="brandbar">${br.logoUrl ? `<img src="${esc(br.logoUrl)}" alt="${esc(br.agencyName || '')}">` : br.agencyName ? `<b style="color:${color}">${esc(br.agencyName)}</b>` : ''}</div><h2 style="font-size:22px;margin:8px 0 0">${esc(b.project.name)} - Search Visibility Report</h2><div class="muted">${new Date(b.generatedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric', day: 'numeric' })} · ${esc([b.project.category, b.project.city].filter(Boolean).join(' · '))}</div></div><div class="shrink score-row">${ring(c.overall, 'Overall')}</div></div></div>
  <div class="grid g6" style="margin-top:16px">${[['Google Maps', 'maps'], ['Business Profile', 'gbp'], ['Website health', 'website'], ['AI assistants', 'ai'], ['Organic', 'organic'], ['Listings', 'citations']].map(([n, k]) => `<div class="card stat"><span class="label">${n}</span><span class="value">${c.parts[k] ?? '–'}</span></div>`).join('')}</div>
  ${L.grid ? `<div class="card" style="margin-top:16px"><h2>Google Maps rankings - "${esc(L.grid.data.config.keyword)}"</h2><div class="row" style="align-items:flex-start"><div class="shrink">${pins(L.grid)}</div><div style="flex:3"><p>In the top-3 map pack at <b>${L.grid.data.metrics.solv}%</b> of ${L.grid.data.metrics.points} locations across a ${L.grid.data.config.radiusMiles}-mile area. Average rank where found: <b>${L.grid.data.metrics.arp ?? '–'}</b>.${L.grid.data.delta ? ` Change since ${new Date(L.grid.data.delta.since).toLocaleDateString()}: <b>${L.grid.data.delta.solv > 0 ? '+' : ''}${L.grid.data.delta.solv} pts</b>.` : ''}</p>${L.grid.data.insights.map(i => `<div class="insight ${i.type}"><span class="i">•</span><span>${esc(i.text)}</span></div>`).join('')}</div></div></div>` : ''}
  ${L.ai ? `<div class="card" style="margin-top:16px"><h2>AI assistant recommendations</h2><p>Mentioned in <b>${L.ai.data.mentionRate}%</b> of ${L.ai.data.results.length} customer-style questions${L.ai.data.avgPosition ? `, average position ${L.ai.data.avgPosition}` : ''}. Most-recommended competitor: <b>${esc(L.ai.data.competitors[0]?.name || '–')}</b>.</p>${(L.ai.data.engines || []).length > 1 ? `<p class="small">${L.ai.data.engines.map(e => `${esc(e.label)}: ${e.mentionRate}%`).join(' · ')}</p>` : ''}</div>` : ''}
  <div class="grid g2" style="margin-top:16px">
  ${L.reviews ? `<div class="card"><h2>Reputation</h2><p><b>${L.reviews.data.rating ?? '–'}★</b> from ${fmt(L.reviews.data.total)} reviews.</p></div>` : ''}
  ${L.audit ? `<div class="card"><h2>Website</h2><p>Health <b>${L.audit.data.health}/100</b> across ${L.audit.data.pagesCrawled} pages - ${L.audit.data.counts.error} errors, ${L.audit.data.counts.warning} warnings.</p><ul class="small">${L.audit.data.issues.map(i => `<li>${esc(i.title)}</li>`).join('')}</ul></div>` : ''}
  ${L.organic ? `<div class="card"><h2>Google rankings</h2><p>${L.organic.data.top3} keyword rankings in the top 3, ${L.organic.data.top10} in the top 10. Estimated ${fmt(L.organic.data.traffic)} monthly clicks.</p><table class="small"><tbody>${L.organic.data.rows.slice(0, 10).map(r => `<tr><td>${esc(r.keyword)}${r.device === 'mobile' ? ' 📱' : ''}</td><td class="num">${r.position ?? '100+'}</td><td class="num">${r.change ? (r.change > 0 ? '▲' : '▼') + Math.abs(r.change) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${L.traffic ? `<div class="card"><h2>Traffic</h2><p>${fmt(L.traffic.data.totals.clicks)} clicks from Google in the last 28 days${L.traffic.data.sourcesSummary ? `, and ${fmt(L.traffic.data.sourcesSummary.aiSessions)} visits from AI assistants` : ''}.</p></div>` : ''}
  </div>
  <div class="card" style="margin-top:16px"><h2>Priorities for next month</h2><ol>${b.tasks.slice(0, 8).map(t => `<li><b>${esc(t.title)}</b> - ${esc(t.detail)}</li>`).join('')}</ol></div>
  ${isPublic ? `<p class="small muted" style="text-align:center;margin-top:16px">${esc(br.agencyName || 'RankPilot')} · <a href="javascript:window.print()">Print / Save PDF</a></p>` : ''}`;
}
views.report = async (el, p) => {
  const [b, settings] = await Promise.all([api(`/projects/${p.id}/report`), api('/settings')]);
  const br = settings.branding || {}, pv = S.status.providers;
  $('#pageActions').innerHTML = '<button onclick="window.print()">Print / Save PDF</button>';
  el.innerHTML = `<details class="card no-print" style="margin-bottom:16px"><summary><b>Branding, sharing & scheduled delivery</b></summary>
    <div class="grid g2" style="margin-top:12px"><form id="brandf" class="grid" style="gap:8px"><label>Agency / company name<input name="agencyName" value="${esc(br.agencyName || '')}"></label><label>Logo URL<input name="logoUrl" value="${esc(br.logoUrl || '')}" placeholder="https://…/logo.png"></label><label>Brand color<input name="color" type="color" value="${esc(br.color || '#2a78d6')}" style="height:38px;padding:2px"></label><button type="submit" class="shrink">Save branding</button></form>
    <div class="grid" style="gap:8px"><div><b>Share a live link</b><p class="small muted">Anyone with the link sees this report (read-only, always up to date). No login needed.</p><div class="row"><button id="mkShare" class="ghost shrink">Create link</button><button id="revoke" class="ghost shrink">Revoke all links</button></div><div id="shareOut" class="small" style="margin-top:6px;word-break:break-all"></div></div>
      <form id="schedf"><b>Email this report</b><p class="small muted">${pv.email ? 'Sends a branded summary with a link to the full report.' : 'Add RESEND_API_KEY and EMAIL_FROM to .env to send email. Until then sending is simulated.'}</p>
        <label>Recipients (comma separated)<input name="reportRecipients" value="${esc((p.reportRecipients || []).join(', '))}"></label>
        <div class="row" style="margin-top:6px"><label>Automatic delivery<select name="reportSchedule">${['off', 'weekly', 'monthly'].map(x => `<option ${(p.reportSchedule || 'off') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><button type="submit" class="ghost shrink">Save schedule</button><button type="button" id="sendNow" class="shrink">Send now</button></div></form></div></div></details>
    <div id="rep"></div>`;
  renderReport($('#rep'), b);
  $('#brandf').onsubmit = async ev => { ev.preventDefault(); await busy(ev.target.querySelector('button'), async () => { await api('/settings', { method: 'PUT', body: { ...settings, branding: formData(ev.target) } }); toast('Branding saved'); router(); }); };
  $('#mkShare').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/projects/${p.id}/share`, { body: {} }); $('#shareOut').innerHTML = `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a> <button class="ghost small" id="cpy">Copy</button>`; $('#cpy').onclick = () => { navigator.clipboard.writeText(r.url); toast('Copied'); }; });
  $('#revoke').onclick = e => busy(e.currentTarget, async () => { await api(`/projects/${p.id}/share`, { method: 'DELETE' }); $('#shareOut').textContent = 'All share links revoked.'; });
  const recips = () => $('[name=reportRecipients]').value.split(',').map(x => x.trim()).filter(Boolean);
  $('#schedf').onsubmit = async ev => { ev.preventDefault(); await busy(ev.target.querySelector('[type=submit]'), async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: { reportRecipients: recips(), reportSchedule: $('[name=reportSchedule]').value } }); await refreshProjects(); toast('Schedule saved'); }); };
  $('#sendNow').onclick = e => busy(e.currentTarget, async () => { const to = recips(); if (!to.length) throw new Error('Add a recipient'); for (const t of to) { const r = await api(`/projects/${p.id}/report/email`, { body: { to: t } }); toast(r.simulated ? `Simulated (email not configured) - link: ${r.url}` : `Sent to ${t}`, 6000); } });
};

// ---------------------------------------------------------------- All businesses (roll-up)
views.locations = async (el) => {
  const [all, alertsAll] = await Promise.all([api('/projects'), api('/alerts')]);
  const groups = [...new Set(all.map(p => p.group).filter(Boolean))];
  let sort = store.get('locSort', 'overall'), grp = store.get('locGroup', ''), mode = store.get('locMode', 'list');
  const val = (p, k) => ({ overall: p.scorecard.overall, solv: p.grid?.metrics.solv, arp: p.grid?.metrics.arp != null ? -p.grid.metrics.arp : null, delta: p.grid?.delta?.solv, rating: p.reviewsSummary?.rating, reviews: p.reviewsSummary?.total, name: null }[k]);
  const render = () => {
    const rows = all.filter(p => !grp || p.group === grp).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (val(b, sort) ?? -1e9) - (val(a, sort) ?? -1e9));
    const tot = rows.reduce((t, p) => ({ n: t.n + 1, solv: t.solv + (p.grid?.metrics.solv || 0), g: t.g + (p.grid ? 1 : 0), rev: t.rev + (p.reviewsSummary?.total || 0) }), { n: 0, solv: 0, g: 0, rev: 0 });
    $('#locOut').innerHTML = `<div class="grid g4" style="margin-bottom:16px"><div class="card stat"><span class="label">Businesses</span><span class="value">${tot.n}</span></div><div class="card stat"><span class="label">Avg map-pack coverage</span><span class="value">${tot.g ? (tot.solv / tot.g).toFixed(1) + '%' : '–'}</span></div><div class="card stat"><span class="label">Total reviews</span><span class="value">${fmt(tot.rev)}</span></div><div class="card stat"><span class="label">Unread alerts</span><span class="value">${alertsAll.filter(a => !a.read).length}</span></div></div>
    ${mode === 'map' ? '<div class="card"><div id="locMap" class="map"></div></div>' : `<div class="card"><div class="table-wrap"><table><thead><tr><th>Business</th><th>Group</th><th class="num">Overall</th><th>Map keyword</th><th class="num">SoLV</th><th class="num">Change</th><th class="num">Avg rank</th><th class="num">Rating</th><th class="num">Reviews</th><th></th></tr></thead><tbody>
    ${rows.map(p => `<tr><td><b>${esc(p.name)}</b><div class="small muted">${esc([p.category, p.city].filter(Boolean).join(' · '))}</div></td><td class="small">${esc(p.group || '')}</td><td class="num"><b>${p.scorecard.overall ?? '–'}</b></td><td class="small">${esc(p.grid?.keyword || '–')}</td><td class="num">${p.grid ? p.grid.metrics.solv + '%' : '–'}</td><td class="num">${p.grid?.delta?.solv ? `<span class="delta ${p.grid.delta.solv > 0 ? 'up' : p.grid.delta.solv < 0 ? 'down' : ''}">${p.grid.delta.solv > 0 ? '▲' : p.grid.delta.solv < 0 ? '▼' : ''}${Math.abs(p.grid.delta.solv)}</span>` : ''}</td><td class="num">${p.grid?.metrics.arp ?? '–'}</td><td class="num">${p.reviewsSummary?.rating ?? '–'}</td><td class="num">${fmt(p.reviewsSummary?.total)}</td><td><button class="ghost small open-p" data-id="${p.id}">Open</button></td></tr>`).join('')}</tbody></table></div></div>`}`;
    el.querySelectorAll('.open-p').forEach(b => b.onclick = () => { S.pid = b.dataset.id; store.set('pid', S.pid); location.hash = '#/overview'; });
    if (mode === 'map') {
      const map = track(L.map('locMap', { scrollWheelZoom: false }));
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const pts = rows.filter(p => p.lat != null);
      pts.forEach(p => {
        const r = p.grid?.metrics.arp ? Math.round(p.grid.metrics.arp) : null;
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="rank-pin ${pinClass(r)}" style="width:auto;padding:0 8px;border-radius:14px">${p.grid ? p.grid.metrics.solv + '%' : '–'}</div>`, iconSize: [52, 30], iconAnchor: [26, 15] }) })
          .addTo(map).bindPopup(`<b>${esc(p.name)}</b><br>Overall ${p.scorecard.overall ?? '–'} · SoLV ${p.grid ? p.grid.metrics.solv + '%' : '–'}<br><a href="#/overview" data-pid="${p.id}" class="pop-open">Open</a>`);
      });
      map.on('popupopen', e => e.popup.getElement().querySelector('.pop-open')?.addEventListener('click', ev => { S.pid = ev.target.dataset.pid; store.set('pid', S.pid); }));
      pts.length ? map.fitBounds(pts.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 12 }) : map.setView([39.8, -98.6], 4);
    }
  };
  el.innerHTML = `<div class="card no-print" style="margin-bottom:16px"><div class="row" style="align-items:end"><label>Group<select id="lg"><option value="">All groups</option>${groups.map(g => `<option ${g === grp ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
    <label>Sort by<select id="ls">${[['overall', 'Overall score'], ['solv', 'Map-pack coverage'], ['delta', 'Biggest gain'], ['arp', 'Best avg rank'], ['rating', 'Rating'], ['reviews', 'Reviews'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="shrink tabs" style="margin:0;border:0"><button data-m="list" class="${mode === 'list' ? 'active' : ''}">List</button><button data-m="map" class="${mode === 'map' ? 'active' : ''}">Map</button></div><a class="btn shrink" href="#/new">+ Add business</a></div>
    <p class="small muted" style="margin:8px 0 0">Set a group (e.g. "Bail bonds", "Real estate", a client name) in each business's Project Settings to filter here.</p></div><div id="locOut"></div>`;
  $('#lg').onchange = e => { grp = e.target.value; store.set('locGroup', grp); render(); };
  $('#ls').onchange = e => { sort = e.target.value; store.set('locSort', sort); render(); };
  el.querySelector('.tabs').onclick = e => { if (!e.target.dataset.m) return; mode = e.target.dataset.m; store.set('locMode', mode); el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === e.target)); liveMaps.forEach(m => m.remove()); liveMaps = []; render(); };
  render();
};

// ---------------------------------------------------------------- Alerts
views.alerts = async (el, p) => {
  const list = await api('/alerts?pid=' + p.id);
  await api('/alerts/read?pid=' + p.id, { body: {} });
  S.alerts = list.map(a => ({ ...a, read: true }));
  const icon = k => ({ review_negative: '✕', rating_drop: '✕', review_new: '★', map_drop: '◎', rank_drop: '↘', ai_drop: '✦', audit_drop: '⚙' }[k] || '•');
  el.innerHTML = `<div class="card"><h2>Alerts <span class="muted small">new reviews, rating drops, map/rank/AI drops, site-health drops${S.status.providers.email ? ' · important ones are emailed' : ' · add RESEND_API_KEY + an alert email to get these by email'}</span></h2>
    ${list.length ? list.map(a => `<div class="insight ${/negative|drop/.test(a.kind) ? 'bad' : 'info'}"><span class="i">${icon(a.kind)}</span><div style="flex:1"><b>${esc(a.title)}</b>${a.read ? '' : ' <span class="pill demo">new</span>'}<div class="small">${esc(a.detail)}</div><div class="small muted">${new Date(a.createdAt).toLocaleString()} ${a.link ? `· <a href="#/${a.link}">Open</a>` : ''}</div></div></div>`).join('') : '<p class="muted">No alerts yet. They appear automatically when scheduled scans find something worth knowing.</p>'}</div>`;
  renderNav('alerts');
};

// ---------------------------------------------------------------- Review requests
views.requests = async (el, p) => {
  const d = await api(`/projects/${p.id}/requests`);
  const st = d.stats, pv = S.status.providers;
  const statusPill = c => ({ pending: '<span class="pill">scheduled</span>', sent: '<span class="pill">sent</span>', clicked: '<span class="pill live">clicked ✓</span>', failed: `<span class="sev error"><span>${esc(c.error || 'failed')}</span></span>` }[c.status] || c.status);
  el.innerHTML = `
  ${!pv.sms && !pv.email ? '<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><b>Test mode:</b> no SMS or email provider is set up, so messages are recorded but not actually sent. Add Twilio (SMS) and/or Resend (email) keys to <span class="kbd">.env</span> to go live.</div>' : ''}
  <div class="grid g6"><div class="card stat"><span class="label">Requests sent</span><span class="value">${st.sent}</span></div><div class="card stat"><span class="label">Clicked review link</span><span class="value">${st.clicked}</span></div><div class="card stat"><span class="label">Click rate</span><span class="value">${st.clickRate}%</span></div><div class="card stat"><span class="label">Scheduled</span><span class="value">${st.pending}</span></div><div class="card stat"><span class="label">Failed</span><span class="value">${st.failed}</span></div><div class="card stat"><span class="label">Reviews gained</span><span class="value">${st.reviewsGained ?? '–'}</span><span class="sub">since first request</span></div></div>
  <div class="grid split" style="margin-top:16px">
    <div class="card"><h2>Send review requests</h2>
      <p class="small muted">One customer per line: <span class="kbd">Name, phone or email</span>. Paste straight from a spreadsheet. Everyone gets the same direct Google review link (asking only happy customers breaks Google's rules).</p>
      <textarea id="cust" rows="6" placeholder="Jane Doe, (937) 555-0100&#10;Bob Smith, bob@example.com"></textarea>
      <div class="row" style="margin-top:8px"><label>When<select id="delay"><option value="0">Send now</option><option value="2">In 2 hours</option><option value="24">Tomorrow</option><option value="72">In 3 days</option></select></label><button id="sendReq" class="shrink">Add customers</button></div>
      <h3>Customers</h3><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>Customer</th><th>Via</th><th>Status</th><th>Sent</th><th></th></tr></thead><tbody>
      ${d.contacts.map(c => `<tr><td>${esc(c.name)}<div class="small muted">${esc(c.phone || c.email)}</div></td><td>${c.channel === 'sms' ? 'SMS' : 'Email'}</td><td>${statusPill(c)}${c.simulated ? ' <span class="pill demo" title="Not actually delivered - test mode">test</span>' : ''}${c.followups ? ` <span class="small muted">+${c.followups} reminder</span>` : ''}</td><td class="small">${c.sentAt ? ago(c.sentAt) : c.status === 'pending' ? 'at ' + new Date(c.sendAt).toLocaleString() : ''}</td><td><button class="ghost small resend" data-id="${c.id}">${c.status === 'pending' ? 'Send now' : 'Resend'}</button> <button class="ghost small delc" data-id="${c.id}" aria-label="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No customers yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Message templates</h2><form id="tplf">
      <label>Google review link<input name="reviewUrl" value="${esc(p.reviewUrl || '')}" placeholder="${esc(st.reviewUrl)}"></label>
      <p class="small muted">${p.placeId && !p.placeId.startsWith('demo') ? 'Auto-built from your Google Place ID.' : 'Paste your link from Google Business Profile → "Ask for reviews" for the most direct link.'}</p>
      <label>SMS<textarea name="reviewSms" rows="3">${esc(d.templates.sms)}</textarea></label>
      <label style="margin-top:8px">Email subject<input name="reviewEmailSubject" value="${esc(d.templates.emailSubject)}"></label>
      <label style="margin-top:8px">Email<textarea name="reviewEmail" rows="7">${esc(d.templates.email)}</textarea></label>
      <label style="margin-top:8px">Send one reminder if not clicked after (days, 0 = never)<input name="reviewFollowupDays" type="number" min="0" max="30" value="${p.reviewFollowupDays ?? 3}"></label>
      <p class="small muted">Placeholders: <span class="kbd">{first}</span> <span class="kbd">{business}</span> <span class="kbd">{city}</span> <span class="kbd">{link}</span> (tracked, so you see who clicked).</p>
      <button type="submit">Save templates</button></form>
      <h3>QR code &amp; counter card</h3><p class="small muted">For receipts, invoices, the front desk or your truck. It points to your Google review link.</p>
      <div class="row" style="align-items:center"><div class="shrink" id="qrBox" style="background:#fff;padding:8px;border-radius:8px"></div><div><button class="ghost small" id="qrDl">Download QR (PNG)</button><br><button class="ghost small" id="qrCard" style="margin-top:6px">Print a review card</button></div></div>
      <h3>Reviews widget for your website</h3><p class="small muted">Paste this where you want your latest Google reviews to appear. It shows your most recent reviews unfiltered - hiding bad reviews on your own site breaks Google's rules and the FTC's review rule.</p>
      <button class="ghost small" id="mkWidget">Get embed code</button><div id="widgetOut" class="small" style="margin-top:6px"></div></div></div>`;
  $('#sendReq').onclick = e => busy(e.currentTarget, async () => {
    const customers = $('#cust').value.split('\n').map(l => l.split(/[,\t]/).map(x => x.trim())).filter(a => a[0]).map(([name, contact = '']) => contact.includes('@') ? { name, email: contact } : { name, phone: contact });
    if (!customers.length) throw new Error('Add at least one customer');
    const r = await api(`/projects/${p.id}/requests`, { body: { customers, delayHours: +$('#delay').value } });
    toast(`Added ${r.added} customer(s)`); router();
  });
  const qrUrl = p.reviewUrl || st.reviewUrl;
  const { default: qrcode } = await import('/vendor/qrcode/qrcode.mjs');
  const qr = qrcode(0, 'M'); qr.addData(qrUrl); qr.make();
  $('#qrBox').innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: false, alt: 'QR code for your Google review link' });
  const qrPng = (cell = 10) => { const q = qrcode(0, 'M'); q.addData(qrUrl); q.make(); return q.createDataURL(cell, 2); };
  $('#qrDl').onclick = () => { const a = document.createElement('a'); a.href = qrPng(12); a.download = 'review-qr.gif'; a.click(); };
  $('#qrCard').onclick = () => {
    const w = window.open('', '_blank');
    w.document.write(`<!doctype html><title>Review card</title><style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:24px}.c{border:2px solid #222;border-radius:16px;padding:28px;width:340px;text-align:center}h1{font-size:22px;margin:0 0 6px}p{margin:6px 0;color:#333}img{width:220px;height:220px;image-rendering:pixelated}.s{color:#e0a100;font-size:28px;letter-spacing:4px}@media print{button{display:none}}</style><div class="c"><div class="s">★★★★★</div><h1>Enjoyed working with ${esc(p.name)}?</h1><p>Scan to leave us a quick Google review.</p><img src="${qrPng(10)}" alt="QR code"><p style="font-size:12px;color:#666">It takes less than a minute. Thank you!</p><button onclick="print()">Print</button></div>`);
    w.document.close();
  };
  $('#mkWidget').onclick = e => busy(e.currentTarget, async () => {
    const { token } = await api(`/projects/${p.id}/widget`, { body: {} });
    const url = `${location.origin}/widget/${token}`;
    const code = `<iframe src="${url}" title="Google reviews for ${esc(p.name)}" style="width:100%;max-width:520px;height:640px;border:0" loading="lazy"></iframe>`;
    $('#widgetOut').innerHTML = `<textarea readonly rows="3" style="font-family:monospace;font-size:12px">${esc(code)}</textarea><div class="row" style="margin-top:4px"><button class="ghost small shrink" id="wcopy">Copy code</button><a class="small shrink" href="${esc(url)}" target="_blank" rel="noopener">Preview</a><span class="small muted">Add <span class="kbd">?theme=dark</span> or <span class="kbd">?n=8</span> to the URL to customise.</span></div>${location.hostname === 'localhost' ? '<p class="small" style="color:var(--critical)">This app is running on localhost, so the widget only works once the app is online.</p>' : ''}`;
    $('#wcopy').onclick = () => { navigator.clipboard.writeText(code); toast('Copied'); };
  });
  $('#tplf').onsubmit = async ev => { ev.preventDefault(); await busy(ev.target.querySelector('button'), async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: formData(ev.target) }); await refreshProjects(); toast('Saved'); }); };
  el.querySelectorAll('.resend').forEach(b => b.onclick = e => busy(e.currentTarget, async () => { await api(`/projects/${p.id}/requests/${b.dataset.id}/send`, { body: {} }); router(); }));
  el.querySelectorAll('.delc').forEach(b => b.onclick = async () => { await api(`/projects/${p.id}/requests/${b.dataset.id}`, { method: 'DELETE' }); router(); });
};

// ---------------------------------------------------------------- Competitor research
views.research = async (el, p) => {
  const [dom, gap] = await Promise.all([api(`/projects/${p.id}/latest/domain`), api(`/projects/${p.id}/latest/gap`)]);
  el.innerHTML = `<div class="tabs" id="rtabs"><button class="active" data-t="domain">Domain Overview</button><button data-t="gap">Keyword Gap</button></div><div id="rout"></div>`;
  const tabs = {
    domain: () => {
      $('#rout').innerHTML = `<div class="card no-print"><div class="row"><label style="flex:3">Any domain (yours or a competitor's)<input id="dom" value="${esc(dom?.data.domain || (p.competitors || [])[0] || p.domain || '')}"></label><button id="go">Analyze</button></div></div><div id="dout" style="margin-top:16px"></div>`;
      $('#go').onclick = e => busy(e.currentTarget, async () => showDomain((await api(`/projects/${p.id}/domain`, { body: { domain: $('#dom').value.trim() } })).data));
      if (dom) showDomain(dom.data);
    },
    gap: () => {
      $('#rout').innerHTML = `<div class="card no-print"><div class="row"><label style="flex:3">Your domain vs up to 4 competitors (comma separated)<input id="gcomp" value="${esc((p.competitors || []).join(', '))}" placeholder="competitor1.com, competitor2.com"></label><button id="go">Compare</button></div></div><div id="gout" style="margin-top:16px"></div>`;
      $('#go').onclick = e => busy(e.currentTarget, async () => {
        const competitors = $('#gcomp').value.split(',').map(x => x.trim()).filter(Boolean);
        await api(`/projects/${p.id}`, { method: 'PUT', body: { competitors } }); await refreshProjects();
        showGap((await api(`/projects/${p.id}/gap`, { body: { competitors } })).data);
      });
      if (gap) showGap(gap.data);
    },
  };
  $('#rtabs').onclick = e => { if (!e.target.dataset.t) return; el.querySelectorAll('#rtabs button').forEach(b => b.classList.toggle('active', b === e.target)); tabs[e.target.dataset.t](); };
  tabs.domain();
  function showDomain(d) {
    const sm = d.summary, maxP = Math.max(1, sm.pos1, sm.pos2_3, sm.pos4_10, sm.pos11_20);
    $('#dout').innerHTML = `<div class="grid g4"><div class="card stat"><span class="label">Organic keywords</span><span class="value">${fmt(sm.keywords)}</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Est. monthly organic clicks</span><span class="value">${fmt(sm.traffic)}</span></div><div class="card"><h2>Ranking distribution</h2>${hbars([{ label: '#1', value: sm.pos1 }, { label: '#2–3', value: sm.pos2_3 }, { label: '#4–10', value: sm.pos4_10 }, { label: '#11–20', value: sm.pos11_20 }], maxP)}</div><div class="card"><h2>Keyword intent</h2>${hbars(Object.entries(d.intents).map(([k, v]) => ({ label: k, value: v })), Math.max(1, ...Object.values(d.intents)))}</div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Top keywords - ${esc(d.domain)}</h2><div class="table-wrap"><table><thead><tr><th>Keyword</th><th class="num">Pos.</th><th class="num">Volume</th><th class="num">Clicks</th><th>URL</th></tr></thead><tbody>${d.keywords.slice(0, 100).map(k => `<tr><td>${esc(k.keyword)}</td><td class="num">${k.position}</td><td class="num">${fmt(k.volume)}</td><td class="num">${fmt(k.traffic)}</td><td class="small" style="word-break:break-all">${esc((k.url || '').replace(/^https?:\/\/[^/]+/, ''))}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>Top pages</h2><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Keywords</th><th class="num">Clicks</th><th>Best keyword</th></tr></thead><tbody>${d.pages.map(pg => `<tr><td class="small" style="word-break:break-all">${esc(pg.url.replace(/^https?:\/\/[^/]+/, '') || '/')}</td><td class="num">${pg.keywords}</td><td class="num">${fmt(pg.traffic)}</td><td class="small">${esc(pg.top?.keyword || '')} (#${pg.top?.position ?? '–'})</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  function showGap(d) {
    const labels = { missing: 'Missing - they rank, you don\'t', weak: 'Weak - you rank lower than all of them', untapped: 'Untapped - one competitor ranks, you don\'t', strong: 'Strong - you outrank them', shared: 'Shared - everyone ranks' };
    let cur = 'missing';
    const render = () => {
      $('#gtbl').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Keyword</th><th class="num">Volume</th><th class="num">KD</th>${d.domains.map((x, i) => `<th class="num">${i === 0 ? 'You' : esc(x)}</th>`).join('')}</tr></thead><tbody>${(d[cur] || []).map(k => `<tr><td>${esc(k.keyword)}</td><td class="num">${fmt(k.volume)}</td><td class="num">${k.difficulty ?? '–'}</td>${k.positions.map((pp, i) => `<td class="num" ${i === 0 ? 'style="font-weight:700"' : ''}>${pp ?? '–'}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="9" class="muted">None</td></tr>'}</tbody></table></div><div class="row" style="margin-top:8px"><button class="ghost shrink" id="trackGap">Track the top 10 of these keywords</button></div>`;
      $('#trackGap').onclick = e => busy(e.currentTarget, async () => { const add = (d[cur] || []).slice(0, 10).map(k => k.keyword); await api(`/projects/${p.id}`, { method: 'PUT', body: { keywords: [...new Set([...(S.project.keywords || []), ...add])] } }); await refreshProjects(); toast(`Tracking ${add.length} more keywords`); });
    };
    $('#gout').innerHTML = `<div class="card"><h2>Keyword gap ${srcPill(d.source)}</h2><div class="tabs" id="gtabs">${Object.keys(labels).map(k => `<button data-k="${k}" class="${k === cur ? 'active' : ''}" title="${esc(labels[k])}">${k[0].toUpperCase() + k.slice(1)} (${d.counts[k]})</button>`).join('')}</div><p class="small muted" id="glabel">${labels[cur]}</p><div id="gtbl"></div></div>`;
    $('#gtabs').onclick = e => { if (!e.target.dataset.k) return; cur = e.target.dataset.k; el.querySelectorAll('#gtabs button').forEach(b => b.classList.toggle('active', b === e.target)); $('#glabel').textContent = labels[cur]; render(); };
    render();
  }
};

// ---------------------------------------------------------------- Traffic insights
views.traffic = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/traffic`);
  const go = b => busy(b, async () => { await api(`/projects/${p.id}/traffic`, { body: {} }); router(); });
  $('#pageActions').innerHTML = '<button id="go">Refresh</button>'; $('#go').onclick = e => go(e.currentTarget);
  const setup = !S.status.providers.google || (!p.gscSite && !p.ga4Property) ? `<div class="card" style="margin-bottom:16px"><b>Connect your real traffic:</b> set <span class="kbd">GOOGLE_SERVICE_ACCOUNT_FILE</span> in .env, add that service account's email as a user in Search Console and GA4, then enter your Search Console property and GA4 property ID in <a href="#/settings">Project Settings</a>. Until then this page shows demo data.</div>` : '';
  if (!run) { el.innerHTML = setup; el.insertAdjacentHTML('beforeend', '<div id="e"></div>'); return emptyState($('#e'), 'See the clicks Google actually sends you', 'Real queries, pages and positions from Search Console, plus visits from AI assistants like ChatGPT and Perplexity from GA4.', 'Load traffic data', go); }
  const d = run.data, ss = d.sourcesSummary;
  el.innerHTML = setup + `${d.errors?.length ? `<div class="card" style="margin-bottom:16px"><span class="sev error"><span>${esc(d.errors.join(' · '))}</span></span></div>` : ''}
  <div class="grid g4"><div class="card stat"><span class="label">Google clicks (28d)</span><span class="value">${fmt(d.totals.clicks)}</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Impressions (28d)</span><span class="value">${fmt(d.totals.impressions)}</span></div><div class="card stat"><span class="label">Visits from AI assistants</span><span class="value">${ss ? fmt(ss.aiSessions) : '–'}</span><span class="sub">${ss ? ss.aiShare + '% of all visits' : 'connect GA4'}</span></div><div class="card stat"><span class="label">Organic search visits</span><span class="value">${ss ? fmt(ss.organicSessions) : '–'}</span></div></div>
  <div class="grid split" style="margin-top:16px"><div class="card"><h2>Clicks per day (90 days)</h2>${lineChart([{ name: 'Clicks', color: 'var(--series-1)', points: d.daily.map(x => ({ x: x.date, y: x.clicks })) }], { yMax: null, height: 200 })}</div>
    <div class="card"><h2>AI assistant referrals</h2>${ss?.aiSources?.length ? hbars(ss.aiSources.map(x => ({ label: x.source, value: x.sessions })), Math.max(...ss.aiSources.map(x => x.sessions))) : '<p class="muted small">No AI referrals found yet.</p>'}</div></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Quick wins - queries on page 1–2 just outside the top spots</h2><table><thead><tr><th>Query</th><th class="num">Impr.</th><th class="num">Pos.</th></tr></thead><tbody>${d.opportunities.map(q => `<tr><td>${esc(q.key)}</td><td class="num">${fmt(q.impressions)}</td><td class="num">${q.position.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None right now</td></tr>'}</tbody></table>
    ${d.lowCtr.length ? `<h3>Ranking well but few clicks - rewrite these titles</h3><table><tbody>${d.lowCtr.map(q => `<tr><td>${esc(q.key)}</td><td class="num">#${q.position.toFixed(1)}</td><td class="num">${(q.ctr * 100).toFixed(1)}% CTR</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="card"><h2>Top queries</h2><div class="table-wrap"><table><thead><tr><th>Query</th><th class="num">Clicks</th><th class="num">Impr.</th><th class="num">CTR</th><th class="num">Pos.</th></tr></thead><tbody>${d.queries.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 100).map(q => `<tr><td>${esc(q.key)}</td><td class="num">${fmt(q.clicks)}</td><td class="num">${fmt(q.impressions)}</td><td class="num">${(q.ctr * 100).toFixed(1)}%</td><td class="num">${q.position.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>
    <h3>Top pages</h3><div class="table-wrap" style="max-height:260px"><table><tbody>${d.pages.slice(0, 50).map(pg => `<tr><td class="small" style="word-break:break-all">${esc(pg.key)}</td><td class="num">${fmt(pg.clicks)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
};

// ---------------------------------------------------------------- Public shared report
views.share = async (el, token) => {
  document.body.classList.add('public');
  $('#pageTitle').textContent = 'Report';
  try {
    const b = await api('/share/' + token);
    renderReport(el, b, true);
  } catch (e) { el.innerHTML = `<div class="card empty"><h2>Report unavailable</h2><p>${esc(e.message)}</p></div>`; }
};

// ---------------------------------------------------------------- Project create / settings
function projectForm(p = {}) {
  return `<div class="grid g2">
    <label>Business name *<input name="name" required value="${esc(p.name)}"></label>
    <label>Website<input name="domain" value="${esc(p.domain)}" placeholder="example.com"></label>
    <label>Primary category<input name="category" value="${esc(p.category)}" placeholder="e.g. Bail bondsman"></label>
    <label>Phone<input name="phone" value="${esc(p.phone)}" placeholder="(555) 555-5555"></label>
    <label class="span2">Street address<input name="address" value="${esc(p.address)}"></label>
    <label>City<input name="city" value="${esc(p.city)}" placeholder="Springfield"></label>
    <label>State<input name="state" value="${esc(p.state)}" placeholder="OH"></label>
    <label>Latitude<input name="lat" value="${p.lat ?? ''}"></label><label>Longitude<input name="lng" value="${p.lng ?? ''}"></label>
    <div class="span2"><div class="small muted" style="margin-bottom:4px">Click the map to set your exact business location (grid scans are centered here).</div><div id="pickMap" class="map small"></div></div>
    <label>Google Place ID<input name="placeId" value="${esc(p.placeId)}" placeholder="auto-filled when you pick from Google"></label>
    <label>Automatic re-scans<select name="schedule">${['weekly', 'daily', 'off'].map(s => `<option ${(p.schedule || 'weekly') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="span2">About the business (helps AI write accurate content)<textarea name="about" rows="3">${esc(p.about)}</textarea></label>
    <label class="span2">Tracked keywords (one per line) <button type="button" class="ghost small" id="sugKw" style="align-self:flex-start">Suggest keywords</button><textarea name="keywords" rows="4">${esc((p.keywords || []).join('\n'))}</textarea></label>
  </div>`;
}
function bindSuggest(form) {
  const b = form.querySelector('#sugKw'); if (!b) return;
  b.onclick = e => busy(e.currentTarget, async () => {
    const f = n => form.querySelector(`[name=${n}]`).value;
    if (!f('category')) throw new Error('Enter the primary category first');
    const { keywords } = await api('/suggest-keywords', { body: { category: f('category'), city: f('city'), name: f('name') } });
    const ta = form.querySelector('[name=keywords]'); ta.value = [...new Set([...ta.value.split('\n').map(x => x.trim()).filter(Boolean), ...keywords])].join('\n');
  });
}
function bindPicker(form) {
  bindSuggest(form);
  const lat = form.querySelector('[name=lat]'), lng = form.querySelector('[name=lng]');
  const center = lat.value ? [+lat.value, +lng.value] : [39.83, -98.58];
  const map = L.map('pickMap').setView(center, lat.value ? 14 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  let mk = lat.value ? L.marker(center).addTo(map) : null;
  map.on('click', e => { lat.value = e.latlng.lat.toFixed(6); lng.value = e.latlng.lng.toFixed(6); mk ? mk.setLatLng(e.latlng) : (mk = L.marker(e.latlng).addTo(map)); });
  return track(map);
}
const formData = f => Object.fromEntries(new FormData(f).entries());

views.new = async (el) => {
  const pv = S.status.providers;
  el.innerHTML = `<div class="wizard"><div class="card"><h2>Add a business</h2><p class="muted">Track one location per project. Everything below can be changed later.</p>
    ${pv.places ? `<div class="row" style="margin-bottom:14px"><label style="flex:3">Find it on Google<input id="gq" placeholder="Business name and city"></label><button id="gsearch" class="ghost">Search</button></div><div id="gres" style="margin-bottom:14px"></div>` : '<p class="small muted">Tip: add GOOGLE_PLACES_API_KEY to auto-fill everything from Google.</p>'}
    <form id="pf">${projectForm()}<div class="row" style="margin-top:16px"><button type="submit" class="shrink">Create & run checkup</button>${!S.projects.length ? '<button type="button" id="demoBtn" class="ghost shrink">Try with a sample business</button>' : ''}</div></form></div></div>`;
  const form = $('#pf'); const map = bindPicker(form);
  if ($('#gsearch')) $('#gsearch').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('/places/search?q=' + encodeURIComponent($('#gq').value));
    $('#gres').innerHTML = r.results.map((x, i) => `<div class="issue"><b>${esc(x.name)}</b> <span class="muted small">${esc(x.address)} · ${x.rating ?? ''}★ (${x.reviews})</span> <button type="button" class="small ghost" data-i="${i}">Use this</button></div>`).join('') || '<p class="muted">No matches.</p>';
    $('#gres').onclick = ev => {
      const x = r.results[ev.target.dataset.i]; if (!x) return;
      const parts = (x.address || '').split(',').map(s => s.trim());
      Object.entries({ name: x.name, domain: x.domain || '', phone: x.phone || '', category: x.category || '', address: x.address, city: parts[parts.length - 3] || '', state: (parts[parts.length - 2] || '').split(' ')[0], lat: x.lat, lng: x.lng, placeId: x.placeId }).forEach(([k, v]) => { const f = form.querySelector(`[name=${k}]`); if (f) f.value = v ?? ''; });
      map.setView([x.lat, x.lng], 15); L.marker([x.lat, x.lng]).addTo(map);
    };
  });
  if ($('#demoBtn')) $('#demoBtn').onclick = () => {
    Object.entries({ name: 'Riverside Plumbing Co', domain: 'example.com', category: 'Plumber', phone: '(937) 555-0142', address: '100 S Fountain Ave', city: 'Springfield', state: 'OH', lat: 39.9242, lng: -83.8088, keywords: 'plumber springfield ohio\nemergency plumber springfield\nwater heater repair springfield oh\ndrain cleaning near me' }).forEach(([k, v]) => form.querySelector(`[name=${k}]`).value = v);
    map.setView([39.9242, -83.8088], 14);
  };
  form.onsubmit = async ev => {
    ev.preventDefault(); const btn = form.querySelector('[type=submit]');
    await busy(btn, async () => {
      const d = formData(form); if (!d.lat) throw new Error('Click the map to set your location');
      const p = await api('/projects', { body: d }); S.pid = p.id; store.set('pid', p.id); await refreshProjects();
      location.hash = '#/overview'; await router(); $('#checkup')?.click();
    });
  };
};
views.settings = async (el, p) => {
  el.innerHTML = `<div class="wizard"><div class="card"><form id="pf">${projectForm(p)}<label style="margin-top:12px">AI visibility prompts (one per line)<textarea name="aiPrompts" rows="5">${esc((p.aiPrompts || []).join('\n'))}</textarea></label><label style="margin-top:12px">Map keywords re-scanned automatically (one per line)<textarea name="gridKeywords" rows="3">${esc((p.gridKeywords || []).join('\n'))}</textarea></label>
    <label style="margin-top:12px">Group (for the All Businesses page)<input name="group" value="${esc(p.group || '')}" placeholder="e.g. Bail bonds, Real estate, Client: Acme"></label>
    <h3>Alerts</h3><label>Email alerts to (negative reviews, ranking/map/AI drops, site-health drops)<input name="alertEmail" type="email" value="${esc(p.alertEmail || '')}" placeholder="you@business.com"></label>
    <h3>Google Search Console & GA4</h3><div class="grid g2"><label>Search Console property<input name="gscSite" value="${esc(p.gscSite || '')}" placeholder="sc-domain:${esc(p.domain || 'example.com')}"></label><label>GA4 property ID<input name="ga4Property" value="${esc(p.ga4Property || '')}" placeholder="123456789"></label></div>
    <div class="row" style="margin-top:16px"><button type="submit" class="shrink">Save</button><button type="button" id="del" class="danger shrink">Delete project</button></div></form></div></div>`;
  const form = $('#pf'); bindPicker(form);
  form.onsubmit = async ev => { ev.preventDefault(); await busy(form.querySelector('[type=submit]'), async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: formData(form) }); await refreshProjects(); toast('Saved'); }); };
  $('#del').onclick = async () => { if (!confirm(`Delete ${p.name} and all its history?`)) return; await api(`/projects/${p.id}`, { method: 'DELETE' }); S.pid = null; await refreshProjects(); location.hash = '#/overview'; router(); };
};

// ---------------------------------------------------------------- boot
const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
$('#themeToggle').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); };
$('#menuBtn').onclick = e => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); };
document.querySelector('main').addEventListener('click', () => $('#sidebar').classList.remove('open'));
$('#projectSelect').onchange = e => { S.pid = e.target.value; store.set('pid', S.pid); router(); };
window.addEventListener('hashchange', router);
(async () => {
  if (location.hash.startsWith('#/share/')) { document.body.classList.add('public'); return views.share($('#view'), location.hash.slice(8)); }
  S.status = await api('/status'); await refreshProjects(); router();
})();
