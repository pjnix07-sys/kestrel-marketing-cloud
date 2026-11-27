(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const eout = t => 1 - Math.pow(1 - t, 3);
const lin = t => t;
const fmt = n => Math.round(n).toLocaleString('en-US');

const params = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('replay');

const W = 1060, H = 830, END = 62, LAUNCH = 54;
const AG = {
  scout:   { name: 'Segment Scout',    color: '#15803D', ini: 'SS' },
  copy:    { name: 'Copy Drafter',     color: '#C2410C', ini: 'CD' },
  budget:  { name: 'Budget Pacer',     color: '#1D4ED8', ini: 'BP' },
  fatigue: { name: 'Fatigue Guard',    color: '#B91C1C', ini: 'FG' },
  planner: { name: 'Campaign Planner', color: '#A16207', ini: 'CP' },
  tuner:   { name: 'Send-Time Tuner',  color: '#0E7490', ini: 'ST' },
  variant: { name: 'Variant Optimizer',color: '#BE185D', ini: 'VO' },
  analyst: { name: 'Insight Analyst',  color: '#475569', ini: 'IA' },
};
const FR = { A: { x: 20, y: 74 }, E: { x: 370, y: 74 }, B: { x: 720, y: 74 }, L: { x: 720, y: 364 }, J: { x: 20, y: 514 } };

const world = $('#world'), viewport = $('#viewport'), thread = $('#thread'), live = $('#live');

/* ---------------- clock + tweens ---------------- */
let now = 0, playing = true, lastTs = 0, fast = false, idx = 0, decided = false, launched = false, offer = 15;
const all = [], active = [];
function tw(t0, dur, fn, ease = eio) { all.push({ t0, dur, fn, ease, n: all.length }); }
function at(t, fn) { tw(t, 0, fn, lin); }
function runTweens() {
  while (idx < all.length && all[idx].t0 <= now) active.push(all[idx++]);
  for (let i = 0; i < active.length;) {
    const a = active[i];
    const p = a.dur ? clamp((now - a.t0) / a.dur) : 1;
    a.fn(a.ease(p), p);
    if (p >= 1) active.splice(i, 1); else i++;
  }
}

function wp(el, x = 0, y = 0) { const r = el.getBoundingClientRect(), w = world.getBoundingClientRect(), sc = w.width / W; return [(r.left - w.left) / sc + x, (r.top - w.top) / sc + y]; }
/* ---------------- narration ---------------- */
const say = (t, text) => at(t, () => { live.textContent = text; });

/* ---------------- cursors ---------------- */
const cur = {};
const cursorsEl = $('#cursors');
const ARROW = 'M2.5 2 2.5 20.5 7.4 16.3 10.6 23.6 14 22.1 10.8 14.9 17.5 14.6Z';
for (const [k, a] of Object.entries(AG)) {
  const el = document.createElement('div');
  el.className = 'cursor'; el.style.setProperty('--c', a.color);
  el.innerHTML = `<svg class="arrow" width="22" height="26" viewBox="0 0 22 26" aria-hidden="true"><path d="${ARROW}" fill="${a.color}" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg><span class="tag">${a.name}</span><div class="bubble"></div>`;
  cursorsEl.appendChild(el);
  cur[k] = { k, el, bub: $('.bubble', el), rx: -60, ry: 300, bx: -60, by: 300, seed: Math.random() * 6 };
  el.style.transform = 'translate(-60px,300px)';
}
function setPos(c, x, y) {
  c.rx = x; c.ry = y;
  c.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  c.el.classList.toggle('flip', c.fl !== undefined ? c.fl : x > W - 250);
  c.el.classList.toggle('up', y > H - 120);
}
function drift(c) {
  if (reduce || !launched) return;
  const t = performance.now() / 1000 + c.seed;
  c.el.style.transform = `translate(${(c.rx + Math.sin(t * .9) * 5).toFixed(1)}px,${(c.ry + Math.cos(t * 1.15) * 4).toFixed(1)}px)`;
}
const presence = $('#presence');
function join(k, t) {
  at(t, () => {
    cur[k].el.classList.add('on');
    const b = document.createElement('b'); b.style.setProperty('--c', AG[k].color); b.textContent = AG[k].ini; b.title = AG[k].name;
    presence.appendChild(b);
  });
}
function go(k, t0, dur, x, y, o = {}) {
  const c = cur[k], fx = c.bx, fy = c.by, dx = x - fx, dy = y - fy, L = Math.hypot(dx, dy) || 1;
  const arc = o.arc ?? Math.min(46, L * .14) * (o.dir || 1), nx = -dy / L, ny = dx / L;
  tw(t0, dur, e => { const off = Math.sin(Math.PI * e) * arc; setPos(c, fx + dx * e + nx * off, fy + dy * e + ny * off); }, o.ease || eio);
  c.bx = x; c.by = y;
}
function trace(k, t0, dur, fn, end, ease = lin) {
  tw(t0, dur, (e, p) => { const [x, y] = fn(e, p); setPos(cur[k], x, y); }, ease);
  cur[k].bx = end[0]; cur[k].by = end[1];
}
function bub(k, t, dur, text, o = {}) {
  at(t, () => { const c = cur[k], b = c.bub; b.textContent = text; c.fl = o.flip ?? c.rx > W - 250; c.el.classList.toggle('flip', c.fl); if (o.dy) b.style.top = (46 + o.dy) + 'px'; b.classList.add('show'); });
  at(t + dur, () => { const c = cur[k]; c.bub.classList.remove('show'); c.fl = undefined; c.bub.style.top = ''; });
}
function click(k, t) {
  at(t, () => {
    if (fast) return;
    const c = cur[k], r = document.createElement('i');
    r.className = 'ripple'; r.style.setProperty('--c', AG[k].color); r.style.left = c.rx + 'px'; r.style.top = c.ry + 'px';
    world.appendChild(r); setTimeout(() => r.remove(), 750);
  });
}
function handoff(t, a, b, label, dur = 1.5) {
  let el = null;
  tw(t, dur, (e, p) => {
    if (fast) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'baton'; el.style.setProperty('--c', AG[a].color); el.textContent = label; world.appendChild(el); }
    const A = cur[a], B = cur[b];
    const x = lerp(A.rx, B.rx, e) + 24, y = lerp(A.ry, B.ry, e) + 10 - Math.sin(Math.PI * e) * 36;
    el.style.transform = `translate(${x}px,${y}px)`;
    if (p >= 1) { el.remove(); B.el.classList.add('ping'); setTimeout(() => B.el.classList.remove('ping'), 800); }
  }, eio);
}

/* ---------------- frames ---------------- */
const F = id => $('#' + id);
function ghost(t, id) { at(t, () => F(id).classList.add('ghost')); }
function claim(t, id, own, k) {
  at(t, () => {
    const f = F(id); f.style.setProperty('--c', AG[k].color); f.classList.add('claimed');
    const o = F(own); o.style.setProperty('--c', AG[k].color); o.textContent = AG[k].name; o.classList.add('on');
  });
}
function solid(t, id) { at(t, () => F(id).classList.add('solid')); }
function typeInto(k, el, text, t0, dur, caret = true) {
  const car = document.createElement('i'); car.className = 'caret'; car.style.background = AG[k].color;
  const wr = world.getBoundingClientRect();
  const sc = () => wr.width ? 1 : 1;
  tw(t0, dur, (e, p) => {
    el.textContent = text.slice(0, Math.round(text.length * e));
    if (caret) el.appendChild(car);
    const r = car.getBoundingClientRect(), w = world.getBoundingClientRect(), s = w.width / W;
    setPos(cur[k], (r.left - w.left) / s + 3, (r.top - w.top) / s + 6);
    if (p >= 1 && !caret) car.remove();
  }, lin);
  return car;
}

/* ---------------- chat ---------------- */
function scrollThread() { thread.scrollTop = thread.scrollHeight; }
const LEAD_AV = '<svg width="16" height="16" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 20 9.5 8l4 7 2.5-4L23 20Z" fill="#14291F"/></svg>';
function leadMsg(t, text) {
  at(t, () => {
    $$('.typing', thread).forEach(n => n.remove());
    const d = document.createElement('div'); d.className = 'msg lead';
    d.innerHTML = `<span class="av">${LEAD_AV}</span><div><span class="who">Lead Strategist</span><p>${text}</p></div>`;
    thread.appendChild(d); scrollThread();
  });
}
function typingDots(t) {
  at(t, () => { const d = document.createElement('div'); d.className = 'typing'; d.innerHTML = '<i></i><i></i><i></i>'; thread.appendChild(d); scrollThread(); });
}
function userMsg(text) {
  const d = document.createElement('div'); d.className = 'msg user'; d.textContent = text; thread.appendChild(d); scrollThread();
}

const GOAL = 'Win back 400 lapsed hikers before Dec 15 without discounting more than 15%';
/* 0. goal typed in */
const cT = $('#composerText'), sendBtn = $('#sendBtn');
tw(0.7, 4.0, e => {
  const n = Math.round(GOAL.length * e);
  cT.innerHTML = n ? '' : '<span class="ph">Give the team a goal</span>';
  if (n) { cT.append(GOAL.slice(0, n)); const c = document.createElement('i'); c.className = 'caret'; cT.appendChild(c); }
  sendBtn.classList.toggle('ready', e >= 1);
}, lin);
at(5.2, () => { cT.innerHTML = '<span class="ph">Give the team a goal</span>'; sendBtn.classList.remove('ready'); userMsg(GOAL);
  $('#goalText').textContent = 'Win back 400 lapsed hikers by Dec 15, nothing over 15% off'; $('.goal-tag').classList.add('on'); live.textContent = 'Goal sent: ' + GOAL; });
typingDots(5.9);
leadMsg(7.0, 'Got it: lapsed hikers, a 15% ceiling, done by Dec 15. I\'ll split it across the team and come back once, for the one call that\'s yours.');

/* plan */
const TASKS = [
  ['scout', 'Find lapsed hikers'], ['copy', 'Write the offer email'], ['fatigue', 'Remove over-messaged people'], ['budget', 'Split the $2,400'],
  ['variant', 'Test three subject lines'], ['planner', 'Build the journey'], ['tuner', 'Set send times'], ['analyst', 'Forecast results'],
];
let planEl;
at(8.2, () => {
  planEl = document.createElement('div'); planEl.className = 'msg plan-card';
  planEl.innerHTML = `<h3>Plan <span id="planCount">0 of 8 done</span></h3><ul>${TASKS.map(([k, t]) => `<li data-k="${k}" style="--c:${AG[k].color}"><span class="tick"><svg width="9" height="9" viewBox="0 0 9 9"><path d="M1.5 4.6 3.6 6.6 7.5 2.5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="t">${t}</span><span class="who">${AG[k].name}</span></li>`).join('')}</ul>`;
  thread.appendChild(planEl); scrollThread(); live.textContent = 'Plan ready: eight tasks across eight agents.';
});
const taskLi = k => $(`li[data-k="${k}"]`, planEl);
const taskClaim = (t, k) => at(t, () => taskLi(k).classList.add('claimed'));
const taskDone = (t, k) => at(t, () => {
  const li = taskLi(k); li.classList.remove('claimed'); li.classList.add('done');
  $('#planCount').textContent = $$('li.done', planEl).length + ' of 8 done';
});

/* ---------------- canvas: frames appear, agents claim ---------------- */
[['fA', 8.6], ['fE', 8.85], ['fB', 9.1], ['fJ', 9.35], ['fL', 9.6]].forEach(([id, t]) => ghost(t, id));
const claims = [
  ['scout', 'fA', 'ownA', 10.0, 120, 140], ['copy', 'fE', 'ownE', 10.4, 420, 200], ['budget', 'fB', 'ownB', 10.8, 780, 150],
  ['planner', 'fJ', 'ownJ', 11.2, 150, 640], ['analyst', 'fL', 'ownL', 11.6, 820, 520],
];
claims.forEach(([k, f, o, t, x, y]) => {
  join(k, t - .2);
  go(k, t - .2, 1.3, x, y, { dir: k === 'copy' || k === 'planner' ? -1 : 1 });
  claim(t + 1.0, f, o, k); taskClaim(t + 1.0, k);
  click(k, t + 1.1);
});
say(11, 'Agents are claiming their parts of the board.');

/* ---------------- Segment Scout: audience ---------------- */
function rng(s) { return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const R = rng(7);
const cx = 178, cy = 106, rx = 64, ry = 46;
const lasso = [];
for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2 - Math.PI * .75, r = 1 + .09 * Math.sin(3 * a) + .06 * Math.cos(5 * a); lasso.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]); }
const inPoly = (x, y) => { let c = false; for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) { const [xi, yi] = lasso[i], [xj, yj] = lasso[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(2 * Math.PI * R());
const others = [], lapsed = [];
while (lapsed.length < 452) { const x = cx + gauss() * 27, y = cy + gauss() * 19; if (inPoly(x, y)) lapsed.push({ x, y, a: Math.atan2(y - cy, x - cx) }); }
while (others.length < 5548) { const x = 2 + R() * 286, y = 2 + R() * 216; if (!inPoly(x, y)) others.push([x, y]); }
lapsed.sort((p, q) => p.a - q.a);
const cv = $('#dots'), g = cv.getContext('2d');
let selN = 0, strikeN = 0;
function drawDots() {
  g.clearRect(0, 0, 580, 440);
  g.fillStyle = selN > 0 ? 'rgba(150,166,150,.62)' : '#9BAA9B';
  for (const [x, y] of others) g.fillRect(x * 2, y * 2, 3, 3);
  for (let i = 0; i < 452; i++) {
    const p = lapsed[i], struck = i % 12 === 0 && (i / 12) < strikeN;
    if (struck) { g.strokeStyle = '#B91C1C'; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x * 2 - 3, p.y * 2 - 3); g.lineTo(p.x * 2 + 4, p.y * 2 + 4); g.moveTo(p.x * 2 + 4, p.y * 2 - 3); g.lineTo(p.x * 2 - 3, p.y * 2 + 4); g.stroke(); continue; }
    g.fillStyle = i < selN ? '#15803D' : '#9BAA9B';
    const s = i < selN ? 4 : 3; g.fillRect(p.x * 2 - (s - 3) / 2, p.y * 2 - (s - 3) / 2, s, s);
  }
}
drawDots();
const aCount = $('#aCount');
const ax = FR.A.x + 10, ay = FR.A.y + 46;
solid(12.4, 'fA');
go('scout', 12.5, 1.0, ax + lasso[0][0], ay + lasso[0][1]);
bub('scout', 13.0, 3.4, 'Lapsed means no order in 120 days. I\'m circling people who bought jackets or boots.');
trace('scout', 13.6, 3.2, e => { const n = e * lasso.length, i = Math.min(lasso.length - 1, Math.floor(n)), j = (i + 1) % lasso.length, f = n - i; const x = lerp(lasso[i][0], lasso[j][0], f), y = lerp(lasso[i][1], lasso[j][1], f); return [ax + x, ay + y]; }, [ax + lasso[0][0], ay + lasso[0][1]]);
tw(13.6, 3.2, e => { const n = Math.max(2, Math.round(e * lasso.length)); const pts = lasso.slice(0, n).map(p => p.join(',')).join(' '); $('#lassoLine').setAttribute('points', pts + (e >= 1 ? ' ' + lasso[0].join(',') : '')); $('#lassoFill').setAttribute('points', e >= 1 ? pts : ''); }, lin);
click('scout', 16.9);
tw(17.0, 1.7, e => { selN = Math.round(452 * e); aCount.textContent = fmt(selN); drawDots(); }, eout);
go('scout', 17.2, 1.2, ax + 14, ay + 150);
bub('scout', 17.8, 2.4, '452 hikers fit. Passing them to Copy Drafter.');
handoff(19.2, 'scout', 'copy', '452 hikers', 1.4);
taskDone(19.6, 'scout');
say(19.6, 'Segment Scout found 452 lapsed hikers.');

/* ---------------- Copy Drafter: email ---------------- */
const SJ = ['Your trail has been quiet', '15% off layers for December hikes', 'Still hiking? Your PrimaLoft waits'];
solid(19.8, 'fE');
const subs = [$('#sjA'), $('#sjB'), $('#sjC')];
go('copy', 19.8, .7, FR.E.x + 60, FR.E.y + 26);
SJ.forEach((s, i) => { typeInto('copy', subs[i], s, 20.5 + i * 1.5, 1.35, true); at(20.5 + i * 1.5 + 1.36, () => $('.caret', subs[i]) && $('.caret', subs[i]).remove()); });
bub('copy', 20.6, 3.4, 'Three angles: a gentle nudge, the offer, and the gear.');
handoff(24.9, 'copy', 'variant', '3 subject lines', 1.4);
taskDone(25.2, 'copy'); // reassigned below once the body is written
// (copy task completes with body; undo early mark)
all.pop();

const mHead = $('#mHead'), mBody = $('#mBody');
go('copy', 25.0, .8, FR.E.x + 40, FR.E.y + 232);
typeInto('copy', mHead, 'Your trail has been quiet.', 25.9, 1.2);
at(27.12, () => $('.caret', mHead) && $('.caret', mHead).remove());
typeInto('copy', mBody, 'It\'s been a while since your last hike with us. This season\'s layers are in, and your next order is 15% off through Dec 15.', 27.3, 3.0);
at(30.32, () => $('.caret', mBody) && $('.caret', mBody).remove());
at(30.5, () => { $('#chip').classList.add('on'); $('#mCta').classList.add('on'); });
go('copy', 30.4, .8, FR.E.x + 200, FR.E.y + 200);
click('copy', 31.1);
taskDone(31.2, 'copy');
say(31.2, 'Copy Drafter wrote the email and three subject lines.');

/* Variant Optimizer: split test */
join('variant', 24.6);
go('variant', 24.6, 1.4, FR.E.x + 250, FR.E.y + 40, { dir: -1 });
bub('variant', 26.2, 3.4, 'Three-way test. The best subject takes the rest after 150 opens.', { flip: true });
[0, 1, 2].forEach(i => {
  go('variant', 26.2 + i * .55, .5, FR.E.x + 292, FR.E.y + 24 + 26 * i);
  click('variant', 26.75 + i * .55);
  tw(26.7 + i * .55, .8, e => { const row = $$('.sj')[i]; row.classList.add('tested'); const v = [34, 33, 33][i]; $('i', row.querySelector('u')).style.width = (e * 100) + '%'; $('em', row).textContent = Math.round(v * e) + '%'; }, eout);
});
at(28.6, () => $('#sjNote').classList.add('on'));
go('variant', 29.4, 1.2, FR.E.x + 296, FR.E.y + 112);
taskDone(29.0, 'variant');
at(29.7, () => { cur.variant.fl = true; cur.variant.el.classList.add('flip'); });

/* ---------------- Fatigue Guard ---------------- */
join('fatigue', 22.0);
go('fatigue', 22.0, 1.4, ax + 250, ay + 215);
bub('fatigue', 23.4, 3.2, '38 of them got 5+ messages in 14 days. Pausing those so we don\'t add to the pile.');
const rows = $$('.r-row');
rows.forEach((row, i) => {
  const y = FR.A.y + 272 + 18 + 24 * i + 12;
  go('fatigue', 23.5 + i * .8, .4, FR.A.x + 270, y);
  tw(23.9 + i * .8, .5, e => { $('.strike', row).style.transform = `scaleX(${e})`; if (e >= 1) row.classList.add('struck'); }, eio);
  click('fatigue', 23.9 + i * .8);
});
tw(23.8, 3.4, e => { strikeN = Math.round(38 * e); $('#fgCount').textContent = strikeN + ' paused'; if (selN === 452) aCount.textContent = fmt(452 - strikeN); drawDots(); }, eio);
go('fatigue', 27.2, 1.0, ax + 190, ay + 178);
handoff(28.6, 'fatigue', 'budget', '414 can be reached', 1.4);
taskDone(28.8, 'fatigue');
say(28.8, 'Fatigue Guard paused 38 people who were messaged too often. 414 remain.');

/* ---------------- Budget Pacer ---------------- */
const barP = wp($('#bar')), barW = 292, bx = barP[0], byc = barP[1] + 17;
const start = [25, 50, 75], endb = [47.9167, 63.75, 89.5833];
let bcur = start.slice();
function setBudget(b) {
  bcur = b;
  const cuts = [0, b[0], b[1], b[2], 100];
  $$('.seg').forEach((s, i) => { s.style.left = cuts[i] + '%'; s.style.width = (cuts[i + 1] - cuts[i]) + '%'; });
  ['k1', 'k2', 'k3'].forEach((id, i) => F(id).style.left = b[i] + '%');
  for (let i = 0; i < 4; i++) { const pct = cuts[i + 1] - cuts[i], amt = Math.round(pct * 24 / 10) * 10; $('#v' + (i + 1)).textContent = '$' + fmt(amt); $('#p' + (i + 1)).textContent = Math.round(pct) + '%'; }
}
setBudget(start);
solid(29.0, 'fB');
go('budget', 29.0, 1.0, bx + barW * .25, byc);
bub('budget', 29.8, 3.8, 'Email converts best for this group, so it gets half. SMS only where it\'s cheap.', { dy: 112 });
trace('budget', 30.1, 1.7, e => { setBudget([lerp(25, endb[0], e), lerp(50, 50 + (endb[0] - 25), e), lerp(75, 75 + (endb[0] - 25), e)]); return [bx + barW * (bcur[0] / 100), byc]; }, [bx + barW * endb[0] / 100, byc], eio);
// handle 2 and 3 settle
const b1 = endb[0];
go('budget', 31.9, .35, bx + barW * (b1 + 25) / 100, byc);
trace('budget', 32.3, 1.5, e => { setBudget([b1, lerp(b1 + 25, endb[1], e), lerp(b1 + 50, endb[2], e)]); return [bx + barW * bcur[1] / 100, byc]; }, [bx + barW * endb[1] / 100, byc], eio);
click('budget', 30.1); click('budget', 32.3);
at(34.0, () => { setBudget(endb); $('#bFoot').textContent = 'Even pace, about $126 a day for 19 days'; });
go('budget', 34.2, .9, FR.B.x + 200, FR.B.y + 226);
handoff(34.5, 'budget', 'planner', '$2,400 split', 1.3);
taskDone(34.8, 'budget');
say(34.8, 'Budget Pacer split the $2,400: $1,150 email, $380 SMS, $620 social, $250 web.');

/* ---------------- Campaign Planner: journey ---------------- */
const J = FR.J;
const nodeC = { n1: [64, 146], n2: [212, 146], n3: [360, 146], n4: [508, 72], n5: [508, 220], n6: [626, 146] };
const arrows = { a12: [212 - 52 - 4, 146], a23: [0, 0] };
solid(29.6, 'fJ');
function placeNode(k, t, id) {
  go('planner', t, .55, J.x + nodeC[id][0] + 10, J.y + nodeC[id][1] + 4);
  click('planner', t + .56);
  at(t + .6, () => F(id).classList.add('in'));
}
function drawArrow(k, t0, dur, id, lab) {
  const path = F(id); let len;
  const mid = () => { if (!len) { len = path.getTotalLength(); path.style.setProperty('--len', len); } return len; };
  const startPt = () => path.getPointAtLength(0);
  tw(t0, dur, (e, p) => {
    const L = mid(); path.classList.add('drawing'); path.style.strokeDasharray = `${L * e} 999`;
    const pt = path.getPointAtLength(L * e);
    if (p < 1 || !fast) setPos(cur[k], J.x + pt.x + 2, J.y + pt.y + 2);
    if (p >= 1) { path.classList.add('done'); if (lab) F(lab).classList.add('on'); }
  }, eio);
  const L0 = path.getTotalLength ? 0 : 0;
}
// precompute endpoints for build-time bookkeeping
const arrowEnd = { a12: [160, 146], a23: [308, 146], a34: [456, 72], a35: [456, 220], a46: [626, 118], a56: [626, 174] };
const arrowStart = { a12: [116, 146], a23: [264, 146], a34: [412, 146], a35: [412, 146], a46: [560, 72], a56: [560, 220] };
function arrow(t0, dur, id, lab) {
  const [sx, sy] = arrowStart[id], [ex, ey] = arrowEnd[id];
  go('planner', t0 - .3, .3, J.x + sx + 2, J.y + sy + 2);
  drawArrow('planner', t0, dur, id, lab);
  cur.planner.bx = J.x + ex + 2; cur.planner.by = J.y + ey + 2;
}
go('planner', 29.6, .8, J.x + 64 + 8, J.y + 120);
bub('planner', 30.3, 3.2, 'Starting from the segment: send the email, then see who opens.');
placeNode('planner', 30.6, 'n1');
placeNode('planner', 31.4, 'n2');
placeNode('planner', 32.2, 'n3');
arrow(33.5, .7, 'a12');
arrow(34.6, .7, 'a23');
go('planner', 35.5, .9, J.x + 300, J.y + 250);
bub('planner', 36.6, 7.2, 'Branches wait on the offer. Holding until you decide.');

/* ---------------- decision ---------------- */
const DEC = 36.0, DEC_AUTO = 44.0;
let decEl = null, tick = null;
function leaderUpdate() {
  const lead = $('#leader');
  if (!decEl || !lead.classList.contains('on')) return;
  const a = decEl.getBoundingClientRect(), b = $('#chipSel').getBoundingClientRect();
  const x1 = a.right + 2, y1 = a.top + a.height / 2, x2 = b.left + 2, y2 = b.top + b.height / 2;
  const mx = (x1 + x2) / 2;
  $('#leaderPath').setAttribute('d', `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
  $('#leaderEnd').setAttribute('cx', x2); $('#leaderEnd').setAttribute('cy', y2);
}
at(DEC - .8, () => { typingDots(0); });
all.pop(); typingDots(DEC - 1.2);
leadMsg(DEC, 'One call is yours. The offer that performs best is also the maximum you allowed.');
at(DEC + .35, () => {
  decEl = document.createElement('div'); decEl.className = 'decision'; decEl.setAttribute('role', 'group'); decEl.setAttribute('aria-label', 'Decision: offer 15% off to 414 people');
  decEl.innerHTML = `<div class="dec-top"><span class="dec-flag">Your call</span><output id="decTimer">Auto-approves in 8s</output></div>
  <h3>Offer 15% off to 414 lapsed hikers?</h3>
  <p class="why">Last winter's win-back brought 1.4x the orders at 15% than at 10%, and 15% is the ceiling you set.</p>
  <div class="range">
    <div class="rg-row pick"><span class="rg-l">15%</span><div class="rg-track"><i style="left:${5.1 / 8 * 100}%;width:${(7.4 - 5.1) / 8 * 100}%"></i><span style="right:${100 - 5.1 / 8 * 100 + 1.5}%">37 to 54 orders</span></div></div>
    <div class="rg-row"><span class="rg-l">10%</span><div class="rg-track"><i style="left:${4.0 / 8 * 100}%;width:${(5.7 - 4.0) / 8 * 100}%"></i><span style="left:${5.7 / 8 * 100 + 1.5}%">29 to 41</span></div></div>
    <div class="rg-axis"><span></span><div><span>$0</span><span>$4k</span><span>$8k revenue</span></div></div>
  </div>
  <div class="actions"><button class="btn primary" id="appr" type="button">Approve 15%</button><button class="btn" id="alt" type="button">Use 10% instead</button></div>
  <div class="timerbar"><i id="timerFill"></i></div>`;
  thread.appendChild(decEl); scrollThread();
  $('#appr').addEventListener('click', () => decide(15));
  $('#alt').addEventListener('click', () => decide(10));
  if (!fast) $('#appr').focus({ preventScroll: true });
  world.classList.add('deciding'); F('fE').classList.add('hl'); $('#chipSel').classList.add('on');
  $('#leader').classList.add('on');
  live.textContent = 'Decision needed: offer 15% off to 414 lapsed hikers? Expected 37 to 54 orders, $5.1k to $7.4k. Auto-approves in 8 seconds.';
});
go('copy', DEC + .3, 1.0, FR.E.x + 100, FR.E.y + 362);
bub('copy', DEC + 1.4, 6.4, '15% is the limit you set. This is the one number I won\'t move without you.');
tw(DEC + .4, DEC_AUTO - DEC - .4, (e, p) => { if (decided || !decEl) return; $('#timerFill').style.transform = `scaleX(${1 - e})`; $('#decTimer').textContent = 'Auto-approves in ' + Math.max(0, Math.ceil((1 - e) * (DEC_AUTO - DEC - .4))) + 's'; }, lin);
function decide(v, auto) {
  if (decided) return; decided = true; offer = v;
  if (decEl) { decEl.classList.add('done'); const tf = $('#timerFill'); $('#decTimer').textContent = auto ? 'Auto-approved' : 'Approved'; $('.dec-flag', decEl).textContent = 'Decided'; $('h3', decEl).textContent = `${v}% off to 414 lapsed hikers`; }
  userMsg(auto ? `No change: ${v}% it is.` : v === 15 ? 'Approve 15%.' : 'Use 10% instead.');
  $('#chipPct').textContent = v + '%';
  $('.sel span').textContent = '';
  $('#n2').lastElementChild.textContent = v + '% off layers'; $('#n4').lastElementChild.textContent = 'Last call, ' + v + '%';
  world.classList.remove('deciding'); F('fE').classList.remove('hl'); $('#chipSel').classList.remove('on'); $('#leader').classList.remove('on');
  live.textContent = `Offer set to ${v}% off.`;
  if (now < DEC_AUTO) now = DEC_AUTO;
}
at(DEC_AUTO, () => decide(15, true));
leadMsg(DEC_AUTO + .5, 'Locked in. Finishing the journey and the forecast now.');

/* ---------------- Planner part 2 ---------------- */
go('planner', 44.2, .5, J.x + 440, J.y + 150);
placeNode('planner', 44.6, 'n4');
placeNode('planner', 45.3, 'n5');
placeNode('planner', 46.0, 'n6');
arrow(47.2, .8, 'a34', 'l34');
arrow(48.4, .8, 'a35', 'l35');
arrow(49.6, .7, 'a46');
arrow(50.6, .7, 'a56');
go('planner', 51.4, .8, J.x + 520, J.y + 252);
bub('planner', 51.5, 2.6, 'Six steps, two paths, one exit when they order.');
taskDone(51.5, 'planner');

/* Fatigue Guard cap note */
go('fatigue', 44.2, 1.2, J.x + 80, J.y + 190, { dir: -1 });
at(45.6, () => { $('#noteF').classList.add('in'); });
click('fatigue', 45.5);
bub('fatigue', 45.8, 2.6, 'Capped at 2 messages a week, whatever else is running.');
go('fatigue', 48.6, 1.0, J.x + 70, J.y + 256);

/* Send-Time Tuner */
join('tuner', 46.0);
go('tuner', 46.0, 1.4, J.x + 190, J.y + 190, { dir: -1 });
at(47.6, () => $('#noteT').classList.add('in'));
click('tuner', 47.5);
bub('tuner', 47.8, 3.2, 'This group opens around 6:40 pm. Sending then, in each time zone.');
go('tuner', 51.2, .9, J.x + 330, J.y + 262);
handoff(51.2, 'tuner', 'analyst', 'Sends 6:40 pm', 1.2);
taskDone(51.4, 'tuner');

/* ---------------- Insight Analyst: forecast + board ---------------- */
const CW = 296, CH = 112 - 16;
const F_ = d => (1 - Math.exp(-d / 5)) / (1 - Math.exp(-19 / 5));
const X = d => d / 19 * CW, Y = v => 96 - v / 60 * 96 + 0;
function bandPts(hi, lo) {
  const up = [], dn = [];
  for (let d = 0; d <= 19.001; d += .5) { up.push(`${X(d).toFixed(1)},${Y(hi * F_(d)).toFixed(1)}`); dn.push(`${X(d).toFixed(1)},${Y(lo * F_(d)).toFixed(1)}`); }
  return [up, dn];
}
const [bu, bd] = bandPts(54, 37);
$('#band').setAttribute('points', [...bu, ...bd.slice().reverse()].join(' '));
$('#bandHi').setAttribute('points', bu.join(' '));
solid(49.6, 'fL');
const cP = wp($('#chart'));
go('analyst', 49.8, .9, cP[0] + 30, cP[1] + 60);
bub('analyst', 50.8, 3.4, 'At 15% I expect 37 to 54 orders by Dec 15, $5.1k to $7.4k.');
trace('analyst', 50.9, 2.3, e => { const d = e * 19; return [cP[0] + X(d) + 4, cP[1] + Y(54 * F_(d)) + 4]; }, [cP[0] + CW + 4, cP[1] + Y(54) + 4]);
tw(50.9, 2.3, e => { $('#bandRect').setAttribute('width', e * CW); $('#fcLabel').textContent = e > .6 ? 'forecast 37 to 54' : ''; }, lin);
go('analyst', 53.3, .8, cP[0] + 120, cP[1] + 56);
taskDone(53.6, 'analyst');

/* ---------------- launch ---------------- */
const STATUS = $('#status');
at(LAUNCH, () => { launched = true; STATUS.classList.add('run'); $('#statusT').textContent = 'Running, demo speed'; live.textContent = 'Campaign is live. 414 people reached, orders arriving.'; });
leadMsg(LAUNCH + .4, 'Running. 414 people are in the journey and none see more than 15% off. I expect 37 to 54 orders by Dec 15, and I\'ll only interrupt you if that moves.');
tw(LAUNCH, 1.6, e => { $('#lReach').textContent = fmt(414 * e); }, eout);
tw(LAUNCH + .2, 4, e => { $('#feed').dataset.on = 1; }, lin);

/* phase progress bar */
tw(0, END, (e, p) => { $('#pfill').style.width = (p * 100) + '%'; }, lin);

/* ---------------- live simulation (function of time after launch) ---------------- */
const AMTS = [112, 148, 96, 184, 129, 167, 88, 139, 121, 156, 104, 173];
const NAMES = ['Priya K.', 'Jonas B.', 'Dana W.', 'Ahmed S.', 'Lucy T.', 'Marcus O.', 'Elena V.', 'Sam R.', 'Hana L.', 'Cole D.'];
const ITEMS = ['PrimaLoft jacket', 'Trail runners', 'Camp kitchen kit', 'Merino base layer', 'Wool beanie', 'Trail runners'];
let shownOrders = 0, sumRev = 0, lastOpen = 0;
const noise = i => 1 + .08 * Math.sin(i * 2.3);
function ordersAt(d) { const tot = offer === 15 ? 45.5 : 35; return Math.floor(tot * F_(d) * 1.0); }
function simulate() {
  if (!launched) return;
  const day = clamp((now - LAUNCH) / 2.5, 0, 19);
  const target = ordersAt(day);
  while (shownOrders < target) {
    const i = shownOrders, amt = AMTS[i % AMTS.length]; sumRev += amt; shownOrders++;
    const li = document.createElement('li'); li.innerHTML = `<span><em>Order</em> ${NAMES[i % NAMES.length]}, ${ITEMS[i % ITEMS.length]}</span><b>$${amt}</b>`;
    const feed = $('#feed'); feed.prepend(li); while (feed.children.length > 4) feed.lastChild.remove();
  }
  const opens = Math.round(414 * .42 * (1 - Math.exp(-day / 1.4)));
  $('#lOpen').textContent = fmt(opens); $('#lOrd').textContent = shownOrders; $('#lRev').textContent = '$' + fmt(sumRev);
  const fx = x => x; 
  const pts = []; for (let d = 0; d <= day + .001; d += .25) pts.push(`${X(d).toFixed(1)},${Y(Math.floor((offer === 15 ? 45.5 : 35) * F_(d))).toFixed(1)}`);
  if (pts.length > 1) $('#actual').setAttribute('points', pts.join(' '));
  $('#actualDot').setAttribute('cx', X(day)); $('#actualDot').setAttribute('cy', Y(shownOrders)); $('#actualDot').setAttribute('opacity', 1);
  $('#planAdd').style.width = (sumRev / 222000 * 100) + '%';
  $('#planT').textContent = 'November: $' + ((169000 + sumRev) / 1000).toFixed(1) + 'k of $222k plan';
}

/* ---------------- controls ---------------- */
const btnPause = $('#btnPause');
btnPause.addEventListener('click', () => { playing = !playing; btnPause.textContent = playing ? 'Pause' : 'Resume'; btnPause.setAttribute('aria-pressed', String(!playing)); document.body.classList.toggle('paused', !playing); });
$('#btnReplay').addEventListener('click', () => { params.set('replay', '1'); location.search = params.toString(); });
$('#btnSkip').addEventListener('click', () => skipTo(END));
function skipTo(t) { fast = true; now = Math.max(now, t); runTweens(); simulate(); fast = false; $$('.baton,.ripple').forEach(n => n.remove()); }

/* ---------------- fit world ---------------- */
function fit() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const s = Math.min(w / (W + 20), h / (H + 6));
  world.style.transform = `translate(${Math.max(0, (w - W * s) / 2)}px,${Math.max(0, (h - H * s) / 2)}px) scale(${s})`;
  fitScale = s;
}
let fitScale = 1;
addEventListener('resize', fit); fit();

/* ---------------- main loop ---------------- */
all.sort((a, b) => a.t0 - b.t0 || a.n - b.n);
function frame(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(.1, (ts - lastTs) / 1000); lastTs = ts;
  if (playing) now += dt;
  runTweens(); simulate(); leaderUpdate();
  for (const k in cur) drift(cur[k]);
  requestAnimationFrame(frame);
}
if (reduce) { skipTo(END + .1); }
requestAnimationFrame(frame);
window.__studio = { get now() { return now; }, skipTo };
})();
