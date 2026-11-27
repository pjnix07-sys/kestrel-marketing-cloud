(() => {
'use strict';
const $ = s => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GOAL = 'Win back 400 lapsed hikers before Dec 15 without discounting more than 15%';

const G = {
  planner: '<path d="M2 13.5 8 2.5l6 11z"/>',
  analyst: '<path d="M3 13.5V8.5M8 13.5v-10M13 13.5v-7"/>',
  scout: '<circle cx="8" cy="8" r="4.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>',
  drafter: '<path d="M2 4h12M2 8h8M2 12h12"/>',
  fatigue: '<path d="M8 1.8 13.3 4v4c0 3-2.3 5-5.3 6.2C5 13 2.7 11 2.7 8V4z"/>',
  variant: '<path d="M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v11H9z"/>',
  budget: '<path d="M8 2a6 6 0 1 0 6 6H8z"/>',
  tuner: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.6 1.8"/>'
};
const LANES = [
  ['planner', 'Campaign Planner'], ['analyst', 'Insight Analyst'], ['scout', 'Segment Scout'], ['drafter', 'Copy Drafter'],
  ['fatigue', 'Fatigue Guard'], ['variant', 'Variant Optimizer'], ['budget', 'Budget Pacer'], ['tuner', 'Send-Time Tuner']
];
const NAME = Object.fromEntries(LANES);

/* mission time -> horizontal fraction (piecewise, so labels fit) */
const TX = [[0,0],[4.5,.012],[9.5,.14],[11,.165],[16.5,.29],[18,.32],[23.5,.45],[25,.485],[30.5,.63],[31.5,.65],[33.7,.74],[34.8,.765],[36.4,.85],[39.5,.885],[56,1]];
const tx = t => {
  if (t >= 56) return 1;
  for (let i = 1; i < TX.length; i++) if (t <= TX[i][0]) { const [a, b] = [TX[i-1], TX[i]]; return a[1] + (b[1]-a[1]) * (t-a[0]) / (b[0]-a[0]); }
  return 1;
};
const PHASES = [[4.5,'Plan'],[11,'Find and write'],[25,'Fund and schedule'],[31.5,'Assemble'],[34.8,'Decide'],[39.5,'Live']];

/* blocks: id, lane, t0, t1, label, thought, done */
const B = [
  ['plan','planner',4.5,9.5,'Split goal into tasks','Two limits to respect: Dec 15 and 15% off.','7 tasks assigned'],
  ['read','analyst',11,15,'Read past orders','Hikers who bought a shell once reorder at 11%.','Baseline set at 11%'],
  ['scout','scout',11,16.5,'Find lapsed hikers','Lapsed means no order in 120 days. Scanning 6,012 customers.','Found 450 hikers'],
  ['draft','drafter',18,23.5,'Write subject lines','Lead with the trail, not the discount.','3 subject lines ready'],
  ['fat','fatigue',18.5,24,'Remove over-messaged','Skipping anyone with 3+ messages this month.','Held out 38 of 450'],
  ['var','variant',25.5,30,'Test subject lines','Testing on 40 held-back people.','Subject B leads by 4 points'],
  ['bud','budget',25.5,30.5,'Split $2.4k by channel','Lapsed hikers open email most. Weighting there.','$2.4k split four ways'],
  ['tune','tuner',25.5,30.5,'Set send windows','Most open at 6:40 am or after 8 pm.','Windows set for 412'],
  ['jour','planner',31.8,33.7,'Journey','Nine days. Stops the moment someone buys.','9-day journey built'],
  ['fore','analyst',34.8,36.4,'Forecast','15% off beats 10% by about 4 points.','Forecast ready']
];
const LIVE = {
  planner: ['Mission running, day 1 of 19', '412 people in the journey', 'Next check-in Monday'],
  analyst: ['Tracking orders against the forecast', 'Reorders are on pace'],
  scout: ['Watching for newly lapsed hikers', 'No new lapsers since launch'],
  drafter: ['On call to rewrite weak subjects', 'Wave two drafts ready'],
  fatigue: ['412 protected from extra sends', 'Black Friday Early Access excluded'],
  variant: ['Subject B ahead by 4 points', 'Wave two tests a fourth subject'],
  budget: ['$2.4k pacing evenly', 'Holding 6% in reserve for SMS'],
  tuner: ['Sending at 6:40 am and 8 pm', 'Wave one is 71% delivered']
};
const LIVE_LABEL = { planner:'Running', analyst:'Tracking', scout:'Watching', drafter:'On call', fatigue:'Guarding', variant:'Testing', budget:'Pacing', tuner:'Sending' };

let S; // run state
const lanesEl = $('#lanes'), stage = $('#stage'), wires = $('#wires'), batons = $('#batons'), ph = $('#playhead');

function build() {
  lanesEl.innerHTML = '';
  LANES.forEach(([id, nm]) => {
    const l = document.createElement('div'); l.className = 'lane'; l.id = 'ln-' + id;
    l.innerHTML = `<div class="who"><span class="led"></span><div class="tx"><div class="nm"><svg viewBox="0 0 16 16" aria-hidden="true">${G[id]}</svg>${nm}</div><div class="st">Waiting for a task</div></div></div><div class="track" id="tr-${id}"></div>`;
    lanesEl.appendChild(l);
  });
  B.forEach(b => mkBlock(b[0], b[1], tx(b[2]), tx(b[3]), b[4]));
  LANES.forEach(([id]) => mkBlock('lv-' + id, id, tx(39.5), 1, LIVE_LABEL[id], true));
  const r = $('#ruler'); r.innerHTML = '';
  PHASES.forEach(([t, n], i) => { const e = document.createElement('div'); e.className = 'ph-l'; e.style.left = tx(t) * 100 + '%'; e.textContent = n; e.dataset.i = i; r.appendChild(e); });
}
function mkBlock(id, lane, x0, x1, label, live) {
  const e = document.createElement('div');
  e.className = live ? 'blk lv' : 'blk q'; e.id = 'b-' + id;
  e.style.left = x0 * 100 + '%'; e.style.width = (x1 - x0) * 100 + '%';
  if (live) { e.style.visibility = 'hidden'; }
  e.innerHTML = `<i class="fill"></i><span class="bl">${label}</span>`;
  $('#tr-' + lane).appendChild(e);
}

/* ---------- scenario ---------- */
function init() {
  clearTimeout(S && S.typeTimer);
  S = { now: 0, el: 0, idx: 0, gate: false, paused: false, ev: [], live: false, liveT: 0, offer: 15, dTimer: 0, done: false, handoffs: [], typed: 0, skipping: false };
  document.body.classList.remove('paused', 'skipping');
  $('#bPause').textContent = 'Pause';
  $('#goalText').textContent = ''; $('#caret').classList.remove('off'); $('#limits').classList.remove('on');
  $('#log').innerHTML = ''; wires.innerHTML = ''; batons.innerHTML = '';
  $('#decision').hidden = true; $('#board').classList.remove('hold');
  const ctrs = $('#ctrs'); ctrs.classList.remove('live');
  ['cReach','cSent','cRev'].forEach(i => $('#'+i).textContent = i === 'cRev' ? '$0' : '0');
  $('#cReachS').textContent = 'of 400 target'; $('#cSentS').textContent = 'across 4 channels'; $('#cRevS').textContent = 'from win-backs so far';
  document.querySelectorAll('.art').forEach(a => { a.className = 'art wait'; });
  $('#dots').innerHTML = ''; $('#dots').className = 'dots'; $('#segN').textContent = '450'; $('#segCap').textContent = 'lapsed hikers';
  $('#subs').innerHTML = ''; $('#jr').innerHTML = ''; $('#bbar').innerHTML = ''; $('#bl').innerHTML = '';
  $('#mCta').textContent = 'Take 15% off'; $('#budT').textContent = '$2,400';
  build();
  layoutPlayhead();
  schedule();
}

const lane = id => $('#ln-' + id);
const blk = id => $('#b-' + id);
const bdef = id => B.find(b => b[0] === id);
const setSt = (lid, txt, cls) => { const l = lane(lid); l.querySelector('.st').textContent = txt; if (cls !== undefined) l.className = 'lane ' + cls; };
const sr = $('#sr');

function narrate(who, text) {
  const ol = $('#log'), li = document.createElement('li');
  li.innerHTML = `<b></b><span></span>`; li.firstChild.textContent = who; li.lastChild.textContent = text;
  ol.appendChild(li); while (ol.children.length > 5) ol.removeChild(ol.firstChild);
  sr.textContent = who + ': ' + text;
}
function queue(id, delay) { const e = blk(id); setTimeout(() => e.classList.add('in'), S.skipping ? 0 : delay || 0); const d = bdef(id); if (S.skipping || !delay) e.classList.add('in'); setSt(d[1], 'Queued: ' + d[4].toLowerCase(), lane(d[1]).className.includes('ok') ? 'ok' : ''); }
function start(id) {
  const d = bdef(id), e = blk(id); e.className = 'blk a in';
  e.querySelector('.fill').style.animationDuration = (d[3] - d[2]) + 's';
  setSt(d[1], d[5], 'lane work');
}
function finish(id) { const d = bdef(id), e = blk(id); e.className = 'blk d in'; setSt(d[1], d[6], 'lane ok'); }
function wait(id) { const d = bdef(id); setSt(d[1], 'Waiting on you', 'lane wait'); }

function wirePath(a, b, k) {
  const s = stage.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const x1 = ra.right - s.left, y1 = ra.top + ra.height / 2 - s.top, x2 = rb.left - s.left, y2 = rb.top + rb.height / 2 - s.top;
  const r = 6, sg = y2 >= y1 ? 1 : -1, xm = Math.max(x1 + 8, Math.min(x2 - 8, x1 + (x2 - x1) * k));
  if (Math.abs(y2 - y1) < 2 * r) return `M${x1} ${y1}H${x2}`;
  return `M${x1} ${y1}H${xm - r}Q${xm} ${y1} ${xm} ${y1 + sg * r}V${y2 - sg * r}Q${xm} ${y2} ${xm + r} ${y2}H${x2}`;
}
function drawWire(h, animate) {
  const d = wirePath(blk(h.from), blk(h.to), h.k);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('pathLength', '1'); if (animate) p.classList.add('draw');
  wires.appendChild(p);
  return d;
}
function handoff(from, to, payload, k) {
  const h = { from, to, payload, k: k || .5 }; S.handoffs.push(h);
  const d = drawWire(h, !S.skipping);
  if (S.skipping || reduce) return;
  const bt = document.createElement('div'); bt.className = 'baton'; bt.textContent = payload;
  bt.style.offsetPath = `path("${d}")`;
  bt.addEventListener('animationend', e => { if (e.animationName === 'fade') bt.remove(); });
  batons.appendChild(bt);
}
function redrawWires() { wires.innerHTML = ''; S.handoffs.forEach(h => drawWire(h, false)); }

const at = (t, fn) => S.ev.push({ t, fn, n: S.ev.length });

function schedule() {
  const O = () => S.offer;
  at(0.4, () => typeGoal());
  at(4.5, () => { start('plan'); narrate('Campaign Planner', 'Reading the goal. Two limits matter: Dec 15, and nothing deeper than 15% off.'); });
  at(5.8, () => { $('#limits').classList.add('on'); });
  at(6.6, () => { narrate('Campaign Planner', 'Seven tasks, one owner each. Putting them on the board.'); B.slice(1).forEach((b, i) => queue(b[0], i * 160)); });
  at(8.6, () => narrate('Insight Analyst', 'Each agent claims the task it does best. I take the numbers.'));
  at(9.5, () => { finish('plan'); handoff('plan', 'scout', 'Goal and limits', .35); handoff('plan', 'read', 'Goal and limits', .6); });
  at(11, () => { start('scout'); start('read'); narrate('Segment Scout', 'Lapsed means no order in 120 days. Searching 6,012 customers for hikers.'); });
  at(13.2, () => { artifact('aSeg'); buildDots(); });
  at(14.6, () => { finish('read'); narrate('Insight Analyst', 'Hikers who bought a shell once reorder at 11%. That is my baseline.'); });
  at(16.5, () => { finish('scout'); narrate('Segment Scout', 'Found 450 lapsed hikers. Passing them to Copy Drafter and Fatigue Guard.');
    handoff('scout', 'draft', '450 hikers', .3); handoff('scout', 'fat', '450 hikers', .7); });
  at(18, () => { start('draft'); narrate('Copy Drafter', 'Writing three subject lines. They lead with the trail, not the discount.'); });
  at(18.5, () => { start('fat'); });
  at(19.6, () => narrate('Fatigue Guard', 'Checking who already got three messages this month. Over-messaged people stop answering.'));
  at(20.5, () => hotDots());
  at(21.5, () => { artifact('aMail'); subLines(); });
  at(23.5, () => { finish('draft'); handoff('draft', 'var', '3 subject lines', .5); });
  at(23.7, () => { narrate('Copy Drafter', 'Three subject lines are ready. Variant Optimizer will test them.'); });
  at(24, () => { finish('fat'); narrate('Fatigue Guard', '38 are over-messaged, so I am holding them out. 412 stay in.');
    handoff('fat', 'bud', '412 people', .35); handoff('fat', 'tune', '412 people', .7); cutDots(); });
  at(25.5, () => { start('var'); start('bud'); start('tune'); narrate('Budget Pacer', '$2.4k to spend. Lapsed hikers open email most, so email gets the largest share.'); artifact('aBud'); buildBudget(); });
  at(27.6, () => narrate('Send-Time Tuner', 'Most of these hikers open at 6:40 am or after 8 pm. I schedule per person.'));
  at(28.8, () => { narrate('Variant Optimizer', 'Testing on 40 held-back people. Subject B is ahead by four points.'); winSub(); });
  at(30, () => finish('var'));
  at(30.5, () => { finish('bud'); finish('tune');
    handoff('var', 'jour', 'Subject B', .25); handoff('bud', 'jour', '$2.4k split', .5); handoff('tune', 'jour', 'Send windows', .75); });
  at(31.8, () => { start('jour'); narrate('Campaign Planner', 'Putting it together as a nine-day journey. It stops the moment someone buys.'); artifact('aJour'); buildJourney(); });
  at(33.7, () => { finish('jour'); handoff('jour', 'fore', 'Journey and budget', .4); });
  at(34.8, () => { start('fore'); narrate('Insight Analyst', 'Forecast is ready. The discount decides the outcome, and that is your call.'); });
  at(36.4, () => { finish('fore'); showDecision(); }, true);
  /* gate: everything below runs after the decision */
  at(38.4, () => { narrate('Campaign Planner', `Approved at ${O()}% off. Locking it into the journey.`); showLive(); handoff('fore', 'lv-planner', `Approved: ${O()}% off`, .4); handoff('fore', 'lv-tuner', 'Go for wave one', .75); });
  at(40.4, () => narrate('Send-Time Tuner', 'Releasing wave one to 412 people. Later waves follow the journey.'));
  at(41.6, () => goLive());
  at(43, () => { LANES.forEach(([id]) => setSt(id, LIVE[id][0], 'lane live'));
    narrate('Campaign Planner', 'The mission is live. 412 people are in the journey. I will flag you only if something changes.'); S.done = true; });
}
function showLive() { LANES.forEach(([id]) => { const e = blk('lv-' + id); e.style.visibility = 'visible'; const w = e.style.width; e.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { e.style.width = w; })); }); }

/* ---------- scenario pieces ---------- */
function typeGoal() {
  const g = $('#goalText'); let i = 0;
  if (S.skipping || reduce) { g.textContent = GOAL; $('#caret').classList.add('off'); return; }
  const run = () => { i++; g.textContent = GOAL.slice(0, i);
    if (i < GOAL.length) S.typeTimer = setTimeout(run, S.paused ? 120 : 46); else setTimeout(() => $('#caret').classList.add('off'), 1200); };
  run();
  setTimeout(() => {}, 0);
}
function artifact(id) {
  const a = $('#' + id); a.className = 'art dev';
  setTimeout(() => a.classList.add('settled'), S.skipping ? 0 : 1600);
}
function pulseArt(id) { const a = $('#' + id); a.classList.remove('edit'); void a.offsetWidth; a.classList.add('edit'); }
function buildDots() {
  const d = $('#dots'); d.innerHTML = '';
  for (let i = 0; i < 450; i++) { const e = document.createElement('i'); e.style.transitionDelay = S.skipping ? '0s' : (i * 2.2) + 'ms'; d.appendChild(e); }
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('show')));
}
function pick38() { let s = 7; const set = new Set(); while (set.size < 38) { s = (s * 1103515245 + 12345) % 2147483648; set.add(s % 450); } return [...set].sort((a, b) => a - b); }
function hotDots() {
  const ds = [...$('#dots').children], idx = pick38();
  idx.forEach((i, n) => setTimeout(() => { ds[i].style.transitionDelay = '0s'; ds[i].classList.add('hot'); }, S.skipping ? 0 : n * 55));
}
function cutDots() {
  const ds = [...$('#dots').children], idx = pick38();
  idx.forEach(i => { ds[i].style.transitionDelay = '0s'; ds[i].classList.remove('hot'); ds[i].classList.add('out'); });
  const n = $('#segN'); n.textContent = '412'; $('#segCap').textContent = 'in, 38 held out';
  pulseArt('aSeg');
}
const SUBS = [['A', 'The trail is still there. So is your 15%.'], ['B', 'Your boots have been waiting since July'], ['C', 'Cold-weather layers, 15% off through Dec 15']];
function subLines() {
  const u = $('#subs'); u.innerHTML = '';
  SUBS.forEach(([k, t], i) => { const li = document.createElement('li'); li.innerHTML = `<b>${k}</b><span></span>`; li.lastChild.textContent = t; u.appendChild(li); setTimeout(() => li.classList.add('in'), S.skipping ? 0 : 500 + i * 450); });
}
function winSub() { const li = $('#subs').children[1]; if (li) { li.classList.add('win', 'in'); $('#mHead').textContent = 'Your boots have been waiting since July.'; pulseArt('aMail'); } }
const BUD = [['Email', 912, '#17667F'], ['SMS', 720, '#1F5C46'], ['Retargeting', 480, '#FF5A1F'], ['Push', 288, '#112019']];
function buildBudget() {
  const bar = $('#bbar'), bl = $('#bl'); bar.innerHTML = ''; bl.innerHTML = '';
  BUD.forEach(([n, v, c], i) => {
    const s = document.createElement('i'); s.style.background = c; bar.appendChild(s);
    const li = document.createElement('li'); li.innerHTML = `<i style="background:${c}"></i>${n}<span>$${v}</span>`; bl.appendChild(li);
    setTimeout(() => { s.style.width = (v / 2400 * 100) + '%'; li.classList.add('in'); }, S.skipping ? 0 : 300 + i * 350);
    if (S.skipping) { s.style.width = (v / 2400 * 100) + '%'; li.classList.add('in'); }
  });
}
const JR = [['Day 0, email', 'Subject B to all 412'], ['Day 3, SMS', 'To anyone who did not open'], ['Day 6, push', 'Reminder with the offer'], ['Day 9, retargeting', 'Last call, then stop']];
function buildJourney() {
  const o = $('#jr'); o.innerHTML = '';
  JR.forEach(([a, b], i) => { const li = document.createElement('li'); li.innerHTML = `<i></i><div><b>${a}</b><span>${b}</span></div>`; o.appendChild(li); setTimeout(() => li.classList.add('in'), S.skipping ? 0 : 250 + i * 380); });
}

/* ---------- the decision ---------- */
function showDecision() {
  S.gate = true; S.dLeft = 8;
  const d = $('#decision'); d.hidden = false; d.classList.remove('in'); void d.offsetWidth; d.classList.add('in');
  $('#board').classList.add('hold');
  LANES.forEach(([id]) => { if (id !== 'planner') return; });
  setSt('planner', 'Waiting on you', 'lane wait');
  $('#dBar').style.transform = 'scaleX(1)'; $('#dCount').textContent = 'Approves itself in 8s';
  narrate('Campaign Planner', 'I need one decision from you. Everything else is moving without you.');
  $('#dYes').focus({ preventScroll: true });
}
function resolve(v) {
  if (!S.gate) return;
  S.gate = false; S.offer = v;
  const d = $('#decision'); d.hidden = true; $('#board').classList.remove('hold');
  if (v === 10) { $('#mCta').textContent = 'Take 10% off'; $('#subs').children[0].lastChild.textContent = 'The trail is still there. So is your 10%.'; $('#subs').children[2].lastChild.textContent = 'Cold-weather layers, 10% off through Dec 15'; }
  setSt('planner', 'Offer: ' + v + '% off', 'lane ok');
  $('#bYes') && 0;
  const b = $('#bPause'); if (!S.skipping) b.focus({ preventScroll: true });
}
$('#dYes').addEventListener('click', () => resolve(15));
$('#dNo').addEventListener('click', () => resolve(10));

/* ---------- live counters ---------- */
const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const ease = x => x * x * (3 - 2 * x);
let ORD = [];
function mkOrders(offer) {
  let s = offer === 15 ? 11 : 23, t = 1.2, tot = 0; const out = [];
  const rate = offer === 15 ? 1 : .68, aov = offer === 15 ? 1 : 1.06;
  for (let i = 0; i < 400; i++) { s = (s * 1103515245 + 12345) % 2147483648; const gap = (0.5 + (s % 1000) / 1000 * 1.5) / rate; s = (s * 1103515245 + 12345) % 2147483648; t += gap; tot += Math.round((96 + (s % 56)) * aov); out.push([t, tot]); }
  return out;
}
function goLive() { S.live = true; S.liveT = 0; ORD = mkOrders(S.offer); $('#ctrs').classList.add('live'); updateCounters(true); }
let lastC = { r: -1, s: -1, v: -1 };
const fmt = n => n.toLocaleString('en-US');
function updateCounters(force) {
  if (!S.live) return;
  const t = S.liveT;
  const reached = Math.round(412 * ease(ramp(t, 0.5, 7)));
  const sent = Math.round(412 * ease(ramp(t, 0.5, 8)) + 251 * ease(ramp(t, 11, 15)) + 158 * ease(ramp(t, 18, 22)) + 0.35 * Math.max(0, t - 24) ** 1);
  let rev = 0; for (let i = 0; i < ORD.length && ORD[i][0] <= t; i++) rev = ORD[i][1];
  const set = (id, key, val, text) => { if (force || lastC[key] !== val) { const e = $('#' + id); e.textContent = text; lastC[key] = val; if (!force) { const c = e.closest('.ctr'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } } };
  set('cReach', 'r', reached, fmt(reached));
  set('cSent', 's', sent, fmt(sent));
  set('cRev', 'v', rev, '$' + fmt(rev));
  if (reached >= 412) $('#cReachS').textContent = 'goal met: 412 of 400';
  if (t > 11) $('#cSentS').textContent = 'email, SMS, push, retargeting';
  if (rev > 0) $('#cRevS').textContent = 'from ' + ORD.filter(o => o[0] <= t).length + ' win-backs so far';
  if (t > 1) { const k = Math.floor(t / 5); LANES.forEach(([id], i) => { const a = LIVE[id], txt = a[(k + i) % a.length]; const el = lane(id).querySelector('.st'); if (el.textContent !== txt && lane(id).classList.contains('live')) el.textContent = txt; }); }
}

/* ---------- playhead + clock ---------- */
function layoutPlayhead() {
  const t = Math.min(S.now, 39.5);
  ph.style.left = tx(t) * 100 + '%';
  const sec = Math.floor(S.el), tag = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  $('#phTag').textContent = S.live ? 'Now' : tag;
  const ps = PHASES.map(p => p[0]); let cur = -1; ps.forEach((p, i) => { if (S.now >= p) cur = i; });
  document.querySelectorAll('.ph-l').forEach((e, i) => e.classList.toggle('now', i === cur));
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
  if (S && !S.paused && !S.skipping) {
    S.el += dt;
    if (!S.gate) S.now += dt;
    else {
      S.dLeft -= dt; const n = Math.max(0, Math.ceil(S.dLeft));
      $('#dBar').style.transform = `scaleX(${Math.max(0, S.dLeft / 8)})`;
      $('#dCount').textContent = `Approves itself in ${n}s`;
      if (S.dLeft <= 0) resolve(15);
    }
    pump();
    if (S.live && !reduce) { S.liveT += dt; updateCounters(); }
    layoutPlayhead();
  }
  requestAnimationFrame(frame);
}
function pump() {
  while (S.idx < S.ev.length && S.ev[S.idx].t <= S.now && !S.gate) { const e = S.ev[S.idx++]; e.fn(); }
}
function skip() {
  if (S.done && !S.gate) return;
  S.skipping = true; document.body.classList.add('skipping');
  if (S.gate) resolve(S.offer);
  while (S.idx < S.ev.length) { const e = S.ev[S.idx++]; if (S.gate) resolve(S.offer); e.fn(); if (S.gate) resolve(S.offer); }
  S.now = 99; S.paused = false; document.body.classList.remove('paused'); $('#bPause').textContent = 'Pause';
  settleEnd();
  setTimeout(() => { S.skipping = false; document.body.classList.remove('skipping'); }, 120);
}
function settleEnd() {
  clearTimeout(S.typeTimer);
  B.forEach(b => { blk(b[0]).className = 'blk d in'; });
  LANES.forEach(([id]) => { const e = blk('lv-' + id); e.style.visibility = 'visible'; });
  $('#limits').classList.add('on'); $('#goalText').textContent = GOAL; $('#caret').classList.add('off');
  document.querySelectorAll('.art').forEach(a => a.classList.add('settled'));
  $('#board').classList.remove('hold'); $('#decision').hidden = true;
  if (!S.live) goLive();
  S.liveT = reduce ? 26 : 12; ORD = ORD.length ? ORD : mkOrders(S.offer);
  updateCounters(true);
  $('#dots').classList.add('show');
  [...$('#subs').children].forEach(li => li.classList.add('in'));
  [...$('#jr').children].forEach(li => li.classList.add('in'));
  document.querySelectorAll('.bl li').forEach(l => l.classList.add('in'));
  [...$('#bbar').children].forEach((s, i) => { s.style.width = BUD[i][1] / 2400 * 100 + '%'; });
  redrawWires(); layoutPlayhead();
}

$('#bPause').addEventListener('click', () => {
  S.paused = !S.paused; document.body.classList.toggle('paused', S.paused);
  $('#bPause').textContent = S.paused ? 'Resume' : 'Pause';
});
$('#bSkip').addEventListener('click', skip);
$('#bReplay').addEventListener('click', () => { init(); });
addEventListener('resize', () => { if (S) redrawWires(); });

init();
if (reduce) { skip(); }
requestAnimationFrame(frame);
window.__mc = { skip, resolve, get S() { return S; } };
})();
