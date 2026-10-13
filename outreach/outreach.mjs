// LinkedIn recruiter outreach (Java/backend). Run on YOUR computer: `node outreach.mjs [--max 20] [--dry]`
// First run: a Chromium window opens, log in to LinkedIn yourself (session is kept in ./profile).
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const MAX = Number(args[args.indexOf('--max') + 1]) || 20;   // hard cap 20 per run
const DRY = args.includes('--dry');                          // go through everything, but don't click Send
const CAP = Math.min(MAX, 20);

// Invite notes, best first. The first one that fits the invite box's limit (300 chars with Premium, 200 without)
// is sent. `role` comes from their "Hiring:" card; `cyber` is true for people at cybersecurity companies (CYBER),
// whose general note names Rapid7 and its VM work. Every other note just says "a layoff".
const SKILLS = 'Java, Spring Boot, microservices & AWS';
const NOTES = {
  recruiter: (first, role, cyber) => [
    role && `Hi ${first}, I noticed you're hiring for ${role}. I'm Dinesh, a Senior Software Engineer (6+ yrs in ${SKILLS}), recently impacted by a layoff and able to join immediately (Pune/remote). Happy to share my resume if it's a fit.`,
    cyber
      ? `Hi ${first}, I'm Dinesh, a Senior Software Engineer with 6+ years in ${SKILLS}, most recently working on VM solutions at Rapid7 until I was impacted by its layoff. I can join immediately (Pune/remote) and am happy to share my resume for backend roles.`
      : `Hi ${first}, I'm Dinesh, a Senior Software Engineer with 6+ years in ${SKILLS}. I was recently impacted by a layoff and can join immediately (Pune/remote). If you're hiring for Senior Java/backend roles, I'd be glad to share my resume.`,
    // 200-character versions, for accounts without Premium.
    `Hi ${first}, I'm Dinesh, Senior SWE with 6+ yrs in Java, Spring Boot, microservices & AWS. Recently impacted by a layoff, available immediately for Senior Java/backend roles (Pune/remote).`,
    `Hi ${first}, I'm Dinesh, Senior SWE, 6+ yrs Java/Spring Boot/AWS. Recently impacted by a layoff and can join immediately. Open to Senior backend roles in Pune or remote. Thanks!`,
  ],
  manager: (first, role, cyber) => [
    role && `Hi ${first}, I saw your team is hiring for ${role}. I'm Dinesh, a Senior Software Engineer (6+ yrs in ${SKILLS}), recently impacted by a layoff and able to join immediately (Pune/remote). Would love to connect and learn more.`,
    cyber
      ? `Hi ${first}, I'm Dinesh, a Senior Software Engineer with 6+ years in ${SKILLS}, most recently working on VM solutions at Rapid7 until I was impacted by its layoff. I can join immediately (Pune/remote) and would love to connect and learn about your team.`
      : `Hi ${first}, I'm Dinesh, a Senior Software Engineer with 6+ years building backend systems in ${SKILLS}. I was recently impacted by a layoff and can join immediately (Pune/remote). Would love to connect and learn about your team.`,
    `Hi ${first}, I'm Dinesh, Senior SWE with 6+ yrs in Java, Spring Boot & AWS, recently impacted by a layoff. Saw your team is hiring; I can join immediately and would love to connect.`,
    `Hi ${first}, I'm Dinesh, Senior SWE, 6+ yrs Java/Spring Boot/AWS, recently impacted by a layoff. Can join immediately; would love to connect about backend roles on your team.`,
  ],
};

// Locations: Pune/Pimpri-Chinchwad and India-wide. Recruiters for Pune/remote roles often live elsewhere,
// so only the generic keyword searches are restricted to Pune.
const PUNE = '90009642', INDIA = '102713980';
// Target companies, searched first (in-house recruiters convert best). Values are LinkedIn company IDs: open the
// company page and copy the number from the "N employees" link (currentCompany=[...]). Empty = search skipped.
// Product and cybersecurity companies: highest priority.
const PRODUCT_COMPANIES = {
  Mastercard: '3015', PubMatic: '167624', Avalara: '22026', 'BMC Software': '1597', 'Red Hat': '3545',
  Amdocs: '1539', Atlassian: '22688', Workday: '17719', Zendesk: '418095', Snowflake: '3653845', Nutanix: '735085',
  Broadcom: '3072', Cisco: '1063', Oracle: '1028', Confluent: '88873', Elastic: '814025', Intuit: '1666',
  Adobe: '1480', Flipkart: '321062', PTC: '1935',
};
const CYBER_COMPANIES = {
  Qualys: '8561', CrowdStrike: '2497653', Securonix: '759889', Zscaler: '234625', 'Palo Alto Networks': '30086',
  Cohesity: '3750699', 'Arctic Wolf': '2760138', Tanium: '2109024', Netskope: '3338050', Proofpoint: '11681',
  Fortinet: '6460', 'Check Point': '3090',
};
// Bank and fintech tech centres.
const MORE_COMPANIES = {
  Barclays: '1426', 'Deutsche Bank': '1262', UBS: '1214', Citi: '11448', Fiserv: '3364', 'Western Union': '2019',
  HSBC: '1241', 'JPMorgan Chase': '1068', 'Morgan Stanley': '497017', 'Goldman Sachs': '1382', 'Northern Trust': '3831',
  'Allianz Technology': '3964931', 'Wells Fargo': '1235', 'Societe Generale': '1691', Nomura: '4440', PayPal: '1482',
  Visa: '2190', 'American Express': '1277',
};
const TOP = Object.values({ ...PRODUCT_COMPANIES, ...CYBER_COMPANIES }), MORE = Object.values(MORE_COMPANIES);
// Matched against the top of a profile (headline, current company) to pick the Rapid7 note.
const CYBER = new RegExp(`${Object.keys(CYBER_COMPANIES).join('|')}|cyber ?security|infosec`, 'i');
const enc = encodeURIComponent;
const people = ({ kw, geo, hiring, company }) => (p) =>
  'https://www.linkedin.com/search/results/people/?' + [
    kw && `keywords=${enc(kw)}`,
    geo && `geoUrn=${enc(`["${geo}"]`)}`,
    company?.length && `currentCompany=${enc(JSON.stringify(company))}`,
    hiring && `activelyHiringForJobTitles=${enc('["-100"]')}`,
    `network=${enc('["S","O"]')}`,
    `page=${p}`,
  ].filter(Boolean).join('&');
// Boolean keywords. Keep each query to ~10 terms: longer ones silently return "No results found" (tested Oct 2026).
// The job-title filter would be cleaner, but it is Premium-only and LinkedIn drops it from the URL otherwise.
const REC = '(recruiter OR "talent acquisition")', MGR = '("engineering manager" OR "tech lead")';
const STACK = '(java OR backend OR "spring boot")';
// Ordered by quality. Each run continues every search from the page it reached last time (state.pages).
// `boost` is added to the score of everyone a search finds.
const SEARCHES = [
  TOP.length  && { name: 'top-recruiters',  track: 'recruiter', boost: 3, url: people({ kw: REC, company: TOP, geo: INDIA }) },
  TOP.length  && { name: 'top-managers',    track: 'manager',   boost: 3, url: people({ kw: `${MGR} (java OR backend)`, company: TOP, geo: INDIA, hiring: true }) },
  MORE.length && { name: 'more-recruiters', track: 'recruiter', boost: 2, url: people({ kw: REC, company: MORE, geo: INDIA }) },
  { name: 'pune-hiring',   track: 'recruiter', boost: 1, url: people({ kw: `${REC} ${STACK} NOT (campus OR fresher)`, geo: PUNE, hiring: true }) },
  { name: 'pune-managers', track: 'manager',   boost: 1, url: people({ kw: `${MGR} (java OR backend)`, geo: PUNE, hiring: true }) },
  { name: 'pune',          track: 'recruiter', boost: 0, url: people({ kw: `${REC} ${STACK} NOT (campus OR fresher)`, geo: PUNE }) },
  { name: 'india-hiring',  track: 'recruiter', boost: 0, url: people({ kw: `${REC} ${STACK} NOT (campus OR fresher)`, geo: INDIA, hiring: true }) },
  { name: 'india-remote',  track: 'recruiter', boost: 0, url: people({ kw: `remote ${REC} (java OR backend)`, geo: INDIA }) },
].filter(Boolean);
const PAGES_PER_SEARCH = 2, PAGE_BUDGET = 12;  // search pages loaded per run, across all searches
const MIN_SCORE = 3;

// Scoring, matched against the search-result card text.
const RECRUITER = /recruit|talent acquisition|\bTA\b|sourcer|sourcing|headhunt/i;
const MANAGER = /engineering manager|\bEM\b|tech(nical)? lead|team lead|head of engineering|director of engineering|\bVP\b.*engineering|\bCTO\b/i;
const JAVA = /java|backend|back-end|spring|microservice|j2ee/i;
const SOFTWARE = /software|\bIT\b|tech(nical|nology)? (recruit|talent|hiring)|tech hiring|\bSDE\b|full.?stack|developer|cloud|platform|distributed|saas/i;
const LOCAL = /pune|pimpri|remote/i;
// Wrong domain, non-tech HR, and recruiters who are job-hunting themselves.
const HARD_BAD = /servicenow|salesforce|\bsap\b|campus|fresher|intern\b|graduate hiring|entry.?level|hrbp|payroll|open to (hr|work|relocation|opportunit)|immediate joiner|actively (looking|seeking)|non-?tech|bpo|investment banking|mainframe|freelance recruiter/i;
const SOFT_BAD = /\bqa\b|testing|leadership hiring|executive (search|hiring)|c-?suite|network (engineer|admin|security)|sysadmin|automotive|embedded|electrical|manufacturing|\.net\b|data engineer|devops/i;
const AGENCY = /staffing|placement|manpower|\bRPO\b|recruitment (agency|firm|services|solutions)|search firm|hr services/i;
function score(card, s) {
  // Drop "Connect/Follow  Jane X, John Y - Immediate Joiner & 7 other mutual connections": other people's headlines.
  const text = card.replace(/\b(Connect|Follow|Message|Pending)\b.*?mutual connections?/, ' ');
  if (HARD_BAD.test(text) || !(s.track === 'manager' ? MANAGER : RECRUITER).test(text)) return -1;
  const java = JAVA.test(text), software = SOFTWARE.test(text);
  if (s.track === 'manager' && !java && !software) return -1;   // "Engineering Manager" at a non-software company
  return 3 + s.boost + (java ? 3 : software ? 1 : 0) + (LOCAL.test(text) ? 1 : 0) - (SOFT_BAD.test(text) ? 2 : 0) - (AGENCY.test(text) ? 1 : 0);
}
// Checked against the "Hiring:" card on the profile itself.
const GOOD_ROLE = /senior|\bsr\b|sde\s*-?\s*(2|3|II|III)\b|\blead\b|backend|back-end|java|spring/i;
const BAD_ROLE = /junior|associate (software|engineer|developer)|sde\s*-?\s*(1|I)\b|fresher|intern|principal|staff|architect|\bmanager\b|director|account executive|react|angular|frontend|front-end|\.net|salesforce|servicenow|\bsap\b|teamcenter|\bqa\b|tester/i;

const STATE = 'state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { done: {} };
state.pages ??= {};
const save = () => { if (!DRY) fs.writeFileSync(STATE, JSON.stringify(state, null, 2)); }; // dry runs never write the log
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (t) => (tty ? `\x1b[${code}m${t}\x1b[0m` : String(t));
const [dim, bold, red, green, yellow, blue, cyan, magenta] = [2, 1, 31, 32, 33, 34, 36, 35].map(c);
const clock = () => dim(new Date().toLocaleTimeString([], { hour12: false }));
const log = (...a) => console.log(clock(), ...a);
const bar = (n, total, w = 20) => { const f = Math.round((n / total) * w); return cyan('█'.repeat(f)) + dim('░'.repeat(w - f)); };
const box = (lines) => { const w = Math.max(...lines.map((l) => l.replace(/\x1b\[\d+m/g, '').length)) + 4; const line = '─'.repeat(w); console.log(cyan('╭' + line + '╮')); for (const l of lines) console.log(cyan('│') + '  ' + l + ' '.repeat(w - 2 - l.replace(/\x1b\[\d+m/g, '').length) + cyan('│')); console.log(cyan('╰' + line + '╯')); };
const stats = { sent: 0, skipped: 0, errors: 0 };
box([bold('LinkedIn recruiter outreach'), dim(`Java backend · target ${CAP} invites · ${DRY ? yellow('DRY RUN (nothing is sent)') : green('LIVE')}`)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => sleep(a + Math.random() * (b - a));

const ctx = await chromium.launchPersistentContext('./profile', { headless: false, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());

async function guard() {
  const u = page.url();
  const txt = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
  if (/checkpoint|authwall|challenge|captcha/i.test(u) || /verify you're a human|security verification|unusual activity|restricted your account/i.test(txt)) {
    log(red('✖ LinkedIn is asking for a security check. Stopping. Complete it by hand and wait a day before running again.'));
    await ctx.close(); process.exit(2);
  }
  if (/reached the weekly invitation limit|weekly invitation limit/i.test(txt)) {
    log(yellow('⚠ Weekly invitation limit reached. Stopping.')); await ctx.close(); process.exit(0);
  }
}

// ---- login ----
await page.goto('https://www.linkedin.com/feed/');
if (/login|signup|authwall/.test(page.url())) {
  log(yellow('🔐 Please log in to LinkedIn in the opened window (waiting up to 5 min)...'));
  await page.waitForURL(/linkedin\.com\/feed/, { timeout: 300000 });
}

// ---- discovery ----
const found = new Map();   // id -> { score, src, track }
const POOL = CAP * 2;
let pagesLoaded = 0;
for (const s of SEARCHES) {
  for (let i = 0; i < PAGES_PER_SEARCH && pagesLoaded < PAGE_BUDGET && found.size < POOL; i++) {
    const p = (state.pages[s.name] || 0) + 1;
    pagesLoaded++;
    await page.goto(s.url(p), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /•\s*(1st|2nd|3rd)/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    await page.mouse.wheel(0, 1500); await jitter(1500, 2500);
    await guard();
    const rows = await page.evaluate(() => {
      const seen = new Set(), out = [];
      document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
        const own = a.innerText.replace(/\s+/g, ' ');
        const m = own.match(/•\s*(1st|2nd|3rd)/);
        if (!m || m[1] === '1st') return;                       // name link carries the degree badge
        const id = a.href.split('/in/')[1]?.split(/[/?]/)[0]; if (!id || seen.has(id)) return; seen.add(id);
        let el = a, text = own;                                  // climb until the card has headline text,
        for (let i = 0; i < 6 && el.parentElement && text.length < 150; i++) {   // but never into the list of cards
          const up = el.parentElement.innerText.replace(/\s+/g, ' ');
          if ((up.match(/•\s*(1st|2nd|3rd)/g) || []).length > 1) break;
          el = el.parentElement; text = up;
        }
        out.push({ id, text: text.slice(0, 300) });
      });
      return out;
    });
    if (!rows.length) { await page.screenshot({ path: 'debug-search.png' }); }
    let kept = 0;
    for (const r of rows) {
      if (state.done[r.id] || found.has(r.id)) continue;
      const sc = score(r.text, s);
      if (sc < MIN_SCORE) continue;
      found.set(r.id, { score: sc, src: s.name, track: s.track }); kept++;
    }
    state.pages[s.name] = rows.length ? p : 0;   // no results = past the end; start this search over next run
    save();
    log(`${blue('🔎 ' + s.name)} ${dim('·')} page ${p} ${dim('·')} ${rows.length} people, kept ${kept} ${dim('→')} pool ${bold(found.size)}`);
    if (!rows.length) break;
  }
}

// ---- sending ----
const document_title_name = (t) => t.replace(/^\(\d+\)\s*/, '').split('|')[0].trim();
async function sendTo(id, { track }) {
  await page.goto(`https://www.linkedin.com/in/${id}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /\|\s*LinkedIn/.test(document.title) && document.body.innerText.length > 800, null, { timeout: 25000 });
  await jitter(2000, 3000); await guard();
  const fullName = document_title_name(await page.title());
  const first = fullName.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '');
  const body = await page.locator('body').innerText();
  const head = body.slice(0, 1500);
  const hiring = (body.match(/^Hiring:[^\n]{0,100}/m) || [''])[0];   // the "Hiring:" card, not "Hiring ..." in a headline
  const vis = (loc) => loc.and(page.locator('visible=true')).first();
  if (await vis(page.getByRole('button', { name: /^Pending/i })).count()) return 'skip: already pending';
  if (/·\s*1st/.test(head)) return 'skip: already connected';
  if (hiring && BAD_ROLE.test(hiring)) return `skip: hiring card "${hiring.slice(0, 50)}"`;
  // A matching "Hiring: Senior Backend Engineer" card lets the note name the role.
  const role = hiring.replace(/^Hiring[:\s]*/i, '').replace(/\s+and \d+ more.*$/i, '').split(/[,·|]/)[0].trim();
  const named = GOOD_ROLE.test(role) && role.length <= 45 ? role : '';
  const cyber = CYBER.test(head);
  const notes = NOTES[track](first, named, cyber).filter(Boolean);

  // Find clickable elements by label + position (top-left profile card, not the right sidebar).
  const findEl = async (reSrc, top = true) => {
    const h = await page.evaluateHandle(({ reSrc, top }) => {
      const re = new RegExp(reSrc, 'i');
      const els = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], li, div[tabindex]')];
      for (const el of els) {
        const label = (el.getAttribute('aria-label') || el.innerText || '').trim().split('\n')[0];
        if (!re.test(label)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 15 || getComputedStyle(el).visibility === 'hidden') continue;
        if (top && !(r.y > 80 && r.y < 800 && r.x < innerWidth * 0.68)) continue;
        return el;
      }
      return null;
    }, { reSrc, top });
    return h.asElement();
  };
  let connect = await findEl('^(Invite .* to connect|Connect)$');
  if (!connect) {
    const more = await findEl('^More( actions)?$');
    if (!more) {
      const labels = await page.evaluate(() => [...document.querySelectorAll('button,a')].map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().split('\n')[0]).filter(Boolean).slice(0, 40));
      fs.writeFileSync(`debug-${id}.txt`, labels.join('\n')); await page.screenshot({ path: `debug-${id}.png` });
      return 'skip: no connect/more button (see debug-' + id + '.txt/.png)';
    }
    await more.click(); await sleep(800);
    connect = await findEl('^Connect$', false);
    if (!connect) { await page.keyboard.press('Escape'); return 'skip: Connect not offered (Follow only)'; }
  }
  let step = 'open Connect', tag = '';
  try {
    await connect.click();
    step = 'wait for invite dialog';
    const dlg = page.locator('[role="dialog"], [role="alertdialog"], .artdeco-modal').filter({ hasText: /invitation|connect|add a note/i }).first();
    await dlg.waitFor({ state: 'visible', timeout: 10000 });
    if (await dlg.locator('input[type="email"], input[name="email"]').count()) {
      await page.keyboard.press('Escape'); return 'skip: asks for email';
    }
    const box = dlg.locator('textarea').first();
    if (!(await box.isVisible().catch(() => false))) {
      step = 'click Add a note';
      await dlg.getByRole('button', { name: /add a note/i }).click({ timeout: 8000 });
    }
    step = 'type note';
    await box.waitFor({ state: 'visible', timeout: 8000 });
    const limit = Number(await box.getAttribute('maxlength')) || 200;   // 300 with Premium; assume 200 if unknown
    const note = notes.find((n) => n.length <= limit);
    if (!note) { await page.keyboard.press('Escape'); return `skip: no note fits ${limit} chars`; }
    tag = ` [${note.length}/${limit}${cyber ? ' cyber' : ''}]`;
    await box.click(); await box.fill(note);
    if (DRY) {
      await page.keyboard.press('Escape'); await sleep(700);
      const discard = page.getByRole('button', { name: /^discard$/i });
      if (await discard.count()) await discard.first().click().catch(() => {});
      return `DRY ok (${first})${tag}` + (named ? ` | ${named}` : '');
    }
    step = 'click Send';
    const send = dlg.getByRole('button', { name: /^send( invitation)?$/i }).first();
    await send.click({ timeout: 8000 });
    step = 'confirm dialog closed';
    await dlg.waitFor({ state: 'hidden', timeout: 10000 });
    await sleep(1200); await guard();
  } catch (e) {
    await page.screenshot({ path: `debug-${id}-${step.replace(/\W+/g, '_')}.png` }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`failed at "${step}": ${e.message.split('\n')[0]}`);
  }
  return `SENT (${first})${tag}` + (hiring ? ` | ${hiring.slice(0, 50)}` : '');
}

const ranked = [...found].sort((a, b) => b[1].score - a[1].score);   // best candidates get the invites
console.log('\n' + bold(`Processing ${ranked.length} candidates (best score first), sending up to ${CAP}\n`));
for (const [id, info] of ranked) {
  if (stats.sent >= CAP) break;
  let res;
  try { res = await sendTo(id, info); } catch (e) { res = 'error: ' + e.message.split('\n')[0]; await page.keyboard.press('Escape').catch(() => {}); }
  const name = ((res.match(/\((.*?)\)/) || [])[1] || id) + ' ' + dim(`[${info.track} ${info.score}]`);
  const prog = `${bar(stats.sent + (res.startsWith('SENT') || res.startsWith('DRY') ? 1 : 0), CAP)} ${String(stats.sent + (res.startsWith('SENT') ? 1 : 0)).padStart(2)}/${CAP}`;
  if (res.startsWith('SENT')) { stats.sent++; log(`${prog}  ${green('✔ SENT   ')} ${bold(name)} ${dim(id)}${res.includes('|') ? dim('  ' + res.split('|')[1].trim()) : ''}`); }
  else if (res.startsWith('DRY')) { stats.sent++; log(`${prog}  ${green('✔ DRY OK ')} ${bold(name)} ${dim(id)}`); }
  else if (res.startsWith('skip')) { stats.skipped++; log(`${prog}  ${yellow('➜ skip    ')} ${id} ${dim(res.replace(/^skip:\s*/, ''))}`); }
  else { stats.errors++; log(`${prog}  ${red('✖ error   ')} ${id} ${red(res.replace(/^error:\s*/, ''))}`); }
  if (!res.startsWith('error')) { state.done[id] = { res, at: new Date().toISOString(), ...info }; save(); } // errors are retried next run
  if (res.startsWith('SENT')) { const ms = 25000 + Math.random() * 30000; log(dim(`   ⏳ waiting ${Math.round(ms / 1000)}s before the next one`)); await sleep(ms); } else await jitter(3000, 6000);
}
const sent = stats.sent;

// ---- verify ----
if (!DRY && sent) {
  await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const list = await page.locator('main').innerText();
  const missing = Object.entries(state.done).filter(([id, v]) => v.res.startsWith('SENT') && !list.includes(v.res.match(/\((.*?)\)/)?.[1] || '@@'));
  log(missing.length ? yellow(`⚠ Not visible on the sent page yet (accepted, or list needs scrolling): ${missing.map(([id]) => id).join(', ')}`) : green('✔ All sent invites confirmed on the sent-invitations page'));
}
console.log();
box([bold('Summary'), `${green(DRY ? 'Dry-run OK' : 'Sent')}     ${bold(stats.sent)} / ${CAP}`, `${yellow('Skipped')}     ${stats.skipped}`, `${red('Errors')}      ${stats.errors}${stats.errors ? dim('  (retried next run, see debug-*.png)') : ''}`, dim('Log: state.json')]);
await ctx.close();
