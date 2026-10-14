// Local review page: approve or reject scored jobs before any outreach.
//
//   npm run review                      # opens http://127.0.0.1:4477
//   npm run review -- --jobs ../docs/data/jobs.json --no-open
//
// Jobs come from the published jobs.json (JOBS_URL), falling back to the
// repo's own copy; decisions go to data/pipeline.json. No dependencies.
// Binds to 127.0.0.1 only, and refuses requests that did not come from its
// own page, so no website you visit can approve jobs behind your back.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pipeline from '../lib/pipeline.mjs';
import { JOBS_URL, INVITES_PER_DAY, CONTACTS_PER_JOB } from '../lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_JOBS = path.resolve(pipeline.ROOT, '..', 'docs', 'data', 'jobs.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const PORT = Number(opt('--port', 4477));
const JOBS_FILE = opt('--jobs', '');
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

let jobs = { jobs: {} }, source = '', fetchedAt = null;

async function loadJobs() {
  if (JOBS_FILE) {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    source = path.resolve(JOBS_FILE);
  } else {
    try {
      const r = await fetch(JOBS_URL, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      jobs = await r.json();
      source = JOBS_URL;
    } catch (e) {
      console.warn(`could not fetch ${JOBS_URL} (${e.message}); using the local copy`);
      jobs = JSON.parse(fs.readFileSync(LOCAL_JOBS, 'utf8'));
      source = LOCAL_JOBS;
    }
  }
  fetchedAt = new Date().toISOString();
  console.log(`loaded ${Object.keys(jobs.jobs || {}).length} jobs from ${source}`);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('body too large');
  }
  return JSON.parse(raw || '{}');
}

function payload() {
  return {
    jobs: jobs.jobs || {},
    updated: jobs.updated || null,
    decisions: pipeline.load().jobs,
    source, fetchedAt,
    budget: { invitesPerDay: INVITES_PER_DAY, contactsPerJob: CONTACTS_PER_JOB },
  };
}

const server = http.createServer(async (req, res) => {
  // DNS rebinding: a hostile page can resolve its own name to 127.0.0.1, but
  // it cannot make the browser send our Host header
  if (!HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'bad host' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (url.searchParams.get('refresh')) await loadJobs();
      return send(res, 200, payload());
    }
    if (req.method === 'POST' && url.pathname === '/api/decide') {
      // A cross-site form cannot send application/json without a CORS
      // preflight, which this server never answers; the Origin check covers
      // the rest.
      const origin = req.headers.origin;
      if (!(req.headers['content-type'] || '').startsWith('application/json')
          || (origin && !HOSTS.has(origin.replace(/^https?:\/\//, '')))) {
        return send(res, 403, { error: 'cross-site request refused' });
      }
      const { id, decision, pitch } = await readJson(req);
      if (typeof id !== 'string' || !['approved', 'rejected', null].includes(decision ?? null)) {
        return send(res, 400, { error: 'want {id, decision: approved|rejected|null}' });
      }
      if (pitch !== undefined && (typeof pitch !== 'string' || pitch.length > 400)) {
        return send(res, 400, { error: 'pitch must be a string of at most 400 characters' });
      }
      const state = pipeline.load();
      const job = (jobs.jobs || {})[id];
      if (!job && !state.jobs[id]) return send(res, 404, { error: `unknown job ${id}` });
      const rec = pipeline.decide(state, id, decision ?? null, job, { pitch: pitch?.trim() });
      pipeline.save(state);
      return send(res, 200, { id, record: rec });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

await loadJobs();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`review page: ${url}  (decisions -> ${pipeline.PIPELINE})`);
  if (!flag('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
});
