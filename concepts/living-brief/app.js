(() => {
'use strict';

/* ---------- basics ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byId = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const AG = {
  planner:   { n: 'Campaign Planner',  m: 'CP', c: '#2A4A8A' },
  scout:     { n: 'Segment Scout',     m: 'SS', c: '#1E7040' },
  drafter:   { n: 'Copy Drafter',      m: 'CD', c: '#6B4A2B' },
  guard:     { n: 'Fatigue Guard',     m: 'FG', c: '#A0600F' },
  pacer:     { n: 'Budget Pacer',      m: 'BP', c: '#0E7280' },
  tuner:     { n: 'Send-Time Tuner',   m: 'ST', c: '#A5332A' },
  optimizer: { n: 'Variant Optimizer', m: 'VO', c: '#9A3A74' },
  analyst:   { n: 'Insight Analyst',   m: 'IA', c: '#4F5D6B' }
};

const doc = byId('doc'), margin = byId('margin'), liveEl = byId('live'), nowEl = byId('now');
const statusEl = byId('status'), statusT = byId('statusT'), ticker = byId('ticker');
const badge = document.createElement('div'); badge.className = 'badge'; badge.textContent = '1 decision waiting'; badge.setAttribute('aria-hidden', 'true'); document.body.appendChild(badge);

/* ---------- virtual clock: pausable, skippable ---------- */
let run = 0, fast = false, paused = false, timers = [], clockT = 0, lastReal = performance.now(), pending = null;
const live = { on: false, s: 0, acc: 0, branch: 'accept' };

setInterval(() => {
  const t = performance.now(), dt = Math.min(80, t - lastReal); lastReal = t;
  if (paused) return;
  clockT += dt;
  if (timers.length) {
    const due = timers.filter(x => x.at <= clockT);
    if (due.length) { timers = timers.filter(x => x.at > clockT); due.forEach(x => x.go()); }
  }
  if (live.on && !reduced) {
    live.acc += dt;
    while (live.acc >= 500) { live.acc -= 500; live.s += 0.5; renderLive(); }
  }
}, 16);

function sleep(ms) {
  const R = run;
  if (fast) return Promise.resolve();
  return new Promise(res => timers.push({ at: clockT + ms, go: () => { if (R === run) res(); } }));
}
const fork = fn => { fn().catch(e => console.error(e)); };

/* ---------- narration ---------- */
function narrate(msg) { liveEl.textContent = msg; nowEl.textContent = msg; }

/* ---------- roster, baton ---------- */
const roster = byId('roster'), mono = {};
Object.entries(AG).forEach(([k, a]) => {
  const b = document.createElement('span');
  b.className = 'rm'; b.style.setProperty('--c', a.c); b.textContent = a.m; b.title = a.n;
  b.setAttribute('role', 'listitem'); b.setAttribute('aria-label', a.n);
  roster.appendChild(b); mono[k] = b;
});
const setActive = (k, on) => mono[k] && mono[k].classList.toggle('on', on);
const allIdle = () => Object.keys(mono).forEach(k => setActive(k, false));

function handoff(a, b) {
  setActive(b, true);
  if (fast) return;
  const team = $('.team'), arcs = byId('arcs'), baton = byId('baton');
  const tr = team.getBoundingClientRect(), ra = mono[a].getBoundingClientRect(), rb = mono[b].getBoundingClientRect();
  const x1 = ra.left + ra.width / 2 - tr.left, x2 = rb.left + rb.width / 2 - tr.left;
  const y = ra.top + ra.height / 2 - tr.top, ym = y - 26 - Math.abs(x2 - x1) * 0.12, xm = (x1 + x2) / 2;
  const d = `M${x1} ${y} Q${xm} ${ym} ${x2} ${y}`;
  const NS = 'http://www.w3.org/2000/svg', p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d); p.style.stroke = AG[a].c; arcs.appendChild(p);
  const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
  baton.style.setProperty('--c', AG[a].c); baton.style.offsetPath = `path('${d}')`;
  baton.classList.remove('go'); void baton.offsetWidth;
  p.getBoundingClientRect();
  p.style.strokeDashoffset = 0; baton.classList.add('go');
  setTimeout(() => { p.style.opacity = 0; baton.classList.remove('go'); baton.style.opacity = 0; setTimeout(() => { p.remove(); baton.style.opacity = ''; }, 1500); }, 850);
}

/* ---------- margin notes ---------- */
let notes = [];
const isNarrow = () => innerWidth <= 900;
function anchorY(n, top) { return n._a && n._a.isConnected ? n._a.getBoundingClientRect().top - top - 6 : 0; }
function layout() {
  if (isNarrow()) return;
  const top = margin.getBoundingClientRect().top;
  const arr = notes.filter(n => n.isConnected).map(n => ({ n, y: anchorY(n, top), h: n.offsetHeight }));
  arr.sort((a, b) => a.y - b.y || a.n._i - b.n._i);
  let cur = 0;
  arr.forEach(o => { const y = Math.max(o.y, cur); o.n.style.transform = `translateY(${Math.round(y)}px)`; cur = y + o.h + 8; });
  margin.style.height = Math.max(0, cur) + 'px';
}
new ResizeObserver(layout).observe(doc);
addEventListener('resize', layout);

function tick(agent, text) {
  ticker.innerHTML = `<span><b style="--c:${AG[agent].c}">${AG[agent].n}</b> ${text.replace(/<[^>]+>/g, '')}</span>`;
}
function note(agent, anchor, text, st = 'working') {
  const a = AG[agent], el = document.createElement('div');
  el.className = 'note'; el.style.setProperty('--c', a.c); el.tabIndex = 0;
  el.innerHTML = `<div class="nh"><span class="mono" aria-hidden="true">${a.m}</span><span class="nn">${a.n}</span><span class="ns"></span></div><div class="nb"></div>`;
  const nb = $('.nb', el), ns = $('.ns', el);
  nb.innerHTML = text; ns.textContent = st; el.classList.add('working');
  el._a = anchor; el._i = notes.length;
  el.addEventListener('click', () => el.classList.toggle('open'));
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.classList.toggle('open'); } });
  el.style.transition = 'none';
  margin.appendChild(el); notes.push(el); layout();
  void el.offsetHeight; el.style.transition = '';
  tick(agent, text);
  return {
    el,
    say(t, s) { nb.innerHTML = t; if (s) ns.textContent = s; el.classList.remove('done'); el.classList.add('working'); tick(agent, t); layout(); },
    done(t, s = 'done') { if (t) nb.innerHTML = t; ns.textContent = s; el.classList.remove('working'); el.classList.add('done'); layout(); }
  };
}

/* ---------- follow the action ---------- */
let lastUser = -1e9;
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(e => addEventListener(e, () => { lastUser = performance.now(); }, { passive: true }));
function follow(el, off = 170) {
  if (!el || performance.now() - lastUser < 6000) return;
  const y = el.getBoundingClientRect().top + scrollY - off;
  scrollTo({ top: Math.max(0, y), behavior: fast ? 'auto' : 'smooth' });
}

/* ---------- writing helpers ---------- */
async function typeText(el, text, cps = 70) {
  if (fast) { el.textContent += text; return; }
  const step = Math.max(1, Math.round(cps / 30));
  for (let i = 0; i < text.length; i += step) { el.textContent += text.slice(i, i + step); await sleep(1000 / (cps / step)); }
}
/* parts: strings are typed in the author's colour; Nodes are inserted as they are */
async function write(p, agent, parts, cps = 70, wrap) {
  const host = wrap || p;
  for (const part of parts) {
    if (typeof part === 'string') {
      const s = document.createElement('span'); s.className = 'auth'; s.style.setProperty('--c', AG[agent].c);
      host.appendChild(s); await typeText(s, part, cps);
      setTimeout(() => s.classList.add('settled'), fast ? 0 : 300);
      if (fast) s.classList.add('settled');
    } else host.appendChild(part);
  }
}
function numEl(id, v) { const s = document.createElement('span'); s.className = 'num'; if (id) s.id = id; s.textContent = v; return s; }
function setNum(el, v) { if (!el) return; const t = String(v); if (el.textContent !== t) { el.textContent = t; if (!fast) { el.classList.add('tick'); void el.offsetWidth; el.classList.remove('tick'); } } }
async function tween(from, to, ms, cb) {
  if (fast) { cb(to); return; }
  const n = Math.max(1, Math.round(ms / 40));
  for (let i = 1; i <= n; i++) { cb(Math.round(from + (to - from) * (1 - Math.pow(1 - i / n, 3)))); await sleep(40); }
}
const show = el => el && el.classList.add('in');
const fmt = n => n.toLocaleString('en-US');
const usd = n => '$' + fmt(n);

/* ---------- document pieces ---------- */
const DOTS = 412;
const aside = new Set(); for (let k = 0; k < 38; k++) aside.add((k * 11 + 3) % DOTS);
function buildDots() {
  const svg = $('#figDots svg'); const NS = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < DOTS; i++) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 4 + (i % 64) * 11.5); c.setAttribute('cy', 5 + Math.floor(i / 64) * 12.2); c.setAttribute('r', 3.7);
    c.dataset.i = i; svg.appendChild(c);
  }
}
const SUBJ = [
  'The ridge is still there, and so is your shell',
  'Winter hiking, sorted: the PrimaLoft Ridge is back',
  'It has been a while. Here is a reason to go back out'
];
function buildSubjects() {
  const ol = byId('sjList');
  SUBJ.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${'ABC'[i]}</b><span></span><div class="bar"><i></i></div><div class="pc"></div>`;
    $('span', li).textContent = s; ol.appendChild(li);
  });
}
const JRN = [
  { d: 0,  t: 'Email, wave 1',      s: 'Thu 7:10 pm, 141 people',      pos: 'up' },
  { d: 1,  t: 'Email, wave 2',      s: 'Fri 6:40 am, 233 people',      pos: 'dn' },
  { d: 4,  t: 'Text message',       s: 'Mon Nov 30, to non-openers',   pos: 'up' },
  { d: 9,  t: 'Retargeting ads',    s: 'Sat Dec 5, social and web',    pos: 'dn' },
  { d: 16, t: 'Last call email',    s: 'Sat Dec 12, offer ends soon',  pos: 'up' },
  { d: 19, t: 'Offer ends',         s: 'Tue Dec 15',                   pos: 'dn', end: true }
];
function buildJourney() {
  const j = byId('jline'); j.innerHTML = '<div class="axis"></div><div class="nowm"></div>';
  JRN.forEach(x => {
    const left = (x.d / 19 * 100) + '%';
    const n = document.createElement('i'); n.className = 'jn'; n.style.left = left; j.appendChild(n);
    const l = document.createElement('div'); l.className = 'jl ' + x.pos + (x.end ? ' end' : ''); l.style.left = x.end ? 'auto' : left; if (x.end) l.style.right = '0';
    l.innerHTML = `<b>${x.t}</b>${x.s}`; j.appendChild(l);
  });
  $('.nowm', j).style.left = '0%';
}
const BUD = {
  ship: [['Free shipping', 600], ['Text messages', 480], ['Retargeting ads', 1320]],
  disc: [['15% discount', 1200], ['Text messages', 480], ['Retargeting ads', 720]]
};
const BC = ['#0E7280', '#4C9DA6', '#9CC9CF'];
function buildBudget() {
  const bar = byId('bbar'), lab = byId('blabels');
  BUD.ship.forEach((b, i) => {
    const s = document.createElement('div'); s.className = 'bseg'; s.style.background = BC[i]; s.style.flexGrow = b[1]; s.innerHTML = '<i class="sp"></i>'; bar.appendChild(s);
    const l = document.createElement('div'); l.className = 'bl'; l.style.flexGrow = b[1]; l.innerHTML = `<b></b><span></span>`; lab.appendChild(l);
  });
  setBudget('ship');
}
function setBudget(kind) {
  const segs = $$('.bseg'), ls = $$('.bl');
  BUD[kind].forEach((b, i) => {
    segs[i].style.flexGrow = b[1]; ls[i].style.flexGrow = b[1];
    $('b', ls[i]).textContent = usd(b[1]); $('span', ls[i]).textContent = b[0];
  });
}

/* ---------- reset ---------- */
function resetDoc() {
  notes = []; margin.innerHTML = ''; margin.style.height = '';
  doc.innerHTML = ''; doc.appendChild(byId('docT').content.cloneNode(true));
  buildDots(); buildSubjects(); buildJourney(); buildBudget();
  allIdle(); $('#arcs').innerHTML = '';
  statusEl.dataset.s = 'draft'; statusT.textContent = 'Draft brief';
  badge.classList.remove('on'); ticker.innerHTML = '';
  narrate(''); live.on = false; live.s = 0; live.acc = 0; live.branch = 'accept';
  scrollTo(0, 0);
}

/* ---------- live numbers ---------- */
function liveVals() {
  const acc = live.branch === 'accept';
  const simMin = Math.min(330, Math.floor(live.s * 3));
  const sent = Math.min(141, Math.floor(simMin * 4.7));
  const opened = Math.min(Math.floor(sent * .45), Math.floor(61 * (1 - Math.exp(-simMin / 40))));
  const clicked = Math.floor(opened * .34);
  const orders = Math.floor(clicked * (acc ? .30 : .17));
  const rev = orders * (acc ? 124 : 139);
  const spend = Math.round(sent * .62 + orders * (acc ? 22 : 0) + simMin * .9);
  const mins = 19 * 60 + 10 + simMin, h = Math.floor(mins / 60) % 12 || 12, mm = String(mins % 60).padStart(2, '0');
  return { simMin, sent, opened, clicked, orders, rev, spend, clock: `${h}:${mm} pm` };
}
function renderLive() {
  const v = liveVals();
  const set = (id, x) => setNum(byId(id), x);
  set('lv-clock', v.clock); set('lv-sent', v.sent); set('lv-open', v.opened); set('lv-click', v.clicked);
  set('lv-orders', v.orders); set('lv-rev', usd(v.rev)); set('lv-spend', usd(v.spend));
  set('bud-spent', usd(v.spend)); set('bud-orders', v.orders);
  const f = byId('goalSeg') && $('.fig', byId('goalSeg'));
  if (f) f.textContent = `374, ${v.orders} back`;
  const pct = Math.min(100, v.spend / 2400 * 100 * 6);
  $$('.bseg .sp').forEach(s => { s.style.width = pct + '%'; });
  const ws = $('.subjects'); if (ws && ws.classList.contains('measuring')) {
    const T = [34, 41, 30]; const lis = $$('li', ws); let best = 0, bv = -1;
    const k = 1 - Math.exp(-v.simMin / 25);
    const vals = T.map((t, i) => Math.max(0, Math.round(t * k + 5 * Math.sin(v.simMin / 7 + i * 2) * Math.exp(-v.simMin / 40))));
    vals.forEach((x, i) => { if (x > bv) { bv = x; best = i; } });
    lis.forEach((li, i) => { $('.bar i', li).style.width = vals[i] + '%'; $('.pc', li).textContent = `${vals[i]}% opened, ${Math.min(47, Math.floor(v.sent / 3))} sent`; li.classList.toggle('lead', i === best && v.simMin > 30); });
  }
  const nm = $('#jline .nowm'); if (nm) nm.style.left = Math.min(100, (v.simMin / 1440) / 19 * 100) + '%';
  const jc = byId('jcap'); if (jc && live.on) jc.innerHTML = `<b>Figure 3.</b> Nineteen days, five touches. Wave 1 is ${v.sent >= 141 ? 'out' : 'going out'}; it is ${v.clock}.`;
  const bc = byId('bcap'); if (bc && live.on) bc.innerHTML = `<b>Figure 4.</b> ${usd(v.spend)} of $2,400 spent, paced evenly. ${v.orders} orders so far.`;
  const lt = byId('liveNote'); if (lt) lt.dataset.v = v.orders;
}

/* ---------- the decision ---------- */
function decisionCard(anchor) {
  const el = document.createElement('div');
  el.className = 'note decision'; el.style.setProperty('--c', AG.planner.c); el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Decision needed');
  el.innerHTML = `
    <div class="nh"><span class="mono" aria-hidden="true">CP</span><span class="nn">Campaign Planner</span><span class="ns">needs your call</span></div>
    <h3>Offer 15% off, not free shipping</h3>
    <p class="sub">To 374 people. The change is tracked in the Message section.</p>
    <div class="rng" role="img" aria-label="Expected orders: free shipping 18 to 27, 15 percent off 34 to 52">
      <span class="lb">Free shipping</span><div class="tr"><i style="left:30%;width:15%"></i><span style="left:46%">18 to 27 orders</span></div>
      <span class="lb">15% off</span><div class="tr hi"><i style="left:56.7%;width:30%"></i><span style="left:6px">34 to 52 orders</span></div>
    </div>
    <p class="why"><b>Why.</b> After 120 days away, people respond to price more than to shipping. Last spring's win-back brought back 2.1 times the orders at 15% off. Revenue after the discount: <b>$4.2k to $6.4k</b>, against $2.6k to $3.9k.</p>
    <p class="chk"><b>Inside your limit.</b> No one is offered more than 15% off.</p>
    <div class="acts"><button type="button" class="yes">Accept change</button><button type="button" class="no">Reject</button></div>
    <div class="cd"><span class="cdt"></span><span>You can undo this later</span></div>
    <div class="cdbar" aria-hidden="true"><i></i></div>
    <div class="res"></div>`;
  el._a = anchor; el._i = notes.length; notes.push(el); margin.appendChild(el); layout();
  return el;
}

/* ---------- the scenario ---------- */
const GOAL = [
  { t: 'Win back 400 ' },
  { t: 'lapsed hikers', chip: 'seg' },
  { t: ' ' },
  { t: 'before Dec 15', chip: 'date' },
  { t: ' without ' },
  { t: 'discounting more than 15%', chip: 'rail' },
  { t: '.' }
];

async function play() {
  const R = run;
  resetDoc();
  if (fast) document.body.classList.add('fast');
  const q = byId;
  let chipSeg, chipDate, chipRail, scoutN1;

  narrate('Maya is writing the goal.');
  await sleep(800);

  /* 1. the goal, typed; phrases become objects as they complete */
  const goal = q('goalT');
  for (const seg of GOAL) {
    const span = document.createElement('span'); goal.appendChild(span);
    if (seg.chip) span.className = 'chip ' + (seg.chip === 'seg' ? '' : seg.chip);
    if (fast) span.textContent = seg.t;
    else for (let i = 0; i < seg.t.length; i++) { span.textContent += seg.t[i]; await sleep(seg.t[i] === ' ' ? 40 : 60); }
    if (seg.chip) {
      await sleep(260);
      const fig = document.createElement('span'); fig.className = 'fig'; span.appendChild(fig);
      span.tabIndex = 0;
      if (seg.chip === 'seg') {
        chipSeg = span; span.id = 'goalSeg'; fig.textContent = 'counting'; span.setAttribute('aria-label', 'lapsed hikers, a live segment');
        span.classList.add('live'); setActive('scout', true);
        narrate('Segment Scout recognises "lapsed hikers" as a segment it can count.');
        fork(async () => {
          scoutN1 = note('scout', span, 'That is a group I can count: customers with no order in 120 days. Counting now.', 'reading along');
        });
      } else if (seg.chip === 'date') {
        chipDate = span; fig.textContent = '19 days'; span.setAttribute('aria-label', 'before Dec 15, a date range of 19 days');
        span.classList.add('live'); setActive('planner', true);
        narrate('Campaign Planner turned "before Dec 15" into a date range: 19 days.');
        fork(async () => { note('planner', span, 'Nov 26 to Dec 15 is 19 days. That fits three touches and a last call.', 'date range').done(); });
      } else {
        chipRail = span; fig.textContent = '15% max'; span.setAttribute('aria-label', 'discounting more than 15%, a guardrail');
        span.classList.add('live'); setActive('pacer', true);
        narrate('Budget Pacer turned "more than 15%" into a guardrail.');
        fork(async () => { note('pacer', span, 'Understood: nothing goes above 15% off. I am treating it as a hard limit.', 'guardrail').done(); });
      }
      await sleep(420);
    }
  }
  q('caret').remove();
  await sleep(400);
  allIdle();

  /* 2. the plan: sections open, tasks appear, agents claim them */
  const deck = q('deck'); deck.textContent = 'Draft. Nothing has been sent yet.';
  narrate('Campaign Planner is splitting the goal into four sections and seven jobs.');
  setActive('planner', true);
  const plan = note('planner', q('sAud'), 'Here is how I would split this. Seven jobs; each agent takes the one it does best.', 'planning');
  const TASKS = [
    ['Count who has lapsed', 'scout'], ['Write the email and subject lines', 'drafter'], ['Set aside anyone over-messaged', 'guard'],
    ['Split the budget', 'pacer'], ['Choose send times', 'tuner'], ['Test the subject lines', 'optimizer'], ['Report what is working', 'analyst']
  ];
  const ul = document.createElement('ul'); ul.className = 'tasks'; plan.el.appendChild(ul);
  TASKS.forEach(([t, a]) => {
    const li = document.createElement('li'); li.style.setProperty('--c', AG[a].c);
    li.innerHTML = `<i class="bx"></i><span class="tt">${t}</span><span class="cl" title="${AG[a].n}">${AG[a].m}</span>`; ul.appendChild(li);
  });
  layout();
  const lis = $$('li', ul), secs = ['sAud', 'sMsg', 'sJrn', 'sBud'];
  for (let i = 0; i < lis.length; i++) {
    show(lis[i]);
    if (i < 4) show(q(secs[i]));
    layout(); await sleep(290);
  }
  await sleep(350);
  narrate('Agents are claiming their jobs.');
  for (let i = 0; i < lis.length; i++) { lis[i].classList.add('claimed'); setActive(TASKS[i][1], true); await sleep(230); }
  await sleep(500);
  plan.done('Seven jobs, seven agents. Each one will write into its own section.', 'planned');
  allIdle();

  /* 3a. Segment Scout: Audience */
  follow(q('sAud'), 150);
  handoff('planner', 'scout'); setActive('planner', false);
  narrate('Segment Scout is counting customers with no order in 120 days.');
  const sc = note('scout', q('sAud'), 'Searching 6,012 customers for no order in 120 days, with email consent.', 'counting');
  const audP = q('audP'), aud = numEl('aud-n', '0');
  const figFill = (async () => {
    const f = q('figDots'); show(f);
    const cs = $$('#figDots circle');
    cs.forEach((c, i) => { if (!fast) { c.classList.add('pop'); c.style.animationDelay = (i * 5) + 'ms'; } });
    layout();
  });
  await sleep(500);
  q('sAud').classList.add('filled');
  fork(async () => { await tween(0, 412, 1900, v => { setNum(aud, v); if (chipSeg) $('.fig', chipSeg).textContent = v + ' people'; }); });
  fork(async () => { await sleep(600); await figFill(); });
  await write(audP, 'scout', ['In all, ', aud, ' customers have not ordered in 120 days. Most last bought a jacket or trail shoes, and 233 have said yes to texts. Trail runners overlap by 57 people, so each person is counted once.'], 78);
  await sleep(500);
  if (scoutN1) scoutN1.done('Recognised as a segment: no order in 120 days. Counted 412.');
  sc.done('412 match. 57 are also Trail runners, so I counted them once. Passing the list on.');
  setActive('scout', false);
  mark(lis[0]);

  /* 3b. Copy Drafter: Message */
  follow(q('sMsg'), 150);
  handoff('scout', 'drafter');
  narrate('Copy Drafter is writing the email and three subject lines.');
  const cd = note('drafter', q('sMsg'), 'Starting from what they bought: mostly jackets. I will write three angles and one email.', 'drafting');
  q('sMsg').classList.add('filled');
  await sleep(400);
  const msgP = q('msgP'), msgO = q('msgO');
  await write(msgP, 'drafter', ['Open on what they bought last, not on a sale. One idea, one button, and a voice that sounds like a friend who noticed they had been gone. Three subject lines go into a test.'], 84);
  await sleep(250);
  const offer = document.createElement('span'); offer.id = 'offerS';
  msgO.appendChild(document.createTextNode(''));
  await write(msgO, 'drafter', ['The offer is '], 84);
  msgO.appendChild(offer);
  await write(msgO, 'drafter', ['free shipping on the next order'], 84, offer);
  await write(msgO, 'drafter', ['. It keeps the email honest and the cost low.'], 84);
  show(q('figMail')); layout();
  const lisS = $$('#sjList li');
  for (const li of lisS) { show(li); await sleep(480); }
  q('mail').classList.add('show');
  await sleep(1200);
  cd.done('Three subject lines and one email. The offer is free shipping for now.');
  setActive('drafter', false); mark(lis[1]);

  /* 3c. Fatigue Guard: tracked change in Audience */
  follow(q('sAud'), 150);
  handoff('drafter', 'guard');
  narrate('Fatigue Guard is checking who has been messaged this week.');
  const fg = note('guard', audP, 'Checking who has had a message this week. Black Friday Early Access already reached some of these people.', 'checking');
  await sleep(1500);
  const del = document.createElement('del'); del.className = 'tc'; del.textContent = '412';
  const ins = document.createElement('ins'); ins.className = 'tc'; ins.textContent = '374';
  aud.textContent = ''; aud.classList.remove('num'); aud.appendChild(del); aud.appendChild(ins);
  fg.say('38 people have had three or more messages in seven days. I have set them aside until Dec 3 and marked the change.', 'tracking a change');
  fork(async () => { await tween(412, 374, 1100, v => { if (chipSeg) $('.fig', chipSeg).textContent = v + ' people'; }); });
  const cs = $$('#figDots circle');
  const ordered = [...aside];
  for (let k = 0; k < ordered.length; k++) { cs[ordered[k]].classList.add('aside'); if (!fast && k % 3 === 0) await sleep(60); }
  await sleep(300);
  const audG = q('audG');
  const gIns = document.createElement('ins'); gIns.className = 'tc'; audG.appendChild(gIns);
  const gs = document.createElement('span'); gIns.appendChild(gs);
  await typeText(gs, 'Fatigue Guard set 38 aside: each has had three or more messages in seven days. They come back in on Dec 3.', 80);
  await sleep(900);
  [del].forEach(d => d.classList.add('gone')); [ins, gIns].forEach(i => i.classList.add('set'));
  aud.classList.add('num');
  fg.done('38 set aside, 374 remain. Applied inside your goal, so no sign-off needed.');
  setActive('guard', false); mark(lis[2]);
  narrate('Fatigue Guard removed 38 over-messaged people. 374 remain.');
  await sleep(400);

  /* 3d. Budget Pacer: Budget */
  follow(q('sBud'), 150);
  handoff('guard', 'pacer');
  narrate('Budget Pacer is splitting $2,400 across channels.');
  const bp = note('pacer', q('sBud'), 'Using $2,400: about what the always-on win-back spends in 19 days. Splitting it by channel.', 'splitting');
  q('sBud').classList.add('filled');
  await sleep(300);
  await write(q('budP'), 'pacer', ['Budget Pacer capped the spend at $2,400, spread evenly over 19 days so no single day takes more than 8%. For now: $600 of free shipping, $480 of texts and $1,320 of retargeting ads.'], 84);
  const bbar = q('bbar'); show(q('figBud')); layout();
  bbar.classList.add('grow'); await sleep(1500);
  bp.done('$2,400 split three ways, paced evenly. Waiting on the offer before I lock it.');
  setActive('pacer', false); mark(lis[3]);

  /* 4. the one decision */
  follow(q('msgO'), 230);
  handoff('pacer', 'planner');
  narrate('Campaign Planner is proposing a change to the offer. This one is your decision.');
  const pn = note('planner', q('msgO'), 'Free shipping reaches about 18 to 27 orders. A 15% offer reaches about 34 to 52, and stays inside your limit. I have marked the change in the text.', 'proposing');
  await sleep(1400);
  const offerDel = document.createElement('del'); offerDel.className = 'tc'; offerDel.style.setProperty('--c', AG.planner.c);
  offerDel.textContent = offer.textContent; offer.textContent = ''; offer.appendChild(offerDel);
  const offerIns = document.createElement('ins'); offerIns.className = 'tc pulse'; offerIns.style.setProperty('--c', AG.planner.c);
  offerIns.textContent = ''; offer.appendChild(document.createTextNode(' ')); offer.appendChild(offerIns);
  await typeText(offerIns, '15% off the PrimaLoft Ridge jacket and trail runners, through Dec 15', 60);
  await sleep(500);
  const card = decisionCard(offerIns);
  badge.classList.add('on');
  follow(offerIns, 200);
  narrate('Decision needed: accept or reject 15% off for 374 people. It accepts itself in 8 seconds.');
  const choice = await decide(card);
  badge.classList.remove('on');
  const accepted = choice === 'accept';
  live.branch = accepted ? 'accept' : 'reject';

  card.classList.add('closed');
  $('.ns', card).textContent = accepted ? 'accepted' : 'rejected';
  $('.res', card).textContent = accepted ? 'You accepted 15% off for 374 people.' : 'You kept free shipping.';
  if (accepted) {
    offerDel.classList.add('gone'); offerIns.classList.remove('pulse'); offerIns.classList.add('set');
    q('mOffer').classList.add('hot'); q('mOffer').textContent = '15% off the Ridge jacket and trail runners, through Dec 15';
    pn.done('I proposed 15% off instead of free shipping. It was accepted, and the email now says so.', 'proposed');
    narrate('Accepted. The offer is now 15% off.');
  } else {
    card._a = q('msgO'); offerIns.remove(); offerDel.classList.remove('tc'); offerDel.replaceWith(document.createTextNode(offerDel.textContent));
    pn.done('I proposed 15% off. It was rejected, so the offer stays free shipping: expect 18 to 27 orders.', 'proposed');
    narrate('Rejected. The offer stays free shipping.');
  }
  setActive('planner', false); 
  layout();
  await sleep(900);

  /* 5. consequences ripple through the document */
  if (accepted) {
    follow(q('sBud'), 180);
    handoff('planner', 'pacer');
    const bp2 = note('pacer', q('bbar'), 'The offer changed, so I am re-splitting: $1,200 of discount, $480 of texts, $720 of ads.', 're-splitting');
    setBudget('disc');
    q('budP').innerHTML = '';
    await write(q('budP'), 'pacer', ['Budget Pacer capped the spend at $2,400, spread evenly over 19 days so no single day takes more than 8%. The $1,200 discount allowance covers about 54 orders at 15% off, and nothing is ever discounted beyond that limit.'], 130);
    await sleep(1200);
    bp2.done('Re-split and locked: $1,200 discount, $480 texts, $720 ads. 54 orders at 15% off fit.');
    setActive('pacer', false);
  }

  follow(q('sJrn'), 150);
  handoff(accepted ? 'pacer' : 'planner', 'tuner');
  narrate('Send-Time Tuner is choosing when each person should hear from us.');
  const tn = note('tuner', q('sJrn'), 'Looking at when each person usually opens email. Two waves, so no one is woken up.', 'timing');
  q('sJrn').classList.add('filled');
  await sleep(350);
  show(q('figJrn')); layout();
  const jl = q('jline'); jl.classList.add('draw');
  fork(async () => { const ns = $$('.jn', jl), ls = $$('.jl', jl); for (let i = 0; i < ns.length; i++) { await sleep(i === 0 ? 300 : 300); show(ns[i]); show(ls[i]); } });
  await write(q('jrnP'), 'tuner', ['Email goes first, in two waves matched to when each person usually reads: 141 tonight at 7:10 pm and 233 tomorrow at 6:40 am. A text follows on Nov 30 for anyone who has not opened, ads on Dec 5, and a last call on Dec 12.'], 84);
  await sleep(500);
  tn.done('Wave 1 tonight at 7:10 pm for 141 evening readers. Wave 2 tomorrow at 6:40 am for 233.');
  setActive('tuner', false); mark(lis[4]);

  follow(q('figMail'), 150);
  handoff('tuner', 'optimizer');
  narrate('Variant Optimizer is splitting wave 1 across the three subject lines.');
  const vo = note('optimizer', q('sjList'), 'Wave 1 splits three ways, 47 people each. When one subject line leads by 8 points, I move the rest of the sends to it.', 'testing');
  q('subjects').classList.add('measuring');
  await sleep(1500);
  setActive('optimizer', false); mark(lis[5]);

  handoff('optimizer', 'analyst');
  narrate('Insight Analyst is ready to report as results arrive.');
  const ia = note('analyst', deck, 'I will read opens, clicks and orders as they land, and say so here when something moves.', 'watching');
  await sleep(1000);
  mark(lis[6]);

  /* 6. launch: the brief becomes the running campaign */
  launch(accepted, { vo, ia });
  await sleep(300);
  document.body.classList.remove('fast');
  fast = false;
}

function mark(li) { if (li) li.classList.add('ok'); }

function decide(card) {
  return new Promise(resolve => {
    const R = run; let done = false;
    const end = v => { if (done || R !== run) return; done = true; pending = null; resolve(v); };
    pending = { resolve: end };
    const yes = $('.yes', card), no = $('.no', card), cdt = $('.cdt', card), bar = $('.cdbar i', card);
    yes.addEventListener('click', () => end('accept')); no.addEventListener('click', () => end('reject'));
    if (!fast && !reduced) yes.focus({ preventScroll: true });
    if (fast || reduced) { cdt.textContent = ''; setTimeout(() => end('accept'), 0); return; }
    (async () => {
      const total = 8000, step = 100;
      for (let t = 0; t <= total && !done; t += step) {
        cdt.textContent = `Accepts itself in ${Math.ceil((total - t) / 1000)} s`;
        bar.style.width = (100 - t / total * 100) + '%';
        if (t === total) { end('accept'); break; }
        await sleep(step);
      }
    })();
  });
}

function launch(accepted, ctx) {
  statusEl.dataset.s = 'running'; statusT.textContent = 'Running, day 1 of 19';
  const deck = byId('deck');
  const acc = accepted;
  deck.classList.add('live');
  deck.innerHTML = `Wave 1 left at 7:10 pm, and it is now <span class="num" id="lv-clock">7:10 pm</span>. <span class="num" id="lv-sent">0</span> of 374 messages are out, <span class="num" id="lv-open">0</span> opened and <span class="num" id="lv-click">0</span> clicked. <span class="num" id="lv-orders">0</span> people are back, worth <span class="num" id="lv-rev">$0</span> against <span class="num" id="lv-spend">$0</span> spent of $2,400. At this pace the plan lands <b>${acc ? '34 to 52' : '18 to 27'}</b> orders by Dec 15.`;
  byId('colo').innerHTML = `Simulated pace: one second here is about three minutes of campaign time. <span id="bud-spent" class="num">$0</span> spent so far; <span id="bud-orders" class="num">0</span> orders.`;
  const cap = byId('jcap'); if (cap) cap.classList.add('live');
  byId('jline').classList.add('run');
  const seg = byId('goalSeg'); if (seg) seg.setAttribute('aria-label', 'lapsed hikers: 374 people, orders so far');
  if (acc) { /* keep the date chip live */ }
  const dc = $('.chip.date .fig'); if (dc) dc.textContent = 'day 1 of 19';
  const rc = $('.chip.rail .fig'); if (rc) rc.textContent = acc ? '15% max, in use' : '15% max, unused';
  setActive('planner', true);
  narrate('The campaign is running. Wave 1 is sending to 141 people.');
  live.on = true; live.s = (fast || reduced) ? 30 : 0; renderLive();
  scrollTo({ top: 0, behavior: fast || reduced ? 'auto' : 'smooth' });
  setTimeout(() => setActive('planner', false), 1500);
  layout();
  if (fast || reduced) { finalNotes(ctx); return; }
  /* live commentary in the margin as results arrive */
  fork(async () => {
    const t0 = run;
    await sleep(4200);
    ctx.ia.say('First opens are landing. Mostly iPhone, mostly in the first ten minutes.', 'reading');
    await sleep(5000);
    ctx.ia.say('Opens are running 11 points above the Black Friday teaser. I will keep watching clicks.', 'reading');
    ctx.vo.say('B is ahead: 41% opened against 34% and 30%. Too early to call; I keep the split even.', 'measuring');
    narrate('Subject line B is ahead, 41 percent against 34 and 30.');
    await sleep(6000);
    ctx.vo.say('B leads by 7 points. One more point and I shift the rest of wave 1 to it.', 'measuring');
    await sleep(6000);
    ctx.ia.done('Opens 11 points above the Black Friday teaser. First orders are in.', 'reading');
  });
}
function finalNotes(ctx) {
  ctx.ia.say('Opens are running 11 points above the Black Friday teaser. I will keep watching clicks.', 'reading');
  ctx.vo.say('B is ahead: 41% opened against 34% and 30%. I keep the split even until the lead holds.', 'measuring');
  const lead = $$('#sjList li')[1]; if (lead) lead.classList.add('lead');
}

/* ---------- controls ---------- */
const bPause = byId('bPause'), bSkip = byId('bSkip'), bReplay = byId('bReplay');
bPause.addEventListener('click', () => {
  paused = !paused; bPause.setAttribute('aria-pressed', paused); bPause.textContent = paused ? 'Resume' : 'Pause';
  narrate(paused ? 'Paused.' : 'Resumed.');
});
bSkip.addEventListener('click', () => {
  if (fast) return;
  paused = false; bPause.setAttribute('aria-pressed', 'false'); bPause.textContent = 'Pause';
  fast = true; document.body.classList.add('fast');
  const t = timers; timers = []; t.forEach(x => x.go());
  if (pending) pending.resolve('accept');
});
function start() {
  run++; timers = []; pending = null; fast = reduced; paused = false;
  bPause.setAttribute('aria-pressed', 'false'); bPause.textContent = 'Pause';
  play().catch(e => console.error(e));
}
bReplay.addEventListener('click', () => { document.body.classList.remove('fast'); start(); });

if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
