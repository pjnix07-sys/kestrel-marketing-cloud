#!/usr/bin/env node
/* End-to-end suite for the static Marketing Cloud app (Playwright + Chromium).
   Tests the mission-first product: mission room, asks, steering, new goals, team, artifacts, Connect Claude.
   Usage:  NODE_PATH=$(npm root -g) node tools/e2e.js [--port 8870] [--out /tmp/claude-0/e2e-out] [--date 2026-11-26] [--only boot,missions,...]
   - Starts its own static server on --port serving the repo root.
   - Fails if any request leaves localhost, except api.anthropic.com which is stubbed with page routes.
   - One line per check: PASS|FAIL|WARN <name> — <detail>; a summary line; exit 1 on any FAIL.
   - Screenshots only for failures, written to --out.
   - --only takes a comma list of groups: boot, missions, asks, team, artifacts, connect, no-theatre, consistency, determinism (default: all).
   - --port is the static server port; --out is where failure screenshots go.
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
/* [hash, ui route, h1 prefix (null = a mission goal sentence)] */
const ROUTES = [['missions', 'missions', null], ['missions/m-lhw', 'missions', null], ['team', 'agents', 'Your team of nine'], ['campaigns', 'campaigns', 'Campaigns'],
  ['content', 'content', 'Content'], ['audiences', 'audiences', 'Audiences'], ['analytics', 'analytics', 'Analytics']];

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
const mission = (page, id) => page.evaluate(id => { const m = MC.store.getState().missions.byId[id]; return m ? JSON.parse(JSON.stringify(m)) : null; }, id);
const askCount = page => page.evaluate(() => { const l = document.getElementById('app-asks-btn').getAttribute('aria-label'); const m = /(\d+)/.exec(l); return m ? +m[1] : 0; });
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
            const aria = [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).join(' \n ');
            const de = document.documentElement, goals = MC.missions.list(MC.store.getState()).map(m => m.goalText);
            return { text: document.body.innerText + '\n' + aria, h1: document.querySelectorAll('h1').length, h1id: document.querySelectorAll('h1#page-title').length,
              h1text: ((document.querySelector('h1#page-title') || {}).textContent || '').trim(), scrollW: de.scrollWidth, clientW: de.clientWidth, bodyScrollW: document.body.scrollWidth,
              title: document.title, theme: de.getAttribute('data-theme'), route: MC.uiStore.getState().route, goals };
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
          if (label === null ? info.goals.indexOf(info.h1text) < 0 : info.h1text.indexOf(label) !== 0) bad.push('h1 "' + info.h1text + '" expected ' + (label === null ? 'a mission goal' : '"' + label + '"'));
          if (hash === 'missions/m-lhw' && info.goals.indexOf(info.h1text) !== info.goals.indexOf(info.goals.find(g => /lapsed hikers/.test(g)))) bad.push('did not open mission m-lhw');
          await check(name, !bad.length, bad.length ? bad.join(' | ') : `no errors, one h1 "${info.h1text.slice(0, 40)}", no overflow, clean text, title "${info.title}"`, page);
        } catch (e) { await fail(name, e.message.split('\n')[0], page); }
        if (page) await page.close();
      }
    } finally { await closeCtx(ctx); }
  }
}

/* ============================== 2. Missions ============================== */
async function secMissions() {
  /* --- the room, an open ask answered from the strip --- */
  let ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const seeded = await page.evaluate(() => MC.missions.list(MC.store.getState()).map(m => ({ id: m.id, goal: m.goalText })));
    const tabs = await page.$$eval('#app-mission-tabs a', els => els.map(e => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), href: e.getAttribute('href'), on: e.getAttribute('aria-current') === 'page' })));
    await check('missions: seeded missions are tabs in the top bar', seeded.length >= 2 && seeded.every(s => tabs.some(t => t.text.indexOf(s.goal) === 0 && t.href === '#missions/' + s.id)),
      tabs.map(t => t.text.slice(0, 30)).join(' | '), page);
    await check('missions: the open mission tab is marked current', tabs.filter(t => t.on).length === 1 && /lapsed hikers/.test(tabs.find(t => t.on).text), JSON.stringify(tabs.filter(t => t.on).map(t => t.href)), page);

    const m0 = await mission(page, SEED_LHW);
    const h1 = (await page.innerText('h1#page-title')).trim();
    await check('missions: room h1 is the goal sentence', h1 === m0.goalText, '"' + h1 + '"', page);
    const status = (await page.innerText('.mr-status')).replace(/\s+/g, ' ').trim();
    await check('missions: status sentence carries numbers', /\d/.test(status) && /(people|messages|found)/i.test(status) && /[.!]$/.test(status), status, page);
    const meta = (await page.innerText('.mr-meta')).replace(/\s+/g, ' ');
    await check('missions: deadline, limits and target shown', /Deadline/.test(meta) && /Limits/.test(meta) && /Target/.test(meta) && /\d/.test(meta) && /15%/.test(meta), meta, page);
    const lanes = await page.locator('.mr-lane').count(), blocks = await page.locator('.mr-blk').count();
    await check('missions: board has a lane per agent and a block per step', lanes >= 3 && blocks === m0.plan.length, `${lanes} lanes, ${blocks} blocks, ${m0.plan.length} steps`, page);
    const labels = await page.$$eval('.mr-blk', els => els.map(e => e.getAttribute('aria-label')));
    await check('missions: each block names its agent, step and state', labels.every(l => /^[^:]+: .+, (done|working|queued|waiting on you|skipped)(\. Weighed \d+ options.*)?$/.test(l)), labels.slice(0, 2).join(' | '), page);
    const batons = await page.$$eval('.mr-baton', els => els.map(e => e.getAttribute('title')));
    await check('missions: finished steps show hand-off batons', batons.length >= 1 && batons.every(t => /handed .+ to /.test(t)), batons.slice(0, 2).join(' | ') || 'none', page);
    const panels = await page.$$eval('.mr-art h3', els => els.map(e => e.textContent.trim()));
    await check('missions: artifact panels Segment, Message, Journey, Budget', JSON.stringify(panels) === JSON.stringify(['Segment', 'Message', 'Journey', 'Budget']), panels.join(','), page);
    const filled = await page.locator('.mr-art:not(.is-wait)').count();
    await check('missions: artifact panels hold real objects', filled >= 3, filled + ' of 4 filled', page);
    const narr = await page.locator('.mr-narr li').count(), narrH = await page.innerText('.mr-narr h2');
    await check('missions: narration lists what the team said', narr >= 1 && /team is saying/i.test(narrH), `${narr} lines under "${narrH}"`, page);
    const thread = await page.locator('.mr-thread .mr-msg').count();
    await check('missions: Lead column shows the goal and Lead replies', thread >= 2 && (await page.locator('.mr-thread .mr-msg.you').first().innerText()).trim() === m0.goalText, thread + ' messages', page);

    /* the Lead column opens on its newest message with nothing clipped at the top */
    const sc = await page.evaluate(() => { const t = document.querySelector('.mr-thread'), first = t.querySelector('.mr-msg'), a = t.getBoundingClientRect(), b = first.getBoundingClientRect();
      return { st: t.scrollTop, sh: t.scrollHeight, ch: t.clientHeight, gap: b.top - a.top, atEnd: t.scrollTop + t.clientHeight >= t.scrollHeight - 1 }; });
    await check('missions: Lead column opens with the first message unclipped and scrolled to the latest', sc.gap >= 0 && sc.atEnd, JSON.stringify(sc), page);

    /* ask on the strip */
    await page.waitForSelector('.mr-ask');
    const ask0 = m0.asks.find(a => a.status === 'open'), blocked0 = m0.plan.filter(s => s.status === 'blocked');
    const q = (await page.innerText('.mr-ask h2')).trim();
    await check('missions: an open ask is shown with its question, why and options', !!ask0 && q === ask0.question && (await page.locator('.mr-ask details').count()) === 1 && (await page.locator('.mr-ask-btn').count()) === ask0.options.length && m0.status === 'waiting' && blocked0.length >= 1,
      `status ${m0.status}; "${q.slice(0, 60)}"; blocked ${blocked0.map(s => s.id)}`, page);
    const before = await askCount(page);
    await page.locator('.mr-ask-btn.go').click();
    await page.waitForTimeout(300);
    const m1 = await mission(page, SEED_LHW), a1 = m1.asks.find(a => a.id === ask0.id);
    await check('missions: answering on the strip records the answer and resumes the mission', a1.status === 'answered' && a1.answer === ask0.default && m1.status !== 'waiting' && m1.plan.every(s => s.status !== 'blocked'),
      `ask ${a1.status} "${a1.answer}", mission ${m1.status}, steps ${steps(m1)}`, page);
    await check('missions: the ask strip goes and the Asks count drops by one', (await page.locator('.mr-ask').count()) === 0 && (await askCount(page)) === before - 1, `Asks ${before} -> ${await askCount(page)}`, page);
    const answered = await page.locator('.mr-msg.lead', { hasText: 'You answered' }).count();
    await check('missions: Lead column notes the answer', answered >= 1, answered + ' message(s)', page);
    const bid = blocked0[0].id;
    let seen = [];
    for (let i = 0; i < 10; i++) { await tick(page, 1); seen.push((await mission(page, SEED_LHW)).plan.find(s => s.id === bid).status); if (seen[seen.length - 1] === 'done') break; }
    await check('missions: the unblocked step runs and finishes on the next ticks', seen[seen.length - 1] === 'done', `${bid}: ${seen.join(' > ')}`, page);
    const m2 = await mission(page, SEED_LHW);
    const blk = await page.locator('.mr-blk.s-' + 'done').count();
    await check('missions: the board shows the step done without a reload', blk === m2.plan.filter(s => s.status === 'done').length && blk > m0.plan.filter(s => s.status === 'done').length, `${blk} done blocks`, page);
    const errs = w.take();
    await check('missions: no console errors in the room', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- steering through the Lead column --- */
  ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions/' + SEED_LHW);
    const m0 = await mission(page, SEED_LHW), n0 = m0.plan.length;
    await page.fill('#mr-lead-input', 'skip SMS');
    await page.click('.mr-send');
    await page.waitForTimeout(350);
    const m1 = await mission(page, SEED_LHW);
    const replan = m1.log.filter(b => b.kind === 'replan' && b.agentId === 'lead' && /SMS/.test(b.text));
    await check('steer: "skip SMS" is recorded and Lead re-plans with a visible beat', m1.steers.length === 1 && m1.steers[0].text === 'skip SMS' && replan.length >= 1, `steers ${m1.steers.length}, replan beats ${replan.map(b => b.text.slice(0, 60))}`, page);
    await check('steer: the limit is added to the mission', m1.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && /sms/i.test((await page.innerText('.mr-meta'))), JSON.stringify(m1.objective.constraints), page);
    const bubbles = await page.$$eval('.mr-thread .mr-msg', els => els.map(e => e.className + '|' + e.innerText.replace(/\s+/g, ' ').trim()));
    await check('steer: the Lead column shows the steer and Lead\'s reply', bubbles.some(b => /^mr-msg you\|skip SMS$/.test(b)) && bubbles.some(b => /^mr-msg lead\|Lead Dropping SMS/.test(b)), bubbles.slice(-2).join(' || '), page);
    await check('steer: the plan gains steps that take SMS out', m1.plan.length > n0 && m1.plan.slice(n0).some(s => /SMS/.test(s.title)) && (await page.locator('.mr-blk').count()) === m1.plan.length, `${n0} -> ${m1.plan.length} steps: ${m1.plan.slice(n0).map(s => s.title)}`, page);
    for (let i = 0; i < 10; i++) { await tick(page, 1); const m = await mission(page, SEED_LHW); if (m.plan.slice(n0).every(s => s.status === 'done')) break; }
    const m2 = await mission(page, SEED_LHW);
    const remaining = m2.plan.filter(s => s.status === 'queued' || s.status === 'working' || s.status === 'blocked');
    const smsLeft = remaining.filter(s => /SMS/i.test(s.title + ' ' + (s.note || '')));
    const sched = await page.evaluate(id => { const w = MC.store.getState(), m = w.missions.byId[id], c = w.campaigns.byId[m.artifacts.find(a => a.kind === 'campaign').id];
      return { sms: c.budget.byChannel.sms || 0, vs: MC.catalog.variantsOf(w, c.id).filter(v => v.channel === 'sms' && v.status !== 'retired' && v.status !== 'paused').length }; }, SEED_LHW);
    await check('steer: SMS is gone from what remains (no SMS step left, no SMS budget)', m2.plan.slice(n0).every(s => s.status === 'done') && !smsLeft.length && sched.sms === 0, `remaining ${remaining.map(s => s.title)}; sms budget ${sched.sms}; live sms variants ${sched.vs}`, page);
    const narr = await page.$$eval('.mr-narr li', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    await check('steer: narration reports taking SMS out', narr.some(t => /SMS/.test(t)), narr.slice(-2).join(' || '), page);
    const errs = w.take();
    await check('steer: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* --- a new goal from the New goal drawer, run across ticks without a reload --- */
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
    await check('new goal: the mission is created', !!nm && list.length === before + 1, nm ? nm.id + ' ' + nm.status : 'missing', page);
    if (!nm) return;
    await check('new goal: the drawer closes and the new mission room opens', (await page.locator('#goal-drawer').isVisible().catch(() => false)) === false && /#missions\/m-/.test(await page.evaluate(() => location.hash)) && (await page.innerText('h1#page-title')).trim() === goal, await page.evaluate(() => location.hash), page);
    const tabs = await page.$$eval('#app-mission-tabs a', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.getAttribute('href'), on: e.getAttribute('aria-current') === 'page' })));
    await check('new goal: it appears as a tab, and is the current one', tabs.some(t => t.t.indexOf(goal) === 0 && t.h === '#missions/' + nm.id && t.on), tabs.map(t => t.t.slice(0, 24)).join(' | '), page);
    await check('new goal: the goal was understood (sign-ups, 300, no SMS)', nm.objective.metric === 'signups' && nm.objective.target === 300 && nm.objective.constraints.some(c => c.kind === 'excludeChannel' && c.value === 'sms') && nm.brain === 'rules',
      JSON.stringify({ metric: nm.objective.metric, target: nm.objective.target, cons: nm.objective.constraints, brain: nm.brain }), page);
    const seen = new Set(nm.plan.map(s => s.status));
    const hist = [nm.plan.map(s => s.status[0]).join('')];
    const startedQueued = nm.plan.every(s => s.status === 'queued');
    let fin = null, answeredAsks = 0;
    for (let i = 0; i < 80; i++) {
      await tick(page, 1);
      const m = await mission(page, nm.id);
      m.plan.forEach(s => seen.add(s.status));
      hist.push(m.plan.map(s => s.status[0]).join(''));
      const open = m.asks.filter(a => a.status === 'open');
      if (open.length) { await page.locator('.mr-ask-btn.go').first().click().catch(() => {}); answeredAsks++; await page.waitForTimeout(200); }
      if (m.plan.every(s => s.status === 'done' || s.status === 'skipped')) { fin = m; break; }
    }
    await check('new goal: steps start queued and finish level by level across ticks (independent steps together)', startedQueued && seen.has('done') && !!fin && hist.length - 1 <= nm.plan.length + 2, `start ${hist[0]} ... end ${hist[hist.length - 1]} after ${hist.length - 1} ticks; statuses ${[...seen]}`, page);
    if (fin) {
      const blocks = await page.locator('.mr-blk.s-done').count();
      await check('new goal: the room shows every step done, with artifacts made', blocks === fin.plan.length && fin.artifacts.length >= 1, `${blocks}/${fin.plan.length} done blocks; artifacts ${JSON.stringify(fin.artifacts)}; asks answered ${answeredAsks}`, page);
    }
    await check('new goal: no page reload happened', (await page.evaluate(() => window.__noReload)) === 'same-page', 'marker kept');
    const errs = w.take();
    await check('new goal: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 3. Asks drawer ============================== */
async function secAsks() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions');
    const n = await askCount(page), exp = await expectedAsks(page);
    const sel = await page.evaluate(() => MC.metrics.asks(MC.store.getState()).missionAsks.length);
    const props = await page.evaluate(() => MC.metrics.asks(MC.store.getState()).proposals.length);
    await check('asks: top-bar count = open mission asks + pending proposals', n === exp && n === sel + props, `button ${n}, mission asks ${sel}, proposals ${props}`, page);
    const visible = await page.evaluate(() => getComputedStyle(document.querySelector('#app-asks-btn .app-count')).display !== 'none');
    await check('asks: the count is shown', visible && (await page.innerText('#app-asks-btn .app-count')).trim() === String(n), (await page.innerText('#app-asks-btn')).replace(/\s+/g, ' '), page);
    await page.click('#app-asks-btn');
    const drawer = page.locator('#approvals-drawer');
    await drawer.waitFor({ state: 'visible' });
    const cards = await drawer.locator('.app-ask').count();
    await check('asks: drawer lists every open mission ask with Why and impact', cards === sel && cards >= 1 && (await drawer.locator('.app-ask .app-ask-why').count()) === cards, `${cards} ask cards, ${sel} open`, page);
    const pc = await drawer.locator('article:not(.app-ask)').count();
    await check('asks: drawer lists the pending proposals', pc === props || pc >= Math.min(props, 30), `${pc} proposal cards, ${props} pending`, page);
    await check('asks: drawer count matches the top bar', cards + props === n, `${cards} + ${props} = ${cards + props}, bar ${n}`, page);
    const card = drawer.locator('.app-ask').first();
    const goal = (await card.locator('.app-ask-from').innerText()).trim();
    const def = await card.locator('.app-ask-btn.is-default').innerText();
    await card.locator('.app-ask-btn.is-default').click();
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({ open: MC.select.missionAsks(MC.store.getState()).length, ans: MC.missions.list(MC.store.getState()).flatMap(m => m.asks.filter(a => a.status === 'answered').map(a => m.id + ':' + a.id + '=' + a.answer)) }));
    await check('asks: answering from the drawer resolves the ask', st.open === sel - 1 && st.ans.some(x => x.indexOf(SEED_LHW + ':') === 0) && (await askCount(page)) === n - 1, `open ${sel} -> ${st.open}; answered ${st.ans}; default "${def.replace(/\s*\(default\)/, '')}" on "${goal.slice(0, 40)}"`, page);
    await check('asks: drawer shows the empty state when nothing is waiting from missions', (await drawer.locator('.app-ask').count()) === sel - 1 && (sel > 1 || /No mission is waiting on you/.test(await drawer.innerText())), (await drawer.locator('.app-ask').count()) + ' cards left', page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.waitForFunction(() => !document.querySelector('.mr-ask'), null, { timeout: 4000 }).catch(() => {});
    await check('asks: the mission room reflects the answer', (await page.locator('.mr-ask').count()) === 0, 'ask strip gone', page);
    await tick(page, 3);
    const m = await mission(page, SEED_LHW);
    await check('asks: the mission moves on after a drawer answer', m.status !== 'waiting' && m.plan.every(s => s.status !== 'blocked'), `${m.status} ${steps(m)}`, page);
    const errs = w.take();
    await check('asks: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 4. Team ============================== */
async function secTeam() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'team');
    await page.waitForSelector('.tm-row');
    const h1 = (await page.innerText('h1#page-title')).trim();
    const rows = await page.$$eval('.tm-row', els => els.map(e => ({ id: e.id.replace('agents-row-', ''), name: e.querySelector('.tm-h').textContent.trim(), now: e.querySelector('.tm-now-text').textContent.trim(), state: e.querySelector('.tm-state').textContent.trim(),
      toggle: !!e.querySelector('.tm-toggle'), link: !!e.querySelector('.tm-on a[href^="#missions/"]') })));
    await check('team: nine agents listed', h1 === 'Your team of nine' && rows.length === 9 && new Set(rows.map(r => r.id)).size === 9, rows.map(r => r.name).join(', '), page);
    await check('team: each agent shows what it is doing right now', rows.every(r => r.now.length > 3 && r.state.length > 1), rows.map(r => r.id + ': ' + r.now.slice(0, 28)).join(' | '), page);
    await check('team: working agents link to their mission', rows.some(r => r.link), rows.filter(r => r.link).map(r => r.id).join(','), page);
    await check('team: every agent has a settings disclosure', rows.every(r => r.toggle), rows.filter(r => !r.toggle).map(r => r.id).join(',') || 'all nine', page);
    const id = 'scout', row = page.locator('#agents-row-' + id), tg = row.locator('.tm-toggle');
    await check('team: settings start closed', (await tg.getAttribute('aria-expanded')) === 'false' && (await page.locator('#team-' + id + '-settings').count()) === 0, 'collapsed', page);
    await tg.click();
    await page.waitForSelector('#team-' + id + '-settings');
    await check('team: settings open on click', (await tg.getAttribute('aria-expanded')) === 'true' && (await page.locator('#team-' + id + '-settings').isVisible()), 'expanded', page);
    for (const mode of ['rules', 'auto']) {
      const r = page.locator('#agents-' + id + '-reasoning-' + mode);
      if (!(await r.count())) { await fail('team: reasoning ' + mode, 'radio #agents-' + id + '-reasoning-' + mode + ' not found', page); continue; }
      await r.click();
      await page.waitForTimeout(250);
      const aiMode = await ws(page, (w, id) => w.agents.byId[id].aiMode || 'auto', id);
      const checked = await r.getAttribute('aria-checked');
      await check('team: reasoning setting -> ' + mode, aiMode === mode && checked === 'true', `state aiMode ${aiMode}, radio aria-checked ${checked}`, page);
    }
    await tg.click();
    await check('team: settings close again', (await tg.getAttribute('aria-expanded')) === 'false', 'collapsed', page);
    const errs = w.take();
    await check('team: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 5. Artifacts ============================== */
async function secArtifacts() {
  const ctx = await newCtx();
  try {
    const { page, w } = await openApp(ctx, 'missions');
    await page.click('#app-artifacts-btn');
    await page.waitForSelector('#app-artifacts-menu', { state: 'visible' });
    const links = await page.$$eval('#app-artifacts-menu a', els => els.map(e => e.getAttribute('href')));
    await check('artifacts: menu lists campaigns, audiences, content, results', JSON.stringify(links) === JSON.stringify(['#campaigns', '#audiences', '#content', '#analytics']), links.join(','), page);
    for (const [route, h1re] of [['campaigns', /^Campaigns/], ['audiences', /^Audiences/], ['content', /^Content/], ['analytics', /^Analytics/]]) {
      if (!(await page.locator('#app-artifacts-menu').isVisible().catch(() => false))) await page.click('#app-artifacts-btn');
      await page.click('#app-art-' + route);
      await page.waitForFunction(re => (document.getElementById('page-title') || { textContent: '' }).textContent.trim().match(new RegExp(re)), h1re.source, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({ h1: document.querySelectorAll('h1#page-title').length, t: document.getElementById('page-title').textContent.trim(), hash: location.hash, len: document.getElementById('app-main').innerText.length, on: document.getElementById('app-artifacts-btn').classList.contains('is-on'), route: MC.uiStore.getState().route }));
      const errs = w.take();
      await check('artifacts: ' + route + ' loads from the menu', h1re.test(info.t) && info.hash === '#' + route && info.len > 200 && info.on && !errs.length, `h1 "${info.t.slice(0, 30)}", ${info.len} chars, menu marked ${info.on}${errs.length ? '; ' + errs.join(' / ') : ''}`, page);
    }

    /* a mission-made campaign and segment link back to their mission */
    const made = await page.evaluate(() => { const m = MC.store.getState().missions.byId['m-lhw']; return { c: (m.artifacts.find(a => a.kind === 'campaign') || {}).id, s: (m.artifacts.find(a => a.kind === 'segment') || {}).id, goal: m.goalText }; });
    await check('artifacts: the seeded mission has made a campaign and a segment', !!made.c && !!made.s, JSON.stringify(made), page);
    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id }), made.c);
    await page.waitForSelector('.cm-xref', { timeout: 8000 }).catch(() => {});
    const xm = await page.$$eval('.cm-xref a[data-xref^="mission:"]', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.getAttribute('href'), all: e.closest('.cm-xref').textContent })));
    await check('artifacts: a mission-made campaign names its mission (link to #missions/<id>) and the agent that made it', xm.length === 1 && xm[0].h === '#missions/' + SEED_LHW && made.goal.indexOf(xm[0].t.replace(/…$/, '')) === 0 && /made by/.test(xm[0].all), JSON.stringify(xm), page);
    let mb;
    await page.evaluate(id => MC.nav.go('audiences', { tab: 'segments', segmentId: id }), made.s);
    await page.waitForSelector('.v-audiences a[data-xref^="mission:"]', { timeout: 8000 }).catch(() => {});
    mb = await page.$$eval('.v-audiences a[data-xref^="mission:"]', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.getAttribute('href') })));
    await check('artifacts: a mission-made segment names its mission and links back', mb.length >= 1 && mb[0].h === '#missions/' + SEED_LHW, JSON.stringify(mb), page);
    if (mb.length) {
      await page.click('.v-audiences a[data-xref^="mission:"]');
      await page.waitForFunction(g => (document.getElementById('page-title') || { textContent: '' }).textContent.trim() === g, made.goal, { timeout: 8000 }).catch(() => {});
      await check('artifacts: the back-link opens the mission room', (await page.evaluate(() => location.hash)) === '#missions/' + SEED_LHW && (await page.innerText('h1#page-title')).trim() === made.goal, await page.evaluate(() => location.hash), page);
    }
    /* a hand-made object has no back-link */
    await page.evaluate(() => MC.nav.go('campaigns', { mode: 'detail', id: 'c-hgg' }));
    await page.waitForFunction(() => /Holiday/.test((document.getElementById('page-title') || { textContent: '' }).textContent), null, { timeout: 8000 }).catch(() => {});
    const own = await page.evaluate(() => { const w = MC.store.getState(); return { has: w.missions.order.some(id => w.missions.byId[id].artifacts.some(a => a.kind === 'campaign' && a.id === 'c-hgg')), n: document.querySelectorAll('.mc-madeby, a[data-xref^="mission:"]').length, t: document.getElementById('page-title').textContent.trim() }; });
    await check('artifacts: an object no mission made shows no "Made by"', own.has ? true : own.n === 0, `made by a mission: ${own.has}; back-links shown: ${own.n}; "${own.t.slice(0, 30)}"`, page);
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
    const { page, w } = await openApp(ctx, 'missions');
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
      await check('connect: top bar shows connected', /connected/i.test(lbl), lbl, page);

      const goal = 'Grow Trail runners by 300 sign-ups by Dec 20 with no SMS';
      const nm = await newGoalViaDrawer(page, goal);
      await check('connect: a mission created while connected records brain "claude"', !!nm && nm.brain === 'claude' && st.kinds.some(k => k.includes('template')), nm ? `brain ${nm.brain}, plan "${nm.plan.map(s => s.title).slice(0, 3).join(' / ')}", stub kinds [${st.kinds.slice(0, 3).join(' | ')}]` : 'mission missing', page);
      if (nm) {
        await check('connect: the Claude plan is the one on the board', nm.plan.length === 9 && nm.plan[1].title === 'Find the trail runners' && (await page.locator('.mr-blk').count()) === 9 && nm.objective.constraints.some(c => c.kind === 'excludeChannel'), nm.plan.length + ' steps', page);
        await page.evaluate(() => MC.engine.setSpeed('pause'));
        let done = false;
        for (let i = 0; i < 60 && !done; i++) { await tick(page, 1); await page.waitForFunction(() => MC.runtime.awaiting(MC.store.getState()).length === 0, null, { timeout: 8000 }).catch(() => {}); const m = await mission(page, nm.id); done = m.plan.every(s => s.status === 'done' || s.status === 'skipped'); const o = m.asks.filter(a => a.status === 'open'); if (o.length) await page.locator('.mr-ask-btn.go').first().click().catch(() => {}); }
        await check('connect: the Claude-planned mission runs to done across ticks', done, steps(await mission(page, nm.id)), page);
        const still = await mission(page, nm.id);
        await check('connect: the mission keeps its brain after running', still.brain === 'claude', still.brain);
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
      await check('connect: a mission created after disconnecting records brain "rules"', !!nm2 && nm2.brain === 'rules', nm2 ? 'brain ' + nm2.brain : 'mission missing', page);
    }
    const errs = w.take().filter(e => !/Failed to load resource/.test(e));
    await check('connect: no console errors', !errs.length, errs.join(' / ') || 'none', page);
    await page.close();
  } finally { await closeCtx(ctx); }

  /* rejected key */
  const st2 = { mode: '401', calls: 0, keys: [], kinds: [] };
  ctx = await newCtx({ stub: makeStub(st2) });
  try {
    const { page } = await openApp(ctx, 'missions');
    await connectVia(page, 'sk-ant-test-e2e-key-bad');
    const shown = await page.waitForFunction(() => /That key didn['’]t work/.test((document.getElementById('connect-msg') || { innerText: '' }).innerText), null, { timeout: 8000 }).then(() => true, () => false);
    const d = await stored(page);
    await check('connect: 401 shows "That key didn’t work"', shown, shown ? 'message shown' : 'message missing; state ' + d.s, page);
    await check('connect: 401 leaves Claude off and stores nothing', d.s !== 'on' && d.l === null && d.se === null, JSON.stringify(d), page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const nm = await newGoalViaDrawer(page, 'Win back 200 lapsed campers by Dec 18 without discounting more than 10%');
    await check('connect: a mission created after a rejected key records brain "rules"', !!nm && nm.brain === 'rules', nm ? 'brain ' + nm.brain : 'mission missing', page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 7. No theatre ============================== */
async function secNoTheatre() {
  const PLAYBACK = /\b(pause|replay|play|skip|rewind|fast[- ]forward|speed)\b/i, COUNTDOWN = /\b(in \d+\s*(s|sec|secs|seconds)|\d+\s*(s|sec|seconds) (left|remaining)|countdown|starts in|auto[- ]?(approv|default|proceed)\w* in)\b/i;
  const ctx = await newCtx();
  try {
    const { page } = await openApp(ctx, 'missions/' + SEED_LHW);
    /* the Lead steering chips ("Skip SMS", "Pause until Monday") and the composer are things you tell Lead, not playback controls */
    const scan = () => page.evaluate(() => {
      const ok = e => !e.closest('.mr-chips, .mr-compose, .mr-thread') && !e.classList.contains('app-skip');   // the "Skip to content" link is keyboard navigation, not playback
      const nameOf = e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('placeholder') || e.value || '').replace(/\s+/g, ' ').trim();
      const els = [...document.querySelectorAll('button, a, summary, input, select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem], [aria-label]')].filter(ok);
      return { names: els.map(e => ({ n: nameOf(e), tag: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') })),
        text: [...document.querySelectorAll('#app-main, header, nav, [role=banner]')].map(e => e.innerText).join('\n'), media: document.querySelectorAll('video, audio, progress, [role=progressbar], [role=slider]').length };
    });
    let s = await scan();
    let bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: no play/pause/replay/skip controls in the app chrome or mission room', !bad.length, bad.length ? bad.slice(0, 4).map(x => x.tag + ' "' + x.n.slice(0, 40) + '"').join(', ') : `${s.names.length} controls checked`, page);
    await check('no-theatre: no countdown text in the room', !COUNTDOWN.test(s.text), (s.text.match(COUNTDOWN) || ['none'])[0], page);
    await check('no-theatre: no playheads, scrubbers or progress widgets', s.media === 0, s.media + ' found', page);
    /* the room still moves only because the engine moves: nothing changes with the clock alone */
    const h0 = await page.evaluate(() => JSON.stringify(MC.store.getState().missions));
    await page.waitForTimeout(2500);
    const h1 = await page.evaluate(() => JSON.stringify(MC.store.getState().missions));
    await check('no-theatre: a paused engine leaves the missions untouched (no timers moving things)', h0 === h1, h0 === h1 ? 'unchanged over 2.5 s' : 'missions changed with the engine paused', page);
    /* the more-options menu and the drawers are chrome too */
    await page.click('#app-more');
    await page.waitForSelector('#app-more-menu', { state: 'visible' });
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: nothing in the More menu is a playback control', !bad.length, bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.keyboard.press('Escape');
    await page.click('#app-asks-btn');
    await page.waitForSelector('#approvals-drawer', { state: 'visible' });
    s = await scan();
    bad = s.names.filter(x => PLAYBACK.test(x.n));
    await check('no-theatre: nothing in the Asks drawer is a playback control or countdown', !bad.length && !COUNTDOWN.test(s.text), bad.length ? bad.slice(0, 3).map(x => '"' + x.n.slice(0, 40) + '"').join(', ') : 'clean', page);
    await page.keyboard.press('Escape');
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ============================== 8. Determinism ============================== */
async function secDeterminism() {
  const snaps = [], pages = [], ctxs = [];
  try {
    for (let i = 0; i < 2; i++) {
      const ctx = await newCtx(); ctxs.push(ctx);
      const { page } = await openApp(ctx, 'missions');
      pages.push(page);
    }
    /* same engine tick on both, then the same ticks and the same answer */
    const ticks = await Promise.all(pages.map(p => p.evaluate(() => MC.store.getState().meta.tick)));
    const hi = Math.max(...ticks);
    for (let i = 0; i < 2; i++) if (ticks[i] < hi) await tick(pages[i], hi - ticks[i]);
    const snap = p => p.evaluate(() => { const w = MC.store.getState(); return JSON.stringify({ tick: w.meta.tick, missions: MC.select.missions(w).map(m => ({ id: m.id, status: m.status, phase: m.phase, progress: m.progress, steps: m.steps, asks: m.openAsks })), asks: MC.select.missionAsks(w).length, open: w.proposals.open.length }); });
    for (const p of pages) snaps.push(await snap(p));
    await check('determinism: same date -> same MC.select.missions(world) progress values', snaps[0] === snaps[1] && /"value":\d/.test(snaps[0]), snaps[0] === snaps[1] ? (JSON.parse(snaps[0]).missions.map(m => m.id + ' ' + m.progress.value + '/' + m.progress.target).join(', ')) : 'load 1 ' + snaps[0].slice(0, 160) + ' vs load 2 ' + snaps[1].slice(0, 160), pages[0]);
    for (const p of pages) { await p.locator('.mr-ask-btn.go').first().click().catch(() => {}); await tick(p, 15); }
    const after = [];
    for (const p of pages) after.push(await snap(p));
    await check('determinism: same answer and 15 ticks later -> same mission state', after[0] === after[1] && after[0] !== snaps[0], after[0] === after[1] ? 'identical at tick ' + JSON.parse(after[0]).tick : 'diverged: ' + after[0].slice(0, 160) + ' vs ' + after[1].slice(0, 160), pages[0]);
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
    await page.fill('#mr-lead-input', 'skip SMS');
    await page.click('.mr-send');
    await page.waitForTimeout(350);
    const m1 = await mission(page, SEED_LHW);
    const withDiff = m1.log.filter(b => b.diff && b.diff.length);
    if (!withDiff.length) await warn('steer diff: the re-plan beat carries no diff yet', 'beat.diff missing', page);
    else {
      const dt = (await page.locator('.mr-lead .mr-diff').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      await check('steer diff: the Lead column lists "What changed" with from and to', /What changed/i.test(dt) && withDiff[withDiff.length - 1].diff.every(d => dt.indexOf(d.what) >= 0), dt, page);
    }
    for (let i = 0; i < 12; i++) { await tick(page, 1); const m = await mission(page, SEED_LHW); if (m.plan.slice(n0).every(s => s.status === 'done' || s.status === 'skipped')) break; }
    await page.waitForTimeout(300);
    const room = await page.evaluate(() => ({ journey: (document.querySelector('.mr-jr') || {}).innerText || '', vers: document.querySelectorAll('.mr-msg-vers .mr-ver-sms').length, budget: (document.querySelector('.mr-bl') || {}).innerText || '' }));
    const world = await page.evaluate(id => { const w = MC.store.getState(), m = w.missions.byId[id]; const cids = MC.xref.campaignIds(w, m);
      return cids.map(cid => { const c = w.campaigns.byId[cid]; return { id: cid, channels: c.channels, sendsSms: (c.journey.steps || []).filter(s => s.type === 'send' && s.channel === 'sms').length, liveSmsVariants: MC.catalog.variantsOf(w, cid).filter(v => v.channel === 'sms' && v.status !== 'retired').length }; }); }, SEED_LHW);
    await check('steer "skip SMS": the mission room shows no SMS in the journey, the message versions or the budget', !/SMS/i.test(room.journey) && room.vers === 0 && !/SMS/i.test(room.budget), JSON.stringify(room).slice(0, 200), page);
    await check('steer "skip SMS": the campaign has no SMS channel, journey send step or live SMS version', world.every(c => c.channels.indexOf('sms') < 0 && c.sendsSms === 0 && c.liveSmsVariants === 0), JSON.stringify(world), page);
    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id: MC.xref.campaignIds(MC.store.getState(), MC.store.getState().missions.byId[id])[0], tab: 'journey' }), SEED_LHW);
    await page.waitForSelector('.cm-journey', { timeout: 8000 });
    await page.waitForTimeout(400);
    const camp = await page.evaluate(() => ({ flow: (document.querySelector('.cm-journey-flow') || {}).textContent || '', sends: (document.querySelector('.cm-sends-all') || {}).innerText || '', head: (document.querySelector('.cm-detail-head') || {}).innerText || '' }));
    await check('steer "skip SMS": the campaign journey and "what each step sends" list no SMS', !/\bSMS\b/i.test(camp.flow) && !/\bSMS\b/i.test(camp.sends), (camp.flow + ' || ' + camp.sends).replace(/\s+/g, ' ').slice(0, 200), page);
    await page.click('#app-nav-campaigns, #app-art-campaigns', { timeout: 500 }).catch(() => {});
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
    await check('search: "lapsed" finds the mission, the campaign, the audience and messages', ['mission', 'campaign', 'segment', 'message'].every(k => kinds.has(k)), o.map(x => x.kind + ':' + x.t.slice(0, 30)).join(' | '), page);
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
    await check('search: Ctrl+K, a mission, Enter opens its room', r.found && (await routeNow(page)) === 'missions' && /#missions\/m-bfe/.test(await page.evaluate(() => location.hash)), r.found ? r.hit.t : JSON.stringify(r.list).slice(0, 120), page);
    r = await go('lapsed hikers', 'segment');
    await check('search: an audience opens the Audiences screen', r.found && (await routeNow(page)) === 'audiences', r.found ? r.hit.t : 'no audience option', page);
    r = await go('lapsed hiker win-back', 'campaign');
    const detail = await page.evaluate(() => MC.uiStore.getState().focus.campaigns || {});
    await check('search: a campaign opens its detail', r.found && (await routeNow(page)) === 'campaigns' && detail.mode === 'detail' && detail.id === r.hit.id, r.found ? r.hit.t + ' ' + JSON.stringify(detail) : 'no campaign option', page);
    const blockWord = await page.evaluate(() => { const w = MC.store.getState(), b = MC.content.blocks(w).find(x => x.kind === 'headline'); return MC.content.textOf(b).split(/\s+/).slice(0, 3).join(' '); });
    r = await go(blockWord, 'block');
    await check('search: a block opens the Library with that block open', r.found && (await routeNow(page)) === 'content' && (await page.locator('#ct-blk-' + r.hit.id).count()) === 1 && (await page.locator('#ct-blk-' + r.hit.id + ' .ct-where').count()) === 1, r.found ? r.hit.t : 'no block option for "' + blockWord + '"', page);
    r = await go('fatigue', 'agent');
    await check('search: an agent opens its Team row', r.found && (await routeNow(page)) === 'agents', r.found ? r.hit.t : 'no agent option', page);
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
    await check('links: the mission room links its campaign, audience and messages', ['campaign:', 'segment:', 'message:'].every(k => links.some(l => l.indexOf(k) === 0)), links.join(' '), page);
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
    await check('links: Compose names the missions and campaigns that use the message', /Goal/.test(cx) && /Campaign/.test(cx), cx, page);
    await page.locator('.ct-compose .xref a[data-xref^="mission:"]').first().click();
    await page.waitForTimeout(500);
    await check('links: the mission link in Compose opens the room', (await routeNow(page)) === 'missions' && /#missions\/m-/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash), page);

    await page.evaluate(id => MC.nav.go('campaigns', { mode: 'detail', id: MC.xref.campaignIds(MC.store.getState(), MC.store.getState().missions.byId[id])[0], tab: 'overview' }), SEED_LHW);
    await page.waitForSelector('.cm-xref a', { timeout: 8000 });
    const xr = (await page.innerText('.cm-xref')).replace(/\s+/g, ' ');
    await check('links: a campaign names its mission, the agent that made / changed it, its audience and messages', /Goal/.test(xr) && /made by/.test(xr) && /Audience/.test(xr) && /Message/.test(xr), xr.slice(0, 220), page);
    const rev = await page.evaluate(id => { const w = MC.store.getState(); return MC.metrics.campaign(w, MC.xref.campaignIds(w, w.missions.byId[id])[0]).revenue; }, SEED_LHW);
    const figs = (await page.innerText('.cm-figs')).replace(/\s+/g, ' ');
    const figRev = parseMoney((/Revenue\s+(\$[\d,.]+\s*[kKmM]?)/.exec(figs) || [])[1]);
    await check('counts: campaign revenue on screen is MC.metrics.campaign revenue', isFinite(figRev) ? Math.abs(figRev - rev) / Math.max(1, rev) < 0.01 : /Revenue/.test(figs) === false, `${figs.slice(0, 120)} vs ${Math.round(rev)}`, page);
    await page.locator('.cm-xref a[data-xref^="mission:"]').first().click();
    await page.waitForTimeout(500);
    const mrev = parseMoney(await page.innerText('.mr-ctr.is-rev b'));
    await check('counts: the mission room revenue counter is the same number', isFinite(mrev) && Math.abs(mrev - rev) / Math.max(1, rev) < 0.01, `${mrev} vs ${Math.round(rev)}`, page);
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
    await check('links: an open block in the Library shows missions and campaigns using it', /Goal/.test(await page.innerText('.ct-where .xref')), (await page.innerText('.ct-where .xref')).replace(/\s+/g, ' '), page);

    /* Asks: one count, grouped by mission */
    const n = await askCount(page), mc = await page.evaluate(() => MC.metrics.asks(MC.store.getState()));
    await check('asks: one count - the bar, MC.metrics.asks and the Team and Approvals numbers agree', n === mc.count && mc.count === mc.missionAsks.length + mc.proposals.length, `bar ${n}, metrics ${mc.count} = ${mc.missionAsks.length} + ${mc.proposals.length}`, page);
    await page.click('#app-asks-btn');
    await page.locator('#approvals-drawer').waitFor({ state: 'visible' });
    const groups = await page.$$eval('#approvals-drawer .app-asks-mission', els => els.map(e => ({ id: e.dataset.mission, h: e.querySelector('h3 a').innerText, asks: e.querySelectorAll('.app-ask').length, props: e.querySelectorAll('article:not(.app-ask)').length })));
    const live = await page.evaluate(() => MC.missions.list(MC.store.getState()).filter(m => m.status !== 'done' && m.status !== 'stopped').map(m => m.id));
    await check('asks: the drawer groups asks and proposals under the mission they belong to', groups.length >= 1 && groups.every(g => live.indexOf(g.id) >= 0 && g.h.length > 10 && g.asks + g.props >= 1), groups.map(g => `${g.id}: ${g.asks} asks, ${g.props} proposals`).join(' | '), page);
    await page.keyboard.press('Escape');

    await page.evaluate(() => MC.nav.go('agents', { tab: 'roster', agentId: null }));
    await page.waitForSelector('.tm-bym', { timeout: 8000 });
    const bym = await page.$$eval('.tm-bym-m', els => els.map(e => ({ id: e.dataset.mission, n: e.querySelectorAll('.tm-bym-agents li').length, link: !!e.querySelector('.tm-bym-t a[href^="#missions/"]') })));
    await check('team: agents are grouped by mission, each mission linked with who is on it', bym.length === live.length && bym.every(b => b.n >= 3 && b.link), JSON.stringify(bym), page);
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
    await page.click('#app-search-btn');
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
  const secs = [['boot', secBoot], ['missions', secMissions], ['asks', secAsks], ['team', secTeam], ['artifacts', secArtifacts], ['connect', secConnect], ['no-theatre', secNoTheatre], ['consistency', secConsistency], ['determinism', secDeterminism]];
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
