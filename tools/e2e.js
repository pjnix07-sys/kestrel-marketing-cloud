#!/usr/bin/env node
/* End-to-end suite for the static Marketing Cloud app (Playwright + Chromium).
   Tests the product as it is now (docs/PRODUCT.md): the left icon rail and the phone bottom bar, Home, the Goals list and
   Goal page (Steer + Activity), Approvals, Agents, the artifact pages (Campaigns, Audiences, Content, Results), Settings
   detail level, Connect Claude, and the same consistency, determinism and no-theatre guarantees as before.
   Usage:  NODE_PATH=$(npm root -g) node tools/e2e.js [--port 8870] [--out /tmp/claude-0/e2e-out] [--date 2026-11-26] [--only boot,shell,...]
   - Starts its own static server on --port serving the repo root.
   - Fails if any request leaves localhost, except api.anthropic.com which is stubbed with page routes.
   - One line per check: PASS|FAIL|WARN <name> — <detail>; a summary line; exit 1 on any FAIL.
   - Screenshots only for failures, written to --out.
   - --only takes a comma list of groups: boot, shell, missions, asks, team, artifacts, connect, no-theatre, consistency, determinism (default: all).
   - --port is the static server port; --out is where failure screenshots go.
   - --date pins the browser clock (YYYY-MM-DD at 10:00 local); default pins to the moment the suite started so
     every context sees the same date.
   - Agent work runs on the work pulse: tests pause the engine, then call MC.engine.pulse() while MC.missions.hasWork(w)
     (the pulse helper below); MC.engine.step(n) still advances world hours where a test needs the daily rhythm.
   - Visible copy is scanned for words that must not appear (see FORBIDDEN): fiction, simulation, "mission(s)" (the user
     word is Goal; hrefs and ids are not visible text), "teammate".
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
const FORBIDDEN = [/kestrel/i, /sim day/i, /simulat/i, /\bseeds?\b/i, /\bticks?\b/i, /\bmissions?\b/i, /teammate/i];
/* [hash, ui route, h1 prefix (null = a goal sentence)] */
const ROUTES = [['home', 'home', 'Home'], ['missions', 'missions', 'Goals'], ['missions/m-lhw', 'missions', null], ['approvals', 'approvals', 'Approvals'], ['team', 'agents', 'Agents'],
  ['campaigns', 'campaigns', 'Campaigns'], ['content', 'content', 'Content'], ['audiences', 'audiences', 'Audiences'], ['analytics', 'analytics', 'Results']];
/* agent voice in Activity is impersonal past-tense facts: no first person, no chat acknowledgements */
const FIRST_PERSON = /\b(I'll|I’ll|I'm|I’m|I've|I’ve|I will|I am)\b|\bGot it\b/;

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
/* ------------------------------ mission helpers ------------------------------ */
const SEED_LHW = 'm-lhw', SEED_BFE = 'm-bfe';
const tick = async (page, n) => { await page.evaluate(k => MC.engine.step(k), n || 1); await page.waitForTimeout(250); };
/* run the work pulse until no goal has claimable work (an open ask or nothing left to do ends it); returns the pulses that changed something */
const pulse = async (page, max) => { const n = await page.evaluate(m => { let k = 0; while (k < m && MC.missions.hasWork(MC.store.getState()) && MC.engine.pulse()) k++; return k; }, max || 40); await page.waitForTimeout(250); return n; };
const mission = (page, id) => page.evaluate(id => { const m = MC.store.getState().missions.byId[id]; return m ? JSON.parse(JSON.stringify(m)) : null; }, id);
/* the rail's Approvals count: aria-label "Approvals, N waiting" (no count when nothing waits) */
const askCount = page => page.evaluate(() => { const l = document.getElementById('rail-approvals').getAttribute('aria-label'); const m = /(\d+) waiting/.exec(l); return m ? +m[1] : 0; });
/* the one Asks count is MC.metrics.asks(w).count (open mission asks + pending proposals that are not superseded/expired) */
const expectedAsks = page => page.evaluate(() => MC.metrics.asks(MC.store.getState()).count);
const steps = m => m.plan.map(s => s.id + ':' + s.status).join(' ');

/* ============================== 1. Boot ============================== */
async function secBoot() {
  const vps = [{ w: 1440, h: 900 }, { w: 390, h: 844 }];
  for (const vp of vps) for (const theme of ['light', 'dark']) {
    const ctx = await newCtx({ viewport: { width: vp.w, height: vp.h } });
    try {
      for (const [hash, route, label] of ROUTES) {
        const name = `boot ${hash} ${vp.w}x${vp.h} ${theme}`;
        let page;
        try {
          const o = await openApp(ctx, hash, { settle: 0 });
          page = o.page;
          await page.evaluate(t => MC.uiStore.set({ theme: t }), theme);
          await page.waitForTimeout(900);
          const info = await page.evaluate(() => {
            const vis = sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
            const aria = [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).join(' \n ');
            const de = document.documentElement, goals = MC.missions.list(MC.store.getState()).map(m => m.goalText);
            return { text: document.body.innerText + '\n' + aria, h1: document.querySelectorAll('h1').length, h1id: document.querySelectorAll('h1#page-title').length,
              h1text: ((document.querySelector('h1#page-title') || {}).textContent || '').trim(), scrollW: de.scrollWidth, clientW: de.clientWidth, bodyScrollW: document.body.scrollWidth,
              title: document.title, theme: de.getAttribute('data-theme'), route: MC.uiStore.getState().route, goals,
              rail: vis('nav.rail'), bbar: vis('nav.bbar'), topbar: !!document.querySelector('header.app-top, #app-top, .app-topbar'), on: [...document.querySelectorAll('nav.rail [aria-current=page], nav.bbar [aria-current=page]')].map(e => e.id) };
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
          if (label === null ? info.goals.indexOf(info.h1text) < 0 : info.h1text.indexOf(label) !== 0) bad.push('h1 "' + info.h1text + '" expected ' + (label === null ? 'a goal sentence' : '"' + label + '"'));
          const phone = vp.w < 760;
          if (phone ? !(info.bbar && !info.rail) : !(info.rail && !info.bbar)) bad.push(`navigation: rail ${info.rail}, bottom bar ${info.bbar} at ${vp.w}px`);
          if (info.topbar) bad.push('a top bar is present');
          if (info.on.length < 1 && ['home', 'missions', 'approvals', 'agents', 'campaigns', 'audiences', 'content', 'analytics'].indexOf(route) >= 0 && !(phone && ['agents', 'campaigns', 'audiences', 'content'].indexOf(route) >= 0)) bad.push('no navigation item is aria-current=page');
          if (hash === 'missions/m-lhw' && info.goals.indexOf(info.h1text) !== info.goals.indexOf(info.goals.find(g => /lapsed hikers/.test(g)))) bad.push('did not open goal m-lhw');
          await check(name, !bad.length, bad.length ? bad.join(' | ') : `no errors, one h1 "${info.h1text.slice(0, 40)}", ${phone ? 'bottom bar' : 'rail'}, no overflow, clean text, title "${info.title}"`, page);
        } catch (e) { await fail(name, e.message.split('\n')[0], page); }
        if (page) await page.close();
      }
    } finally { await closeCtx(ctx); }
  }
}

/* ============================== 2. Shell: rail, bottom bar, Settings, Home ============================== */
const RAIL = [['home', 'Home'], ['missions', 'Goals'], ['approvals', 'Approvals'], ['campaigns', 'Campaigns'], ['audiences', 'Audiences'], ['content', 'Content'], ['analytics', 'Results'], ['agents', 'Agents']];
const RAIL_HASH = { agents: 'team' };
const tipState = (page, id) => page.evaluate(id => { const t = document.querySelector('#' + id + ' .rail-tip'); if (!t) return null; const cs = getComputedStyle(t); return { text: t.textContent.trim(), opacity: +cs.opacity, visibility: cs.visibility }; }, id);
async function secShell() {
  /* --- the icon rail --- */
  let ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    const rail = await page.$$eval('nav.rail a.rail-item', els => els.map(e => ({ id: e.id, name: e.getAttribute('aria-label'), href: e.getAttribute('href'), tip: (e.querySelector('.rail-tip') || {}).textContent, text: e.innerText.replace(/\s+/g, ' ').trim() })));
    await check('rail: Home, Goals, Approvals, Campaigns, Audiences, Content, Results, Agents in that order, each a link', JSON.stringify(rail.map(r => r.id)) === JSON.stringify(RAIL.map(r => 'rail-' + r[0])) && rail.every((r, i) => r.href === '#' + (RAIL_HASH[RAIL[i][0]] || RAIL[i][0])), rail.map(r => r.id + '->' + r.href).join(' '), page);
    const asks0 = await expectedAsks(page);
    await check('rail: every item has an accessible name and a tooltip with the same name', rail.every((r, i) => (r.name || '').indexOf(RAIL[i][1]) === 0 && (r.tip || '').indexOf(RAIL[i][1]) === 0), rail.map(r => r.name + '/' + r.tip).join(' | '), page);
    const btns = await page.evaluate(() => ['app-new-goal', 'app-search-btn', 'app-help', 'app-connect-btn', 'app-more'].map(id => { const e = document.getElementById(id); return { id, tag: e && e.tagName, name: e && e.getAttribute('aria-label'), inRail: !!(e && e.closest('nav.rail')) }; }));
    await check('rail: New goal, Search, Help, Connect Claude and Settings are named buttons in the rail', btns.every(b => b.tag === 'BUTTON' && b.name && b.inRail) && /New goal/.test(btns[0].name) && /Search/.test(btns[1].name) && /^Help/.test(btns[2].name) && /Claude/.test(btns[3].name) && /^Settings/.test(btns[4].name), btns.map(b => b.name).join(' | '), page);
    await check('rail: the labels are not drawn until asked for (icons only)', rail.every(r => r.text === '' || /^\d+$/.test(r.text) || r.text === RAIL.find(x => 'rail-' + x[0] === r.id)[1]) && (await tipState(page, 'rail-campaigns')).visibility === 'hidden', 'tip hidden at rest', page);
    /* hover and keyboard focus show the name */
    await page.mouse.move(700, 450);
    await page.hover('#rail-campaigns');
    await page.waitForTimeout(700);
    const hov = await tipState(page, 'rail-campaigns');
    await check('rail: hovering an item shows its name (.rail-tip)', hov.visibility === 'visible' && hov.opacity > 0.9 && hov.text === 'Campaigns', JSON.stringify(hov), page);
    await page.mouse.move(700, 450);
    await page.keyboard.press('Tab');
    await page.focus('#rail-audiences');
    await page.waitForTimeout(700);
    const foc = await tipState(page, 'rail-audiences'), other = await tipState(page, 'rail-campaigns');
    await check('rail: keyboard focus shows the name, and only that name', foc.visibility === 'visible' && foc.opacity > 0.9 && foc.text === 'Audiences' && other.visibility === 'hidden', JSON.stringify({ foc, other }), page);
    /* active item */
    const marks = [];
    for (const [route, label] of RAIL) {
      await page.click('#rail-' + route);
      await page.waitForFunction(r => MC.uiStore.getState().route === r, route, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(250);
      const on = await page.$$eval('nav.rail [aria-current=page]', els => els.map(e => e.id));
      const cls = await page.$$eval('nav.rail .rail-item.is-on', els => els.map(e => e.id));
      marks.push({ route, on: on.join(','), ok: on.length === 1 && on[0] === 'rail-' + route && cls.length === 1 && cls[0] === 'rail-' + route && (await page.evaluate(() => location.hash)) === '#' + (RAIL_HASH[route] || route) });
    }
    await check('rail: clicking an item opens it, and exactly that item is aria-current="page"', marks.every(m => m.ok), marks.map(m => m.route + ':' + m.on).join(' '), page);
    await page.click('#rail-missions');
    await page.click('.gl-row a');
    await page.waitForFunction(() => /^#missions\/m-/.test(location.hash), null, { timeout: 5000 }).catch(() => {});
    const onGoal = await page.$$eval('nav.rail [aria-current=page]', els => els.map(e => e.id));
    await check('rail: a goal page keeps Goals as the current item', onGoal.length === 1 && onGoal[0] === 'rail-missions', onGoal.join(','), page);
    /* approvals count */
    const lbl = await page.getAttribute('#rail-approvals', 'aria-label'), badge = (await page.locator('#rail-approvals .rail-badge').count()) ? (await page.innerText('#rail-approvals .rail-badge')).trim() : '';
    const exp = await expectedAsks(page);
    await check('rail: the Approvals count (aria-label and badge) is MC.metrics.asks(w).count', exp >= 1 && lbl === `Approvals, ${exp} waiting` && badge === String(exp) && asks0 === exp, `label "${lbl}", badge "${badge}", metrics ${exp}`, page);
    const tipApp = await tipState(page, 'rail-approvals');
    await check('rail: the Approvals tooltip carries the count', new RegExp('^Approvals \\(' + exp + '\\)$').test(tipApp.text), tipApp.text, page);
    await page.evaluate(() => { const m = MC.missions.list(MC.store.getState()).find(m => m.asks.some(a => a.status === 'open')); const a = m.asks.find(a => a.status === 'open'); MC.missions.answer(m.id, a.id, a.default); });
    await page.waitForTimeout(300);
    await check('rail: the count follows an answer without a reload', (await askCount(page)) === exp - 1 && (await expectedAsks(page)) === exp - 1, `${exp} -> ${await askCount(page)}`, page);
    /* a rail button opens things */
    await page.click('#app-new-goal');
    await page.waitForSelector('#goal-drawer #app-goal-text', { state: 'visible' });
    await check('rail: the New goal button opens the goal box', true, 'goal drawer open', page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.click('#app-help');
    await page.waitForSelector('#app-help-menu', { state: 'visible' });
    await check('rail: Help opens a popover with Getting started and the keyboard keys', (await page.locator('#app-help-menu #app-take-tour').count()) === 1 && /Getting started/.test(await page.innerText('#app-help-menu #app-take-tour')) && /Search everything/.test(await page.innerText('#app-help-menu')), (await page.innerText('#app-help-menu')).replace(/\s+/g, ' ').slice(0, 120), page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const errs = w.take();
    await check('rail: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- Settings: detail level opens and closes the advanced disclosures --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'team');
    const dets = () => page.$$eval('details.mc-details', els => els.map(e => e.open));
    const d0 = await dets();
    await check('settings: in Simple (the default) every advanced disclosure is closed', d0.length >= 9 && d0.every(o => o === false) && (await page.evaluate(() => MC.uiStore.getState().detail || 'simple')) === 'simple', `${d0.length} disclosures, open: ${d0.filter(Boolean).length}`, page);
    await page.click('#app-more');
    await page.waitForSelector('#app-more-menu', { state: 'visible' });
    const menu = await page.evaluate(() => ({ theme: !!document.querySelector('#app-more-menu [aria-label=Theme]'), detail: !!document.getElementById('app-more-detail'), persona: !!document.getElementById('app-more-persona'), reset: !!document.getElementById('app-more-restart'), text: document.getElementById('app-more-menu').innerText.replace(/\s+/g, ' ') }));
    await check('settings: the popover holds theme, detail level, persona, the sample-workspace label and reset', menu.theme && menu.detail && menu.persona && menu.reset && /Detail level/.test(menu.text) && /Sample workspace/.test(menu.text), menu.text.slice(0, 160), page);
    await page.click('#app-more-detail >> text=Detailed');
    await page.waitForTimeout(400);
    const d1 = await dets();
    await check('settings: Detailed opens every advanced disclosure', d1.length === d0.length && d1.every(o => o === true) && (await page.evaluate(() => MC.uiStore.getState().detail)) === 'detailed' && (await page.getAttribute('#app-more-detail [aria-checked=true]', 'id')) !== null, `${d1.filter(Boolean).length} of ${d1.length} open`, page);
    await page.click('#app-more-detail >> text=Simple');
    await page.waitForTimeout(400);
    const d2 = await dets();
    await check('settings: Simple closes them again', d2.every(o => o === false), `${d2.filter(Boolean).length} open`, page);
    await page.click('#app-more-detail >> text=Detailed');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.click('#rail-missions');
    await page.click('.gl-row a');
    await page.waitForSelector('.mr-activity');
    await page.waitForTimeout(300);
    const gd = await page.$$eval('.v-missions details.mc-details', els => els.map(e => e.open));
    await check('settings: the level holds across pages (Goal page disclosures are open in Detailed)', gd.length >= 1 && gd.every(o => o === true), `${gd.length} disclosures on the Goal page`, page);
    await page.evaluate(() => MC.uiStore.set({ detail: 'simple' }));
    await page.waitForTimeout(300);
    const gd2 = await page.$$eval('.v-missions details.mc-details', els => els.map(e => e.open));
    await check('settings: MC.uiStore.set({detail:"simple"}) closes them from code too', gd2.every(o => o === false), `${gd2.filter(Boolean).length} open`, page);
    const errs = w.take();
    await check('settings: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- Home --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    const info = await page.evaluate(() => { const w = MC.store.getState(), live = MC.missions.list(w).filter(m => m.status !== 'stopped');
      return { hero: document.querySelector('.hm-hero').innerText.trim(), h2: [...document.querySelectorAll('.v-home h2')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), asks: MC.metrics.asks(w).count, goals: live.map(m => m.id), rows: [...document.querySelectorAll('.gl-row')].map(r => ({ id: r.dataset.goal, href: r.querySelector('a').getAttribute('href'), t: r.querySelector('a').textContent.trim() })),
        titles: Object.fromEntries(live.map(m => [m.id, m.goalText])), chart: document.querySelectorAll('#hm-rev-h ~ * svg, #hm-rev-h ~ svg, #hm-rev-h ~ div svg').length, newBtn: [...document.querySelectorAll('.hm-head button')].map(b => b.textContent.trim()) }; });
    await check('home: the hero sentence names what the goals have made and the decisions waiting', /^\$[\d.,]+k? from your goals so far/.test(info.hero) && (info.asks ? info.hero.indexOf(info.asks + ' decision') > 0 : /nothing needs your decision/.test(info.hero)), info.hero, page);
    await check('home: Goals, Revenue, Recent agent work and Needs your decision are on the page', ['Goals', 'Revenue this month', 'Recent agent work'].every(h => info.h2.some(x => x.indexOf(h) === 0)) && info.h2.some(x => /^Needs your decision/.test(x)), info.h2.join(' | '), page);
    await check('home: every live goal is a row linking to its goal page', info.rows.length === info.goals.length && info.rows.every(r => r.href === '#missions/' + r.id && r.t === info.titles[r.id]), info.rows.map(r => r.href).join(' '), page);
    await check('home: the revenue chart is drawn', info.chart >= 1, info.chart + ' svg(s)', page);
    const acts = await page.$$eval('.act-list .act-text', els => els.map(e => e.textContent.trim()));
    await check('home: Recent agent work lists plain facts, none in the first person', acts.length >= 1 && !acts.some(t => FIRST_PERSON.test(t)), acts.slice(0, 2).join(' | '), page);
    const dec = await page.evaluate(() => ({ n: +(document.querySelector('.hm-count') || { textContent: '0' }).textContent, asks: document.querySelectorAll('.dec-row[data-ask]').length, props: document.querySelectorAll('.dec-row[data-proposal]').length, mAsks: MC.metrics.asks(MC.store.getState()).missionAsks.length, mProps: MC.metrics.asks(MC.store.getState()).proposals.length }));
    await check('home: "Needs your decision" count is the rail count, with every open goal ask listed', dec.n === info.asks && dec.n === (await askCount(page)) && dec.asks === dec.mAsks && dec.props === Math.min(3, dec.mProps), JSON.stringify(dec), page);
    const before = await askCount(page);
    await page.locator('.dec-row[data-ask] .dec-btn.is-default').first().click();
    await page.waitForTimeout(350);
    await check('home: answering a decision from Home resolves it and the rail count drops', (await askCount(page)) === before - 1 && (await page.locator('.dec-row[data-ask]').count()) === dec.asks - 1, `${before} -> ${await askCount(page)}`, page);
    await page.click('.gl-row a');
    await page.waitForFunction(() => /^#missions\/m-/.test(location.hash), null, { timeout: 5000 }).catch(() => {});
    await check('home: a goal row opens its goal page', (await routeNow(page)) === 'missions' && /^#missions\/m-/.test(await page.evaluate(() => location.hash)) && (await page.locator('.mr-steer').count()) === 1, await page.evaluate(() => location.hash), page);
    const errs = w.take();
    await check('home: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- phone: bottom bar and the Menu sheet --- */
  ctx = await newCtx({ viewport: { width: 390, height: 844 } });
  try {
    const { page, w } = await openApp(ctx, 'home');
    const bar = await page.$$eval('nav.bbar > *', els => els.map(e => ({ id: e.id, name: e.getAttribute('aria-label'), cur: e.getAttribute('aria-current'), label: (e.querySelector('.bbar-label') || {}).textContent, h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })));
    await check('phone 390: the bottom bar holds Home, Goals, Approvals, Results and More; the rail is gone', JSON.stringify(bar.map(b => b.id)) === JSON.stringify(['bbar-home', 'bbar-missions', 'bbar-approvals', 'bbar-analytics', 'app-menu-btn']) && bar.every(b => b.name && b.label) && !(await page.evaluate(() => { const r = document.querySelector('nav.rail'); return !!r && getComputedStyle(r).display !== 'none' && r.getBoundingClientRect().width > 0; })), bar.map(b => b.name).join(' | '), page);
    await check('phone 390: bottom bar targets are at least 44 px and the current page is marked', bar.every(b => b.h >= 44 && b.w >= 44) && bar.filter(b => b.cur === 'page').map(b => b.id).join() === 'bbar-home', bar.map(b => b.w + 'x' + b.h).join(' ') + ' current ' + bar.filter(b => b.cur === 'page').map(b => b.id), page);
    const n = await expectedAsks(page), lab = await page.getAttribute('#bbar-approvals', 'aria-label');
    await check('phone 390: the Approvals item carries the same count', lab === `Approvals, ${n} waiting` && n === (await askCount0(page)), lab + ' vs ' + n, page);
    for (const r of ['missions', 'approvals', 'analytics', 'home']) {
      await page.click('#bbar-' + r);
      await page.waitForFunction(x => MC.uiStore.getState().route === x, r, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.click('#bbar-approvals');
    await page.waitForTimeout(300);
    await check('phone 390: the Approvals page opens from the bar, marked current', (await routeNow(page)) === 'approvals' && (await page.getAttribute('#bbar-approvals', 'aria-current')) === 'page', await routeNow(page), page);
    await page.click('#app-menu-btn');
    await page.waitForSelector('#app-menu-nav-campaigns', { state: 'visible' });
    const sheet = await page.evaluate(() => ({ nav: [...document.querySelectorAll('[id^=app-menu-nav-]')].map(e => e.id.replace('app-menu-nav-', '') + '=' + e.getAttribute('href') + ':' + e.innerText.replace(/\s+/g, ' ').trim()), detail: !!document.getElementById('app-menu-detail'), help: !!document.getElementById('app-menu-take-tour'), reset: !!document.getElementById('app-menu-restart') }));
    await check('phone 390: the Menu sheet lists every section by name, plus Settings and Getting started', RAIL.every(([r, l]) => sheet.nav.some(x => x.indexOf(r + '=#' + (RAIL_HASH[r] || r) + ':' + l) === 0)) && sheet.detail && sheet.help && sheet.reset, sheet.nav.join(' | '), page);
    await page.click('#app-menu-detail >> text=Detailed');
    await page.waitForTimeout(250);
    await check('phone 390: the detail level can be set from the Menu sheet', (await page.evaluate(() => MC.uiStore.getState().detail)) === 'detailed', 'detailed', page);
    await page.click('#app-menu-nav-agents');
    await page.waitForFunction(() => MC.uiStore.getState().route === 'agents', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({ route: MC.uiStore.getState().route, drawer: MC.uiStore.getState().drawer, ov: document.documentElement.scrollWidth <= window.innerWidth + 1, open: [...document.querySelectorAll('details.mc-details')].every(e => e.open) }));
    await check('phone 390: a Menu sheet link opens the page and closes the sheet; Detailed holds', info.route === 'agents' && !info.drawer && info.ov && info.open, JSON.stringify(info), page);
    const errs = w.take();
    await check('phone 390: no console errors on the shell', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}
async function askCount0(page) { return page.evaluate(() => { const m = /(\d+) waiting/.exec(document.getElementById('bbar-approvals').getAttribute('aria-label')); return m ? +m[1] : 0; }); }

/* ============================== 3. Goals: list, Goal page, Steer, Activity, new goals ============================== */
async function secMissions() {
  /* --- the Goals list --- */
  let ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions');
    const seeded = await page.evaluate(() => MC.missions.list(MC.store.getState()).map(m => ({ id: m.id, goal: m.goalText, live: m.status !== 'done' && m.status !== 'stopped' })));
    const rows = await page.$$eval('.gl-row', els => els.map(e => ({ id: e.dataset.goal, t: e.querySelector('.gl-title a').textContent.trim(), href: e.querySelector('.gl-title a').getAttribute('href'), status: e.querySelector('.gl-status').textContent.trim(), num: e.querySelector('.gl-num').textContent.trim() })));
    await check('goals: every seeded goal is a row that links to its goal page', seeded.length >= 2 && seeded.every(s => rows.some(r => r.id === s.id && r.t === s.goal && r.href === '#missions/' + s.id)), rows.map(r => r.t.slice(0, 28) + ' ' + r.href).join(' | '), page);
    await check('goals: each row shows a status and progress against its target', rows.every(r => /(Working|Planning|Tracking results|Needs your decision|Done|Paused|Ended)/.test(r.status) && /\d.* of .*\d/.test(r.num)), rows.map(r => r.status + ' / ' + r.num).join(' | '), page);
    const sent = (await page.innerText('.mr-status')).replace(/\s+/g, ' ');
    const open = await page.evaluate(() => MC.missions.list(MC.store.getState()).reduce((n, m) => n + (m.status === 'done' || m.status === 'stopped' ? 0 : m.asks.filter(a => a.status === 'open').length), 0));
    await check('goals: the page sentence counts goals in progress and decisions that need you', /\d+ goals? in progress/.test(sent) && (open ? sent.indexOf(open + (open === 1 ? ' decision needs you' : ' decisions need you')) > 0 : true), sent, page);
    await page.click('.gl-row[data-goal="' + SEED_BFE + '"] .gl-title a');
    await page.waitForFunction(id => location.hash === '#missions/' + id, SEED_BFE, { timeout: 5000 }).catch(() => {});
    const h1 = (await page.innerText('h1#page-title')).trim();
    await check('goals: a row opens its goal page (h1 is the goal sentence)', h1 === seeded.find(s => s.id === SEED_BFE).goal && /^Goals$/.test((await page.innerText('.mr-crumb a')).trim()), h1, page);
    await page.click('.mr-crumb a');
    await page.waitForSelector('.gl-list');
    await check('goals: the "Goals" crumb returns to the list', (await page.innerText('h1#page-title')).trim() === 'Goals', 'back on the list', page);
    const errs = w.take();
    await check('goals: no console errors on the list', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- the Goal page, an open decision answered in place --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const m0 = await mission(page, SEED_LHW);
    const h1 = (await page.innerText('h1#page-title')).trim();
    await check('goal page: h1 is the goal sentence', h1 === m0.goalText, '"' + h1 + '"', page);
    const status = (await page.innerText('.mr-status')).replace(/\s+/g, ' ').trim();
    await check('goal page: status sentence carries numbers', /\d/.test(status) && /(people|messages|found)/i.test(status) && /[.!]$/.test(status), status, page);
    const meta = (await page.innerText('.mr-meta')).replace(/\s+/g, ' ');
    await check('goal page: deadline, limits and target shown', /Deadline/.test(meta) && /Limits/.test(meta) && /Target/.test(meta) && /\d/.test(meta) && /15%/.test(meta), meta, page);
    const lanes = await page.locator('.mr-lane').count(), blocks = await page.locator('.mr-blk').count();
    await check('goal page: the plan has a lane per agent and a block per step', lanes >= 3 && blocks === m0.plan.length, `${lanes} lanes, ${blocks} blocks, ${m0.plan.length} steps`, page);
    const labels = await page.$$eval('.mr-blk', els => els.map(e => e.getAttribute('aria-label')));
    await check('goal page: each block names its agent, step and state', labels.every(l => /^[^:]+: .+, (done|working|queued|needs your decision|skipped)(\. Weighed \d+ options.*)?$/.test(l)), labels.slice(0, 2).join(' | '), page);
    const wires = await page.locator('.mr-wires path.is-passed').count();
    await check('goal page: finished steps show their hand-offs as passed connections', wires >= 1 && (await page.locator('.mr-blk.s-done').count()) >= 1, wires + ' passed connections', page);
    const panels = await page.$$eval('.mr-art h3', els => els.map(e => e.textContent.trim()));
    await check('goal page: artifact panels Audience, Message, Journey, Budget', JSON.stringify(panels) === JSON.stringify(['Audience', 'Message', 'Journey', 'Budget']), panels.join(','), page);
    const filled = await page.locator('.mr-art:not(.is-wait)').count();
    await check('goal page: artifact panels hold real objects', filled >= 3, filled + ' of 4 filled', page);

    /* Steer + Activity */
    const side = await page.evaluate(() => { const s = document.querySelector('.mr-side'); return { steer: !!s.querySelector('.mr-steer #mr-steer-input'), activity: !!s.querySelector('.mr-activity'), h: [...s.querySelectorAll('h2')].map(e => e.textContent.trim()), label: (document.querySelector('label[for=mr-steer-input]') || {}).textContent, chips: [...s.querySelectorAll('.mr-chips button')].map(b => b.textContent.trim()), send: !!s.querySelector('.mr-send'), thread: document.querySelectorAll('.mr-thread, .mr-compose').length, tabs: document.querySelectorAll('#app-mission-tabs').length }; });
    await check('goal page: the right column is Steer and Activity (no Lead chat, no goal tabs)', side.steer && side.activity && side.send && side.h.join() === 'Steer,Activity' && /Steer this goal/.test(side.label) && side.chips.length >= 3 && side.thread === 0 && side.tabs === 0, JSON.stringify(side), page);
    const act = await page.$$eval('.mr-activity .act-row', els => els.map(e => ({ who: e.querySelector('.act-who').innerText.replace(/\s+/g, ' ').trim(), text: e.querySelector('.act-text').textContent.trim(), cls: e.className })));
    await check('goal page: Activity lists what the agents did, as facts with who and when', act.length >= 3 && act.every(a => a.text.length > 3 && /\S/.test(a.who)), `${act.length} rows; ${act.slice(0, 2).map(a => a.who + ': ' + a.text.slice(0, 40)).join(' | ')}`, page);
    const voice = await page.evaluate(() => { const bad = []; MC.missions.list(MC.store.getState()).forEach(m => MC.goalUi.factsOf(m).forEach(f => { if (f.agentId !== 'you' && /\b(I'll|I’ll|I'm|I’m|I've|I’ve|I will|I am)\b|\bGot it\b/.test(f.text)) bad.push(m.id + ': ' + f.text.slice(0, 60)); })); return bad; });
    await check('goal page: Activity is impersonal past-tense facts (no "I\'ll", "I\'m", "Got it") for every goal', !act.some(a => FIRST_PERSON.test(a.text)) && !voice.length, voice.join(' | ') || `${act.length} rows clean`, page);
    const newest = await page.evaluate(id => { const f = MC.goalUi.factsOf(MC.store.getState().missions.byId[id]), top = Math.max.apply(null, f.map(x => x.tick)); return f.filter(x => x.tick === top).map(x => x.text); }, SEED_LHW);
    await check('goal page: Activity is newest first', newest.indexOf(act[0].text) >= 0, act[0].text.slice(0, 80), page);
    const errsA = w.take();

    /* ask on the page */
    await page.waitForSelector('.mr-ask');
    const ask0 = m0.asks.find(a => a.status === 'open'), blocked0 = m0.plan.filter(s => s.status === 'blocked');
    const q = (await page.innerText('.mr-ask h2')).trim();
    await check('goal page: an open decision shows its question, why and options', !!ask0 && q === ask0.question && (await page.locator('.mr-ask details').count()) === 1 && (await page.locator('.mr-ask-btn').count()) === ask0.options.length && m0.status === 'waiting' && blocked0.length >= 1,
      `status ${m0.status}; "${q.slice(0, 60)}"; blocked ${blocked0.map(s => s.id)}`, page);
    await check('goal page: the page offers "Review decision" while one is open', /Review decision/.test(await page.innerText('.mr-goal')), 'primary action', page);
    const before = await askCount(page), logN = m0.log.length;
    await page.locator('.mr-ask-btn.go').click();
    await page.waitForTimeout(300);
    const m1 = await mission(page, SEED_LHW), a1 = m1.asks.find(a => a.id === ask0.id);
    await check('goal page: answering records the answer and resumes the goal', a1.status === 'answered' && a1.answer === ask0.default && m1.status !== 'waiting' && m1.plan.every(s => s.status !== 'blocked'),
      `ask ${a1.status} "${a1.answer}", goal ${m1.status}, steps ${steps(m1)}`, page);
    await check('goal page: the decision card goes and the Approvals count drops by one', (await page.locator('.mr-ask').count()) === 0 && (await askCount(page)) === before - 1, `Approvals ${before} -> ${await askCount(page)}`, page);
    const rowsAfter = await page.$$eval('.mr-activity .act-text', els => els.map(e => e.textContent.trim()));
    await check('goal page: Activity keeps the question that was asked and logs what happened next', m1.log.length > logN && rowsAfter.some(t => t.indexOf('Asked you: ' + ask0.question.slice(0, 20)) === 0), `${logN} -> ${m1.log.length} entries; ${rowsAfter.length} rows`, page);
    const bid = blocked0[0].id;
    const ran = await pulse(page, 40);
    const m2 = await mission(page, SEED_LHW);
    await check('goal page: the unblocked step runs and finishes on the work pulse', m2.plan.find(s => s.id === bid).status === 'done', `${bid}: ${m2.plan.find(s => s.id === bid).status} after ${ran} pulses`, page);
    const blk = await page.locator('.mr-blk.s-done').count();
    await check('goal page: the plan shows the step done without a reload', blk === m2.plan.filter(s => s.status === 'done').length && blk > m0.plan.filter(s => s.status === 'done').length, `${blk} done blocks`, page);
    const errs = errsA.concat(w.take());
    await check('goal page: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- steering through the Steer box --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const m0 = await mission(page, SEED_LHW), n0 = m0.plan.length;
    await check('steer: the Steer button waits for words', await page.locator('.mr-send').isDisabled(), 'disabled while empty', page);
    await page.click('.mr-chips button:has-text("Skip SMS")');
    await check('steer: a chip fills the box', (await page.inputValue('#mr-steer-input')) === 'Skip SMS', await page.inputValue('#mr-steer-input'), page);
    await page.fill('#mr-steer-input', 'skip SMS');
    await page.click('.mr-send');
    await page.waitForTimeout(350);
    const m1 = await mission(page, SEED_LHW);
    const replan = m1.log.filter(b => b.kind === 'replan' && b.agentId === 'lead' && /SMS/.test(b.text));
    await check('steer: "skip SMS" is recorded and the Planner re-plans with a visible fact', m1.steers.length === 1 && m1.steers[0].text === 'skip SMS' && replan.length >= 1, `steers ${m1.steers.length}, replan facts ${replan.map(b => b.text.slice(0, 60))}`, page);
    await check('steer: the limit is added to the goal', m1.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && /sms/i.test((await page.innerText('.mr-meta'))), JSON.stringify(m1.objective.constraints), page);
    const rows = await page.$$eval('.mr-activity .act-row', els => els.map(e => e.querySelector('.act-who').innerText.replace(/\s+/g, ' ').trim() + '|' + e.querySelector('.act-text').textContent.trim()));
    await check('steer: Activity shows "You steered: skip SMS" and the Planner\'s fact, in plain voice', rows.some(r => /^You\b.*\|You steered: skip SMS$/.test(r)) && rows.some(r => /^Planner\b.*\|.*SMS/.test(r)) && !rows.some(r => FIRST_PERSON.test(r)), rows.slice(0, 2).join(' || '), page);
    await check('steer: the box is cleared after sending', (await page.inputValue('#mr-steer-input')) === '', 'empty', page);
    await check('steer: the plan gains steps that take SMS out', m1.plan.length > n0 && m1.plan.slice(n0).some(s => /SMS/.test(s.title)) && (await page.locator('.mr-blk').count()) === m1.plan.length, `${n0} -> ${m1.plan.length} steps: ${m1.plan.slice(n0).map(s => s.title)}`, page);
    await pulse(page, 40);
    const m2 = await mission(page, SEED_LHW);
    const remaining = m2.plan.filter(s => s.status === 'queued' || s.status === 'working' || s.status === 'blocked');
    const smsLeft = remaining.filter(s => /SMS/i.test(s.title + ' ' + (s.note || '')));
    const sched = await page.evaluate(id => { const w = MC.store.getState(), m = w.missions.byId[id], c = w.campaigns.byId[m.artifacts.find(a => a.kind === 'campaign').id];
      return { sms: c.budget.byChannel.sms || 0, vs: MC.catalog.variantsOf(w, c.id).filter(v => v.channel === 'sms' && v.status !== 'retired' && v.status !== 'paused').length }; }, SEED_LHW);
    await check('steer: SMS is gone from what remains (no SMS step left, no SMS budget)', m2.plan.slice(n0).every(s => s.status === 'done') && !smsLeft.length && sched.sms === 0, `remaining ${remaining.map(s => s.title)}; sms budget ${sched.sms}; live sms variants ${sched.vs}`, page);
    const acts = await page.$$eval('.mr-activity .act-text', els => els.map(e => e.textContent.trim()));
    await check('steer: Activity reports taking SMS out', acts.some(t => /SMS/.test(t) && !/^You steered/.test(t)), acts.slice(0, 2).join(' || '), page);
    const errs = w.take();
    await check('steer: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- a new goal from the New goal drawer, run on the work pulse without a reload --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions');
    await page.evaluate(() => { window.__noReload = 'same-page'; });
    const goal = 'Grow Trail runners by 300 sign-ups by Dec 20 with no SMS';
    const before = await page.evaluate(() => MC.missions.list(MC.store.getState()).length);
    await page.click('#app-new-goal');
    await page.waitForSelector('#goal-drawer #app-goal-text', { state: 'visible' });
    await page.fill('#app-goal-text', goal);
    await page.click('#app-goal-go');
    await page.waitForFunction(g => MC.missions.list(MC.store.getState()).some(m => m.goalText === g), goal, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const list = await page.evaluate(() => MC.missions.list(MC.store.getState()).map(m => m.id));
    const nm = await page.evaluate(g => { const m = MC.missions.list(MC.store.getState()).find(m => m.goalText === g); return m ? JSON.parse(JSON.stringify(m)) : null; }, goal);
    await check('new goal: the goal is created', !!nm && list.length === before + 1, nm ? nm.id + ' ' + nm.status : 'missing', page);
    if (!nm) return;
    await check('new goal: the drawer closes and the new goal page opens', (await page.locator('#goal-drawer').isVisible().catch(() => false)) === false && /#missions\/m-/.test(await page.evaluate(() => location.hash)) && (await page.innerText('h1#page-title')).trim() === goal, await page.evaluate(() => location.hash), page);
    await check('new goal: the goal was understood (sign-ups, 300, no SMS)', nm.objective.metric === 'signups' && nm.objective.target === 300 && nm.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && nm.brain === 'rules',
      JSON.stringify({ metric: nm.objective.metric, target: nm.objective.target, cons: nm.objective.constraints, brain: nm.brain }), page);
    const seen = new Set(nm.plan.map(s => s.status));
    const hist = [nm.plan.map(s => s.status[0]).join('')];
    const startedQueued = nm.plan.every(s => s.status === 'queued');
    let fin = null, answeredAsks = 0;
    for (let i = 0; i < 80; i++) {
      await page.evaluate(() => MC.engine.pulse());
      await page.waitForTimeout(60);
      const m = await mission(page, nm.id);
      m.plan.forEach(s => seen.add(s.status));
      hist.push(m.plan.map(s => s.status[0]).join(''));
      const open = m.asks.filter(a => a.status === 'open');
      if (open.length) { await page.locator('.mr-ask-btn.go').first().click().catch(() => {}); answeredAsks++; await page.waitForTimeout(200); }
      if (m.plan.every(s => s.status === 'done' || s.status === 'skipped')) { fin = m; break; }
    }
    await check('new goal: steps start queued and finish level by level on the work pulse (independent steps together)', startedQueued && seen.has('done') && !!fin && hist.length - 1 <= nm.plan.length * 2 + 2, `start ${hist[0]} ... end ${hist[hist.length - 1]} after ${hist.length - 1} pulses; statuses ${[...seen]}`, page);
    if (fin) {
      const blocks = await page.locator('.mr-blk.s-done').count();
      await check('new goal: the page shows every step done, with artifacts made', blocks === fin.plan.length && fin.artifacts.length >= 1, `${blocks}/${fin.plan.length} done blocks; artifacts ${JSON.stringify(fin.artifacts)}; asks answered ${answeredAsks}`, page);
      const acts = await page.$$eval('.mr-activity .act-text', els => els.map(e => e.textContent.trim()));
      await check('new goal: its Activity reads as facts ("Plan created") and not as chat', acts.length >= 3 && !acts.some(t => FIRST_PERSON.test(t)), acts.slice(-2).join(' | '), page);
    }
    await check('new goal: no page reload happened', (await page.evaluate(() => window.__noReload)) === 'same-page', 'marker kept');
    await page.click('#rail-missions');
    await page.waitForSelector('.gl-list');
    const row = await page.$$eval('.gl-row', (els, id) => els.filter(e => e.dataset.goal === id).map(e => ({ t: e.querySelector('.gl-title a').textContent.trim(), h: e.querySelector('.gl-title a').getAttribute('href') })), nm.id);
    await check('new goal: it appears as a row on the Goals list, linking to its page', row.length === 1 && row[0].t === goal && row[0].h === '#missions/' + nm.id, JSON.stringify(row), page);
    const errs = w.take();
    await check('new goal: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 4. Approvals ============================== */
async function secAsks() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    const n = await askCount(page), exp = await expectedAsks(page);
    const sel = await page.evaluate(() => MC.metrics.asks(MC.store.getState()).missionAsks.length);
    const props = await page.evaluate(() => MC.metrics.asks(MC.store.getState()).proposals.length);
    await check('approvals: the rail count = open goal asks + pending proposals', n === exp && n === sel + props, `rail ${n}, goal asks ${sel}, proposals ${props}`, page);
    await check('approvals: the count is shown as a badge', (await page.innerText('#rail-approvals .rail-badge')).trim() === String(n), (await page.innerText('#rail-approvals')).replace(/\s+/g, ' '), page);
    await page.click('#rail-approvals');
    await page.waitForSelector('.app-approvals-page .app-asks');
    const h1 = (await page.innerText('h1#page-title')).trim(), lede = (await page.innerText('.app-page-lede')).replace(/\s+/g, ' ');
    await check('approvals: the page opens (h1 Approvals) and its sentence states the waiting count', h1 === 'Approvals' && lede.indexOf(n + (n === 1 ? ' decision is' : ' decisions are') + ' waiting') === 0 && (await routeNow(page)) === 'approvals', lede.slice(0, 80), page);
    const pg = page.locator('.app-approvals-page');
    const cards = await pg.locator('.app-ask').count();
    await check('approvals: the page lists every open goal ask with Why and impact', cards === sel && cards >= 1 && (await pg.locator('.app-ask .app-ask-why').count()) === cards, `${cards} ask cards, ${sel} open`, page);
    const pc = await pg.locator('.app-asks article:not(.app-ask)').count();
    await check('approvals: the page lists the pending proposals', pc === props || pc >= Math.min(props, 30), `${pc} proposal cards, ${props} pending`, page);
    await check('approvals: the page count matches the rail', cards + props === n, `${cards} + ${props} = ${cards + props}, rail ${n}`, page);
    const groups = await pg.locator('.app-asks-mission').evaluateAll(els => els.map(e => ({ id: e.dataset.mission, h: e.querySelector('h3 a').innerText, href: e.querySelector('h3 a').getAttribute('href') })));
    const liveIds = await page.evaluate(() => MC.missions.list(MC.store.getState()).filter(m => m.status !== 'done' && m.status !== 'stopped').map(m => m.id));
    await check('approvals: asks and proposals are grouped under the goal they belong to, each linking to its page', groups.length >= 1 && groups.every(g => liveIds.indexOf(g.id) >= 0 && g.h.length > 10 && g.href === '#missions/' + g.id), groups.map(g => g.id + ' ' + g.href).join(' | '), page);
    const card = pg.locator('.app-ask').first();
    const goal = (await card.locator('.app-ask-from').innerText()).trim();
    const def = await card.locator('.app-ask-btn.is-default').innerText();
    await card.locator('.app-ask-btn.is-default').click();
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({ open: MC.select.missionAsks(MC.store.getState()).length, ans: MC.missions.list(MC.store.getState()).flatMap(m => m.asks.filter(a => a.status === 'answered').map(a => m.id + ':' + a.id + '=' + a.answer)) }));
    await check('approvals: answering from the page resolves the ask', st.open === sel - 1 && st.ans.some(x => x.indexOf(SEED_LHW + ':') === 0) && (await askCount(page)) === n - 1, `open ${sel} -> ${st.open}; answered ${st.ans}; default "${def.replace(/\s*\(default\)/, '')}" on "${goal.slice(0, 40)}"`, page);
    const left = await pg.locator('.app-ask').count();
    await check('approvals: the page shows the quiet state when no goal is waiting', left === sel - 1 && (sel > 1 || /No goal needs a decision from you/.test(await pg.innerText())), left + ' cards left', page);
    const lede2 = (await page.innerText('.app-page-lede')).replace(/\s+/g, ' ');
    await check('approvals: the page sentence follows the new count', lede2.indexOf(String(n - 1)) === 0 || (n - 1 === 0 && /Nothing is waiting/.test(lede2)), lede2.slice(0, 80), page);
    await page.evaluate(id => MC.nav.go('missions', id), SEED_LHW);
    await page.waitForSelector('h1#page-title');
    await page.waitForTimeout(300);
    await check('approvals: the goal page reflects the answer', (await page.locator('.mr-ask').count()) === 0, 'decision card gone', page);
    await pulse(page, 40);
    const m = await mission(page, SEED_LHW);
    await check('approvals: the goal moves on after an answer given on the Approvals page', m.status !== 'waiting' && m.plan.every(s => s.status !== 'blocked'), `${m.status} ${steps(m)}`, page);
    const errs = w.take();
    await check('approvals: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 5. Agents ============================== */
async function secTeam() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'team');
    await page.waitForSelector('.tm-row');
    const h1 = (await page.innerText('h1#page-title')).trim();
    const rows = await page.$$eval('.tm-row', els => els.map(e => ({ id: e.id.replace('agents-row-', ''), name: e.querySelector('.tm-h').textContent.trim(), now: e.querySelector('.tm-now-text').textContent.trim(), state: e.querySelector('.tm-state').textContent.trim(),
      toggle: !!e.querySelector('.tm-settings-wrap details.mc-details > summary'), link: !!e.querySelector('.tm-on a[href^="#missions/"]') })));
    await check('team: nine agents listed on the Agents page', h1 === 'Agents' && rows.length === 9 && new Set(rows.map(r => r.id)).size === 9, rows.map(r => r.name).join(', '), page);
    await check('team: the Planner is the plan-maker\'s name in copy (no "Lead")', rows.some(r => r.name === 'Planner') && !rows.some(r => /\bLead\b/.test(r.name)), rows.map(r => r.name).join(', '), page);
    await check('team: each agent shows what it is doing right now', rows.every(r => r.now.length > 3 && r.state.length > 1), rows.map(r => r.id + ': ' + r.now.slice(0, 28)).join(' | '), page);
    await check('team: working agents link to their goal', rows.some(r => r.link), rows.filter(r => r.link).map(r => r.id).join(','), page);
    await check('team: every agent has a settings disclosure', rows.every(r => r.toggle), rows.filter(r => !r.toggle).map(r => r.id).join(',') || 'all nine', page);
    const id = 'scout', row = page.locator('#agents-row-' + id), det = row.locator('details.mc-details').first();
    await check('team: settings start closed (Simple)', (await det.evaluate(e => e.open)) === false && !(await page.locator('#agents-' + id + '-reasoning').isVisible().catch(() => false)), 'collapsed', page);
    await det.locator('summary').click();
    await page.waitForSelector('#agents-' + id + '-reasoning', { state: 'visible' });
    await check('team: settings open on click', (await det.evaluate(e => e.open)) === true, 'expanded', page);
    for (const mode of ['rules', 'auto']) {
      const r = page.locator('#agents-' + id + '-reasoning [role=radio]').nth(mode === 'rules' ? 1 : 0);
      if (!(await r.count())) { await fail('team: reasoning ' + mode, 'radio in #agents-' + id + '-reasoning not found', page); continue; }
      await r.click();
      await page.waitForTimeout(250);
      const aiMode = await ws(page, (w, id) => w.agents.byId[id].aiMode || 'auto', id);
      const checked = await r.getAttribute('aria-checked');
      await check('team: reasoning setting -> ' + mode, aiMode === mode && checked === 'true', `state aiMode ${aiMode}, radio aria-checked ${checked}`, page);
    }
    await det.locator('summary').click();
    await check('team: settings close again', (await det.evaluate(e => e.open)) === false, 'collapsed', page);
    const errs = w.take();
    await check('team: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 6. Artifacts (Campaigns, Audiences, Content, Results from the rail) ============================== */
async function secArtifacts() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'home');
    for (const [route, h1re] of [['campaigns', /^Campaigns/], ['audiences', /^Audiences/], ['content', /^Content/], ['analytics', /^Results/]]) {
      await page.click('#rail-' + route);
      await page.waitForFunction(re => (document.getElementById('page-title') || { textContent: '' }).textContent.trim().match(new RegExp(re)), h1re.source, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({ h1: document.querySelectorAll('h1#page-title').length, t: document.getElementById('page-title').textContent.trim(), hash: location.hash, len: document.getElementById('app-main').innerText.length, on: [...document.querySelectorAll('nav.rail [aria-current=page]')].map(e => e.id).join(), route: MC.uiStore.getState().route }));
      const errs = w.take();
      await check('artifacts: ' + route + ' loads from the rail', h1re.test(info.t) && info.hash === '#' + route && info.len > 200 && info.on === 'rail-' + route && !errs.length, `h1 "${info.t.slice(0, 30)}", ${info.len} chars, current ${info.on}${errs.length ? '; ' + errs.join(' / ') : ''}`, page);
    }

    /* a goal-made campaign and audience link back to their goal */
    const made = await page.evaluate(() => { const m = MC.store.getState().missions.byId['m-lhw']; return { c: (m.artifacts.find(a => a.kind === 'campaign') || {}).id, s: (m.artifacts.find(a => a.kind === 'segment') || {}).id, goal: m.goalText }; });
    await check('artifacts: the seeded goal has made a campaign and an audience', !!made.c && !!made.s, JSON.stringify(made), page);
    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id }), made.c);
    await page.waitForSelector('.cm-xref', { timeout: 8000 }).catch(() => {});
    const xm = await page.$$eval('.cm-xref a[data-xref^="mission:"]', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.getAttribute('href'), all: e.closest('.cm-xref').textContent })));
    await check('artifacts: a goal-made campaign names its goal (link to #missions/<id>) and the agent that made it', xm.length === 1 && xm[0].h === '#missions/' + SEED_LHW && made.goal.indexOf(xm[0].t.replace(/…$/, '')) === 0 && /made by/.test(xm[0].all), JSON.stringify(xm), page);
    let mb;
    await page.evaluate(id => MC.nav.go('audiences', { tab: 'segments', segmentId: id }), made.s);
    await page.waitForSelector('.v-audiences a[data-xref^="mission:"]', { timeout: 8000 }).catch(() => {});
    mb = await page.$$eval('.v-audiences a[data-xref^="mission:"]', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.getAttribute('href') })));
    await check('artifacts: a goal-made audience names its goal and links back', mb.length >= 1 && mb[0].h === '#missions/' + SEED_LHW, JSON.stringify(mb), page);
    if (mb.length) {
      await page.click('.v-audiences a[data-xref^="mission:"]');
      await page.waitForFunction(g => (document.getElementById('page-title') || { textContent: '' }).textContent.trim() === g, made.goal, { timeout: 8000 }).catch(() => {});
      await check('artifacts: the back-link opens the goal page', (await page.evaluate(() => location.hash)) === '#missions/' + SEED_LHW && (await page.innerText('h1#page-title')).trim() === made.goal, await page.evaluate(() => location.hash), page);
    }
    /* a hand-made object has no back-link */
    await page.evaluate(() => MC.nav.go('campaigns', { mode: 'detail', id: 'c-hgg' }));
    await page.waitForFunction(() => /Holiday/.test((document.getElementById('page-title') || { textContent: '' }).textContent), null, { timeout: 8000 }).catch(() => {});
    const own = await page.evaluate(() => { const w = MC.store.getState(); return { has: w.missions.order.some(id => w.missions.byId[id].artifacts.some(a => a.kind === 'campaign' && a.id === 'c-hgg')), n: document.querySelectorAll('.mc-madeby, a[data-xref^="mission:"]').length, t: document.getElementById('page-title').textContent.trim() }; });
    await check('artifacts: an object no goal made shows no "Made by"', own.has ? true : own.n === 0, `made by a goal: ${own.has}; back-links shown: ${own.n}; "${own.t.slice(0, 30)}"`, page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ---- stubbed Anthropic (shared by the connect group) ---- */
function makeStub(state) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': '*' };
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
    // Key verification is a model lookup (GET /v1/models/<id>).
    if (req.method() === 'GET' && /\/v1\/models\//.test(req.url())) return send(200, { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' });
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
    if (props.includes('template')) return send(200, msg({ template: 'grow', metric: 'signups', target: 300, byInDays: 23, audience: 'trail runners', segmentId: '',
      constraints: [{ kind: 'excludeChannel', value: 'sms' }],
      steps: [{ kind: 'goal', title: 'Confirm the goal and limits', after: [] }, { kind: 'audience', title: 'Find the trail runners', after: [1] }, { kind: 'campaign', title: 'Draft the sign-up campaign', after: [2] },
        { kind: 'copy', title: 'Write the messages', after: [3] }, { kind: 'guard', title: 'Rest over-messaged people', after: [3] }, { kind: 'sendtime', title: 'Choose send times', after: [3] },
        { kind: 'pacer', title: 'Split the budget', after: [3] }, { kind: 'handoff', title: 'Hand over for sign-off', after: [4, 5, 6, 7] }, { kind: 'monitor', title: 'Track sign-ups daily', after: [8] }] }));
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
const stored = page => page.evaluate(() => ({ s: MC.ai.state(), l: localStorage.getItem('mc.ai.key'), se: sessionStorage.getItem('mc.ai.key') }));
async function newGoalViaDrawer(page, goal) {
  await page.click('#app-new-goal');
  await page.waitForSelector('#goal-drawer #app-goal-text', { state: 'visible' });
  await page.fill('#app-goal-text', goal);
  await page.click('#app-goal-go');
  await page.waitForFunction(g => MC.missions.list(MC.store.getState()).some(m => m.goalText === g), goal, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page.evaluate(g => { const m = MC.missions.list(MC.store.getState()).find(m => m.goalText === g); return m ? JSON.parse(JSON.stringify(m)) : null; }, goal);
}

/* ============================== 6. Connect (stubbed Anthropic) ============================== */
async function secConnect() {
  const st = { mode: 'ok', calls: 0, keys: [], kinds: [] };
  let ctx = await newCtx({ stub: makeStub(st) });
  try {
    const { page, w } = await openApp(ctx, 'home');
    const key = 'sk-ant-test-e2e-key-000000000001';
    const off0 = await page.evaluate(() => MC.ai.state());
    await check('connect: starts off with no key stored', off0 === 'off' && (await page.evaluate(() => localStorage.getItem('mc.ai.key') === null && sessionStorage.getItem('mc.ai.key') === null)), 'state ' + off0, page);
    await connectVia(page, key);
    const on = await page.waitForFunction(() => MC.ai.state() === 'on', null, { timeout: 10000 }).then(() => true, () => false);
    await check('connect: a good key (stubbed Haiku) turns Claude on', on, 'state ' + await page.evaluate(() => MC.ai.state()) + ', calls ' + st.calls, page);
    if (on) {
      const s = await page.evaluate(() => localStorage.getItem('mc.ai.key') || sessionStorage.getItem('mc.ai.key'));
      await check('connect: key stored in the browser and sent in x-api-key', s === key && st.keys[0] === key, 'stored ' + (s ? 'yes' : 'no') + ', header ' + (st.keys[0] === key));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const lbl = await page.getAttribute('#app-connect-btn', 'aria-label');
      await check('connect: the rail button shows connected', /connected/i.test(lbl) && !!(await page.locator('#app-connect-btn .rail-dot').count()), lbl, page);

      const goal = 'Grow Trail runners by 300 sign-ups by Dec 20 with no SMS';
      const nm = await newGoalViaDrawer(page, goal);
      await check('connect: a goal created while connected records brain "claude"', !!nm && nm.brain === 'claude' && st.kinds.some(k => k.includes('template')), nm ? `brain ${nm.brain}, plan "${nm.plan.map(s => s.title).slice(0, 3).join(' / ')}", stub kinds [${st.kinds.slice(0, 3).join(' | ')}]` : 'mission missing', page);
      if (nm) {
        await check('connect: the Claude plan is the one on the board', nm.plan.length === 9 && nm.plan[1].title === 'Find the trail runners' && (await page.locator('.mr-blk').count()) === 9 && nm.objective.constraints.some(c => c.kind === 'excludeChannel'), nm.plan.length + ' steps', page);
        await page.evaluate(() => MC.engine.setSpeed('pause'));
        let done = false;
        for (let i = 0; i < 60 && !done; i++) { await pulse(page, 40); await page.waitForFunction(() => MC.runtime.awaiting(MC.store.getState()).length === 0, null, { timeout: 8000 }).catch(() => {}); const m = await mission(page, nm.id); done = m.plan.every(s => s.status === 'done' || s.status === 'skipped'); const o = m.asks.filter(a => a.status === 'open'); if (o.length) await page.locator('.mr-ask-btn.go').first().click().catch(() => {}); }
        await check('connect: the Claude-planned goal runs to done on the work pulse', done, steps(await mission(page, nm.id)), page);
        const still = await mission(page, nm.id);
        await check('connect: the goal keeps its brain after running', still.brain === 'claude', still.brain);
      }
      /* disconnect */
      await page.click('#app-connect-btn');
      await page.waitForSelector('#connect-disconnect', { state: 'visible' });
      await page.click('#connect-disconnect');
      await page.waitForFunction(() => MC.ai.state() === 'off', null, { timeout: 5000 }).catch(() => {});
      const d = await stored(page);
      await check('connect: disconnect clears storage and state', d.s === 'off' && d.l === null && d.se === null, JSON.stringify(d), page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const nm2 = await newGoalViaDrawer(page, 'Win back 200 lapsed campers by Dec 18 without discounting more than 10%');
      await check('connect: a goal created after disconnecting records brain "rules"', !!nm2 && nm2.brain === 'rules', nm2 ? 'brain ' + nm2.brain : 'mission missing', page);
    }
    const errs = w.take().filter(e => !/Failed to load resource/.test(e));
    await check('connect: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* rejected key */
  const st2 = { mode: '401', calls: 0, keys: [], kinds: [] };
  ctx = await newCtx({ stub: makeStub(st2) });
  try {
    const { page } = await openApp(ctx, 'home');
    await connectVia(page, 'sk-ant-test-e2e-key-bad');
    const shown = await page.waitForFunction(() => /That key didn['’]t work/.test((document.getElementById('connect-msg') || { innerText: '' }).innerText), null, { timeout: 8000 }).then(() => true, () => false);
    const d = await stored(page);
    await check('connect: 401 shows "That key didn’t work"', shown, shown ? 'message shown' : 'message missing; state ' + d.s, page);
    await check('connect: 401 leaves Claude off and stores nothing', d.s !== 'on' && d.l === null && d.se === null, JSON.stringify(d), page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const nm = await newGoalViaDrawer(page, 'Win back 200 lapsed campers by Dec 18 without discounting more than 10%');
    await check('connect: a goal created after a rejected key records brain "rules"', !!nm && nm.brain === 'rules', nm ? 'brain ' + nm.brain : 'mission missing', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 7. No theatre ============================== */
async function secNoTheatre() {
  const PLAYBACK = /\b(pause|replay|play|skip|rewind|fast[- ]forward|speed)\b/i, COUNTDOWN = /\b(in \d+\s*(s|sec|secs|seconds)|\d+\s*(s|sec|seconds) (left|remaining)|countdown|starts in|auto[- ]?(approv|default|proceed)\w* in)\b/i;
  const ctx = await newCtx();
  try {
    const { page } = await openApp(ctx, 'missions/' + SEED_LHW);
    /* the Steer chips ("Skip SMS", "Pause until Monday") and the Steer box are things you tell the Planner, not playback controls */
    const scan = () => page.evaluate(() => {
      const ok = e => !e.closest('.mr-chips, .mr-steer') && !e.classList.contains('app-skip');   // the "Skip to content" link is keyboard navigation, not playback
      const nameOf = e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('placeholder') || e.value || '').replace(/\s+/g, ' ').trim();
      const els = [...document.querySelectorAll('button, a, summary, input, select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem], [aria-label]')].filter(ok);
      return { names: els.map(e => ({ n: nameOf(e), tag: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') })),
        text: [...document.querySelectorAll('#app-main, header, nav, [role=banner]')].map(e => e.innerText).join('\n'), media: document.querySelectorAll('video, audio, progress, [role=progressbar], [role=slider]').length };
    });
    let s = await scan();
    let bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: no play/pause/replay/skip controls in the rail, the goal page or the Activity log', !bad.length, bad.length ? bad.slice(0, 4).map(x => x.tag + ' "' + x.n.slice(0, 40) + '"').join(', ') : `${s.names.length} controls checked`, page);
    await check('no-theatre: no countdown text on the goal page', !COUNTDOWN.test(s.text), (s.text.match(COUNTDOWN) || ['none'])[0], page);
    await check('no-theatre: no playheads, scrubbers or progress widgets', s.media === 0, s.media + ' found', page);
    /* the room still moves only because the engine moves: nothing changes with the clock alone */
    const h0 = await page.evaluate(() => JSON.stringify(MC.store.getState().missions));
    await page.waitForTimeout(2500);
    const h1 = await page.evaluate(() => JSON.stringify(MC.store.getState().missions));
    await check('no-theatre: a paused engine leaves the goals untouched (no timers moving things)', h0 === h1, h0 === h1 ? 'unchanged over 2.5 s' : 'goals changed with the engine paused', page);
    /* the rail, its Settings and Help popovers and the Approvals page are chrome too */
    await page.click('#app-more');
    await page.waitForSelector('#app-more-menu', { state: 'visible' });
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: nothing in the Settings popover is a playback control', !bad.length, bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.keyboard.press('Escape');
    await page.click('#app-help');
    await page.waitForSelector('#app-help-menu', { state: 'visible' });
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: nothing in the Help popover is a playback control', !bad.length, bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.keyboard.press('Escape');
    await page.click('#rail-approvals');
    await page.waitForSelector('.app-approvals-page .app-asks');
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: nothing on the Approvals page is a playback control or countdown', !bad.length && !COUNTDOWN.test(s.text), bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.evaluate(() => { location.hash = '#home'; });
    await page.waitForSelector('.v-home');
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: Home has no playback controls, countdowns or progress widgets', !bad.length && !COUNTDOWN.test(s.text) && s.media === 0, bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 8. Determinism ============================== */
async function secDeterminism() {
  const snaps = [], pages = [], ctxs = [];
  try {
    for (let i = 0; i < 2; i++) {
      const ctx = await newCtx(); ctxs.push(ctx);
      const { page } = await openApp(ctx, 'missions/' + SEED_LHW);
      pages.push(page);
    }
    /* same world hour on both, then the same answer, the same work pulses and the same hours */
    const ticks = await Promise.all(pages.map(p => p.evaluate(() => MC.store.getState().meta.tick)));
    const hi = Math.max(...ticks);
    for (let i = 0; i < 2; i++) if (ticks[i] < hi) await tick(pages[i], hi - ticks[i]);
    const snap = p => p.evaluate(() => { const w = MC.store.getState(); return JSON.stringify({ tick: w.meta.tick, missions: MC.select.missions(w).map(m => ({ id: m.id, status: m.status, phase: m.phase, progress: m.progress, steps: m.steps, asks: m.openAsks })), asks: MC.select.missionAsks(w).length, open: w.proposals.open.length }); });
    for (const p of pages) snaps.push(await snap(p));
    await check('determinism: same date -> same MC.select.missions(world) progress values', snaps[0] === snaps[1] && /"value":\d/.test(snaps[0]), snaps[0] === snaps[1] ? (JSON.parse(snaps[0]).missions.map(m => m.id + ' ' + m.progress.value + '/' + m.progress.target).join(', ')) : 'load 1 ' + snaps[0].slice(0, 160) + ' vs load 2 ' + snaps[1].slice(0, 160), pages[0]);
    for (const p of pages) { await p.locator('.mr-ask-btn.go').first().click().catch(() => {}); await pulse(p, 40); await tick(p, 15); }
    const after = [];
    for (const p of pages) after.push(await snap(p));
    await check('determinism: same answer, the work pulses and 15 hours later -> same goal state', after[0] === after[1] && after[0] !== snaps[0], after[0] === after[1] ? 'identical at tick ' + JSON.parse(after[0]).tick : 'diverged: ' + after[0].slice(0, 160) + ' vs ' + after[1].slice(0, 160), pages[0]);
  } finally { for (const p of pages) await p.close().catch(() => {}); for (const c of ctxs) await closeCtx(c); }
}


/* ============================== 7. Consistency: verdict, decisions, steering, search, cross-links ============================== */
const routeNow = page => page.evaluate(() => MC.uiStore.getState().route);
const parseMoney = t => { const m = /\$\s*([\d,.]+)\s*([kKmM]?)/.exec(t || ''); if (!m) return NaN; return parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] || 1); };
async function secConsistency() {
  /* --- the room: forecast verdict, what the agent weighed --- */
  let ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const v = (await page.innerText('.mr-verdict')).replace(/\s+/g, ' ').trim();
    const mm = await page.evaluate(id => { const x = MC.metrics.mission(MC.store.getState(), id); return { forecast: x.forecast, lo: x.lo, hi: x.hi, target: x.target, band: x.band }; }, SEED_LHW);
    await check('verdict: forecast sits beside the goal with a state, a forecast out of the target, a range and the deadline',
      /Forecast (On pace for|Ahead of pace for|Behind pace:|Too early to call:)/.test(v) && /\d+ of \d+/.test(v) && (mm.band === 'early' || /\(\d[\d,.k$]* to \$?\d[\d,.k]*\)/.test(v)) && /by (Mon|Tue|Wed|Thu|Fri|Sat|Sun|[A-Z][a-z]{2})/.test(v) && v.indexOf(String(Math.round(mm.target))) > 0,
      v + ' | ' + JSON.stringify(mm), page);
    const dsteps = await page.evaluate(id => MC.store.getState().missions.byId[id].plan.filter(s => s.decision && s.decision.options && s.decision.options.length).map(s => ({ id: s.id, title: s.title, chose: s.decision.chose, n: s.decision.options.length, why: s.decision.why })), SEED_LHW);
    if (!dsteps.length) await warn('decision: no step has recorded what the agent weighed yet', 'step.decision missing in the sample missions', page);
    else {
      const tgt = dsteps[0];
      await page.locator('.mr-blk[data-step="' + tgt.id + '"]').focus();
      await page.waitForTimeout(150);
      const optDet = page.locator('.mr-why details.mc-details:has(.mr-opts)');
      await check('decision: the weighed options sit in an "Options considered" disclosure, closed in Simple', (await optDet.count()) === 1 && (await optDet.evaluate(e => e.open)) === false, 'closed', page);
      await optDet.locator('summary').click();
      const opts = await page.$$eval('.mr-why .mr-opt', els => els.map(e => ({ chosen: e.classList.contains('is-chosen'), t: e.innerText.replace(/\s+/g, ' ').trim() })));
      const hd = (await page.innerText('.mr-why h2')).replace(/\s+/g, ' ');
      await check('decision: focusing a step shows the options it weighed, with numbers, the choice and why', opts.length === tgt.n && opts.filter(o => o.chosen).length === 1 && opts.some(o => /\d/.test(o.t)) && hd.indexOf(tgt.title) >= 0 && (await page.innerText('.mr-why')).indexOf(tgt.why.slice(0, 20)) >= 0,
        hd + ' | ' + opts.map(o => (o.chosen ? '*' : '') + o.t.slice(0, 40)).join(' / '), page);
      const ttl = await page.getAttribute('.mr-blk[data-step="' + tgt.id + '"]', 'title');
      await check('decision: the step carries a hover summary of what it weighed', /Weighed/.test(ttl || '') && (ttl || '').indexOf(tgt.chose) >= 0, ttl, page);
    }
    const errs = w.take();
    await check('verdict: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- steering: the diff, and SMS removed from every surface --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const m0 = await mission(page, SEED_LHW), n0 = m0.plan.length;
    await page.fill('#mr-steer-input', 'skip SMS');
    await page.click('.mr-send');
    await page.waitForTimeout(350);
    const m1 = await mission(page, SEED_LHW);
    const withDiff = m1.log.filter(b => b.diff && b.diff.length);
    if (!withDiff.length) await warn('steer diff: the re-plan fact carries no diff yet', 'beat.diff missing', page);
    else {
      const dt = (await page.locator('.mr-activity .mr-diff').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      await check('steer diff: Activity lists "What changed" with from and to', /What changed/i.test(dt) && withDiff[withDiff.length - 1].diff.every(d => dt.indexOf(d.what) >= 0), dt, page);
    }
    await pulse(page, 40);
    await page.waitForTimeout(300);
    const room = await page.evaluate(() => ({ journey: (document.querySelector('.mr-jr') || {}).innerText || '', vers: document.querySelectorAll('.mr-msg-vers .mr-ver-sms').length, budget: (document.querySelector('.mr-bl') || {}).innerText || '' }));
    const world = await page.evaluate(id => { const w = MC.store.getState(), m = w.missions.byId[id]; const cids = MC.xref.campaignIds(w, m);
      return cids.map(cid => { const c = w.campaigns.byId[cid]; return { id: cid, channels: c.channels, sendsSms: (c.journey.steps || []).filter(s => s.type === 'send' && s.channel === 'sms').length, liveSmsVariants: MC.catalog.variantsOf(w, cid).filter(v => v.channel === 'sms' && v.status !== 'retired').length }; }); }, SEED_LHW);
    await check('steer "skip SMS": the goal page shows no SMS in the journey, the message versions or the budget', !/SMS/i.test(room.journey) && room.vers === 0 && !/SMS/i.test(room.budget), JSON.stringify(room).slice(0, 200), page);
    await check('steer "skip SMS": the campaign has no SMS channel, journey send step or live SMS version', world.every(c => c.channels.indexOf('sms') < 0 && c.sendsSms === 0 && c.liveSmsVariants === 0), JSON.stringify(world), page);
    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id: MC.xref.campaignIds(MC.store.getState(), MC.store.getState().missions.byId[id])[0], tab: 'journey' }), SEED_LHW);
    await page.waitForSelector('.cm-journey', { timeout: 8000 });
    await page.waitForTimeout(400);
    const camp = await page.evaluate(() => ({ flow: (document.querySelector('.cm-journey-flow') || {}).textContent || '', sends: (document.querySelector('.cm-sends-all') || {}).innerText || '', head: (document.querySelector('.cm-detail-head') || {}).innerText || '' }));
    await check('steer "skip SMS": the campaign journey and "what each step sends" list no SMS', !/\bSMS\b/i.test(camp.flow) && !/\bSMS\b/i.test(camp.sends), (camp.flow + ' || ' + camp.sends).replace(/\s+/g, ' ').slice(0, 200), page);
    await page.evaluate(() => MC.nav.go('campaigns', { mode: 'board', id: null }));
    await page.waitForTimeout(500);
    const board = (await page.innerText('.v-campaigns')).replace(/\s+/g, ' ');
    const lhwName = await page.evaluate(id => { const w = MC.store.getState(); return w.campaigns.byId[MC.xref.campaignIds(w, w.missions.byId[id])[0]].name; }, SEED_LHW);
    const at = board.indexOf(lhwName);
    await check('steer "skip SMS": the campaigns board card for it lists no SMS channel', at >= 0 && !/\bSMS\b/.test(board.slice(at, at + 260)), board.slice(at, at + 200), page);
    const errs = w.take();
    await check('steer "skip SMS": no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- global search --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'team');
    const opts = async () => page.$$eval('#app-search-list [role=option]', els => els.map(e => ({ kind: e.dataset.kind, id: e.dataset.id, t: e.innerText.replace(/\s+/g, ' ').trim(), sel: e.getAttribute('aria-selected') })));
    await page.keyboard.press('/');
    await page.waitForSelector('#app-search', { state: 'visible' });
    const a11y = await page.evaluate(() => { const i = document.getElementById('app-search-input'); return { role: i.getAttribute('role'), focused: document.activeElement === i, dlg: document.getElementById('app-search').getAttribute('role'), modal: document.getElementById('app-search').getAttribute('aria-modal'), lb: document.getElementById('app-search-list').getAttribute('role'), label: !!i.getAttribute('aria-label') }; });
    await check('search: "/" opens a labelled dialog with focus in a combobox over a listbox', a11y.role === 'combobox' && a11y.focused && a11y.dlg === 'dialog' && a11y.modal === 'true' && a11y.lb === 'listbox' && a11y.label, JSON.stringify(a11y), page);
    await page.keyboard.type('lapsed');
    await page.waitForTimeout(250);
    let o = await opts();
    const kinds = new Set(o.map(x => x.kind));
    await check('search: "lapsed" finds the goal, the campaign, the audience and messages', ['mission', 'campaign', 'segment', 'message'].every(k => kinds.has(k)), o.map(x => x.kind + ':' + x.t.slice(0, 30)).join(' | '), page);
    const act0 = await page.getAttribute('#app-search-input', 'aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    const act1 = await page.getAttribute('#app-search-input', 'aria-activedescendant');
    const selNow = (await opts()).filter(x => x.sel === 'true').length;
    await check('search: arrow keys move the active option (aria-activedescendant) and exactly one option is selected', !!act0 && !!act1 && act0 !== act1 && selNow === 1, `${act0} -> ${act1}, selected ${selNow}`, page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => ({ gone: !document.getElementById('app-search'), back: document.activeElement && document.activeElement.id }));
    await check('search: Escape closes it and returns focus to where it was', closed.gone && closed.back !== 'app-search-input', JSON.stringify(closed), page);

    const go = async (q, kind) => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#app-search-input', { state: 'visible' });
      await page.fill('#app-search-input', q);
      await page.waitForTimeout(250);
      const r = await opts();
      const i = r.findIndex(x => x.kind === kind);
      if (i < 0) return { found: false, list: r };
      for (let k = 0; k < i; k++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      return { found: true, hit: r[i] };
    };
    let r = await go('black friday', 'mission');
    await check('search: Ctrl+K, a goal, Enter opens its page', r.found && (await routeNow(page)) === 'missions' && /#missions\/m-bfe/.test(await page.evaluate(() => location.hash)), r.found ? r.hit.t : JSON.stringify(r.list).slice(0, 120), page);
    r = await go('lapsed hikers', 'segment');
    await check('search: an audience opens the Audiences screen', r.found && (await routeNow(page)) === 'audiences', r.found ? r.hit.t : 'no audience option', page);
    r = await go('lapsed hiker win-back', 'campaign');
    const detail = await page.evaluate(() => MC.uiStore.getState().focus.campaigns || {});
    await check('search: a campaign opens its detail', r.found && (await routeNow(page)) === 'campaigns' && detail.mode === 'detail' && detail.id === r.hit.id, r.found ? r.hit.t + ' ' + JSON.stringify(detail) : 'no campaign option', page);
    const blockWord = await page.evaluate(() => { const w = MC.store.getState(), b = MC.content.blocks(w).find(x => x.kind === 'headline'); return MC.content.textOf(b).split(/\s+/).slice(0, 3).join(' '); });
    r = await go(blockWord, 'block');
    await check('search: a block opens the Library with that block open', r.found && (await routeNow(page)) === 'content' && (await page.locator('#ct-blk-' + r.hit.id).count()) === 1 && (await page.locator('#ct-blk-' + r.hit.id + ' .ct-where').count()) === 1, r.found ? r.hit.t : 'no block option for "' + blockWord + '"', page);
    r = await go('fatigue', 'agent');
    await check('search: an agent opens its row on the Agents page', r.found && (await routeNow(page)) === 'agents', r.found ? r.hit.t : 'no agent option', page);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('#app-search-input');
    await page.fill('#app-search-input', 'zzzzqx');
    await page.waitForTimeout(200);
    await check('search: no match says so', /No matches/.test(await page.innerText('#app-search .app-search-status')), await page.innerText('#app-search .app-search-status'), page);
    await page.keyboard.press('Escape');
    const errs = w.take();
    await check('search: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- cross-links, one Asks count, grouped Asks and Team --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const links = await page.$$eval('.mr-links a', els => els.map(e => e.dataset.xref));
    await check('links: the goal page links its campaign, audience and messages', ['campaign:', 'segment:', 'message:'].every(k => links.some(l => l.indexOf(k) === 0)), links.join(' '), page);
    await page.locator('.mr-links a[data-xref^="segment:"]').first().click();
    await page.waitForTimeout(500);
    await check('links: the audience link opens Audiences', (await routeNow(page)) === 'audiences', await routeNow(page), page);
    await page.evaluate(id => MC.nav.go('missions', id), SEED_LHW);
    await page.waitForSelector('.mr-links');
    const mname = await page.locator('.mr-links a[data-xref^="message:"]').first().innerText();
    await page.locator('.mr-links a[data-xref^="message:"]').first().click();
    await page.waitForSelector('.ct-msgname', { timeout: 8000 });
    const cn = (await page.innerText('.ct-msgname')).replace(/\s*Rename\s*$/, '').trim();
    await check('links: the message link opens that message in Compose', (await routeNow(page)) === 'content' && cn.indexOf(mname.trim()) === 0, `${mname} -> ${cn}`, page);
    const cx = (await page.locator('.ct-compose .xref').first().innerText()).replace(/\s+/g, ' ');
    await check('links: Compose names the goals and campaigns that use the message', /Goal/.test(cx) && /Campaign/.test(cx), cx, page);
    await page.locator('.ct-compose .xref a[data-xref^="mission:"]').first().click();
    await page.waitForTimeout(500);
    await check('links: the goal link in Compose opens the goal page', (await routeNow(page)) === 'missions' && /#missions\/m-/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash), page);

    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id: MC.xref.campaignIds(MC.store.getState(), MC.store.getState().missions.byId[id])[0], tab: 'overview' }), SEED_LHW);
    await page.waitForSelector('.cm-xref a', { timeout: 8000 });
    const xr = (await page.innerText('.cm-xref')).replace(/\s+/g, ' ');
    await check('links: a campaign names its goal, the agent that made / changed it, its audience and messages', /Goal/.test(xr) && /made by/.test(xr) && /Audience/.test(xr) && /Message/.test(xr), xr.slice(0, 220), page);
    const rev = await page.evaluate(id => { const w = MC.store.getState(); return MC.metrics.campaign(w, MC.xref.campaignIds(w, w.missions.byId[id])[0]).revenue; }, SEED_LHW);
    const figs = (await page.innerText('.cm-figs')).replace(/\s+/g, ' ');
    const figRev = parseMoney((/Revenue\s+(\$[\d,.]+\s*[kKmM]?)/.exec(figs) || [])[1]);
    await check('counts: campaign revenue on screen is MC.metrics.campaign revenue', isFinite(figRev) ? Math.abs(figRev - rev) / Math.max(1, rev) < 0.01 : /Revenue/.test(figs) === false, `${figs.slice(0, 120)} vs ${Math.round(rev)}`, page);
    await page.locator('.cm-xref a[data-xref^="mission:"]').first().click();
    await page.waitForTimeout(500);
    const mrev = parseMoney(await page.innerText('.mr-ctr.is-rev b'));
    await check('counts: the goal page revenue counter is the same number', isFinite(mrev) && Math.abs(mrev - rev) / Math.max(1, rev) < 0.01, `${mrev} vs ${Math.round(rev)}`, page);
    await page.evaluate(() => MC.nav.go('campaigns', { mode: 'detail', id: 'c-lhw', tab: 'journey' }));
    await page.waitForSelector('.cm-sends-all', { timeout: 8000 });
    const sends = await page.$$eval('.cm-sends-all .cm-send', els => els.map(e => ({ link: !!e.querySelector('a[data-xref^="message:"]'), t: e.innerText.replace(/\s+/g, ' ') })));
    await check('links: every journey send step shows the message and channel version it sends', sends.length >= 2 && sends.every(x => x.link && /version/.test(x.t) && /“/.test(x.t)), sends.slice(0, 2).map(x => x.t.slice(0, 80)).join(' | '), page);

    await page.evaluate(() => MC.nav.go('content', { tab: 'library', messageId: null }));
    await page.waitForSelector('.ct-count', { timeout: 8000 });
    const cnt = await page.evaluate(() => { const m = MC.metrics.messages(MC.store.getState()); return { m, t: document.querySelector('.ct-count').innerText.replace(/\s+/g, ' ') }; });
    await check('counts: the Library count is MC.metrics.messages (messages, blocks, channel versions apart)', cnt.t.indexOf(cnt.m.messages + ' messages') === 0 && cnt.t.indexOf(cnt.m.blocks + ' blocks') > 0 && cnt.t.indexOf(cnt.m.channelVersions + ' channel versions') > 0, cnt.t, page);
    await page.locator('.ct-link[aria-expanded]').first().click();
    await page.waitForSelector('.ct-where .xref');
    await check('links: an open block in the Library shows goals and campaigns using it', /Goal/.test(await page.innerText('.ct-where .xref')), (await page.innerText('.ct-where .xref')).replace(/\s+/g, ' '), page);

    /* Approvals: one count, grouped by goal */
    const n = await askCount(page), mc = await page.evaluate(() => MC.metrics.asks(MC.store.getState()));
    await check('approvals: one count - the rail, MC.metrics.asks and the Approvals page agree', n === mc.count && mc.count === mc.missionAsks.length + mc.proposals.length, `bar ${n}, metrics ${mc.count} = ${mc.missionAsks.length} + ${mc.proposals.length}`, page);
    await page.click('#rail-approvals');
    await page.waitForSelector('.app-approvals-page .app-asks');
    const groups = await page.$$eval('.app-approvals-page .app-asks-mission', els => els.map(e => ({ id: e.dataset.mission, h: e.querySelector('h3 a').innerText, asks: e.querySelectorAll('.app-ask').length, props: e.querySelectorAll('article:not(.app-ask)').length })));
    const live = await page.evaluate(() => MC.missions.list(MC.store.getState()).filter(m => m.status !== 'done' && m.status !== 'stopped').map(m => m.id));
    await check('approvals: the page groups asks and proposals under the goal they belong to', groups.length >= 1 && groups.every(g => live.indexOf(g.id) >= 0 && g.h.length > 10 && g.asks + g.props >= 1), groups.map(g => `${g.id}: ${g.asks} asks, ${g.props} proposals`).join(' | '), page);

    await page.evaluate(() => MC.nav.go('agents', { tab: 'roster', agentId: null }));
    await page.waitForSelector('.tm-bym', { timeout: 8000 });
    const bym = await page.$$eval('.tm-bym-m', els => els.map(e => ({ id: e.dataset.mission, n: e.querySelectorAll('.tm-bym-agents li').length, link: !!e.querySelector('.tm-bym-t a[href^="#missions/"]') })));
    await check('team: agents are grouped by goal, each goal linked with who is on it', bym.length === live.length && bym.every(b => b.n >= 3 && b.link), JSON.stringify(bym), page);
    const errs = w.take();
    await check('links: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- phone width: verdict, decision and search stay usable --- */
  ctx = await newCtx({ viewport: { width: 390, height: 844 } });
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const vis = await page.evaluate(() => { const e = document.querySelector('.mr-verdict'); const r = e && e.getBoundingClientRect(); return { shown: !!r && r.width > 0, fits: !!r && r.right <= window.innerWidth + 1, overflow: document.documentElement.scrollWidth <= window.innerWidth + 1 }; });
    await check('phone 390: the forecast verdict is visible and nothing overflows sideways', vis.shown && vis.fits && vis.overflow, JSON.stringify(vis), page);
    await page.click('#app-menu-btn');
    await page.click('.app-menu-sheet .app-menu-item:has-text("Search")');
    await page.waitForSelector('#app-search-input', { state: 'visible' });
    await page.fill('#app-search-input', 'lapsed');
    await page.waitForTimeout(250);
    const box = await page.evaluate(() => { const r = document.getElementById('app-search').getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth, n: document.querySelectorAll('#app-search-list [role=option]').length }; });
    await check('phone 390: search fits the screen and lists results', box.l >= 0 && box.r <= box.w + 1 && box.n >= 3, JSON.stringify(box), page);
    const errs = w.take();
    await check('phone 390: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== main ============================== */
(async () => {
  const srv = await startServer().catch(e => { console.error('server failed: ' + e.message); process.exit(2); });
  browser = await chromium.launch();
  const secs = [['boot', secBoot], ['shell', secShell], ['missions', secMissions], ['asks', secAsks], ['team', secTeam], ['artifacts', secArtifacts], ['connect', secConnect], ['no-theatre', secNoTheatre], ['consistency', secConsistency], ['determinism', secDeterminism]];
  for (const [n, f] of secs) await section(n, f);
  await check('network: no request left localhost (except stubbed api.anthropic.com)', externals.length === 0, externals.length ? [...new Set(externals)].slice(0, 5).join(', ') : 'none');
  await browser.close();
  srv.close();
  const secs2 = ((Date.now() - T_START) / 1000).toFixed(1);
  const total = counts.PASS + counts.FAIL + counts.WARN;
  console.log(`SUMMARY total=${total} pass=${counts.PASS} fail=${counts.FAIL} warn=${counts.WARN} runtime=${secs2}s`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(counts.FAIL ? 1 : 0);
})().catch(e => { console.error('fatal: ' + (e && e.stack || e)); process.exit(2); });
