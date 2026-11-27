#!/usr/bin/env node
/* End-to-end suite for the static Marketing Cloud app (Playwright + Chromium).
   Tests the mission-first product: mission room, asks, steering, new goals, team, artifacts, Connect Claude.
   Usage:  NODE_PATH=$(npm root -g) node tools/e2e.js [--port 8870] [--out /tmp/claude-0/e2e-out] [--date 2026-11-26] [--only boot,missions,...]
   - Starts its own static server on --port serving the repo root.
   - Fails if any request leaves localhost, except api.anthropic.com which is stubbed with page routes.
   - One line per check: PASS|FAIL|WARN <name> — <detail>; a summary line; exit 1 on any FAIL.
   - Screenshots only for failures, written to --out.
   - --only takes a comma list of groups: boot, missions, asks, team, artifacts, connect, no-theatre, determinism (default: all).
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
  ['content', 'content', 'Content Studio'], ['audiences', 'audiences', 'Audiences'], ['analytics', 'analytics', 'Analytics']];

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
const expectedAsks = page => page.evaluate(() => {
  const w = MC.store.getState(); let n = w.proposals.open.length;
  w.missions.order.forEach(id => { const m = w.missions.byId[id]; if (m.status !== 'done' && m.status !== 'stopped') m.asks.forEach(a => { if (a.status === 'open') n++; }); });
  return n;
});
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
    await check('missions: each block names its agent, step and state', labels.every(l => /^[^:]+: .+, (done|working|queued|waiting on you|skipped)$/.test(l)), labels.slice(0, 2).join(' | '), page);
    const batons = await page.$$eval('.mr-baton', els => els.map(e => e.getAttribute('title')));
    await check('missions: finished steps show hand-off batons', batons.length >= 1 && batons.every(t => /handed .+ to /.test(t)), batons.slice(0, 2).join(' | ') || 'none', page);
    const panels = await page.$$eval('.mr-art h3', els => els.map(e => e.textContent.trim()));
    await check('missions: artifact panels Segment, Email, Journey, Budget', JSON.stringify(panels) === JSON.stringify(['Segment', 'Email', 'Journey', 'Budget']), panels.join(','), page);
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
    await check('new goal: steps start queued and move through working to done across ticks', startedQueued && seen.has('working') && !!fin, `start ${hist[0]} ... end ${hist[hist.length - 1]} after ${hist.length - 1} ticks; statuses ${[...seen]}`, page);
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
    const sel = await page.evaluate(() => MC.select.missionAsks(MC.store.getState()).length);
    const props = await page.evaluate(() => MC.store.getState().proposals.open.length);
    await check('asks: top-bar count = open mission asks + pending proposals', n === exp && n === sel + props, `button ${n}, mission asks ${sel}, proposals ${props}`, page);
    const visible = await page.evaluate(() => getComputedStyle(document.querySelector('#app-asks-btn .app-count')).display !== 'none');
    await check('asks: the count is shown', visible && (await page.innerText('#app-asks-btn .app-count')).trim() === String(n), (await page.innerText('#app-asks-btn')).replace(/\s+/g, ' '), page);
    await page.click('#app-asks-btn');
    const drawer = page.locator('#approvals-drawer');
    await drawer.waitFor({ state: 'visible' });
    const cards = await drawer.locator('.app-ask').count();
    await check('asks: drawer lists every open mission ask with Why and impact', cards === sel && cards >= 1 && (await drawer.locator('.app-ask .app-ask-why').count()) === cards, `${cards} ask cards, ${sel} open`, page);
    const pc = await drawer.locator('#approvals-panel article').count();
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
    await page.waitForSelector('.mc-madeby', { timeout: 8000 }).catch(() => {});
    let mb = await page.$$eval('.mc-madeby', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.querySelector('a') && e.querySelector('a').getAttribute('href') })));
    await check('artifacts: a mission-made campaign says "Made by" and links to #missions/<id>', mb.length === 1 && /^Made by /.test(mb[0].t) && mb[0].h === '#missions/' + SEED_LHW && mb[0].t.indexOf(made.goal) >= 0, JSON.stringify(mb), page);
    await page.evaluate(id => MC.nav.go('audiences', { tab: 'segments', segmentId: id }), made.s);
    await page.waitForSelector('.mc-madeby', { timeout: 8000 }).catch(() => {});
    mb = await page.$$eval('.mc-madeby', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: e.querySelector('a') && e.querySelector('a').getAttribute('href') })));
    await check('artifacts: a mission-made segment says "Made by" and links back', mb.length === 1 && mb[0].h === '#missions/' + SEED_LHW, JSON.stringify(mb), page);
    if (mb.length) {
      await page.click('.mc-madeby a');
      await page.waitForFunction(g => (document.getElementById('page-title') || { textContent: '' }).textContent.trim() === g, made.goal, { timeout: 8000 }).catch(() => {});
      await check('artifacts: the back-link opens the mission room', (await page.evaluate(() => location.hash)) === '#missions/' + SEED_LHW && (await page.innerText('h1#page-title')).trim() === made.goal, await page.evaluate(() => location.hash), page);
    }
    /* a hand-made object has no back-link */
    await page.evaluate(() => MC.nav.go('campaigns', { mode: 'detail', id: 'c-hgg' }));
    await page.waitForFunction(() => /Holiday/.test((document.getElementById('page-title') || { textContent: '' }).textContent), null, { timeout: 8000 }).catch(() => {});
    const own = await page.evaluate(() => { const w = MC.store.getState(); return { has: w.missions.order.some(id => w.missions.byId[id].artifacts.some(a => a.kind === 'campaign' && a.id === 'c-hgg')), n: document.querySelectorAll('.mc-madeby').length, t: document.getElementById('page-title').textContent.trim() }; });
    await check('artifacts: an object no mission made shows no "Made by"', own.has ? true : own.n === 0, `made by a mission: ${own.has}; back-links shown: ${own.n}; "${own.t.slice(0, 30)}"`, page);
    await page.close();
  } finally { await closeCtx(ctx); }
}

/* ---- stubbed Anthropic (shared by the connect group) ---- */
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

/* ============================== main ============================== */
(async () => {
  const srv = await startServer().catch(e => { console.error('server failed: ' + e.message); process.exit(2); });
  browser = await chromium.launch();
  const secs = [['boot', secBoot], ['missions', secMissions], ['asks', secAsks], ['team', secTeam], ['artifacts', secArtifacts], ['connect', secConnect], ['no-theatre', secNoTheatre], ['determinism', secDeterminism]];
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
