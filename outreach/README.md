# LinkedIn Recruiter Outreach

A single-file Playwright script that finds LinkedIn recruiters hiring for roles you
care about and sends each one a personalized connection invite, slowly and with a
hard cap per run.

It drives a real Chromium window on your own machine using your own logged-in
session. There is no API key, no scraping service, and nothing leaves your computer.

**Read [Before you run this](#before-you-run-this) first** — automating invites is
against LinkedIn's User Agreement.

---

## What it does

1. **Discovers** candidates by running a list of LinkedIn people searches (Boolean
   keywords + location/company + "actively hiring"), in two
   tracks: recruiters and hiring managers. Each search continues from the page it
   reached on the previous run, and a run loads at most 12 search pages in total.
2. **Scores** each result from their headline/card text: points for a recruiter or
   manager title, your tech, Pune/remote, and a target company; deductions for
   agencies and off-stack terms; hard rejects for the wrong fits.
3. **Sends** an invite to the highest-scoring candidates first, one at a time, pausing
   25–55 s between each. The note names the role from their "Hiring:" card when it
   matches. Skips anyone already pending, already connected, hiring for the wrong
   role, or whose invite requires an email address.
4. **Records** everyone processed in `state.json`, with the search, track, and score
   that found them, so reruns never double-invite and you can see which searches pay off.
5. **Verifies** the sent invites against your sent-invitations page at the end.

It stops immediately on a CAPTCHA, a security checkpoint, or the weekly invite limit.

---

## Requirements

- **Node.js 20+** (Playwright 1.63 requires it)
- A desktop OS with a display — the browser runs visibly, not headless
- A LinkedIn account you log into by hand on the first run

---

## Setup

```bash
git clone <your-repo-url>
cd LinkedIn-outreach
npm install          # installs playwright
npm run setup        # downloads the Chromium build playwright drives
```

---

## How to use

### 1. Customize the script first

The defaults are written for *one specific person's* job search (a senior Java
backend engineer in Pune, India). **They will not fit you.** Open `outreach.mjs` and
edit `ME`/`NOTES`, `PRODUCT_COMPANIES`/`CYBER_COMPANIES`/`MORE_COMPANIES`, `SEARCHES`, and the scoring regexes before your first run — see
[Customizing](#customizing) below.

### 2. Do a dry run

```bash
node outreach.mjs --dry
```

A Chromium window opens. **Log in to LinkedIn yourself** in that window — the script
waits up to 5 minutes for you. Your session is saved in `./profile`, so you only do
this once.

The dry run does everything a real run does — searches, filters, opens each profile,
clicks Connect, fills in the note — then presses Escape instead of Send. Nothing is
sent and `state.json` is not written, so you can rerun it as often as you like.

Watch the output and confirm:

- the pool is filling with people who are actually relevant recruiters
- the note reads correctly with their first name substituted in
- the skip reasons make sense

### 3. Do a real run

```bash
node outreach.mjs              # sends up to 20
node outreach.mjs --max 5      # sends up to 5 — good for a first live run
```

Start small. Let the window be; don't click in it while the script works.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--max N` | `20` | Invites to send this run. Capped at 20 regardless of what you pass. |
| `--dry` | off | Rehearse everything, send nothing, write nothing to `state.json`. |

`npm start` is a shortcut for `node outreach.mjs` with no flags.

### Reading the output

```
14:08:26  ████████░░░░░░░░░░░░  4/20  ✔ SENT    Protyusha  protyusha-gupta-438378b7
14:10:33  ████████░░░░░░░░░░░░  4/20  ➜ skip    monika-ghule  hiring card "Hiring: Teamcenter Architect"
```

A `✖ error` line means a step failed on that profile; the script saves a
`debug-<id>-<step>.png` screenshot and **does not** record the person, so they are
retried on the next run. Skips *are* recorded and never retried.

### Pacing

Run this **at most ~4 times a week**. The per-invite delay and the 20-invite cap
exist to keep your account out of trouble; raising them is how accounts get
restricted.

---

## Customizing

Everything worth changing sits in the first ~75 lines of `outreach.mjs`.

### The notes

```js
const NOTES = {
  recruiter: (first, role, cyber) => [ /* role-specific, general (300 chars), then two 200-char fallbacks */ ],
  manager:   (first, role, cyber) => [ /* same, worded for a hiring manager */ ],
};
```

Each track has a list of notes, most specific first. When the invite dialog opens, the
script reads the note box's character limit (300 with Premium, 200 without; assumed 200
if the box doesn't say). It then sends **the first note that fits**. If none fits, it skips
that person rather than send a truncated note.

- `first` is their first name.
- `role` is the role from their "Hiring:" card, filled in only when it matches
  `GOOD_ROLE` and is 45 characters or less.
- `cyber` is true when the top of their profile mentions a `CYBER_COMPANIES` name or
  "cybersecurity". Their general note says you most recently worked on VM
  solutions at Rapid7 until its layoff. Every other note just says "a layoff".

In `--dry` output each line shows `[length/limit cyber]`, so you can see which note was
chosen and whether the 300-character limit was detected.

### Target companies

```js
const PRODUCT_COMPANIES = { Mastercard: '3015', Workday: '17719', /* ... */ };
const CYBER_COMPANIES   = { Qualys: '8561', CrowdStrike: '2497653', /* ... */ };
const MORE_COMPANIES    = { Barclays: '1426', Citi: '11448', /* ... */ };  // bank & fintech tech centres
```

The highest-value searches look for in-house recruiters and hiring managers *at companies
you choose*. `PRODUCT_COMPANIES` and `CYBER_COMPANIES` together feed the `top-recruiters` and `top-managers` searches (boost +3); `CYBER_COMPANIES` also picks the Rapid7 note.
`MORE_COMPANIES` feeds `more-recruiters` (boost +2). An empty map skips its searches.

To add a company, open its LinkedIn page and copy the number from the "N employees" link
(`currentCompany=["…"]`). **Check the page name first.** Several obvious-looking addresses
belong to unrelated pages: `/company/nice`, `/company/coupa-software`, `/company/gendigital`
and `/company/bny` are all different companies.

### The searches

```js
{ name: 'pune-hiring', track: 'recruiter', boost: 1,
  url: people({ kw: `${REC} ${STACK} NOT (campus OR fresher)`, geo: PUNE, hiring: true }) },
```

`people({ kw, geo, company, hiring })` builds a people-search URL:

| Option | LinkedIn filter | Notes |
|---|---|---|
| `kw` | Keywords | Supports Boolean: `AND`, `OR`, `NOT`, quotes, parentheses. **Keep it to ~10 terms** — longer queries silently return "No results found". |
| `geo` | Location `geoUrn` | Where the *person* lives, not the job. Recruiters for Pune roles often sit in other cities, so the company searches use India-wide. |
| `company` | Current company | List of company IDs. |
| `hiring` | "Actively hiring" | Only people showing a Hiring badge. |

There is no job-title filter: LinkedIn made it Premium-only and silently drops `titleFreeText` from the URL on a free account. That is why the role words (`REC`, `MGR`) go in the keywords.

`track` is `recruiter` or `manager`. It decides which title regex the card must
match and which note is sent. `boost` is added to the score of everyone that search
finds. `name` is the key under which the script remembers the last page reached
(`state.pages`).

Searches run in order, `PAGES_PER_SEARCH` (2) pages each, until the run has loaded
`PAGE_BUDGET` (12) pages or the pool holds 2× `--max` candidates. Then the pool is
sorted by score, so your invites go to the best candidates across all searches.

To change location, run a search by hand with the location filter applied and copy
the `geoUrn` number out of the address bar. `network=["S","O"]` limits results to
2nd and 3rd-degree connections.

### Scoring and filters

Every search result is scored against its card text:

| Signal | Points |
|---|---|
| Matches `RECRUITER` (recruiter track) or `MANAGER` (manager track) | required, +3 |
| Search's `boost` | +0 to +3 |
| Mentions your stack (`JAVA`) | +3 |
| Otherwise mentions software/IT (`SOFTWARE`) | +1 (a manager with neither is rejected) |
| Mentions Pune or remote (`LOCAL`) | +1 |
| Off-stack terms like QA, .NET, DevOps, or leadership/executive hiring (`SOFT_BAD`) | −2 |
| Agency or staffing wording (`AGENCY`) | −1 |
| Campus, fresher, SAP, non-tech HR, recruiters job-hunting themselves ("open to work", "immediate joiner")... (`HARD_BAD`) | rejected |

Anyone below `MIN_SCORE` (3) is dropped. On the profile itself, a "Hiring:" card
matching `BAD_ROLE` (junior, SDE-1, staff, architect, frontend, ...) is skipped.
To retarget the script to another stack, edit `STACK`, `JAVA`, `GOOD_ROLE` and
`BAD_ROLE`, then move your old stack's terms into `SOFT_BAD`.

When tuning, use `--dry`. Each sent line shows `[track score]`, and skip reasons
name the exact text that rejected each person.

### Volume and pacing

```js
const CAP = Math.min(MAX, 20);                           // hard ceiling
const ms = 25000 + Math.random() * 30000;                // delay after each send
const PAGES_PER_SEARCH = 2, PAGE_BUDGET = 12;            // search pages per run
```

The 20-invite ceiling and the 25–55 s delay are safety limits, not tuning knobs.
Leave them alone.

### Resetting state

`state.json` holds `done` (`profile-id → { res, at, src, track, score }`) and `pages`
(`search name → last page reached`). Delete an entry from `done` to let the script
reconsider that person. Delete an entry from `pages` to restart that search from
page 1. Delete the file to start completely over. Delete `profile/` to log out and
force a fresh login.


---

## Files

| Path | Committed | What it is |
|---|---|---|
| `outreach.mjs` | yes | The entire script. |
| `package.json` / `package-lock.json` | yes | Dependencies and setup scripts. |
| `.gitignore` | yes | Keeps the entries below out of git. |
| `profile/` | **no** | Chromium profile with your live LinkedIn session. Secret. |
| `state.json` | **no** | Your outreach log, containing other people's names. |
| `debug-*.png` / `debug-*.txt` | **no** | Failure artifacts. Safe to delete. |
| `node_modules/` | **no** | Reinstall with `npm install`. |

---

## Troubleshooting

**"LinkedIn is asking for a security check."** The script exits with code 2. Complete
the check by hand in a normal browser and wait a day before running again. Do not
retry immediately.

**"Weekly invitation limit reached."** Exits cleanly. LinkedIn caps invitations per
week. Wait for the window to roll over.

**The pool stays at 0 and `debug-search.png` appears.** The search page did not
render results — usually because the session expired, or because LinkedIn changed
their markup. Open the screenshot to see what the page actually showed.

**"skip: no connect/more button"** for everyone. LinkedIn's profile DOM changed. The
script writes `debug-<id>.txt` listing every button label it found on the page;
compare that against the patterns in `findEl` and adjust.

**"skip: Connect not offered (Follow only)."** That profile genuinely has no Connect
button — common for creator-mode or very large accounts. Nothing to fix.

**"skip: asks for email."** LinkedIn requires the person's email address to invite
them. Correctly skipped.

---

## Before you run this

Automated invitations violate LinkedIn's
[User Agreement](https://www.linkedin.com/legal/user-agreement), and LinkedIn does
act on it — consequences range from a temporary invite block to permanent account
loss. That risk is yours, and it is real.

If you run this anyway:

- Keep the volume low and the cadence slow. The defaults are already at the limit of
  what's defensible.
- Send notes you would be comfortable having sent by hand. Every invite lands on a
  real person who has to read it.
- Never target the same person twice. `state.json` is what prevents that — don't
  delete it casually.

Consider whether a smaller number of genuinely hand-written invites would serve you
better. Often it does.
