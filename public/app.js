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
  try { return await fn(); } catch (e) { toast('⚠ ' + e.message, 6000); throw e; } finally { btn.disabled = false; btn.innerHTML = label; }
}
const srcPill = s => !s ? '' : s === 'demo' ? '<span class="pill demo" title="Simulated data - add the provider API key in .env for live data">DEMO DATA</span>' : `<span class="pill live">LIVE · ${esc(s.replace(/_/g, ' '))}</span>`;
const ring = (v, label) => `<div class="score-ring" style="--v:${v ?? 0};--c:${v == null ? 'var(--border)' : v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--warning)' : 'var(--critical)'}"><div>${v ?? '–'}</div></div>${label ? `<div class="muted small">${label}</div>` : ''}`;

// ---------------------------------------------------------------- state & nav
const S = { status: null, projects: [], pid: store.get('pid', null), get project() { return this.projects.find(p => p.id === this.pid); } };
const NAV = [
  ['Overview', [['overview', '⌂', 'Dashboard'], ['plan', '✓', 'Action Plan']]],
  ['Local', [['maps', '◎', 'Map Rank Grid'], ['gbp', '★', 'Business Profile'], ['reviews', '✎', 'Reviews'], ['citations', '≡', 'Listings']]],
  ['Organic', [['audit', '⚙', 'Site Audit'], ['keywords', '⌕', 'Keyword Research'], ['organic', '↗', 'Rank Tracking'], ['backlinks', '⛓', 'Backlinks']]],
  ['AI Search', [['ai', '✦', 'AI Visibility'], ['content', '✍', 'Content Studio']]],
  ['Account', [['report', '⎙', 'Client Report'], ['settings', '⚑', 'Project Settings'], ['new', '+', 'Add Business']]],
];
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, , t]) => [k, t])));

function renderNav(active) {
  $('#nav').innerHTML = NAV.map(([g, items]) => `<div class="group">${g}</div>` + items.map(([k, ico, t]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}"><span class="ico">${ico}</span>${t}</a>`).join('')).join('');
  $('#projectSelect').innerHTML = S.projects.map(p => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option>No businesses yet</option>';
  const pv = S.status?.providers || {};
  $('#providerBadges').innerHTML = [['AI (Claude)', pv.ai], ['Google Places', pv.places], ['DataForSEO', pv.dataforseo], ['Site crawler', true]].map(([n, on]) => `<div class="provider"><span>${n}</span><span class="pill ${on ? 'live' : 'demo'}">${on ? 'live' : 'demo'}</span></div>`).join('');
}

async function refreshProjects() { S.projects = await api('/projects'); if (!S.project && S.projects[0]) S.pid = S.projects[0].id; store.set('pid', S.pid); }

const views = {};
let currentMap = null;
async function router() {
  const route = (location.hash.replace(/^#\//, '') || 'overview').split('?')[0];
  if (currentMap) { currentMap.remove(); currentMap = null; }
  $('#sidebar').classList.remove('open');
  const view = !S.projects.length && route !== 'new' ? 'new' : route;
  renderNav(view);
  $('#pageTitle').textContent = TITLES[view] || 'RankPilot';
  $('#pageActions').innerHTML = '';
  const el = $('#view'); el.innerHTML = '<div class="muted"><span class="spinner"></span> Loading…</div>';
  try { await (views[view] || views.overview)(el, S.project); } catch (e) { el.innerHTML = `<div class="card"><b>Something went wrong:</b> ${esc(e.message)}</div>`; console.error(e); }
  el.focus({ preventScroll: true });
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
  return `<div class="task ${done ? 'done' : ''}"><input type="checkbox" data-task="${esc(t.title)}" ${done ? 'checked' : ''} aria-label="Mark done"><div><div class="t-title">${esc(t.title)}</div><div class="t-detail">${esc(t.detail)}</div></div><div style="text-align:right"><span class="pill">${esc(t.area)}</span><div class="small muted" style="margin-top:4px">${t.impact} impact · ${t.effort}</div>${t.link ? `<a class="small" href="#/${t.link}">Open →</a>` : ''}</div></div>`;
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
views.maps = async (el, p) => {
  let lastGrid = null;
  const runs = await api(`/projects/${p.id}/runs?type=grid&limit=40`);
  const kwOpts = [...new Set([...(p.gridKeywords || []), ...(p.keywords || [])])];
  el.innerHTML = `
  <div class="card no-print"><div class="row">
    <label style="flex:2">Keyword<input id="kw" list="kwlist" placeholder="e.g. ${esc((p.category || 'plumber').toLowerCase())} near me" value="${esc(kwOpts[0] || '')}"><datalist id="kwlist">${kwOpts.map(k => `<option value="${esc(k)}">`).join('')}</datalist></label>
    <label>Grid<select id="size">${[3, 5, 7, 9, 11, 13, 15].map(n => `<option ${n === 7 ? 'selected' : ''} value="${n}">${n}×${n} (${n * n} pts)</option>`).join('')}</select></label>
    <label>Radius<select id="radius">${[0.5, 1, 2, 3, 5, 8, 10, 15, 25].map(n => `<option ${n === 3 ? 'selected' : ''} value="${n}">${n} mi</option>`).join('')}</select></label>
    <label>Shape<select id="shape"><option value="square">Square</option><option value="circle">Circle (cheaper)</option><option value="rings">Distance rings</option></select></label>
    <label>Data source<select id="source"><option value="auto">Best available</option><option value="dataforseo">DataForSEO (GPS-exact)</option><option value="google_places">Google Places</option><option value="demo">Demo</option></select></label>
    <button id="scan">Run scan</button></div>
    <div class="row small muted" style="margin-top:8px"><span>History:</span><select id="hist" class="shrink" style="max-width:420px"><option value="">Latest scan</option>${runs.map(r => `<option value="${r.id}">${esc(r.keyword)} · ${esc(r.summary)} · ${new Date(r.createdAt).toLocaleString()}</option>`).join('')}</select>
    <label class="shrink" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="cmpToggle" style="width:auto"> Compare with previous scan of same keyword</label></div>
  </div>
  <div id="gridOut" style="margin-top:16px"></div>`;
  $('#scan').onclick = e => busy(e.currentTarget, async () => {
    const body = { keyword: $('#kw').value.trim(), size: +$('#size').value, radiusMiles: +$('#radius').value, shape: $('#shape').value, source: $('#source').value };
    const run = await api(`/projects/${p.id}/grid`, { body });
    if (!(p.gridKeywords || []).includes(body.keyword)) { await api(`/projects/${p.id}`, { method: 'PUT', body: { gridKeywords: [...(p.gridKeywords || []), body.keyword] } }); await refreshProjects(); }
    showGrid(run);
  });
  $('#hist').onchange = async e => showGrid(e.target.value ? await api('/runs/' + e.target.value) : await api(`/projects/${p.id}/latest/grid`));
  $('#cmpToggle').onchange = async () => { if (lastGrid) showGrid(lastGrid); };
  const latest = await api(`/projects/${p.id}/latest/grid`);
  if (latest) showGrid(latest); else $('#gridOut').innerHTML = `<div class="card empty"><h2>See your Google Maps rankings block by block</h2><p>Pick a keyword customers search and run a scan. Each pin on the map shows where you rank when someone searches from that exact spot.</p></div>`;

  async function showGrid(run) {
    lastGrid = run;
    const d = run.data, m = d.metrics;
    let prevRun = null;
    if ($('#cmpToggle').checked) { const prevMeta = runs.filter(r => r.keyword === run.keyword && r.id !== run.id && r.createdAt < run.createdAt)[0]; if (prevMeta) prevRun = await api('/runs/' + prevMeta.id); }
    const dl = (v, invert) => v == null ? '' : `<span class="delta ${(invert ? -v : v) > 0 ? 'up' : (invert ? -v : v) < 0 ? 'down' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(v)}</span>`;
    $('#gridOut').innerHTML = `
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
          ${prevRun ? `<div class="grid g2"><div><div class="small muted">Previous · ${new Date(prevRun.createdAt).toLocaleDateString()}</div><div id="map2" class="map"></div></div><div><div class="small muted">This scan</div><div id="map" class="map"></div></div></div>` : '<div id="map" class="map"></div>'}
          <div class="legend"><span><i style="background:#0ca30c"></i>1–3 (map pack)</span><span><i style="background:#b98400"></i>4–10</span><span><i style="background:#e0632f"></i>11–15</span><span><i style="background:#d03b3b"></i>16–20</span><span><i style="background:#6b6a65"></i>Not in top 20</span><span>· Click any pin to see who outranks you there</span></div>
          <div id="pointDetail" style="margin-top:12px"></div></div>
        <div class="card"><h2>What this means</h2>${d.insights.map(i => `<div class="insight ${i.type}"><span class="i">${{ good: '✓', bad: '✕', warn: '!', info: 'i' }[i.type]}</span><span>${esc(i.text)}</span></div>`).join('')}
          <h3>Competitor leaderboard (whole grid)</h3><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>#</th><th>Business</th><th class="num">SoLV</th><th class="num">ATRP</th><th class="num">★</th><th class="num">Reviews</th></tr></thead><tbody>
          ${d.leaderboard.slice(0, 15).map((c, i) => `<tr class="${c.isTarget ? 'me' : ''}"><td>${i + 1}</td><td>${esc(c.name)}${c.isTarget ? ' <span class="pill">you</span>' : ''}</td><td class="num">${c.solv}%</td><td class="num">${c.atrp}</td><td class="num">${c.rating ?? '–'}</td><td class="num">${fmt(c.reviews)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>`;
    currentMap = drawGrid('map', d, run.id);
    if (prevRun) { const m2 = drawGrid('map2', prevRun.data, prevRun.id); currentMap.sync = m2; currentMap.on('move', () => m2.setView(currentMap.getCenter(), currentMap.getZoom(), { animate: false })); }
  }
  function drawGrid(id, d, runId) {
    const map = L.map(id, { scrollWheelZoom: false }).setView([d.config.center.lat, d.config.center.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const b = [];
    d.points.forEach(pt => {
      const icon = L.divIcon({ className: '', html: `<div class="rank-pin ${pinClass(pt.rank)}" title="Rank ${pt.rank ?? '20+'}">${pt.rank ?? '20+'}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
      L.marker([pt.lat, pt.lng], { icon, keyboard: true, title: `Rank ${pt.rank ?? 'not found'}` }).addTo(map).on('click', async () => {
        let results = pt.results;
        if (results.length <= 3) { const full = await api('/runs/' + runId); results = full.data.points.find(x => x.lat === pt.lat && x.lng === pt.lng)?.results || results; }
        $('#pointDetail').innerHTML = `<div class="card" style="background:var(--surface-2)"><b>From this spot</b> (${(pt.distanceM / 1609).toFixed(1)} mi from you): ${pt.rank ? `you rank <b>#${pt.rank}</b>` : 'you are <b>not in the top 20</b>'}<ol class="small" style="margin:8px 0 0">${results.slice(0, 10).map(r => `<li ${r.name === S.project.name ? 'style="font-weight:700"' : ''}>${esc(r.name)} <span class="muted">${r.rating ? '★' + r.rating : ''} ${r.reviews ? '(' + fmt(r.reviews) + ')' : ''}</span></li>`).join('')}</ol></div>`;
      });
      b.push([pt.lat, pt.lng]);
    });
    L.circleMarker([d.config.center.lat, d.config.center.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(map).bindTooltip('Your business');
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
  if (!p.keywords?.length) return emptyState(el, 'Track your Google rankings', 'Add keywords in Keyword Research (tick the boxes) or Project Settings.', 'Open Keyword Research', () => location.hash = '#/keywords');
  if (!run) return emptyState(el, `Track ${p.keywords.length} keywords`, 'Check where you rank in organic results, which SERP features appear, and whether Google\'s AI Overview cites you.', 'Check rankings', go);
  const d = run.data;
  const hist = runs.slice().reverse().map(r => ({ x: r.createdAt, y: parseFloat(r.summary.match(/Visibility ([\d.]+)/)?.[1] || 0) }));
  el.innerHTML = `<div class="grid g6"><div class="card stat"><span class="label">Visibility</span><span class="value">${d.visibility}%</span><span class="sub">${srcPill(d.source)}</span></div><div class="card stat"><span class="label">Est. monthly clicks</span><span class="value">${fmt(d.traffic)}</span></div><div class="card stat"><span class="label">Top 3</span><span class="value">${d.top3}</span></div><div class="card stat"><span class="label">Top 10</span><span class="value">${d.top10}</span></div><div class="card stat"><span class="label">AI Overviews shown</span><span class="value">${d.aiOverviews}</span><span class="sub">of ${d.rows.length} keywords</span></div><div class="card stat"><span class="label">AI Overview cites you</span><span class="value">${d.aiOverviewCitations}</span></div></div>
  <div class="grid split" style="margin-top:16px"><div class="card"><h2>Keywords</h2><div class="table-wrap"><table><thead><tr><th>Keyword</th><th class="num">Pos.</th><th class="num">Change</th><th class="num">Volume</th><th>SERP features</th><th>AI Overview</th><th>URL</th></tr></thead><tbody>
    ${d.rows.map(r => `<tr><td>${esc(r.keyword)}</td><td class="num"><b>${r.position ?? '100+'}</b></td><td class="num">${r.change ? `<span class="delta ${r.change > 0 ? 'up' : 'down'}">${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}</span>` : ''}</td><td class="num">${fmt(r.volume)}</td><td class="small">${(r.features || []).map(f => `<span class="pill">${esc(f.replace(/_/g, ' '))}</span>`).join(' ')}</td><td class="small">${r.aiOverview?.present ? (r.aiOverview.citesYou ? '✓ cites you' : '✕ not cited') : '–'}</td><td class="small" style="word-break:break-all">${esc(r.url || '')}${r.error ? `<span class="sev error"><span>${esc(r.error)}</span></span>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>Visibility trend</h2>${lineChart([{ name: 'Visibility', color: 'var(--series-1)', points: hist }], { height: 150 })}<h3>Who you compete with in organic</h3>${hbars(d.competitors.map(c => ({ label: c.domain, value: c.appearances })), Math.max(1, ...d.competitors.map(c => c.appearances)))}</div></div>`;
};

// ---------------------------------------------------------------- Backlinks
views.backlinks = async (el, p) => {
  const run = await api(`/projects/${p.id}/latest/backlinks`);
  el.innerHTML = `<div class="card no-print"><div class="row"><label style="flex:3">Compare with competitor domains (comma separated)<input id="cmp" value="${esc((p.competitors || []).join(', '))}" placeholder="competitor1.com, competitor2.com"></label><button id="go">Analyze backlinks</button></div></div><div id="blOut" style="margin-top:16px"></div>`;
  $('#go').onclick = e => busy(e.currentTarget, async () => { const compare = $('#cmp').value.split(',').map(s => s.trim()).filter(Boolean); await api(`/projects/${p.id}`, { method: 'PUT', body: { competitors: compare } }); const r = await api(`/projects/${p.id}/backlinks`, { body: { compare } }); await refreshProjects(); show(r.data); });
  if (run) show(run.data);
  function show(d) {
    $('#blOut').innerHTML = `<div class="card"><h2>Authority comparison ${srcPill(d.source)}</h2><table><thead><tr><th>Domain</th><th class="num">Authority</th><th class="num">Referring domains</th><th class="num">Backlinks</th><th class="num">Dofollow %</th></tr></thead><tbody>${d.profiles.map((x, i) => `<tr class="${i === 0 ? 'me' : ''}"><td>${esc(x.domain)}</td><td class="num">${x.authority}</td><td class="num">${fmt(x.referringDomains)}</td><td class="num">${fmt(x.backlinks)}</td><td class="num">${x.dofollowPct ?? '–'}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Link gap - sites linking to competitors, not you</h2>${d.gap.length ? `<table><thead><tr><th>Domain</th><th class="num">Authority</th><th>Links to</th></tr></thead><tbody>${d.gap.map(g => `<tr><td>${esc(g.domain)}</td><td class="num">${g.authority}</td><td class="small">${g.linksTo.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Add competitor domains to find link opportunities.</p>'}</div>
    <div class="card"><h2>Your top referring domains</h2><table><thead><tr><th>Domain</th><th class="num">Authority</th><th class="num">Links</th></tr></thead><tbody>${(d.profiles[0].topReferrers || []).map(r => `<tr><td>${esc(r.domain)}</td><td class="num">${r.authority}</td><td class="num">${r.links}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
};

// ---------------------------------------------------------------- AI visibility
views.ai = async (el, p) => {
  const [run, runs] = await Promise.all([api(`/projects/${p.id}/latest/ai`), api(`/projects/${p.id}/runs?type=ai&limit=30`)]);
  el.innerHTML = `<div class="card no-print"><h2>Prompts to test <span class="muted small">one per line - phrase them the way customers ask ChatGPT, Claude, Gemini or Perplexity</span></h2><textarea id="prompts" rows="5">${esc((p.aiPrompts || []).join('\n'))}</textarea><div class="row" style="margin-top:8px"><button id="go" class="shrink">Run AI visibility check</button><span class="small muted">${S.status.providers.ai ? 'Each prompt is answered live by Claude with web search, then analyzed for mentions, rank, sentiment and cited sources.' : 'Demo mode - add ANTHROPIC_API_KEY for live AI answers.'}</span></div></div><div id="aiOut" style="margin-top:16px"></div>`;
  $('#go').onclick = e => busy(e.currentTarget, async () => { const prompts = $('#prompts').value.split('\n').map(s => s.trim()).filter(Boolean); await api(`/projects/${p.id}`, { method: 'PUT', body: { aiPrompts: prompts } }); await refreshProjects(); const r = await api(`/projects/${p.id}/ai`, { body: { prompts } }); show(r.data); });
  if (run) show(run.data);
  function show(d) {
    const hist = runs.slice().reverse().map(r => ({ x: r.createdAt, y: +(r.summary.match(/AI score (\d+)/)?.[1] || 0) }));
    $('#aiOut').innerHTML = `<div class="grid g4"><div class="card"><h2>AI visibility score ${srcPill(d.source)}</h2><div class="score-row">${ring(d.score)}<div class="small muted">Mentions 60% · prominence 25% · sentiment 15%</div></div></div><div class="card stat"><span class="label">Mentioned in</span><span class="value">${d.mentionRate}%</span><span class="sub">of AI answers</span></div><div class="card stat"><span class="label">Avg position when mentioned</span><span class="value">${d.avgPosition ?? '–'}</span></div><div class="card stat"><span class="label">AI share of voice</span><span class="value">${d.shareOfVoice}%</span><span class="sub">of all businesses named</span></div></div>
    <div class="grid g3" style="margin-top:16px"><div class="card"><h2>How to get recommended more</h2>${d.recommendations.map(r => `<div class="insight info"><span class="i">→</span><span>${esc(r)}</span></div>`).join('')}<h3>Trend</h3>${lineChart([{ name: 'AI score', color: 'var(--series-1)', points: hist }], { height: 130 })}</div>
      <div class="card"><h2>Competitors AI recommends</h2><table><thead><tr><th>Business</th><th class="num">Mentions</th><th class="num">Avg pos.</th></tr></thead><tbody>${d.competitors.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.mentions}</td><td class="num">${c.avgPosition}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>Sources AI cites</h2><p class="small muted">Be present and well-reviewed on these.</p>${hbars(d.sources.map(s => ({ label: s.domain, value: s.count })), Math.max(1, ...d.sources.map(s => s.count)))}</div></div>
    <div class="card" style="margin-top:16px"><h2>Answers</h2>${d.results.map(r => `<details class="issue"><summary>${r.mentioned ? `<span class="sev notice"><span>Mentioned${r.position ? ' #' + r.position : ''}</span></span>` : '<span class="sev error"><span>Not mentioned</span></span>'} · ${esc(r.prompt)} ${r.sentiment && r.mentioned ? `<span class="pill">${esc(r.sentiment)}</span>` : ''}</summary>${r.error ? `<p class="sev error"><span>${esc(r.error)}</span></p>` : `<div class="answer">${esc(r.answer)}</div><div class="small muted" style="margin-top:6px">Named: ${esc(r.businesses.join(', ') || 'none')}${r.reasons?.length ? ' · Reasons given: ' + esc(r.reasons.join(', ')) : ''}${r.citedDomains?.length ? ' · Sources: ' + esc(r.citedDomains.join(', ')) : ''}</div>`}</details>`).join('')}</div>`;
  }
};

// ---------------------------------------------------------------- Content studio
views.content = async (el, p) => {
  const types = S.status.contentTypes;
  el.innerHTML = `<div class="grid g2"><div class="card"><h2>Generate</h2><div class="grid" style="gap:10px">
    <label>What do you need?<select id="ctype">${Object.entries(types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
    <label>Target keyword<input id="ckw" value="${esc(p.keywords?.[0] || '')}" placeholder="e.g. 24 hour bail bonds springfield"></label>
    <label>Topic / notes (optional)<textarea id="ctopic" rows="3" placeholder="Offer, angle, facts to include (license #, years in business, pricing)…"></textarea></label>
    <button id="gen">Generate</button></div><h3>Output</h3><div id="cout" class="output muted">Your content appears here.</div><div class="row" style="margin-top:8px"><button class="ghost small shrink" id="ccopy">Copy</button><button class="ghost small shrink" id="cuse">Score this draft →</button></div></div>
    <div class="card"><h2>Content grader</h2><p class="small muted">Paste any page or draft to grade it against a keyword: coverage, readability, structure, local signals and related terms.</p>
    <label>Keyword<input id="skw" value="${esc(p.keywords?.[0] || '')}"></label><label style="margin-top:8px">Text<textarea id="stext" rows="12"></textarea></label>
    <div class="row" style="margin-top:8px"><button id="terms" class="ghost shrink">Suggest related terms</button><button id="score" class="shrink">Grade</button></div><div id="terms-out" class="small muted" style="margin-top:8px"></div><div id="sout" style="margin-top:8px"></div></div></div>`;
  let terms = [];
  $('#gen').onclick = e => busy(e.currentTarget, async () => { const r = await api(`/projects/${p.id}/content`, { body: { type: $('#ctype').value, keyword: $('#ckw').value, topic: $('#ctopic').value } }); $('#cout').className = 'output'; $('#cout').textContent = r.text; if (r.score) toast(`Content score: ${r.score.score}/100`); });
  $('#ccopy').onclick = () => { navigator.clipboard.writeText($('#cout').textContent); toast('Copied'); };
  $('#cuse').onclick = () => { $('#stext').value = $('#cout').textContent; $('#skw').value = $('#ckw').value; $('#score').click(); };
  $('#terms').onclick = e => busy(e.currentTarget, async () => { terms = (await api(`/projects/${p.id}/content/terms`, { body: { keyword: $('#skw').value } })).terms; $('#terms-out').textContent = 'Related terms: ' + terms.join(', '); });
  $('#score').onclick = e => busy(e.currentTarget, async () => {
    const r = await api(`/projects/${p.id}/content/score`, { body: { text: $('#stext').value, keyword: $('#skw').value, terms } });
    $('#sout').innerHTML = `<div class="score-row">${ring(r.score)}<div>${r.missingTerms.length ? `<div class="small"><b>Missing terms:</b> ${esc(r.missingTerms.join(', '))}</div>` : ''}</div></div>${r.checks.map(c => `<div class="check"><span class="${c.pass ? 'ok' : 'no'}">${c.pass ? '✓' : '✕'}</span><span>${esc(c.label)}${c.value !== undefined ? ` <span class="muted small">(${esc(c.value)})</span>` : ''}</span></div>`).join('')}`;
  });
};

// ---------------------------------------------------------------- Report
views.report = async (el, p) => {
  const types = ['grid', 'gbp', 'reviews', 'audit', 'ai', 'organic', 'citations'];
  const [plan, ...latest] = await Promise.all([api(`/projects/${p.id}/plan`), ...types.map(t => api(`/projects/${p.id}/latest/${t}`))]);
  const L = Object.fromEntries(types.map((t, i) => [t, latest[i]]));
  const c = plan.scorecard;
  $('#pageActions').innerHTML = '<button onclick="window.print()">Print / Save PDF</button>';
  el.innerHTML = `<div class="card"><div class="row" style="align-items:center"><div style="flex:3"><h2 style="font-size:22px;margin:0">${esc(p.name)} - Search Visibility Report</h2><div class="muted">${new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric', day: 'numeric' })} · ${esc([p.category, p.city].filter(Boolean).join(' · '))}</div></div><div class="shrink score-row">${ring(c.overall, 'Overall')}</div></div></div>
  <div class="grid g3" style="margin-top:16px">${[['Map pack', 'maps'], ['Business Profile', 'gbp'], ['Website health', 'website'], ['AI visibility', 'ai'], ['Organic', 'organic'], ['Listings', 'citations']].map(([n, k]) => `<div class="card stat"><span class="label">${n}</span><span class="value">${c.parts[k] ?? '–'}</span></div>`).join('')}</div>
  ${L.grid ? `<div class="card" style="margin-top:16px"><h2>Google Maps rankings - "${esc(L.grid.data.config.keyword)}"</h2><p>In the 3-pack at <b>${L.grid.data.metrics.solv}%</b> of ${L.grid.data.metrics.points} locations across a ${L.grid.data.config.radiusMiles}-mile area. Average rank where found: <b>${L.grid.data.metrics.arp ?? '–'}</b>.${L.grid.data.delta ? ` Change since ${new Date(L.grid.data.delta.since).toLocaleDateString()}: ${L.grid.data.delta.solv > 0 ? '+' : ''}${L.grid.data.delta.solv} pts.` : ''}</p>${L.grid.data.insights.map(i => `<div class="insight ${i.type}"><span class="i">•</span><span>${esc(i.text)}</span></div>`).join('')}</div>` : ''}
  ${L.ai ? `<div class="card" style="margin-top:16px"><h2>AI assistant recommendations</h2><p>Mentioned in <b>${L.ai.data.mentionRate}%</b> of ${L.ai.data.results.length} customer-style AI questions${L.ai.data.avgPosition ? `, average position ${L.ai.data.avgPosition}` : ''}. Most-recommended competitor: <b>${esc(L.ai.data.competitors[0]?.name || '–')}</b>.</p></div>` : ''}
  ${L.reviews ? `<div class="card" style="margin-top:16px"><h2>Reputation</h2><p>${L.reviews.data.rating ?? '–'}★ from ${fmt(L.reviews.data.total)} reviews.</p></div>` : ''}
  ${L.audit ? `<div class="card" style="margin-top:16px"><h2>Website</h2><p>Health ${L.audit.data.health}/100 across ${L.audit.data.pagesCrawled} pages - ${L.audit.data.counts.error} errors, ${L.audit.data.counts.warning} warnings.</p><ul>${L.audit.data.issues.filter(i => i.severity === 'error').slice(0, 6).map(i => `<li>${esc(i.title)}</li>`).join('')}</ul></div>` : ''}
  ${L.organic ? `<div class="card" style="margin-top:16px"><h2>Organic rankings</h2><p>${L.organic.data.top3} keywords in the top 3, ${L.organic.data.top10} in the top 10. Estimated ${fmt(L.organic.data.traffic)} monthly clicks.</p></div>` : ''}
  <div class="card" style="margin-top:16px"><h2>Priorities for next month</h2><ol>${plan.tasks.slice(0, 8).map(t => `<li><b>${esc(t.title)}</b> - ${esc(t.detail)}</li>`).join('')}</ol></div>`;
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
    <label class="span2">Tracked keywords (one per line)<textarea name="keywords" rows="4">${esc((p.keywords || []).join('\n'))}</textarea></label>
  </div>`;
}
function bindPicker(form) {
  const lat = form.querySelector('[name=lat]'), lng = form.querySelector('[name=lng]');
  const center = lat.value ? [+lat.value, +lng.value] : [39.83, -98.58];
  const map = L.map('pickMap').setView(center, lat.value ? 14 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  let mk = lat.value ? L.marker(center).addTo(map) : null;
  map.on('click', e => { lat.value = e.latlng.lat.toFixed(6); lng.value = e.latlng.lng.toFixed(6); mk ? mk.setLatLng(e.latlng) : (mk = L.marker(e.latlng).addTo(map)); });
  currentMap = map; return map;
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
    <div class="row" style="margin-top:16px"><button type="submit" class="shrink">Save</button><button type="button" id="del" class="danger shrink">Delete project</button></div></form></div></div>`;
  const form = $('#pf'); bindPicker(form);
  form.onsubmit = async ev => { ev.preventDefault(); await busy(form.querySelector('[type=submit]'), async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: formData(form) }); await refreshProjects(); toast('Saved'); }); };
  $('#del').onclick = async () => { if (!confirm(`Delete ${p.name} and all its history?`)) return; await api(`/projects/${p.id}`, { method: 'DELETE' }); S.pid = null; await refreshProjects(); location.hash = '#/overview'; router(); };
};

// ---------------------------------------------------------------- boot
const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
$('#themeToggle').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); };
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
$('#projectSelect').onchange = e => { S.pid = e.target.value; store.set('pid', S.pid); router(); };
window.addEventListener('hashchange', router);
(async () => { S.status = await api('/status'); await refreshProjects(); router(); })();
