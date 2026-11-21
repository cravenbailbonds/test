// Tiny JSON document store with atomic writes. Good for a single-business or agency install;
// swap for Postgres later without touching modules (they only use these functions).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const FILE = () => path.join(config.dataDir, 'db.json');
let db = null;

const EMPTY = { projects: [], runs: [], alerts: [], contacts: [], shares: [], settings: {} };

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch {
    db = structuredClone(EMPTY);
  }
  for (const [k, v] of Object.entries(EMPTY)) db[k] ??= structuredClone(v);
  return db;
}

let pending = null;
function save() {
  // Coalesce bursts of writes into one disk write.
  if (pending) return;
  pending = setImmediate(() => {
    pending = null;
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE());
  });
}

export function flush() {
  if (pending) { clearImmediate(pending); pending = null; }
  if (!db) return;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(db));
}

export function resetForTests(dir) {
  config.dataDir = dir;
  db = null;
}

export const id = () => crypto.randomUUID().slice(0, 12);

// ---- Projects -------------------------------------------------------------
export function listProjects() { return load().projects; }
export function getProject(pid) { return load().projects.find(p => p.id === pid) || null; }
export function createProject(data) {
  const p = { id: id(), createdAt: new Date().toISOString(), keywords: [], competitors: [], aiPrompts: [], ...data };
  load().projects.push(p); save(); return p;
}
export function updateProject(pid, patch) {
  const p = getProject(pid); if (!p) return null;
  Object.assign(p, patch, { id: p.id, updatedAt: new Date().toISOString() }); save(); return p;
}
export function deleteProject(pid) {
  const d = load();
  d.projects = d.projects.filter(p => p.id !== pid);
  d.runs = d.runs.filter(r => r.projectId !== pid);
  d.alerts = d.alerts.filter(r => r.projectId !== pid);
  d.contacts = d.contacts.filter(r => r.projectId !== pid);
  d.shares = d.shares.filter(r => r.projectId !== pid);
  save();
}

// ---- Runs (every scan/report result, kept for history & trends) ----------
export function addRun(projectId, type, data, meta = {}) {
  const r = { id: id(), projectId, type, createdAt: new Date().toISOString(), ...meta, data };
  load().runs.push(r); save(); return r;
}
export function listRuns(projectId, type, limit = 50) {
  return load().runs
    .filter(r => r.projectId === projectId && (!type || r.type === type))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
export function latestRun(projectId, type, where = () => true) {
  return listRuns(projectId, type, 1000).find(where) || null;
}
export function getRun(rid) { return load().runs.find(r => r.id === rid) || null; }

// ---- Alerts (in-app notification feed; optionally emailed) -------------
export function addAlert(projectId, kind, title, detail = '', link = '') {
  const a = { id: id(), projectId, kind, title, detail, link, createdAt: new Date().toISOString(), read: false };
  load().alerts.unshift(a); load().alerts.splice(500); save(); return a;
}
export function listAlerts(projectId) { return load().alerts.filter(a => !projectId || a.projectId === projectId); }
export function markAlertsRead(projectId) { load().alerts.forEach(a => { if (!projectId || a.projectId === projectId) a.read = true; }); save(); }

// ---- Review-request contacts --------------------------------------------
export function listContacts(projectId) { return load().contacts.filter(c => c.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function addContact(projectId, data) {
  const c = { id: id(), token: crypto.randomBytes(9).toString('base64url'), projectId, status: 'pending', createdAt: new Date().toISOString(), events: [], ...data };
  load().contacts.push(c); save(); return c;
}
export function getContact(cid) { return load().contacts.find(c => c.id === cid || c.token === cid) || null; }
export function updateContact(cid, patch) { const c = getContact(cid); if (!c) return null; Object.assign(c, patch); save(); return c; }
export function deleteContact(cid) { const d = load(); d.contacts = d.contacts.filter(c => c.id !== cid); save(); }

// ---- Shareable report links ---------------------------------------------
export function createShare(projectId) {
  const s = { token: crypto.randomBytes(12).toString('base64url'), projectId, createdAt: new Date().toISOString() };
  load().shares.push(s); save(); return s;
}
export function getShare(token) { return load().shares.find(s => s.token === token) || null; }
export function revokeShares(projectId) { const d = load(); d.shares = d.shares.filter(s => s.projectId !== projectId); save(); }

// ---- Global settings (branding, notification email) ---------------------
export function getSettings() { return load().settings; }
export function updateSettings(patch) { Object.assign(load().settings, patch); save(); return load().settings; }
