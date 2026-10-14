// Knobs shared by the review page, the people finder and the sender.

// The cloud scan publishes scored jobs here; reading it directly means the
// review page is current without a `git pull`.
export const JOBS_URL = process.env.JOBS_URL
  || 'https://raw.githubusercontent.com/xo-fr/job-referral-pipeline/main/docs/data/jobs.json';

// Daily invite budget, and how many people to contact per approved job
// (hiring team + recruiters + engineers). Together they say how many jobs a
// day are worth approving: ceil(20 / 6) = 4.
export const INVITES_PER_DAY = Number(process.env.INVITES_PER_DAY || 20);
export const CONTACTS_PER_JOB = Number(process.env.CONTACTS_PER_JOB || 6);
