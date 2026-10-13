# India Java Jobs Monitor

A free, serverless job alert for **Java backend / Senior Software Engineer roles in India**,
tuned for **~6 years of experience** (SDE II → Senior → Lead).

Every two hours it checks LinkedIn, Naukri, Indeed India and the careers sites of ~90
companies hiring Java engineers in India. Every **new** matching posting is sent to your
**Discord** channel with a direct apply link, and a **web dashboard** lets you track what
you have applied to.

There is no server and no cost: it runs entirely on GitHub Actions and GitHub Pages.

```
 GitHub Actions (every hour, alternating)
        │
        ▼
 Fetch postings ─── LinkedIn · Naukri · Indeed India           (job boards)
        │       ─── Amazon · Google · Nvidia · Adobe · Cisco …  (big tech)
        │       ─── Citi · Barclays · Mastercard · Wells Fargo … (bank GCCs)
        │       ─── Okta · MongoDB · Databricks · Paytm · Meesho … (product cos)
        ▼
 Filter: India location · Java/backend/SWE title · SDE II → Lead · 2–10 yrs asked
        ▼
 Compare with docs/data/jobs.json  ──►  only NEW jobs  ──►  Discord alert
        ▼
 Commit jobs.json back to the repo  ──►  Dashboard (GitHub Pages) updates
```

---

## Referral pipeline (this fork)

This repo is a fork of the job monitor that adds **resume matching** and, in
[`outreach/`](outreach/), the **LinkedIn referral outreach** that acts on it. The original
monitor keeps running unchanged in its own repo; this one scans every 4 hours, offset
from it, and has no Discord unless you add a webhook.

On each scan, every new in-scope posting gets its full description fetched
([`monitor/describe.py`](monitor/describe.py)) and is scored against your resume by Gemini
([`monitor/match.py`](monitor/match.py)). The score, reasons, gaps, a one-line pitch and
shared keywords land in `jobs.json` as a `match` block, and the dashboard can filter and
sort by them.

**`jobs.json` is public.** The prompt keeps match output fit to publish (gaps describe the
posting, never you), and the resume itself stays in a secret.

| Secret / variable | What |
|---|---|
| `GEMINI_API_KEY` (secret) | Google AI Studio key |
| `RESUME_TEXT` (secret) | Your resume as plain text |
| `GEMINI_MODEL` (variable, optional) | Pin a model; default `gemini-3.1-flash-lite` |

Without the key or resume, scans run as before with no scores. Naukri posting bodies sit
behind a CAPTCHA, so those are scored from the title alone, capped at 60 and marked `*`.

Run it locally, or score postings found before matching existed:

```bash
# resume at private/resume.txt (gitignored), key in the environment
python -m monitor.match --dry-run --limit 3          # try it, save nothing
python -m monitor.match --since 2026-10-10 --limit 30
```

---

## Contents

1. [What gets matched](#1-what-gets-matched)
2. [Setup (≈15 minutes)](#2-setup-15-minutes)
   - [Step 1 – Get the code into your GitHub](#step-1--get-the-code-into-your-github)
   - [Step 2 – Create a Discord webhook](#step-2--create-a-discord-webhook)
   - [Step 3 – Add the webhook as a GitHub secret](#step-3--add-the-webhook-as-a-github-secret)
   - [Step 4 – Turn on the GitHub workflows](#step-4--turn-on-the-github-workflows)
   - [Step 5 – Run the first (seed) scan](#step-5--run-the-first-seed-scan)
   - [Step 6 – Turn on the dashboard](#step-6--turn-on-the-dashboard-github-pages)
   - [Step 7 – (Optional) Save your "Applied" marks](#step-7--optional-save-your-applied-marks)
3. [Daily use](#3-daily-use)
4. [Customising](#4-customising)
5. [Running it on your own computer](#5-running-it-on-your-own-computer)
6. [The GitHub workflows explained](#6-the-github-workflows-explained)
7. [Troubleshooting](#7-troubleshooting)
8. [Project layout](#8-project-layout)

---

## 1. What gets matched

| Rule | Kept | Dropped |
|---|---|---|
| **Location** | Any Indian city (Bengaluru, Hyderabad, Pune, Chennai, Gurugram, Noida, Mumbai…), "India", "Remote – India" | Everything outside India, and unlabelled "Remote" on global boards |
| **Role** | Java / Spring / J2EE, Backend, Software Engineer / Developer, SDE, Full-stack (if Java), Platform, Distributed Systems | Frontend, mobile, QA/SDET, DevOps/SRE, data/ML, security, embedded; titles naming another stack (Go, Python, .NET, Node…) unless Java is also named |
| **Level** | SDE II / mid, Senior / SDE III, Lead / Tech Lead | Intern, fresher, SDE I, Associate; Principal, Architect, Manager, Director. Staff is off by default |
| **Experience** | Posting asks for 2–10 years, or doesn't say | Asks for 0–1 years, or 11+ years |

Each match is put in one of three **tiers** (shown in Discord and the dashboard):

| Tier | Examples |
|---|---|
| 🛠 **SDE II / Mid** | SDE II, Software Engineer II, Java Developer, Software Engineer |
| 🚀 **Senior / SDE III** | Senior Software Engineer, Sr. Java Developer, SDE III, SMTS |
| 🧭 **Lead / Staff** | Lead Software Engineer, Java Tech Lead, Staff (only with `--include-staff`) |

All of these rules live in one file, [`monitor/filters.py`](monitor/filters.py), as plain
regular expressions — see [Customising](#4-customising) to change them.

---

## 2. Setup (≈15 minutes)

**You need:** a GitHub account and a Discord account. Nothing to install for the basic setup.

### Step 1 – Get the code into your GitHub

**Option A – you already have this repo on GitHub:** skip to Step 2.

**Option B – push it from your computer:**

1. Create an **empty** repository at <https://github.com/new> (name it e.g. `job-monitor`).
   Don't tick "Add a README". **Public** is easiest — GitHub Pages is free for public repos.
2. In a terminal inside this folder:

   ```bash
   git remote add origin https://github.com/<YOUR-USERNAME>/job-monitor.git
   git branch -M main
   git push -u origin main
   ```

> **Public vs private:** in a public repo anyone can see the job list (not your Discord
> webhook or tokens — those are secrets). Private works too, but GitHub Pages on a private
> repo needs a paid plan; you can still open `docs/index.html` locally instead.

### Step 2 – Create a Discord webhook

A webhook is a URL that lets the scanner post messages into one Discord channel.

1. In Discord, create a server if you don't have one (**+** in the left bar → *Create My Own*).
2. Create a channel for alerts, e.g. `#java-jobs`.
3. Hover the channel → ⚙ **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**.
4. Give it a name (e.g. *Job Monitor*), then click **Copy Webhook URL**.
   It looks like `https://discord.com/api/webhooks/1234567890/AbCdEf...`

> ⚠️ Treat this URL like a password — anyone who has it can post to your channel.
> Never commit it to the repo; it goes into GitHub Secrets (next step).

**Tip:** on your phone, enable notifications for this channel in the Discord app
(long-press channel → *Notification Settings* → *All Messages*) so you hear about jobs instantly.

### Step 3 – Add the webhook as a GitHub secret

1. On GitHub open your repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. **Name:** `DISCORD_WEBHOOK_URL` (exactly this, case-sensitive)
   **Secret:** paste the webhook URL. Click **Add secret**.

Optional second secret — only if LinkedIn stops returning results (see
[Troubleshooting](#7-troubleshooting)):

| Name | Value |
|---|---|
| `JOBSPY_PROXIES` | Comma-separated proxy URLs, e.g. `http://user:pass@host:port,http://...` |

### Step 4 – Turn on the GitHub workflows

1. Open the repo's **Actions** tab.
2. If you see *"Workflows aren't being run on this repository"*, click
   **I understand my workflows, go ahead and enable them**.
3. Repo → **Settings** → **Actions** → **General** → *Workflow permissions* →
   select **Read and write permissions** → **Save**.
   (The scan needs this to commit `jobs.json` back to the repo.)

That's it — the schedules in `.github/workflows/` now run automatically.

### Step 5 – Run the first (seed) scan

1. **Actions** tab → **Full sweep (every 2h)** in the left sidebar → **Run workflow** → **Run workflow**.
2. Wait for it to finish (roughly 10–20 minutes) and open the run to read the log. You'll see
   one line per source, then a summary:

   ```
     ✓ Citi: 283 raw postings over 3 searches
     ✓ LinkedIn (JobSpy): 640 raw postings over 9 searches
     ! SomeCompany: FAILED - 404 ...
   4100 raw -> 850 in scope -> 850 new (seed run: notifications suppressed)
   ```

**The first run is a seed run:** it saves everything currently open **without** sending
Discord messages (otherwise you'd get hundreds at once). From the second run onwards,
**only new postings** are sent.

A few sources failing is normal — careers sites change. The run carries on without them, and
Discord gets a ⚠️ alert if a source that used to work stops returning anything.

### Step 6 – Turn on the dashboard (GitHub Pages)

1. Repo → **Settings** → **Pages**.
2. *Build and deployment*: Source = **Deploy from a branch**, Branch = **main**, Folder = **/docs** → **Save**.
3. After a minute or two the dashboard is live at
   `https://<YOUR-USERNAME>.github.io/<REPO-NAME>/`

The dashboard shows every job found so far with filters for tier, role, company, experience
asked, and source (job boards vs company sites). It refreshes itself while open.

### Step 7 – (Optional) Save your "Applied" marks

Clicking **✓ Applied / ✗ Skip / ★ Interview** on the dashboard is remembered by your browser
straight away. To also save those marks **into the repo** (so they follow you to other
devices), give the dashboard a GitHub token:

1. GitHub → avatar → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. *Repository access*: **Only select repositories** → pick this repo.
3. *Permissions* → *Repository permissions* → **Contents: Read and write**. Nothing else.
4. Generate and copy the `github_pat_...` value.
5. On the dashboard click **⚙ GitHub token**, fill in Owner (your username), Repo, Branch
   (`main`) and the token → **Save**.

The token is stored only in your browser's localStorage and is only ever sent to `api.github.com`.

---

## 3. Daily use

- New postings arrive in Discord: company, title, tier, location, salary (when posted),
  experience asked, and an **apply link** (the title is clickable).
- Open the dashboard, apply on the company's site, click **✓ Applied**. Click again to undo.
- **✗ Skip** hides roles you're not interested in; **★ Interview** tracks progress.
- Identical openings (same company + title + city, posted as many separate requisitions)
  are folded into one row with an **N openings** badge — click it to see them all.
- The **Location** filter groups postings by city (Bengaluru, Pune, Delhi NCR…); a posting naming several cities appears under each.
- The **Experience** filter (`≤ 6 yrs asked` etc.) uses the years the posting states,
  when it states them.

---

## 4. Customising

Everything is plain text — edit, commit, push. The next scheduled run picks it up.

### Add or remove a company — `config/companies.yaml`

Find the company's careers page and look at the URL (or your browser's *Network* tab):

| You see… | Add this |
|---|---|
| `boards.greenhouse.io/acme` or `job-boards.greenhouse.io/acme` | `fetcher: greenhouse` + `token: acme` |
| `jobs.lever.co/acme` | `fetcher: lever` + `token: acme` |
| `jobs.ashbyhq.com/acme` | `fetcher: ashby` + `token: acme` |
| `jobs.smartrecruiters.com/Acme` | `fetcher: smartrecruiters` + `token: Acme` |
| `acme.wd5.myworkdayjobs.com/AcmeCareers` | `fetcher: workday` + `host`, `tenant`, `site` (below) |

```yaml
other:
  - name: Acme
    fetcher: greenhouse
    token: acme

  - name: Acme Bank
    fetcher: workday
    host: acmebank.wd5.myworkdayjobs.com   # from the URL
    tenant: acmebank                       # the part before .wd5
    site: AcmeCareers                      # the part after the host
    searches: *search_terms                # java / software engineer / backend
```

Workday boards are **automatically restricted to India** (the fetcher looks up the board's
own "India" location filter). Then check it works before pushing:

```bash
python -m monitor.main --tier all --dry-run
```

Companies in the `bigtech:` section are scanned every hour; `other:` and `aggregators:`
every two hours.

### Change the job-board searches

The `aggregators:` section at the bottom of `companies.yaml` holds the LinkedIn / Naukri /
Indeed search terms (`senior java developer`, `java spring boot microservices`, …).
Add or remove phrases; each phrase is one search per board per run.

### Change the experience band, levels or tech stack — `monitor/filters.py`

| Want to… | Change |
|---|---|
| Accept roles asking up to 12 years | `YOE_MAX = 12` |
| Drop roles asking for less than 4 years | `YOE_MIN = 4` |
| Include Staff engineer roles | Add `--include-staff` to the `python -m monitor.main` lines in the workflows |
| Allow Kotlin/Go/Python titles too | Remove the language from `OTHER_STACK` |
| Allow DevOps / SRE titles | Remove `devops\|site reliability\|\bsre\b` from `ROLE_EXCLUDE` |
| Add a city | Add it to `INDIA_HINT` |

Run `python -m pytest tests -q` after editing to make sure nothing else broke.

### Change how often it runs

Edit the `cron:` lines in `.github/workflows/scan-all.yml` and `scan-bigtech.yml`.
Times are **UTC** (IST = UTC + 5:30). <https://crontab.guru> helps.

---

## 5. Running it on your own computer

Needs Python 3.10+.

```bash
pip install -r requirements.txt -r requirements-dev.txt

# see what would be found, without saving or notifying
python -m monitor.main --tier all --dry-run

# scan only the big-tech section
python -m monitor.main --tier bigtech --dry-run

# real run that also posts to Discord
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."     # PowerShell: $env:DISCORD_WEBHOOK_URL="..."
python -m monitor.main --tier all

# tests
python -m pytest tests -q
```

| Flag | Meaning |
|---|---|
| `--tier bigtech\|other\|all` | Which section of `companies.yaml` to scan |
| `--dry-run` | Print results; save nothing, send nothing |
| `--no-notify` | Save new jobs but don't message Discord (useful after widening filters) |
| `--include-staff` | Also accept Staff-level titles |

To view the dashboard locally: `python -m http.server -d docs 8000` and open <http://localhost:8000>.

---

## 6. The GitHub workflows explained

All in `.github/workflows/`. You can run any of them by hand from the **Actions** tab → pick
the workflow → **Run workflow**.

| Workflow | When (IST) | What it does |
|---|---|---|
| **Full sweep (every 2h)** — `scan-all.yml` | 6:00, 8:00, 10:00 … (every 2h) | Scans every company + LinkedIn/Naukri/Indeed, alerts new jobs, commits `jobs.json`. Has a *no_notify* checkbox for silent catch-up runs |
| **Scan big tech** — `scan-bigtech.yml` | 7:00, 9:00, 11:00 … (every 2h) | Scans only `bigtech:` companies, so those get hourly coverage |
| **LinkedIn reachability** — `linkedin-smoke.yml` | Manual only | Checks whether LinkedIn is answering GitHub's servers right now |
| **Tests** — `tests.yml` | On every push | Runs the test suite |

**How a scan workflow works** (`scan-all.yml`, simplified):

```yaml
on:
  schedule:
    - cron: "30 */2 * * *"        # every 2 hours at :30 UTC
  workflow_dispatch:               # adds the "Run workflow" button

permissions:
  contents: write                  # allows committing jobs.json

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt
      - run: python -m monitor.main --tier all
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}   # from Step 3
      - run: git commit docs/data/jobs.json && git push              # save state
```

The real file also retries the push and merges `jobs.json` safely if the dashboard saved a
status at the same moment.

> **Note:** GitHub pauses scheduled workflows in a repo with no activity for 60 days.
> The scans commit regularly so this normally never triggers, but if it does, just
> re-enable them from the Actions tab.

GitHub Actions is free for public repos. For private repos the free plan includes
2,000 minutes/month. A full sweep takes about 10 minutes (most of it is LinkedIn's
rate-limit pacing) and a big-tech scan about 2, so the default schedule uses about
4,500 minutes a month. On a private repo, run the full sweep every 4–6 hours instead.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| No Discord messages at all | Was it the first run? That's the silent seed run. Otherwise check the secret is named exactly `DISCORD_WEBHOOK_URL`, and look for `DISCORD_WEBHOOK_URL not set` in the run log |
| Run fails at "Commit state" with a permission error | Settings → Actions → General → Workflow permissions → **Read and write** |
| `! Company: FAILED - 404` in the log | That company changed its careers system. Find its new board (see [Customising](#4-customising)) or delete the entry |
| `LinkedIn (JobSpy): 0 raw postings` | LinkedIn is throttling GitHub's IP addresses. Run **LinkedIn reachability** to confirm; if it fails, add a `JOBSPY_PROXIES` secret. Naukri and Indeed keep working meanwhile |
| Too many alerts | Remove high-volume sources (e.g. Accenture), narrow `searches:`, or raise `YOE_MIN` |
| A role you wanted was filtered out | Test its title: `python -c "from monitor import filters as F; print(F.classify('Your Title Here'))"` — `None` means rejected. Adjust the regexes in `filters.py` |
| Dashboard says *Could not load data/jobs.json* | Run a scan first, and check Pages is serving the `/docs` folder |
| Old/stale jobs piling up | `python -m monitor.prune --dry-run` lists postings no longer in scope; drop `--dry-run` to remove them |

---

## 8. Project layout

```
config/companies.yaml        ← the companies & job-board searches (edit this most)
monitor/
  main.py                    ← entry point: fetch → filter → dedupe → save → notify
  filters.py                 ← India / Java / seniority / experience rules
  profiles.py                ← tracker settings (config file, data file, tiers, webhook)
  state.py                   ← reads/writes docs/data/jobs.json; never overwrites your marks
  notify.py                  ← Discord messages
  merge.py                   ← safely merges jobs.json when two writers race
  prune.py                   ← removes stored postings that no longer match
  names.py                   ← company-name normalising for de-duplication
  fetchers/
    generic.py               ← Greenhouse, Lever, Ashby, Workday, Eightfold, SmartRecruiters
    custom.py                ← Amazon, Google, Microsoft, Walmart, Phenom
    jobspy_board.py          ← LinkedIn, Naukri, Indeed (via python-jobspy)
docs/                        ← the dashboard (served by GitHub Pages)
  index.html · app.js · app.css
  data/jobs.json             ← the database: every job seen + your Applied/Skip status
tests/                       ← pytest suite
.github/workflows/           ← the schedules (see §6)
```

How duplicates are avoided: every posting gets a stable ID (company + hash of its job
ID/URL). A job already in `jobs.json` is never alerted again, and the same job found on both
LinkedIn and the company's own site is merged into one entry.
