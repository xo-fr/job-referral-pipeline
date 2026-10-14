// The local pipeline state: which jobs you approved, and (later) who gets
// contacted for them and where each contact stands. It holds real names, so
// it lives in outreach/data/, which is gitignored - the repo is public.
//
//   jobs[id]     = { decision: 'approved' | 'rejected', decided_at, pitch?, job }
//                  `job` is a snapshot (title, company, url, match...) so later
//                  stages still work after jobs.json prunes the posting;
//                  `pitch` is your edit of the Gemini pitch, when you made one.
//   contacts[id] = filled by the people finder (phase 3)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
// PIPELINE_FILE points a trial run somewhere other than your real decisions.
export const PIPELINE = process.env.PIPELINE_FILE || path.join(DATA_DIR, 'pipeline.json');

// What reaches the snapshot: enough to show the job and write to people about it.
const SNAPSHOT = ['company', 'title', 'location', 'url', 'posted_at', 'first_seen', 'tier', 'yoe', 'match'];

export function load(file = PIPELINE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, jobs: {}, contacts: {}, ...s };
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, jobs: {}, contacts: {} };
    throw e;   // a corrupt file is worth stopping for, not silently resetting
  }
}

// Write to a temp file and rename, so a crash mid-write never leaves half a file.
export function save(state, file = PIPELINE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function snapshot(job) {
  return Object.fromEntries(SNAPSHOT.filter((k) => job[k] != null).map((k) => [k, job[k]]));
}

// decision: 'approved' | 'rejected' | null (undo). Returns the new record or null.
export function decide(state, id, decision, job, { pitch, now = new Date() } = {}) {
  if (decision == null) {
    delete state.jobs[id];
    return null;
  }
  const prev = state.jobs[id] || {};
  const rec = { ...prev, decision, decided_at: now.toISOString(), job: job ? snapshot(job) : prev.job };
  if (pitch !== undefined) {
    // an edit back to the generated text is no edit at all
    if (pitch && pitch !== rec.job?.match?.pitch) rec.pitch = pitch;
    else delete rec.pitch;
  }
  state.jobs[id] = rec;
  return rec;
}

// The pitch the outreach should use: yours if you edited it, else Gemini's.
export const pitchOf = (rec) => rec?.pitch || rec?.job?.match?.pitch || '';
