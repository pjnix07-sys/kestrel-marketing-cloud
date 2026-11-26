#!/usr/bin/env node
/* End-to-end suite for the static Marketing Cloud app (Playwright + Chromium).
   Usage:  NODE_PATH=$(npm root -g) node tools/e2e.js [--port 8870] [--out /tmp/claude-0/e2e-out] [--date 2026-11-26] [--only boot,home,...]
   - Starts its own static server on --port serving the repo root.
   - Fails if any request leaves localhost, except api.anthropic.com which is stubbed with page routes.
   - One line per check: PASS|FAIL|WARN <name> — <detail>; a summary line; exit 1 on any FAIL.
   - Screenshots only for failures, written to --out.
   - --date pins the browser clock (YYYY-MM-DD at 10:00 local); default pins to the moment the suite started so
     every context sees the same date.
   WARN = a feature's UI was not found, so the check was skipped (not a failure). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { console.error('Cannot load playwright. Run with NODE_PATH=$(npm root -g).'); process.exit(2); }

/* ------------------------------ args ------------------------------ */
const argv = process.argv.slice(2);
function arg(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; }
const PORT = +arg('port', 8870);
const OUT = arg('out', '/tmp/claude-0/e2e-out');
const DATE_ARG = arg('date', '');
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const ROOT = path.join(__dirname, '..');
const BASE = 'http://localhost:' + PORT + '/index.html';
const T_START = Date.now();
const PIN = DATE_ARG ? new Date(DATE_ARG + 'T10:00:00') : new Date();

/* ------------------------------ static server ------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function startServer() {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404, { 'content-type': 'text/plain' }); return r.end('not found'); }
    r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(PORT, '127.0.0.1', () => res(srv)); });
}

/* ------------------------------ reporting ------------------------------ */
const counts = { PASS: 0, FAIL: 0, WARN: 0 };
const failures = [];
let shotN = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function oneLine(s) { return String(s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 300); }
async function shot(page, name) {
  if (!page) return;
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const f = path.join(OUT, String(++shotN).padStart(3, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + '.png');
    await page.screenshot({ path: f, fullPage: false, timeout: 5000 });
  } catch (e) { /* page may be closed */ }
}
async function report(kind, name, detail, page) {
  counts[kind]++;
  if (kind === 'FAIL') { failures.push(name + ' — ' + oneLine(detail)); await shot(page, name); }
  console.log(kind + ' ' + name + ' — ' + oneLine(detail));
}
const pass = (n, d, p) => report('PASS', n, d === undefined ? 'ok' : d, p);
const fail = (n, d, p) => report('FAIL', n, d, p);
const warn = (n, d, p) => report('WARN', n, d, p);
const check = (n, ok, d, p) => report(ok ? 'PASS' : 'FAIL', n, d === undefined ? (ok ? 'ok' : 'failed') : d, p);

/* ------------------------------ browser contexts ------------------------------ */
const externals = [];           // every non-localhost request that is not api.anthropic.com
const FORBIDDEN = [/kestrel/i, /sim day/i, /simulat/i, /\bseeds?\b/i, /\bticks?\b/i];
const ROUTES = [['home', 'Command Center'], ['campaigns', 'Campaigns'], ['content', 'Content Studio'], ['audiences', 'Audiences'], ['analytics', 'Analytics'], ['agents', 'Agents']];

let browser;
const live = new Set();
async function newCtx(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1440, height: 900 }, serviceWorkers: 'block' });
  ctx.__stub = o.stub || null;
  await ctx.clock.setFixedTime(o.date || PIN);
  await ctx.route('**/*', route => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (e) { return route.abort(); }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (u.hostname === 'api.anthropic.com') return ctx.__stub ? ctx.__stub(route) : route.fulfill({ status: 500, body: '{}' });
    externals.push(req.method() + ' ' + req.url());
    return route.abort();
  });
  live.add(ctx);
  return ctx;
}
async function closeCtx(ctx) { live.delete(ctx); try { await ctx.close(); } catch (e) { /* ignore */ } }

function watch(page) {
  const w = { errors: [] };
  page.on('console', m => { if (m.type() === 'error') w.errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => w.errors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('requestfailed', r => { const u = r.url(); if (/localhost|127\.0\.0\.1/.test(u)) w.errors.push('requestfailed: ' + u); });
  w.take = () => { const e = w.errors.slice(); w.errors.length = 0; return e; };
  return w;
}
const READY = () => !!(window.MC && MC.store && MC.store.getState && MC.store.getState() && document.querySelector('h1#page-title') && !document.querySelector('.app-bootcard'));
async function openApp(ctx, hash, o) {
  o = o || {};
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const w = watch(page);
  await page.goto(BASE + (hash ? '#' + hash : ''), { waitUntil: 'load' });
  await page.waitForFunction(READY, null, { timeout: 120000 });
  if (o.pause !== false) await page.evaluate(() => { try { MC.engine.setSpeed('pause'); } catch (e) { /* ignore */ } });
  await page.waitForTimeout(o.settle === undefined ? 400 : o.settle);
  return { page, w };
}
const W = (page, fn, arg) => page.evaluate(fn, arg);
const world = page => page.evaluate(() => MC.store.getState());
/* run `fn(world)` in the page (fn must be self-contained) */
const ws = (page, fn, a) => page.evaluate(([src, arg]) => (new Function('w', 'a', 'return (' + src + ')(w, a)'))(MC.store.getState(), arg), [fn.toString(), a]);

async function section(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  try { await fn(); } catch (e) { await fail('section ' + name + ' crashed', (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
}

/* ============================== 1. Boot ============================== */
async function secBoot() {
  const vps = [{ w: 1440, h: 900 }, { w: 390, h: 844 }];
  for (const vp of vps) for (const theme of ['light', 'dark']) {
    const ctx = await newCtx({ viewport: { width: vp.w, height: vp.h } });
    try {
      for (const [route, label] of ROUTES) {
        const name = `boot ${route} ${vp.w}x${vp.h} ${theme}`;
        let page;
        try {
          const o = await openApp(ctx, route, { settle: 0 });
          page = o.page;
          await page.evaluate(t => MC.uiStore.set({ theme: t }), theme);
          await page.waitForTimeout(900);
          const info = await page.evaluate(() => {
            const aria = [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).join(' \n ');
            const de = document.documentElement;
            return { text: document.body.innerText + '\n' + aria, h1: document.querySelectorAll('h1').length, h1id: document.querySelectorAll('h1#page-title').length,
              h1text: (document.querySelector('h1#page-title') || {}).textContent, scrollW: de.scrollWidth, clientW: de.clientWidth, bodyScrollW: document.body.scrollWidth,
              title: document.title, theme: de.getAttribute('data-theme'), route: MC.uiStore.getState().route };
          });
          const errs = o.w.take();
          const bad = [];
          if (errs.length) bad.push('errors: ' + errs.slice(0, 2).join(' / '));
          if (info.h1 !== 1 || info.h1id !== 1) bad.push(`h1 count ${info.h1} (#page-title ${info.h1id})`);
          if (info.scrollW > info.clientW + 1 || info.bodyScrollW > info.clientW + 1) bad.push(`horizontal overflow ${Math.max(info.scrollW, info.bodyScrollW)}>${info.clientW}`);
          const hits = FORBIDDEN.filter(re => re.test(info.text)).map(re => { const m = info.text.match(re); const i = info.text.indexOf(m[0]); return re.source + ' near "' + info.text.slice(Math.max(0, i - 25), i + 30).replace(/\s+/g, ' ') + '"'; });
          if (hits.length) bad.push('forbidden text: ' + hits.join('; '));
          if (!/ · Marketing Cloud$/.test(info.title)) bad.push('title "' + info.title + '"');
          if (info.theme !== theme) bad.push('theme attr ' + info.theme);
          if (info.route !== route) bad.push('route ' + info.route);
          if (info.h1text !== label) bad.push('h1 "' + info.h1text + '" expected "' + label + '"');
          await check(name, !bad.length, bad.length ? bad.join(' | ') : `no errors, one h1 "${info.h1text}", no overflow, clean text, title "${info.title}"`, page);
        } catch (e) { await fail(name, e.message.split('\n')[0], page); }
        if (page) await page.close();
      }
    } finally { await closeCtx(ctx); }
  }
}

/* ============================== 2. Dates ============================== */
async function secDates() {
  const cases = [[new Date(2026, 10, 26, 10), '2026-11-26'], [new Date(2026, 11, 5, 10), '2026-12-05'], [PIN, null]];
  for (const [d, expectYmd] of cases) {
    const ctx = await newCtx({ date: d });
    try {
      const { page } = await openApp(ctx, 'home');
      const r = await page.evaluate(() => {
        const T = MC.time, w = MC.store.getState(), n = new Date();
        const pad = x => ('0' + x).slice(-2);
        const todayYmd = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
        const bf = T.EVENTS.find(e => e.label === 'Black Friday');
        return { todayYmd, bfLabel: T.dayLabel(bf.day), bfYmd: T.displayYmd(bf.day), tickYmd: T.displayYmd(T.dayOf(w.meta.tick)), tick: w.meta.tick,
          inSeason: n >= new Date(2026, 10, 7) && n < new Date(2027, 0, 1), gold: T.EVENTS.map(e => e.label + '=' + T.dayLabel(e.day, { style: 'short' })).join(', ') };
      });
      const tag = 'dates (clock ' + r.todayYmd + ')';
      if (!r.inSeason) { await warn(tag, 'date outside Nov 7 - Dec 31 2026; display mapping checks skipped'); }
      else {
        await check(tag + ' Black Friday shows Nov 27', /Nov 27$/.test(r.bfLabel), r.bfLabel + ' (' + r.gold + ')', page);
        await check(tag + ' world tick is today', r.tickYmd === r.todayYmd, 'tick ' + r.tick + ' displays ' + r.tickYmd + ', today ' + r.todayYmd, page);
        if (expectYmd) await check(tag + ' pinned date honoured', r.todayYmd === expectYmd, r.todayYmd);
      }
      await page.close();
    } finally { await closeCtx(ctx); }
  }
}

/* ============================== 3. Command Center ============================== */
async function secHome() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    await page.waitForSelector('#home-brief');
    const brief = (await page.innerText('#home-brief')).trim();
    await check('home brief sentence present', /[A-Z][a-z]+ (has brought in|is) .*\.\s+.*(agent|Agents).*\.$/s.test(brief) || (brief.split('.').length >= 3 && brief.length > 40), brief, page);
    const nodes = await page.locator('svg.hm-j-svg g.hm-node').count();
    await check('home journey line has agent nodes', nodes > 0, nodes + ' nodes', page);
    if (nodes > 0) {
      const node = page.locator('svg.hm-j-svg g.hm-node').last();
      await node.scrollIntoViewIfNeeded();
      await node.click({ force: true });
      let hot = false;
      try { await page.waitForSelector('.hm-feed-row.is-hot', { timeout: 4000 }); hot = true; } catch (e) { /* maybe scroll only */ }
      const inView = await page.evaluate(() => { const el = document.getElementById('home-changes'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
      await check('home journey node click highlights/scrolls a feed row', hot || inView, hot ? 'feed row highlighted (is-hot)' : (inView ? 'no highlighted row, but What changed scrolled into view' : 'nothing happened'), page);
    }
    const s = await page.evaluate(() => ({ label: document.getElementById('app-approvals-btn').getAttribute('aria-label'), open: MC.store.getState().proposals.open.length,
      pendingByStatus: Object.values(MC.store.getState().proposals.byId).filter(p => p.status === 'pending').length }));
    const m = /(\d+)/.exec(s.label);
    const bm = /(\d+) needs? you/.exec(brief);
    const uiN = m ? +m[1] : 0;
    await check('approvals button count matches pending proposals', uiN === s.open && s.open === s.pendingByStatus, `button "${s.label}", open ${s.open}, pending ${s.pendingByStatus}`, page);
    if (bm) await check('brief "needs you" count matches pending proposals', +bm[1] === s.open, `brief ${bm[1]}, open ${s.open}`, page);
    else if (s.open === 0) await pass('brief has no needs-you clause when nothing is pending', brief);
    else await warn('brief "needs you" count', 'no "N need you" text in brief');
    const errs = w.take();
    await check('home no console errors during interaction', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 4. Approvals ============================== */
async function secApprovals() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    const open = await ws(page, w => w.proposals.open.slice());
    if (!open.length) { await warn('approvals', 'no pending proposals in this world; skipped'); return; }
    await page.click('#app-approvals-btn');
    const drawer = page.locator('#approvals-drawer');
    await drawer.waitFor({ state: 'visible' });
    const cards = drawer.locator('article');
    await cards.first().waitFor();
    const nCards = await cards.count();
    await check('approvals drawer lists pending proposals', nCards === open.length || nCards >= Math.min(open.length, 30), `${nCards} cards, ${open.length} pending`, page);
    let done = null;
    for (let i = 0; i < Math.min(nCards, 8) && !done; i++) {
      const card = cards.nth(i);
      const titleId = await card.locator('[id^="proposal-"][id$="-title"]').first().getAttribute('id');
      const pid = open.find(id => 'proposal-' + id.replace(/[^a-zA-Z0-9_-]/g, '-') + '-title' === titleId);
      if (!pid) continue;
      await card.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.waitForFunction(id => { const p = MC.store.getState().proposals.byId[id]; return p && p.status !== 'pending'; }, pid, { timeout: 2500 }).catch(() => {});
      const st = await ws(page, (w, id) => ({ status: w.proposals.byId[id].status, undo: MC.runtime.undoCheck(w, id), open: w.proposals.open.length }), pid);
      if (st.status === 'applied' || st.status === 'auto') { done = { pid, titleId, st }; break; }
      const txt = (await card.innerText()).split('\n').filter(l => /Blocked|Couldn|guardrail/i.test(l)).join(' ');
      await warn('approvals: Approve did not apply ' + pid, 'status ' + st.status + '; card says "' + txt + '"', page);
    }
    await check('approve -> applied/auto and undo available', !!done && done.st.undo && done.st.undo.ok, done ? `${done.pid}: status ${done.st.status}, undoCheck ${JSON.stringify(done.st.undo)}` : 'none of the first pending proposals could be approved', page);
    if (done) {
      await check('approving reduces the pending count', done.st.open === open.length - 1, `open ${open.length} -> ${done.st.open}`, page);
      await page.mouse.move(2, 2);   // the list freezes while hovered
      await page.getByRole('tab', { name: done.st.status === 'auto' ? /Applied by agents/ : /^History/ }).click();   // approved-by-you lands in History
      const same = page.locator('article:has(#' + done.titleId + ')');
      for (let k = 0; k < 4 && !(await same.count()); k++) { const more = page.locator('#approvals-more'); if (!(await more.count())) break; await more.click(); await page.waitForTimeout(250); }
      await same.waitFor({ timeout: 3000 }).catch(() => {});
      const undoBtn = same.getByRole('button', { name: 'Undo' });
      if (await undoBtn.count() && await undoBtn.isEnabled()) {
        await undoBtn.click();
        await page.waitForFunction(id => MC.store.getState().proposals.byId[id].status === 'undone', done.pid, { timeout: 8000 }).catch(() => {});
        const s2 = await ws(page, (w, id) => w.proposals.byId[id].status, done.pid);
        await check('undo restores the proposal (status undone)', s2 === 'undone', 'status ' + s2, page);
      } else await warn('approvals undo via UI', 'Undo button not found/enabled for ' + done.pid, page);
    }
    const errs = w.take();
    await check('approvals no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.keyboard.press('Escape');
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 5. Campaigns ============================== */
async function secCampaigns() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'campaigns');
    await page.waitForSelector('#cmp-modes-board');
    await page.click('#cmp-modes-list');
    await page.waitForSelector('table');
    await check('campaigns list mode', (await page.locator('table tbody tr').count()) >= 3, (await page.locator('table tbody tr').count()) + ' rows', page);
    await page.click('#cmp-modes-calendar');
    await page.waitForFunction(() => /Select a bar to open the campaign/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
    await check('campaigns calendar mode', /Select a bar to open the campaign/.test(await page.innerText('main')), 'calendar caption present', page);
    await page.click('#cmp-modes-board');
    await check('campaigns board mode', (await page.locator('h2', { hasText: /^Draft/ }).count()) > 0, 'Draft column present', page);

    for (const name of ['Winter Layering Launch', 'Holiday Gift Guide']) {
      const btn = page.getByRole('button', { name, exact: true }).first();
      if (!(await btn.count())) { await warn('campaign detail ' + name, 'card not found on board'); continue; }
      await btn.click();
      await page.waitForFunction(n => (document.querySelector('h1#page-title') || {}).textContent === n, name, { timeout: 8000 }).catch(() => {});
      const h1 = await page.innerText('h1#page-title');
      await check('campaign detail opens: ' + name, h1 === name, 'h1 "' + h1 + '"', page);
      const tabs = await page.$$eval('[role=tab][id^="cmp-tabs-"]', els => els.map(e => e.id));
      await check('campaign detail has tabs: ' + name, tabs.length >= 4, tabs.map(t => t.replace('cmp-tabs-', '')).join(','), page);
      for (const id of tabs) {
        await page.click('#' + id);
        await page.waitForTimeout(350);
        const len = await page.evaluate(() => (document.querySelector('[role=tabpanel]') || { innerText: '' }).innerText.trim().length);
        const errs = w.take();
        await check(`campaign ${name} tab ${id.replace('cmp-tabs-', '')}`, len > 20 && !errs.length, `panel text ${len} chars` + (errs.length ? '; ' + errs.join(' / ') : ''), page);
      }
      await page.click('#cmp-back');
      await page.waitForSelector('#cmp-modes-board');
    }

    /* planner */
    const pname = 'E2E Planner Test';
    await page.click('#cmp-plan');
    await page.waitForSelector('#brief-name');
    await page.fill('#brief-name', pname);
    await page.fill('#brief-target', '5000');
    await page.fill('#brief-budget', '3000');
    await page.click('#plan-draft');
    const drafted = await page.waitForSelector('#plan-audience-accept', { timeout: 10000 }).then(() => true, () => false);
    await check('planner drafts a plan from the brief', drafted, drafted ? 'plan sections shown' : 'no plan draft appeared', page);
    if (drafted) {
      await page.click('#plan-create');
      await page.waitForFunction(n => (document.querySelector('h1#page-title') || {}).textContent === n, pname, { timeout: 10000 }).catch(() => {});
      const c = await ws(page, (w, n) => Object.values(w.campaigns.byId).filter(x => x.name === n).map(x => x.status), pname);
      await check('planner creates a draft campaign', c.length === 1 && c[0] === 'draft', 'campaign status ' + JSON.stringify(c), page);
      await page.click('#cmp-back');
      await page.waitForSelector('#cmp-modes-board');
      await page.click('#cmp-modes-board');
      const under = await page.evaluate(n => {
        const heads = [...document.querySelectorAll('h2')].filter(h => /^(Draft|Scheduled|Live|Completed|Always-on)/.test(h.textContent));
        const el = [...document.querySelectorAll('main button, main a')].find(b => b.textContent.trim() === n);
        if (!el) return 'card not on board';
        let cur = null;
        for (const h of heads) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) cur = h.textContent.trim();
        return cur;
      }, pname);
      await check('new campaign appears in the Draft column', /^Draft/.test(under || ''), 'under heading "' + under + '"', page);
    }
    const errs = w.take();
    await check('campaigns no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 6. Content ============================== */
async function secContent() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'content');
    const vid = 'v-hgg-email-a';
    await page.waitForSelector('#cs-lib-' + vid);
    await page.click('#cs-lib-' + vid);
    await page.waitForSelector('#cs-subject');
    await page.waitForSelector('#cs-checks-headline');
    const head0 = await page.innerText('#cs-checks-headline');
    const bad = 'Best jacket EVER, guaranteed 100% waterproof!!!';
    await page.fill('#cs-subject', bad);
    await page.fill('#cs-body', 'The best, guaranteed lowest price. Act now');
    await page.waitForTimeout(500);
    const head1 = await page.innerText('#cs-checks-headline');
    const fixes = await page.$$eval('[id^="cs-fix-"]:not(#cs-fix-all)', els => els.map(e => e.id));
    await check('content: editing a field re-runs the checks', head1 !== head0 && fixes.length > 0, `"${head0}" -> "${head1}"; fixes ${fixes.join(',')}`, page);
    if (fixes.includes('cs-fix-banned')) {
      let clicks = 0;
      while (clicks < 5 && await page.locator('#cs-fix-banned').count()) { await page.click('#cs-fix-banned'); clicks++; await page.waitForTimeout(300); }
      const subj = await page.inputValue('#cs-subject'), body = await page.inputValue('#cs-body');
      const still = await page.locator('#cs-fix-banned').count();
      await check('content: Fix clears the banned-word failure', !/guaranteed/i.test(subj + ' ' + body) && still === 0, `after ${clicks} click(s) subject "${subj}", body "${body}"`, page);
    } else if (fixes.length) {
      await page.click('#' + fixes[0]);
      await pass('content: Fix applied', fixes[0]);
    } else await warn('content: Fix', 'no failing check with a Fix button appeared');
    await page.fill('#cs-subject', 'A warm layer for the first cold morning');
    await page.waitForTimeout(300);
    if (await page.locator('#cs-save').isEnabled()) {
      await page.click('#cs-save');
      await page.waitForTimeout(500);
      const saved = await ws(page, (w, id) => (w.variants.byId[id] || {}).fields && w.variants.byId[id].fields.subject, vid);
      await check('content: saving persists the edited field', saved === 'A warm layer for the first cold morning', 'subject in state: ' + saved, page);
    } else await warn('content: save', '#cs-save disabled (draft-live conflict UI or no change detected)');

    /* generate variants (rules path, AI off) */
    const n0 = await ws(page, w => Object.values(w.variants.byId).filter(v => v.campaignId === 'c-hgg').length);
    await page.click('#cs-generate');
    const gen = await page.waitForSelector('.cs-result', { timeout: 15000 }).then(() => true, () => false);
    const count = await page.locator('.cs-result').count();
    await check('content: generate variants returns results (rules path)', gen && count >= 3, count + ' results', page);
    if (gen) {
      await page.locator('.cs-result input[type=checkbox]').first().check();
      await page.selectOption('#cs-add-campaign', 'c-hgg');
      await page.click('#cs-add-go');
      await page.waitForFunction(() => /Added \d+ variants?/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
      const n1 = await ws(page, w => Object.values(w.variants.byId).filter(v => v.campaignId === 'c-hgg').length);
      await check('content: add a generated variant to a campaign', n1 === n0 + 1, `variants in Holiday Gift Guide ${n0} -> ${n1}`, page);
    }
    await page.click('#cs-tab-voice');
    const voice = await page.waitForSelector('#cs-v-pillars', { timeout: 5000 }).then(() => true, () => false);
    await check('content: brand voice tab renders', voice, voice ? 'pillars present' : 'missing #cs-v-pillars', page);
    const errs = w.take();
    await check('content no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 7. Audiences ============================== */
async function secAudiences() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'audiences');
    await page.click('#aud-tabs-builder');
    await page.waitForSelector('#aud-describe');
    await page.fill('#aud-describe', 'people in the Pacific Northwest who bought in the last 60 days');
    await page.click('#aud-describe-build');
    await page.waitForFunction(() => /\d[\d,]* people/.test((document.querySelector('.aud-live') || { innerText: '' }).innerText), null, { timeout: 8000 }).catch(() => {});
    const main = await page.innerText('main');
    const live = await page.evaluate(() => (document.querySelector('.aud-live') || { innerText: '' }).innerText);
    const cnt = /(\d[\d,]*) people/.exec(live);
    await check('audiences: description becomes a rule', /Region is Pacific Northwest/.test(main) && /Last order/.test(main), (main.match(/Understood:[\s\S]{0,160}/) || ['no "Understood" text'])[0], page);
    await check('audiences: live audience shows a count', !!cnt && +cnt[1].replace(/,/g, '') > 0, cnt ? cnt[0] : 'no count: ' + live.slice(0, 80), page);
    const n0 = await ws(page, w => w.segments.order.length);
    await page.fill('#seg-name', 'E2E PNW recent buyers');
    await page.click('#aud-save');
    await page.waitForTimeout(600);
    const n1 = await ws(page, w => w.segments.order.length);
    await check('audiences: save the described segment', n1 === n0 + 1, `segments ${n0} -> ${n1}`, page);
    const errs = w.take();
    await check('audiences no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 8. Agents ============================== */
async function secAgents() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'agents');
    await page.waitForSelector('#agents-roster');
    const rows = await page.locator('[id^="agents-row-"]').count();
    await check('agents: roster renders 8 agents', rows === 8, rows + ' rows', page);
    const id = 'guard';
    await page.click('#agents-row-' + id);
    await page.waitForSelector('#agents-' + id + '-run');
    const before = await ws(page, (w, id) => w.audit.entries.filter(e => e.agentId === id).length, id);
    await page.click('#agents-' + id + '-run');
    const queued = await page.waitForFunction(() => /Queued/.test(document.querySelector('#agents-detail').innerText), null, { timeout: 4000 }).then(() => true, () => false);
    await page.evaluate(() => MC.engine.step(3));
    await page.waitForTimeout(300);
    const after = await ws(page, (w, id) => w.audit.entries.filter(e => e.agentId === id).length, id);
    const asked = await ws(page, (w, id) => w.audit.entries.some(e => e.agentId === id && e.reason === 'runNow'), id);
    await check('agents: Run now produces a run', after > before && asked, `${id} audit entries ${before} -> ${after}; runNow entry: ${asked}; queued message: ${queued}`, page);
    await page.click('#agents-tabs-history');
    await page.waitForTimeout(400);
    const hist = await page.innerText('#agents-panel');
    await check('agents: run shows in Run history', /you asked/.test(hist), /you asked/.test(hist) ? 'found "you asked"' : 'no "you asked" entry', page);
    await page.click('#agents-tabs-roster');
    await page.click('#agents-row-' + id);
    for (const lvl of ['suggest', 'off', 'autopilot']) {
      const r = page.locator('#agents-' + id + '-autonomy-' + lvl);
      if (!(await r.count())) { await warn('agents: autonomy ' + lvl, 'radio not found'); continue; }
      await r.click();
      await page.waitForTimeout(250);
      const a = await ws(page, (w, id) => w.agents.byId[id].autonomy, id);
      await check('agents: autonomy -> ' + lvl, a === lvl, 'state ' + a, page);
    }
    for (const mode of ['rules', 'auto']) {
      const r = page.locator('#agents-' + id + '-reasoning-' + mode);
      if (!(await r.count())) { await warn('agents: reasoning ' + mode, 'radio not found'); continue; }
      await r.click();
      await page.waitForTimeout(250);
      const m = await ws(page, (w, id) => w.agents.byId[id].aiMode || 'auto', id);
      await check('agents: reasoning -> ' + mode, m === mode, 'state aiMode ' + m, page);
    }
    const errs = w.take();
    await check('agents no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 9. Connect (stubbed Anthropic) ============================== */
function makeStub(state) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
  const msg = (obj, stop) => ({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: stop || 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
    usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  const blank = { subject: '', preheader: '', headline: '', body: '', cta: '', sms: '', pushTitle: '', pushBody: '', socialText: '', socialHeadline: '', alt: '' };
  return route => {
    const req = route.request();
    const send = (status, json) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(json) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    state.calls++;
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) { /* ignore */ }
    state.keys.push(req.headers()['x-api-key']);
    if (state.mode === '401') return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (body.max_tokens === 16) return send(200, msg('OK'));
    const sys = body.system || [];
    const user = body.messages && body.messages[0] ? body.messages[0].content : '';
    const props = body.output_config && body.output_config.format ? Object.keys(body.output_config.format.schema.properties) : [];
    state.kinds.push(props.join(','));
    if (props.includes('decisions')) {
      let cands = [];
      try { cands = JSON.parse(String(user).split(/CANDIDATE DRAFTS FROM THE ENGINE \(\d+\)\n/)[1].split('\n\nRULE INSIGHTS')[0]); } catch (e) { cands = []; }
      const agent = (/"id":"(\w+)","name"/.exec(sys[1] ? sys[1].text : '') || [])[1];
      const out = { decisions: cands.map((c, i) => ({ candidate: 'c' + i, verdict: 'propose', adjust: [], title: 'Smart pick: ' + String(c.draftTitle || '').slice(0, 60),
        why: 'The evidence in the draft supports acting now rather than waiting another week.', confidence: 0.7 })), insights: [], summary: (agent || 'agent') + ' reviewed its options and acted on the strongest one.' };
      if (agent === 'copy') out.variants = [];
      if (agent === 'scout') out.segments = [];
      return send(200, msg(out));
    }
    if (props.includes('variants')) return send(200, msg({ variants: [1, 2, 3].map(i => ({ fields: Object.assign({}, blank, { subject: 'Trail-ready pick number ' + i, preheader: 'Fresh gear for the weekend', body: 'Gear up with Fernway.', cta: 'Shop now' }) })) }));
    if (props.includes('goalType')) return send(200, msg({ name: 'Winter camp push', goalType: 'conversions', goalTarget: 0, productId: 'nope', segmentId: 's-campers', budget: 4000, startInDays: 2, lengthDays: 10, channels: ['email', 'push'], tone: 'warm', offer: 'freeship', narrative: 'A warm push.' }));
    if (props.includes('conditions')) return send(200, msg({ name: 'Lapsed hikers in the Northwest', why: 'Reads the description as lapsed hikers.', combine: 'all', conditions: [{ attr: 'region', cmp: 'in', value: 'pnw' }, { attr: 'lastOrderDays', cmp: 'gt', value: '120' }] }));
    if (props.includes('answer')) return send(200, msg({ answer: 'The draft shows a clear winner.' }));
    return send(400, { error: { message: 'unexpected' } });
  };
}
async function connectVia(page, key) {
  await page.click('#app-connect-btn');
  await page.waitForSelector('#connect-panel', { state: 'visible' });
  await page.click('#connect-manual');
  await page.fill('#connect-key', key);
  await page.click('#connect-submit');
}
async function secConnect() {
  /* good key */
  const st = { mode: 'ok', calls: 0, keys: [], kinds: [] };
  let ctx = await newCtx({ stub: makeStub(st) });
  try {
    const { page, w } = await openApp(ctx, 'agents');
    const key = 'sk-ant-test-e2e-key-000000000001';
    const off0 = await page.evaluate(() => MC.ai.state());
    await check('connect: starts off with no key stored', off0 === 'off' && (await page.evaluate(() => localStorage.getItem('mc.ai.key') === null && sessionStorage.getItem('mc.ai.key') === null)), 'state ' + off0, page);
    await connectVia(page, key);
    const on = await page.waitForFunction(() => MC.ai.state() === 'on', null, { timeout: 10000 }).then(() => true, () => false);
    await check('connect: typed key -> state on', on, 'state ' + await page.evaluate(() => MC.ai.state()) + ', calls ' + st.calls, page);
    if (on) {
      const stored = await page.evaluate(() => localStorage.getItem('mc.ai.key') || sessionStorage.getItem('mc.ai.key'));
      await check('connect: key stored in the browser and sent in x-api-key', stored === key && st.keys[0] === key, 'stored ' + (stored ? 'yes' : 'no') + ', header ' + (st.keys[0] === key));
      await page.waitForFunction(() => { const w = MC.store.getState(); return w.ai && w.ai.on; }, null, { timeout: 5000 }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const lbl = await page.getAttribute('#app-connect-btn', 'aria-label');
      await check('connect: top bar shows connected', /connected/i.test(lbl), lbl, page);

      /* run agents through the stub */
      await page.click('#agents-tabs-roster');
      const ids = await page.$$eval('[id^="agents-row-"]', els => els.map(e => e.id.replace('agents-row-', '')));
      for (const id of ids) await page.evaluate(id => MC.store.dispatch({ type: 'agent/runNow', payload: { id } }), id);
      await page.evaluate(() => MC.engine.step(3));
      await page.waitForFunction(() => MC.runtime.awaiting(MC.store.getState()).length === 0, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(400);
      const ai = await ws(page, w => w.audit.entries.filter(e => e.engine === 'ai').map(e => e.agentId + ':' + (e.ai || '')), null);
      await check('connect: agent run uses Claude (audit engine ai)', ai.length > 0 && st.kinds.some(k => k.includes('decisions')), `${ai.length} ai entries [${[...new Set(ai)].slice(0, 6).join(', ')}], API calls ${st.calls}`, page);
      await page.click('#agents-tabs-history');
      await page.waitForTimeout(500);
      const hist = await page.innerText('#agents-panel');
      await check('connect: Run history labels the run Claude', /Claude/.test(hist), /Claude/.test(hist) ? 'label found' : 'no "Claude" label in history', page);
      const bad = await ws(page, w => w.audit.entries.filter(e => e.ai === 'fallback').map(e => e.agentId + ':' + e.fallbackReason).slice(0, 3), null);
      if (bad.length) await warn('connect: some AI runs fell back to rules', bad.join(', '));

      /* disconnect */
      await page.click('#app-connect-btn');
      await page.waitForSelector('#connect-disconnect', { state: 'visible' });
      await page.click('#connect-disconnect');
      await page.waitForFunction(() => MC.ai.state() === 'off', null, { timeout: 5000 }).catch(() => {});
      const d = await page.evaluate(() => ({ s: MC.ai.state(), l: localStorage.getItem('mc.ai.key'), se: sessionStorage.getItem('mc.ai.key') }));
      await check('connect: disconnect clears storage and state', d.s === 'off' && d.l === null && d.se === null, JSON.stringify(d), page);
    }
    const errs = w.take().filter(e => !/Failed to load resource/.test(e));
    await check('connect no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* rejected key */
  const st2 = { mode: '401', calls: 0, keys: [], kinds: [] };
  ctx = await newCtx({ stub: makeStub(st2) });
  try {
    const { page } = await openApp(ctx, 'home');
    await connectVia(page, 'sk-ant-test-e2e-key-bad');
    const shown = await page.waitForFunction(() => /That key didn['’]t work/.test((document.getElementById('connect-msg') || { innerText: '' }).innerText), null, { timeout: 8000 }).then(() => true, () => false);
    const d = await page.evaluate(() => ({ s: MC.ai.state(), l: localStorage.getItem('mc.ai.key'), se: sessionStorage.getItem('mc.ai.key') }));
    await check('connect: 401 shows "That key didn’t work"', shown, shown ? 'message shown' : 'message missing; state ' + d.s, page);
    await check('connect: 401 leaves AI off and stores nothing', d.s !== 'on' && d.l === null && d.se === null, JSON.stringify(d), page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 10. Determinism ============================== */
async function secDeterminism() {
  const vals = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await newCtx();
    try {
      const { page } = await openApp(ctx, 'home');
      vals.push(await page.evaluate(() => JSON.stringify({ actual: MC.select.goalFor(MC.store.getState()).actual, tick: MC.store.getState().meta.tick, n: MC.store.getState().proposals.open.length })));
      await page.close();
    } finally { await closeCtx(ctx); }
  }
  await check('determinism: same date -> same goalFor(world).actual', vals[0] === vals[1] && /"actual":\d/.test(vals[0]), vals[0] + (vals[0] === vals[1] ? '' : ' vs ' + vals[1]));
}

/* ============================== main ============================== */
(async () => {
  const srv = await startServer().catch(e => { console.error('server failed: ' + e.message); process.exit(2); });
  browser = await chromium.launch();
  const secs = [['boot', secBoot], ['dates', secDates], ['home', secHome], ['approvals', secApprovals], ['campaigns', secCampaigns], ['content', secContent],
    ['audiences', secAudiences], ['agents', secAgents], ['connect', secConnect], ['determinism', secDeterminism]];
  for (const [n, f] of secs) await section(n, f);
  if (!ONLY || ONLY.includes('boot')) { /* network audit covers every section that ran */ }
  await check('network: no request left localhost (except stubbed api.anthropic.com)', externals.length === 0, externals.length ? [...new Set(externals)].slice(0, 5).join(', ') : 'none');
  await browser.close();
  srv.close();
  const secs2 = ((Date.now() - T_START) / 1000).toFixed(1);
  const total = counts.PASS + counts.FAIL + counts.WARN;
  console.log(`SUMMARY total=${total} pass=${counts.PASS} fail=${counts.FAIL} warn=${counts.WARN} runtime=${secs2}s`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(counts.FAIL ? 1 : 0);
})().catch(e => { console.error('fatal: ' + (e && e.stack || e)); process.exit(2); });
