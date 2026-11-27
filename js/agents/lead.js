/* Marketing Cloud - Lead: the orchestrator of the mission engine (docs/AGENTIC.md). Turns one sentence into an
   objective and a plan, answers to its own questions, steering and drift into re-plans, and writes the narration.
   This file is the deterministic ("rules") brain: a phrase parser (metric, target, deadline, audience, constraints),
   templates for win-back, launch, event revenue, grow a segment and protect the list, and the voice every agent uses
   in a beat. It is pure: functions of (text, mission, world) with no clock, randomness or store access, so the same
   input always yields the same plan. MC.missions runs the plan; Claude (MC.ai.tasks.planFromGoal) returns the same shape. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var L = MC.lead = MC.lead || {};

  L.ID = 'lead';
  L.NAME = 'Lead';
  L.METRICS = ['reactivations', 'revenue', 'orders', 'signups', 'unsubs'];
  L.TEMPLATES = ['winback', 'launch', 'event', 'grow', 'protect'];
  L.CONSTRAINT_KINDS = ['maxDiscountPct', 'maxSpend', 'excludeChannel', 'maxSendsPerWeek'];
  // Step kinds a plan may use, and the agent that owns each.
  L.KIND_AGENT = { goal: 'lead', audience: 'scout', campaign: 'planner', copy: 'copy', guard: 'guard', sendtime: 'sendtime', pacer: 'pacer',
    handoff: 'lead', monitor: 'analyst', extend: 'planner', widen: 'scout', rewrite: 'copy', offer: 'planner', channel: 'planner', budget: 'planner' };
  L.KINDS = Object.keys(L.KIND_AGENT);
  L.MAX_STEPS = 16;
  L.OFFER_PCT = { none: 0, freeship: 0, pct15: 15, pct25: 25, gift: 0 };

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var DOW_NAMES = [/^sun/, /^mon/, /^tue/, /^wed/, /^thu/, /^fri/, /^sat/];
  var DOW_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)';
  var CH_WORDS = '(?:sms|texts?|text messages?|email|emails|push|social|paid|ads?|display|web|banner)';

  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function money(x) { return MC.fmt.money(x); }
  function moneyS(x) { return Math.abs(x) >= 10000 ? MC.fmt.money(x, { compact: true }) : MC.fmt.money(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function round(x) { return Math.round(x); }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function listJoin(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function lowerFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function clone(o) { return MC.util.clone(o); }
  // Dates in beats use the fixed internal calendar so the same text comes out on every run.
  function dayShort(day) { var c = T().simCalendar(day); return T().MONTHS[c.m - 1] + ' ' + c.d; }
  L.dayShort = dayShort;
  function todayOf(world) { return world && world.meta ? T().dayOf(world.meta.tick) : 0; }
  function agentName(id) {
    if (id === 'lead') return L.NAME;
    try { var d = MC.runtime && MC.runtime.def(id); if (d && d.name) return d.name; } catch (e) { /* fall through */ }
    return { scout: 'Segment Scout', copy: 'Copy Drafter', guard: 'Fatigue Guard', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer',
      planner: 'Campaign Planner', optimizer: 'Variant Optimizer', analyst: 'Insight Analyst' }[id] || id;
  }
  L.agentName = agentName;

  /* ======================= phrase parser ======================= */
  function amount(str) {
    var m = /^\$?\s*([\d,]*\.?\d+)\s*(k|m)?$/i.exec(String(str).trim());
    if (!m) return null;
    var v = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(v)) return null;
    if (m[2] && m[2].toLowerCase() === 'k') v *= 1000;
    if (m[2] && m[2].toLowerCase() === 'm') v *= 1000000;
    return v;
  }
  L.amount = amount;

  function chTokens(s) {
    var out = [];
    String(s).toLowerCase().replace(/sms|texts?|text messages?|email|push|social|paid|ads?|display|web|banner/g, function (w) {
      if (/^(sms|text)/.test(w)) out.push('sms');
      else if (w === 'email') out.push('email');
      else if (w === 'push') out.push('push');
      else if (w === 'social') out.push('social');
      else if (w === 'web' || w === 'display' || w === 'banner') out.push('web');
      else { out.push('social'); out.push('web'); }     // paid / ads
      return w;
    });
    return out.filter(function (c, i, a) { return a.indexOf(c) === i; });
  }

  // Pulls constraints out of the text; returns them and the text with those phrases blanked out.
  function takeConstraints(low) {
    var cons = [], rest = low;
    function add(kind, value) {
      for (var i = 0; i < cons.length; i++) if (cons[i].kind === kind && cons[i].value === value) return;
      cons.push({ kind: kind, value: value });
    }
    function eat(re, fn) {
      var m, guard = 0;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && guard++ < 6) {
        fn(m);
        rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
        re.lastIndex = 0;
      }
    }
    // discounts
    eat(/(?:discount\w*|offers?|promo\w*|off)\s*(?:of\s+)?(?:by\s+)?(?:no more than|not more than|more than|deeper than|higher than|over|above|beyond|under|below|less than|at most|max(?:imum)?(?: of)?|up to|capped at|no deeper than|within|to|at)\s*(\d{1,2})\s*(?:%|percent)/g,
      function (m) { add('maxDiscountPct', +m[1]); });
    eat(/(?:no more than|not more than|at most|max(?:imum)?(?: of)?|up to|under|below|less than|capped at)\s*(\d{1,2})\s*(?:%|percent)\s*(?:off|discount\w*)/g,
      function (m) { add('maxDiscountPct', +m[1]); });
    eat(/\b(?:no|without|skip|avoid|zero)\s+(?:any\s+)?(?:discount(?:s|ing)?|promo(?:s|tions?)?|coupons?|sales?\s+pricing)\b/g, function () { add('maxDiscountPct', 0); });
    // spend
    eat(/(?:under|below|less than|no more than|not more than|up to|at most|max(?:imum)?(?: of)?|within|capped at|cap(?:ped)? of|budget(?: of| is| cap)?|spend(?:ing)?(?: up to| no more than| under| at most| of)?)\s*\$\s?([\d,]*\.?\d+\s*[km]?)/g,
      function (m) { var v = amount(m[1].replace(/\s+/g, '')); if (v) add('maxSpend', v); });
    eat(/\$\s?([\d,]*\.?\d+\s*[km]?)\s*(?:budget|spend|cap|limit|max)\b/g, function (m) { var v = amount(m[1].replace(/\s+/g, '')); if (v) add('maxSpend', v); });
    // sends per week
    eat(/(?:no more than|not more than|at most|max(?:imum)?(?: of)?|up to|only|under)\s*(\d+)\s*(?:emails?|sends?|messages?|texts?|touches?|contacts?)\s*(?:a|per|each|\/)\s*week/g,
      function (m) { add('maxSendsPerWeek', +m[1]); });
    eat(/(\d+)\s*(?:emails?|sends?|messages?|texts?|touches?)\s*(?:a|per|each|\/)\s*week\s*(?:max|at most|or fewer)/g, function (m) { add('maxSendsPerWeek', +m[1]); });
    // channels
    eat(new RegExp('\\b(?:no|skip|without|exclude|avoid|except|not using|don[’\']?t (?:use|send))\\s+((?:' + CH_WORDS + '(?:\\s*(?:,|and|or|\\/)\\s*)?)+)', 'g'), function (m) {
      chTokens(m[1]).forEach(function (c) { add('excludeChannel', c); });
    });
    eat(new RegExp('\\bonly\\s+(?:use\\s+)?((?:' + CH_WORDS + '(?:\\s*(?:,|and|or|\\/)\\s*)?)+)(?!\\s+(?:a|per|each))', 'g'), function (m) {
      var only = chTokens(m[1]);
      MC.CH.ALL.forEach(function (c) { if (only.indexOf(c) < 0) add('excludeChannel', c); });
    });
    eat(new RegExp('\\b((?:' + CH_WORDS + ')(?:\\s*(?:,|and|or)\\s*(?:' + CH_WORDS + '))*)\\s+only\\b', 'g'), function (m) {
      var only = chTokens(m[1]);
      MC.CH.ALL.forEach(function (c) { if (only.indexOf(c) < 0) add('excludeChannel', c); });
    });
    return { constraints: cons, rest: rest };
  }

  function monthIndex(w) { for (var i = 0; i < 12; i++) if (w.slice(0, 3) === MONTHS[i]) return i + 1; return null; }
  function dowIndex(w) { for (var i = 0; i < 7; i++) if (DOW_NAMES[i].test(w)) return i; return null; }
  function nextDow(today, dow, inclusive) {
    var d = (dow - T().dowOfDay(today) + 7) % 7;
    if (d === 0 && !inclusive) d = 7;
    return today + d;
  }
  function eventDays(low) {
    var out = null;
    (T().EVENTS || []).forEach(function (e) { if (!out && low.indexOf(e.label.toLowerCase()) >= 0) out = e; });
    return out;
  }

  // Deadline phrase -> {day, text, rest}. `day` is the last day the goal counts. "before Dec 15" ends Dec 14.
  function takeDeadline(low, today) {
    var m, day = null, text = '', before = false, rest = low;
    function cut() { rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); }
    var lead = '(before|by|until|through|on|no later than|ending|ends|due)';
    m = new RegExp('\\b' + lead + '\\s+(?:the\\s+)?(?:end of\\s+)?' + MONTH_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b').exec(rest);
    if (m) {
      var mo = monthIndex(m[2]), dd = +m[3];
      var cur = T().simCalendar(today);
      var y = cur.y;
      var d0 = T().simDayOfYmd(y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd);
      if (d0 !== null && d0 < today - 30) d0 = T().simDayOfYmd((y + 1) + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd);
      if (d0 !== null && dd >= 1 && dd <= 31) {
        before = m[1] === 'before';
        day = before ? d0 - 1 : d0;
        text = (before ? 'before ' : 'by ') + dayShort(d0);
        cut();
        return { day: day, text: text, rest: rest };
      }
    }
    m = new RegExp('\\b' + lead + '\\s+(\\d{1,2})\\/(\\d{1,2})\\b').exec(rest);
    if (m) {
      var mo2 = +m[2], dd2 = +m[3];
      var y2 = T().simCalendar(today).y;
      var d2 = T().simDayOfYmd(y2 + '-' + (mo2 < 10 ? '0' : '') + mo2 + '-' + (dd2 < 10 ? '0' : '') + dd2);
      if (d2 !== null && mo2 >= 1 && mo2 <= 12) {
        before = m[1] === 'before';
        day = before ? d2 - 1 : d2;
        text = (before ? 'before ' : 'by ') + dayShort(d2);
        cut();
        return { day: day, text: text, rest: rest };
      }
    }
    m = new RegExp('\\b' + lead + '\\s+(?:the\\s+)?(?:this\\s+|next\\s+|coming\\s+)?' + DOW_RE + '\\b').exec(rest);
    if (m) {
      var dow = dowIndex(m[2]);
      var d3 = nextDow(today, dow, false);
      if (/\bnext\s+/.test(m[0]) && d3 - today <= 7 && T().dowOfDay(today) !== dow) d3 += 0;
      before = m[1] === 'before';
      day = before ? d3 - 1 : d3;
      text = (before ? 'before ' : 'by ') + T().DOWS[dow];
      cut();
      return { day: day, text: text, rest: rest };
    }
    m = /\b(before|by|on|for|through|until|ahead of)\s+(?:the\s+)?(black friday|cyber monday|thanksgiving)\b/.exec(rest);
    if (m) {
      var ev = eventDays(m[2]);
      if (ev) {
        before = m[1] === 'before' || m[1] === 'ahead of';
        day = before ? ev.day - 1 : ev.day;
        text = (before ? 'before ' : (m[1] === 'on' ? 'on ' : 'by ')) + ev.label;
        // keep the event words in `rest` so the template still sees them; only blank the preposition
        rest = rest.replace(m[1], ' ');
        return { day: day, text: text, rest: rest };
      }
    }
    m = /\b(?:in|within|over the next|over|for the next)\s+(\d{1,3})\s+(day|week|month)s?\b/.exec(rest);
    if (m) {
      var n = +m[1] * ({ day: 1, week: 7, month: 30 })[m[2]];
      day = today + n;
      text = 'by ' + dayShort(day);
      cut();
      return { day: day, text: text, rest: rest };
    }
    m = /\bnext week\b/.exec(rest);
    if (m) { day = today + 7; text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    m = /\b(?:this weekend)\b/.exec(rest);
    if (m) { day = nextDow(today, 0, true); text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    m = /\b(?:this week)\b/.exec(rest);
    if (m) { day = nextDow(today, 0, true); text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    m = /\b(?:by |before |until |through )?(?:the )?end of (?:the )?month\b/.exec(rest);
    if (m) { day = T().simMonthOf(today).toDay; text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    m = /\b(?:by |before |until |through )?(?:the )?end of (?:the )?year\b|\byear[- ]?end\b/.exec(rest);
    if (m) { day = T().simDayOfYmd(T().simCalendar(today).y + '-12-31'); text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    m = /\btomorrow\b/.exec(rest);
    if (m) { day = today + 1; text = 'by ' + dayShort(day); cut(); return { day: day, text: text, rest: rest }; }
    return { day: null, text: '', rest: rest };
  }

  var AUDIENCES = [
    { re: /lapsed hik|hikers? who (?:have )?lapsed|lapsed.*hik/, id: 's-lapsed', label: 'lapsed hikers' },
    { re: /gift giv|gift buyers|gifters|holiday shoppers/, id: 's-gift', label: 'gift givers' },
    { re: /trail runner|runners/, id: 's-runners', label: 'trail runners' },
    { re: /car camp|campers/, id: 's-campers', label: 'car campers' },
    { re: /summit|peak member|loyal|vip|members\b/, id: 's-loyal', label: 'Summit & Peak members' },
    { re: /new customers|first.?time|newcomers|new buyers/, id: 's-new', label: 'new customers' },
    { re: /pacific northwest|pnw/, id: 's-pnw', label: 'Pacific Northwest customers' },
    { re: /high.?(?:value|ltv)|big spenders|best customers|top customers/, id: 's-highltv', label: 'high-value customers' },
    { re: /cold.?weather|layering|winter shoppers/, id: 's-layer', label: 'cold-weather shoppers' }
  ];

  function findProduct(low) {
    var ps = (MC.data && MC.data.PRODUCTS) || [], best = null;
    ps.forEach(function (p) {
      var n = String(p.name || '').toLowerCase();
      if (!n) return;
      if (low.indexOf(n) >= 0) { if (!best || n.length > best.n.length) best = { id: p.id, n: n, name: p.name }; return; }
      var words = n.split(' '), tail = words.slice(-2).join(' ');
      if (words.length >= 2 && low.indexOf(tail) >= 0 && (!best || tail.length > best.n.length)) best = { id: p.id, n: tail, name: p.name };
    });
    return best;
  }

  // parse(text, world?) -> { text, template, metric, target, targetGiven, growthPct, by, deadlineText, byGiven, audience, constraints, event, product, missing, ... }
  L.parse = function (text, world) {
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    var low = (' ' + raw.toLowerCase().replace(/[“”"]/g, ' ').replace(/[’]/g, '\'') + ' ').replace(/\s+/g, ' ');
    var today = todayOf(world);
    var out = { text: raw, template: null, metric: null, target: null, targetGiven: false, growthPct: null, by: null, deadlineText: '', byGiven: false,
      audience: { hints: [], segmentId: null, label: '' }, constraints: [], event: null, product: null, missing: [], notes: [] };

    var tc = takeConstraints(low);
    out.constraints = tc.constraints;
    var dl = takeDeadline(tc.rest, today);
    if (dl.day !== null) { out.by = dl.day; out.deadlineText = dl.text; out.byGiven = true; }
    var rest = dl.rest;

    // event words and product
    var ev = eventDays(rest);
    if (ev) out.event = { day: ev.day, label: ev.label };
    var prod = findProduct(rest);
    if (prod) out.product = { id: prod.id, name: prod.name };

    // audience hints
    AUDIENCES.forEach(function (a) {
      if (!a.re.test(rest)) return;
      if (a.id === 's-loyal' && /\bmembers\b/.test(rest) && !/summit|peak|loyal|vip/.test(rest) && /grow|more members|new members|sign/.test(rest)) return;
      out.audience.hints.push(a.label);
      if (!out.audience.segmentId) { out.audience.segmentId = a.id; out.audience.label = a.label; }
    });
    if (world && world.segments && out.audience.segmentId && !world.segments.byId[out.audience.segmentId]) out.audience.segmentId = null;

    // template
    var has = function (re) { return re.test(rest); };
    if (has(/protect|unsubscrib|fatigue|list health|opt.?outs?|over.?messag|spam complain|too many (?:emails|messages)/)) out.template = 'protect';
    else if (has(/win.?back|reactivat|lapsed|dormant|come back|re-?engage|inactive|bring back/)) out.template = 'winback';
    else if (has(/\blaunch|introduc|unveil|new (?:product|collection|arrival|jacket|boot|line|release|gear)|debut|roll(?:ing)? out/)) out.template = 'launch';
    else if (out.event || has(/\bsale\b|early access|flash|gift guide|holiday|\bevent\b|promotion|doorbuster/) || has(/\$\s?\d/)) out.template = has(/\$\s?\d|revenue|sales\b|sell/) || out.event ? 'event' : null;
    if (!out.template && has(/grow|increase|expand|build|more (?:members|subscribers|customers)|sign.?ups?|subscribers|join/)) out.template = 'grow';
    if (!out.template && has(/revenue|sales\b|sell\b/)) out.template = 'event';

    // target
    var m;
    var pctGrow = /(?:grow|increase|lift|boost|raise|expand|build)[^%]{0,60}?\bby\s+(\d{1,3})\s*(?:%|percent)/.exec(rest);
    if (pctGrow) { out.growthPct = +pctGrow[1]; out.targetGiven = true; }
    var mm = /\$\s?([\d,]*\.?\d+)\s*(k|m)?\b/.exec(rest);
    if (mm && !pctGrow) {
      var dollars = amount('$' + mm[1] + (mm[2] || ''));
      if (dollars) { out.target = dollars; out.targetGiven = true; out.metric = 'revenue'; }
    }
    if (!out.targetGiven) {
      var re = /(^|[^\w$.\/#-])(\d[\d,]*(?:\.\d+)?)\s*(k)?(?![\w%\/.]*\d)(?=\s|$|[.,;])/g, nm;
      while ((nm = re.exec(rest))) {
        var after = rest.slice(nm.index + nm[0].length, nm.index + nm[0].length + 14);
        if (/^\s*(?:day|week|month|%|percent|pm|am|hour)/.test(after)) continue;
        var v = parseFloat(nm[2].replace(/,/g, '')) * (nm[3] ? 1000 : 1);
        if (isFinite(v) && v > 0) { out.target = v; out.targetGiven = true; break; }
      }
    }
    // metric
    if (!out.metric) {
      if (out.template === 'winback') out.metric = 'reactivations';
      else if (out.template === 'protect') out.metric = 'unsubs';
      else if (out.template === 'grow') out.metric = 'signups';
      else if (out.template === 'launch') out.metric = has(/revenue|sales/) && out.targetGiven && out.target > 1000 ? 'revenue' : 'orders';
      else if (out.template === 'event') out.metric = 'revenue';
      else if (has(/sign.?ups?|subscribers/)) out.metric = 'signups';
      else if (has(/orders?|purchases|conversions|buyers/)) out.metric = 'orders';
    }
    if (out.metric === 'revenue' && out.target !== null && out.target < 100 && !/\$/.test(rest)) { out.target = null; out.targetGiven = false; }
    if (!out.template && out.metric) out.template = { reactivations: 'winback', revenue: 'event', orders: 'launch', signups: 'grow', unsubs: 'protect' }[out.metric];

    // event deadlines: "on Black Friday" ends a day after
    if (!out.byGiven && out.event && out.template === 'event') { out.by = out.event.day + 1; out.deadlineText = 'by ' + dayShort(out.by); out.byGiven = true; }

    if (!out.template) out.missing.push('goal');
    else {
      if (!out.targetGiven) out.missing.push('target');
      if (!out.byGiven) out.missing.push('deadline');
    }
    return out;
  };

  /* ======================= constraints ======================= */
  L.constraintLabel = function (c) {
    if (!c) return '';
    if (c.kind === 'maxDiscountPct') return c.value > 0 ? 'Discounts up to ' + c.value + '%' : 'No discounts';
    if (c.kind === 'maxSpend') return 'Spend up to ' + money(c.value);
    if (c.kind === 'excludeChannel') return 'No ' + (c.value === 'sms' ? 'SMS' : chLower(c.value));
    if (c.kind === 'maxSendsPerWeek') return 'At most ' + c.value + (c.value === 1 ? ' send' : ' sends') + ' a week';
    return c.kind;
  };
  L.constraintOf = function (list, kind) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].kind === kind) return list[i];
    return null;
  };
  // Later statements win for single-valued constraints (a steer replaces the old limit); channel exclusions accumulate.
  L.mergeConstraints = function (oldList, newList) {
    var out = clone(oldList || []);
    (newList || []).forEach(function (n) {
      if (n.kind === 'excludeChannel') { if (!out.some(function (o) { return o.kind === n.kind && o.value === n.value; })) out.push(clone(n)); return; }
      var hit = false;
      out = out.map(function (o) { if (o.kind === n.kind) { hit = true; return clone(n); } return o; });
      if (!hit) out.push(clone(n));
    });
    return out;
  };
  function allowedChannels(cons, wanted) {
    var ex = (cons || []).filter(function (c) { return c.kind === 'excludeChannel'; }).map(function (c) { return c.value; });
    var list = wanted.filter(function (c) { return ex.indexOf(c) < 0; });
    return list.length ? list : MC.CH.ALL.filter(function (c) { return ex.indexOf(c) < 0; }).slice(0, 1);
  }
  L.allowedChannels = allowedChannels;
  function offerFor(template, cons) {
    var cap = L.constraintOf(cons, 'maxDiscountPct');
    var prefs = { winback: ['pct15', 'freeship', 'none'], event: ['pct25', 'pct15', 'freeship', 'none'], launch: ['none'], grow: ['freeship', 'none'], protect: ['none'] }[template] || ['none'];
    for (var i = 0; i < prefs.length; i++) if (!cap || L.OFFER_PCT[prefs[i]] <= cap.value) return prefs[i];
    return 'none';
  }
  L.offerFor = offerFor;
  L.offerLabel = function (o) { return { none: 'no offer', freeship: 'free shipping', pct15: '15% off', pct25: '25% off', gift: 'a free gift' }[o] || o; };

  /* ======================= objective text ======================= */
  L.objectiveText = function (o) {
    if (!o) return '';
    var by = isNum(o.by) ? ' ' + (o.deadlineText || 'by ' + dayShort(o.by)) : '';
    if (o.metric === 'reactivations') return 'win back ' + num(o.target) + ' customers' + by;
    if (o.metric === 'revenue') return 'reach ' + moneyS(o.target) + ' in revenue' + by;
    if (o.metric === 'orders') return 'drive ' + num(o.target) + ' orders' + by;
    if (o.metric === 'signups') return 'add ' + num(o.target) + ' new sign-ups' + by;
    if (o.metric === 'unsubs') return 'keep unsubscribes under ' + num(o.target) + (isNum(o.by) ? ' through ' + dayShort(o.by) : '');
    return String(o.metric || 'hit the goal');
  };
  L.metricNoun = function (metric, plural) {
    return { reactivations: plural === false ? 'win-back' : 'win-backs', revenue: 'revenue', orders: plural === false ? 'order' : 'orders', signups: plural === false ? 'sign-up' : 'sign-ups', unsubs: plural === false ? 'unsubscribe' : 'unsubscribes' }[metric] || metric;
  };
  L.fmtMetric = function (metric, v) { return metric === 'revenue' ? moneyS(v) : num(v); };
  L.GOAL_TYPE = { reactivations: 'reactivation', revenue: 'revenue', orders: 'conversions', signups: 'conversions', unsubs: 'engagement' };

  /* ======================= templates ======================= */
  function step(id, kind, title, needs, extra) {
    return Object.assign({ id: id, agentId: L.KIND_AGENT[kind], kind: kind, title: title, needs: needs || [], status: 'queued',
      startedTick: null, doneTick: null, actions: [], artifact: null, note: '' }, extra || {});
  }
  L.step = step;

  function audienceWord(p) { return p.audience.label || { winback: 'lapsed customers', launch: 'likely buyers', event: 'your best customers', grow: 'new customers', protect: 'over-messaged people' }[p.template] || 'your audience'; }

  function templateSteps(p) {
    var a = audienceWord(p);
    if (p.template === 'protect') {
      return [
        step('s1', 'goal', 'Confirm the goal and the limit', []),
        step('s2', 'audience', 'Find people who are hearing from us too often', ['s1']),
        step('s3', 'guard', 'Rest the people closest to unsubscribing', ['s2']),
        step('s4', 'monitor', 'Watch the unsubscribe rate every day', ['s3'])
      ];
    }
    var campaignTitle = { winback: 'Draft the win-back campaign: journey, channels and dates', launch: 'Draft the launch campaign: journey, channels and dates',
      event: 'Draft the campaign: journey, channels and dates', grow: 'Draft the sign-up campaign: journey, channels and dates' }[p.template];
    return [
      step('s1', 'goal', 'Confirm the goal and set the plan', []),
      step('s2', 'audience', 'Find and size ' + a, ['s1']),
      step('s3', 'campaign', campaignTitle, ['s2']),
      step('s4', 'copy', 'Write the messages for each channel', ['s3']),
      step('s5', 'guard', 'Rest anyone who has heard from us too often', ['s3']),
      step('s6', 'sendtime', 'Choose send times for each channel', ['s3']),
      step('s7', 'pacer', 'Split the budget across channels', ['s3']),
      step('s8', 'handoff', 'Hand the draft over for your sign-off', ['s4', 's5', 's6', 's7']),
      step('s9', 'monitor', 'Start tracking progress every day', ['s8'])
    ];
  }

  // Suggested targets for the clarifying ask, sized from the audience when the world can say how big it is.
  function audienceSize(world, p) {
    if (!world) return null;
    try {
      if (p.audience.segmentId && world.segments.byId[p.audience.segmentId]) return world.segments.byId[p.audience.segmentId].count || null;
      if (p.template === 'winback' && world.segments.byId['s-lapsed']) return world.segments.byId['s-lapsed'].count || null;
    } catch (e) { /* no size */ }
    return null;
  }
  function niceNum(x) {
    if (x >= 10000) return Math.round(x / 1000) * 1000;
    if (x >= 1000) return Math.round(x / 100) * 100;
    if (x >= 100) return Math.round(x / 10) * 10;
    return Math.max(1, Math.round(x));
  }
  function targetChoices(p, size) {
    var base;
    if (p.metric === 'reactivations') base = [0.08, 0.15, 0.25].map(function (f) { return niceNum((size || 1500) * f); });
    else if (p.metric === 'signups') base = [0.05, 0.1, 0.2].map(function (f) { return niceNum((size || 2000) * f); });
    else if (p.metric === 'orders') base = [100, 250, 500];
    else if (p.metric === 'unsubs') base = [20, 40, 80];
    else base = [10000, 25000, 50000];
    return base;
  }
  function deadlineChoices(today) {
    return [today + 7, today + 14, today + 21];
  }

  function missingAsk(p, field, world, stepId, askId) {
    var today = todayOf(world), noun = L.metricNoun(p.metric), a;
    if (field === 'target') {
      var vals = targetChoices(p, audienceSize(world, p));
      var label = function (v) { return p.metric === 'revenue' ? moneyS(v) : num(v); };
      a = { id: askId, stepId: stepId, agentId: 'lead', kind: 'goal-field', field: 'target', blocking: true,
        question: 'How many ' + noun + ' should I aim for?',
        why: 'You didn’t give a number, and the plan (budget, channels, how hard to push) depends on it.',
        impact: { metric: noun, lo: vals[0], hi: vals[2] },
        options: vals.map(label), values: vals, default: label(vals[1]) };
    } else {
      var days = deadlineChoices(today), lab = function (d) { return dayShort(d); };
      a = { id: askId, stepId: stepId, agentId: 'lead', kind: 'goal-field', field: 'deadline', blocking: true,
        question: 'By when do you need this?',
        why: 'The deadline sets how long the campaign runs and how fast the budget can be spent.',
        impact: { metric: noun, lo: 0, hi: 0 },
        options: days.map(lab), values: days, default: lab(days[1]) };
    }
    a.status = 'open'; a.answer = null; a.by = null; a.createdTick = null; a.answeredTick = null;
    return a;
  }
  L.missingAsk = missingAsk;

  function defaultsFor(p, world) {
    var size = audienceSize(world, p), today = todayOf(world), t = p.target;
    if (!p.targetGiven) t = targetChoices(p, size)[1];
    if (p.growthPct) t = Math.max(10, niceNum((size || 2000) * p.growthPct / 100));
    var by = p.by;
    if (by === null) by = today + (p.template === 'protect' ? 28 : 21);
    return { target: t, by: by };
  }

  // plan(world, text, opts?) -> { title, objective, constraints, plan, asks, data, beats, template, parsed, brain:'rules' }
  // opts.parsed lets a caller (a clarifying answer) supply an already-parsed goal.
  L.plan = function (world, text, opts) {
    opts = opts || {};
    var p = opts.parsed || L.parse(text, world);
    var today = todayOf(world), asks = [], missing = p.missing.slice();
    var template = p.template || 'event';
    if (!p.template) p.template = 'event';
    if (!p.metric) p.metric = { winback: 'reactivations', launch: 'orders', event: 'revenue', grow: 'signups', protect: 'unsubs' }[template];
    var d = defaultsFor(p, world);
    var objective = { metric: p.metric, target: d.target, by: d.by, deadlineText: p.deadlineText || 'by ' + dayShort(d.by), constraints: clone(p.constraints), direction: p.metric === 'unsubs' ? 'atMost' : 'atLeast' };
    var plan = templateSteps(p);
    var goalStep = plan[0];
    // Nothing essential to go on: ask what kind of result they want before doing any work.
    if (missing.indexOf('goal') >= 0) {
      asks.push({ id: 'a1', stepId: 's1', agentId: 'lead', kind: 'goal-template', field: 'template', blocking: true,
        question: 'What are you trying to get done: win back lapsed customers, launch something, hit a revenue number, grow a list, or protect it?',
        why: 'I couldn’t tell the kind of result you want from that sentence, and the plan is different for each.',
        impact: { metric: 'plan', lo: 0, hi: 0 },
        options: ['Win back lapsed customers', 'Launch a product', 'Hit a revenue number', 'Grow a list', 'Protect the list'],
        values: ['winback', 'launch', 'event', 'grow', 'protect'], default: 'Hit a revenue number',
        status: 'open', answer: null, by: null, createdTick: null, answeredTick: null });
    } else if (missing.length) {
      asks.push(missingAsk(p, missing[0], world, 's1', 'a1'));
    }
    if (asks.length) { goalStep.status = 'blocked'; goalStep.note = 'Waiting for your answer.'; }
    var data = {
      template: template, audience: clone(p.audience), product: p.product ? p.product.id : null, productName: p.product ? p.product.name : '',
      event: p.event ? clone(p.event) : null, missing: missing.filter(function (x) { return x !== 'goal'; }), overrides: {}, parsedBy: 'rules',
      growthPct: p.growthPct, notes: p.notes.slice()
    };
    var title = cap1(String(p.text || '').replace(/[.!?]+$/, '')).slice(0, 140);
    var beats = [];
    return { title: title, objective: objective, constraints: objective.constraints, plan: plan, asks: asks, data: data, beats: beats, template: template, parsed: p, brain: 'rules' };
  };

  /* ======================= brief for the Campaign Planner step ======================= */
  // brief(world, mission) -> the MC.planner brief for this mission at today's date.
  L.brief = function (world, m) {
    var d = m.data || {}, o = m.objective, cons = (o && o.constraints) || [];
    var ov = d.overrides || {};
    var today = todayOf(world), template = d.template;
    var startDay = today + 1;
    if (template === 'event' && d.event && d.event.day - 1 > startDay) startDay = d.event.day - 1;
    var by = isNum(o.by) ? o.by : startDay + 14;
    var endDay = Math.max(startDay + 1, Math.min(by, startDay + 27));
    var wanted = { winback: ['email', 'sms', 'push'], launch: ['email', 'push', 'social'], event: ['email', 'sms', 'push', 'social'], grow: ['email', 'social', 'web'], protect: ['email'] }[template] || ['email', 'push'];
    var chans = allowedChannels(cons, wanted);
    if (ov.leadChannel && chans.indexOf(ov.leadChannel) >= 0) chans = [ov.leadChannel].concat(chans.filter(function (c) { return c !== ov.leadChannel; }));
    var days = endDay - startDay + 1;
    var cap = (world.guardrails && world.guardrails.maxDailySpend) || 2500;
    var dflt = { winback: 3000, launch: 5000, event: 6000, grow: 4000, protect: 0 }[template] || 4000;
    var budget = Math.min(dflt, Math.max(500, Math.floor(cap * 0.8 * days / 100) * 100));
    var ms = L.constraintOf(cons, 'maxSpend');
    if (ms) budget = Math.max(500, Math.min(budget, Math.floor(ms.value / 100) * 100 || ms.value));
    if (isNum(ov.budget)) budget = Math.max(500, ov.budget);
    var aud = d.audience || {};
    var names = { winback: 'Win-back: ' + (aud.label || 'lapsed customers'), launch: 'Launch: ' + (d.productName || 'new arrivals'),
      event: d.event ? d.event.label + ' push' : 'Revenue push: ' + dayShort(endDay), grow: 'Grow: ' + (aud.label || 'new members') };
    var goalType = L.GOAL_TYPE[o.metric] || 'revenue';
    var offer = ov.offer || offerFor(template, cons);
    return {
      name: String(names[template] || 'Mission campaign').slice(0, 80), goal: { type: goalType, target: o.target }, productFocus: d.product || null,
      segmentId: aud.resolvedId || aud.segmentId || null, budget: budget, startDay: startDay, endDay: endDay, channels: chans,
      tone: { winback: 'warm', launch: 'adventurous', event: 'urgent', grow: 'warm' }[template] || 'practical', offer: offer,
      notes: cap1(L.objectiveText(o)) + '. Drafted by the mission team; review before scheduling.', eventDay: d.event ? d.event.day : null
    };
  };

  /* ======================= answers ======================= */
  function optionIndex(ask, answer) {
    var a = String(answer == null ? '' : answer).trim().toLowerCase(), i;
    for (i = 0; i < (ask.options || []).length; i++) if (String(ask.options[i]).toLowerCase() === a) return i;
    if (/^\d+$/.test(a) && +a >= 1 && +a <= (ask.options || []).length && false) return +a - 1;
    return -1;
  }
  L.optionIndex = optionIndex;
  function isNo(ask, answer, idx) {
    var a = String(answer == null ? '' : answer).trim().toLowerCase();
    if (idx >= 0) return /^(no|stop|not yet|hold|cancel)\b/.test(String(ask.options[idx]).toLowerCase());
    return /^(no|stop|nope|not yet|hold off|cancel)\b/.test(a);
  }
  function stepPatch(m, id, patch) { var o = {}; o[id] = patch; return o; }

  // onAnswer(mission, ask, answer, world?) -> { steps:{id:patch}, data?, objective?, constraints?, asks?:[new asks], beats:[], status?, template? }
  // Pure: the consequence of an answer, computed inside the logged action so replay repeats it exactly.
  L.onAnswer = function (m, ask, answer, world) {
    var res = { steps: {}, beats: [], asks: [] }, idx = optionIndex(ask, answer), no = isNo(ask, answer, idx);
    var text = String(answer == null ? '' : answer).trim();
    function say(agentId, kind, t, ref) { res.beats.push({ agentId: agentId, kind: kind, text: t, ref: ref }); }
    var objective = clone(m.objective), data = clone(m.data || {});
    if (ask.kind === 'goal-template') {
      var tmpl = idx >= 0 ? ask.values[idx] : null;
      if (!tmpl) { var p0 = L.parse(text, world); tmpl = p0.template; }
      if (!tmpl) { say('lead', 'thought', 'I still can’t tell which of those you mean. Pick one of the options and I’ll take it from there.'); res.reask = true; return res; }
      var base = L.parse(m.goalText || '', world);
      base.template = tmpl;
      base.metric = { winback: 'reactivations', launch: 'orders', event: 'revenue', grow: 'signups', protect: 'unsubs' }[tmpl];
      base.missing = [];
      if (!base.targetGiven) base.missing.push('target');
      if (!base.byGiven) base.missing.push('deadline');
      var np = L.plan(world, m.goalText, { parsed: base });
      res.replacePlan = np.plan; res.objective = np.objective; res.data = np.data; res.asks = np.asks;
      res.stepsKeep = true;
      say('lead', 'replan', 'Okay, treating this as a ' + { winback: 'win-back', launch: 'launch', event: 'revenue push', grow: 'list-growth push', protect: 'list-protection' }[tmpl] + '. I’ve rebuilt the plan around that.');
      if (np.asks.length) say('lead', 'ask', np.asks[0].question, np.asks[0].id);
      return res;
    }
    if (ask.kind === 'goal-field') {
      var val = null;
      if (idx >= 0 && ask.values) val = ask.values[idx];
      else if (ask.field === 'target') { val = amount(text.replace(/[^\d.,$kKmM]/g, '')); }
      else if (ask.field === 'deadline') {
        var dd = takeDeadline(' by ' + text.toLowerCase() + ' ', todayOf(world));
        val = dd.day;
        if (dd.day !== null) objective.deadlineText = dd.text;
      }
      if (!isNum(val) || !(val > 0 || ask.field === 'deadline')) {
        say('lead', 'thought', 'I couldn’t read “' + text.slice(0, 40) + '” as ' + (ask.field === 'target' ? 'a number' : 'a date') + '. Choose one of the options, or type it again.');
        res.reask = true; return res;
      }
      if (ask.field === 'target') objective.target = val; else { objective.by = val; objective.deadlineText = 'by ' + dayShort(val); }
      var left = (data.missing || []).filter(function (f) { return f !== (ask.field === 'target' ? 'target' : 'deadline'); });
      data.missing = left;
      res.objective = objective; res.data = data;
      say('lead', 'did', 'Got it: ' + L.objectiveText(objective) + '.');
      if (left.length) {
        var pf = { metric: objective.metric, template: data.template, audience: data.audience || {}, target: objective.target };
        var nid = 'a' + ((m.asks || []).length + 1);
        var na = missingAsk(pf, left[0], world, ask.stepId, nid);
        res.asks.push(na);
        say('lead', 'ask', na.question, nid);
      } else {
        res.steps[ask.stepId] = { status: 'queued', note: '' };
      }
      return res;
    }
    if (ask.kind === 'guardrail') {
      var fix = ask.fix || {};
      if (idx === 0 && !no) {
        data.overrides = Object.assign({}, data.overrides || {}, fix.overrides || {});
        if (fix.ignore) data.ignore = (data.ignore || []).concat(fix.ignore.filter(function (x) { return (data.ignore || []).indexOf(x) < 0; }));
        res.data = data;
        res.steps[ask.stepId] = { status: 'queued', note: '' };
        say(ask.agentId, 'did', fix.say || 'Okay, adjusting and trying again.');
      } else {
        res.status = 'paused';
        res.steps[ask.stepId] = { status: 'blocked', note: 'Paused at your request.' };
        say('lead', 'did', 'Okay, I’ve stopped here. The work so far is saved; tell me how you’d like to change it and I’ll re-plan.');
      }
      return res;
    }
    if (ask.kind === 'offer') {
      var offers = ask.values || [];
      var pick = idx >= 0 ? offers[idx] : null;
      if (pick) {
        data.overrides = Object.assign({}, data.overrides || {}, { offer: pick });
        res.data = data;
        say('copy', 'did', 'Using ' + L.offerLabel(pick) + '. I’ll write the messages around it.');
      } else say('lead', 'thought', 'Noted: ' + text.slice(0, 100) + '.');
      res.steps[ask.stepId] = { status: 'queued', note: '' };
      return res;
    }
    if (ask.kind === 'launch') {
      if (no) say('lead', 'did', 'No problem. The draft stays ready in Campaigns whenever you want it.');
      else say('lead', 'did', 'Great. The draft is in Campaigns. Before it can be scheduled it needs the launch checklist: test send, links, legal, consent and creative.');
      return res;
    }
    if (ask.kind === 'behind') {
      if (no) say('lead', 'did', 'Understood, I’ll keep the budget where it is and keep working the other levers.');
      else say('lead', 'did', 'Thanks. Raising the total takes a change on the campaign itself, so open its budget and I’ll keep pacing the new amount.');
      return res;
    }
    say('lead', 'did', 'Thanks, noted.');
    if (ask.stepId && (m.plan || []).some(function (s) { return s.id === ask.stepId && s.status === 'blocked'; })) res.steps[ask.stepId] = { status: 'queued', note: '' };
    return res;
  };

  /* ======================= steering ======================= */
  var STEER_PAUSE = /\b(pause|hold off|hold on|wait|stop for now|freeze)\b/;
  var STEER_STOP = /\b(stop this|cancel (?:this|the mission)|drop this|end (?:this|the mission)|abandon)\b/;
  var STEER_RESUME = /\b(resume|continue|carry on|go ahead|unpause|keep going)\b/;

  // steer(mission, text, given?, world?) -> { constraints, objective?, status?, resumeDay?, beats, added:[steps], changed:[...] }
  // Parses new constraints (or uses `given`) and says what changes in the remaining work. Remaining steps are re-planned by
  // appending the steps that bring what already exists in line with the new limits (the engine runs them like any other step).
  L.steer = function (m, text, given, world) {
    var low = ' ' + String(text || '').toLowerCase() + ' ';
    var parsed = takeConstraints(low);
    var newCons = given && given.length ? clone(given) : parsed.constraints;
    var res = { constraints: L.mergeConstraints((m.objective && m.objective.constraints) || [], newCons), beats: [], added: [], changed: [] };
    function say(agentId, kind, t) { res.beats.push({ agentId: agentId, kind: kind, text: t }); }
    var today = todayOf(world);
    // pause / stop / resume
    if (STEER_STOP.test(low)) { res.status = 'stopped'; say('lead', 'did', 'Stopped. Everything the team made stays where it is, and nothing further will run.'); return res; }
    var mm = /\b(?:pause|hold off|wait|freeze)\b[^.]*?\buntil\s+(?:next\s+)?([a-z]+(?:\s+\d{1,2})?)/.exec(low);
    if (STEER_PAUSE.test(low) && !/\bdon[’']?t pause\b/.test(low)) {
      res.status = 'paused';
      if (mm) {
        var dl = takeDeadline(' by ' + mm[1] + ' ', today);
        if (dl.day !== null) res.resumeDay = dl.day;
      }
      say('lead', 'did', res.resumeDay ? 'Paused. I’ll pick this back up on ' + dayShort(res.resumeDay) + '.' : 'Paused. Tell me when to pick it back up.');
      if (!newCons.length) return res;
    } else if (STEER_RESUME.test(low) && m.status === 'paused') {
      res.status = 'running';
      say('lead', 'did', 'Picking this back up.');
      if (!newCons.length) return res;
    }
    // deadline / target changes
    var dline = takeDeadline(parsed.rest, today);
    var obj = clone(m.objective);
    var changedObj = false;
    if (dline.day !== null && /\b(?:move|push|change|extend|make|set|deadline|by|before)\b/.test(low)) {
      obj.by = dline.day; obj.deadlineText = dline.text; changedObj = true;
      say('lead', 'replan', 'New deadline: ' + dline.text + '. I’m adjusting the campaign dates to match.');
    }
    var tm = /\b(?:target|goal|aim)\b[^\d$]{0,30}\$?\s?([\d,]*\.?\d+\s*[km]?)\b/.exec(parsed.rest);
    if (tm) { var tv = amount(tm[1].replace(/\s+/g, '')); if (tv && tv > 0) { obj.target = tv; changedObj = true; say('lead', 'replan', 'New target: ' + L.fmtMetric(obj.metric, tv) + ' ' + L.metricNoun(obj.metric) + '.'); } }
    if (changedObj) res.objective = obj;
    var steps = m.plan || [], nextN = steps.length + 1, last = steps.length ? steps[steps.length - 1].id : null;
    function add(kind, title, needs, extra) {
      var id = 's' + (nextN++);
      var s = step(id, kind, title, needs, extra);
      res.added.push(s);
      return id;
    }
    var hasCampaign = (m.artifacts || []).some(function (a) { return a.kind === 'campaign'; });
    var before = (m.objective && m.objective.constraints) || [];
    var tail = (steps.filter(function (s) { return s.status !== 'done' && s.status !== 'skipped'; }).map(function (s) { return s.id; })).concat([]);
    // Each new limit becomes the steps that bring what exists in line with it.
    newCons.forEach(function (c) {
      var old = L.constraintOf(before, c.kind);
      if (c.kind === 'maxDiscountPct') {
        res.changed.push(c);
        say('lead', 'replan', c.value > 0 ? 'Capping discounts at ' + c.value + '%. ' + (hasCampaign ? 'I’m asking Copy Drafter to rewrite anything that goes deeper.' : 'The offer on the campaign and the copy will stay inside that.')
          : 'No discounts from here on. Offers become free shipping or none, and the copy follows.');
        if (hasCampaign) add('offer', 'Bring the offer within ' + (c.value > 0 ? c.value + '%' : 'no discount'), [], { limit: c.value });
        if (hasCampaign) add('rewrite', 'Rewrite messages for the new offer', [res.added[res.added.length - 1].id]);
      } else if (c.kind === 'excludeChannel') {
        if (old && old.value === c.value) return;
        res.changed.push(c);
        say('lead', 'replan', 'Dropping ' + chLower(c.value) + '. ' + (hasCampaign ? 'The campaign pauses it and its budget moves to the other channels.' : 'It won’t be part of the campaign.'));
        if (hasCampaign) add('channel', 'Take ' + chLower(c.value) + ' out of the campaign', [], { channel: c.value });
        if (hasCampaign) add('pacer', 'Re-split the budget without ' + chLower(c.value), [res.added[res.added.length - 1].id]);
      } else if (c.kind === 'maxSpend') {
        res.changed.push(c);
        say('lead', 'replan', 'Keeping total spend at ' + money(c.value) + ' or less.' + (hasCampaign ? ' I’m scaling the campaign budget down to fit.' : ''));
        if (hasCampaign) add('budget', 'Fit the budget within ' + money(c.value), [], { limit: c.value });
      } else if (c.kind === 'maxSendsPerWeek') {
        res.changed.push(c);
        say('lead', 'replan', 'No more than ' + c.value + (c.value === 1 ? ' message' : ' messages') + ' a week per person. Fatigue Guard rests anyone who is already at that.');
        add('guard', 'Rest people who are at ' + c.value + ' messages a week', []);
      }
    });
    res.constraintsChanged = newCons.length > 0;
    if (changedObj && hasCampaign && dline.day !== null) add('extend', 'Move the campaign end to ' + dayShort(dline.day), []);
    if (!res.beats.length && !newCons.length) say('lead', 'thought', 'Noted: “' + String(text || '').slice(0, 100) + '”. I couldn’t turn that into a limit or a change, so the plan stays as it is. Try something like “no SMS”, “keep discounts under 10%” or “spend under $3k”.');
    // new steps start now and hold the monitor until they finish
    if (res.added.length) {
      var monitor = steps.filter(function (s) { return s.kind === 'monitor'; })[0];
      res.holdMonitor = monitor ? monitor.id : null;
      res.addedIds = res.added.map(function (s) { return s.id; });
    }
    return res;
  };

  /* ======================= drift: re-plan when behind ======================= */
  // remediate(world, m, state) -> { steps:[...], beat, ask?, note } or null. `state` = { pace, forecast, target, daysLeft, campaignId, replans }.
  L.remediate = function (world, m, st) {
    var c = st.campaignId && world.campaigns.byId[st.campaignId];
    var res = { added: [], beats: [], asks: [] }, nextN = (m.plan || []).length + 1;
    function add(kind, title, needs, extra) { var s = step('s' + (nextN++), kind, title, needs || [], extra); res.added.push(s); return s; }
    var by = m.objective.by, behindPct = Math.round((1 - st.pace) * 100);
    var gap = L.fmtMetric(m.objective.metric, Math.max(0, st.target - st.forecast));
    var head = 'We’re running about ' + behindPct + '% behind where we need to be (heading for ' + L.fmtMetric(m.objective.metric, st.forecast) + ' of ' + L.fmtMetric(m.objective.metric, st.target) + ').';
    if (c && isNum(by) && T().dayOf(c.endTick - 1) < by && st.replans === 0) {
      add('extend', 'Run the campaign through ' + dayShort(by), []);
      res.beats.push({ agentId: 'lead', kind: 'replan', text: head + ' The campaign ends ' + dayShort(T().dayOf(c.endTick - 1)) + ', before your deadline, so I’m extending it to ' + dayShort(by) + '.' });
      return res;
    }
    if (c && st.replans <= 1) {
      add('widen', 'Widen the audience with similar customers', []);
      res.beats.push({ agentId: 'lead', kind: 'replan', text: head + ' I’m asking Segment Scout to find similar customers we aren’t reaching yet and add them to the campaign.' });
      return res;
    }
    var ask = { id: 'a' + ((m.asks || []).length + 1), stepId: null, agentId: 'lead', kind: 'behind', blocking: false,
      question: 'We’re still short by about ' + gap + '. Can the campaign budget go up?',
      why: head + ' The team has already extended the run and widened the audience; more budget is the lever left, and only you can change the total.',
      impact: { metric: L.metricNoun(m.objective.metric), lo: Math.round(st.target - st.forecast) * 0.3, hi: Math.round(st.target - st.forecast) * 0.7 },
      options: ['Yes, raise the budget', 'No, keep it'], default: 'Yes, raise the budget', status: 'open', answer: null, by: null, createdTick: null, answeredTick: null };
    res.asks.push(ask);
    res.beats.push({ agentId: 'lead', kind: 'replan', text: head + ' We’ve used the levers we control, so I’m asking you about the budget.' });
    return res;
  };

  /* ======================= plan validation (rules or Claude) ======================= */
  // normalizePlan(list) -> { ok, plan, error }: forces the owner agent from the kind, repairs needs, enforces limits.
  L.normalizePlan = function (list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, error: 'A plan needs at least one step.' };
    if (list.length > L.MAX_STEPS) return { ok: false, error: 'A plan can have at most ' + L.MAX_STEPS + ' steps.' };
    var ids = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || typeof s !== 'object') return { ok: false, error: 'Each step needs details.' };
      if (L.KINDS.indexOf(s.kind) < 0) return { ok: false, error: 'Unknown step kind ' + s.kind + '.' };
      var id = typeof s.id === 'string' && /^[a-z0-9_-]{1,12}$/i.test(s.id) ? s.id : 's' + (i + 1);
      if (ids[id]) return { ok: false, error: 'Duplicate step id ' + id + '.' };
      ids[id] = true;
      var needs = (Array.isArray(s.needs) ? s.needs : []).filter(function (n) { return ids[n] && n !== id; });
      var title = typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : L.KIND_TITLE[s.kind];
      var o = step(id, s.kind, title, needs);
      ['status', 'startedTick', 'doneTick', 'actions', 'artifact', 'note', 'limit', 'channel'].forEach(function (k) { if (s[k] !== undefined && s[k] !== null && k !== 'status') o[k] = s[k]; });
      o.status = ['queued', 'working', 'done', 'blocked', 'skipped'].indexOf(s.status) >= 0 ? s.status : 'queued';
      out.push(o);
    }
    return { ok: true, plan: out };
  };
  L.KIND_TITLE = { goal: 'Confirm the goal and set the plan', audience: 'Find and size the audience', campaign: 'Draft the campaign', copy: 'Write the messages',
    guard: 'Rest over-messaged people', sendtime: 'Choose send times', pacer: 'Split the budget', handoff: 'Hand the draft over for your sign-off',
    monitor: 'Start tracking progress every day', extend: 'Extend the campaign', widen: 'Widen the audience', rewrite: 'Rewrite the messages',
    offer: 'Bring the offer within the limit', channel: 'Change the channels', budget: 'Fit the budget' };

  // Guardrails on a plan from any brain: the shape the engine can run safely.
  L.checkPlan = function (plan, template) {
    var kinds = plan.map(function (s) { return s.kind; });
    if (kinds.indexOf('goal') !== 0) return 'The first step must confirm the goal.';
    if (template !== 'protect') {
      if (kinds.indexOf('audience') < 0 || kinds.indexOf('campaign') < 0) return 'The plan needs an audience step and a campaign step.';
      if (kinds.indexOf('audience') > kinds.indexOf('campaign')) return 'The audience has to be found before the campaign is drafted.';
      var ci = kinds.indexOf('campaign');
      for (var i = 0; i < plan.length; i++) {
        var k = plan[i].kind;
        if ((k === 'copy' || k === 'sendtime' || k === 'pacer') && i < ci) return 'Copy, send times and budget come after the campaign exists.';
      }
    }
    if (kinds.indexOf('monitor') < 0) return 'The plan needs a monitoring step.';
    return null;
  };

  /* ======================= the voice ======================= */
  var V = L.voice = {};
  V.opening = function (m) {
    var o = m.objective, c = ((o && o.constraints) || []).map(L.constraintLabel);
    return 'Got it: ' + L.objectiveText(o) + '.' + (c.length ? ' I’ll keep to ' + listJoin(c.map(lowerFirst)) + '.' : '') +
      ' I’ll find the audience, draft the campaign and have the team check it before anything goes out.';
  };
  V.planned = function (m) {
    var n = m.plan.length, agents = {};
    m.plan.forEach(function (s) { agents[s.agentId] = true; });
    var k = Object.keys(agents).length;
    return 'Here’s the plan: ' + n + ' steps across ' + k + (k === 1 ? ' teammate' : ' teammates') + '. ' + (m.brain === 'claude' ? '' : '') + 'You’ll hear from me if I need a decision.';
  };
  V.start = {
    goal: function () { return 'Reading the goal and lining up the team.'; },
    audience: function (m) { return 'Looking for ' + audienceWord({ template: (m.data || {}).template, audience: (m.data || {}).audience || {} }) + ' and checking who can actually be reached.'; },
    campaign: function () { return 'Drafting the campaign: journey, channels, dates and an opening budget split.'; },
    copy: function (m) { return 'Writing messages for ' + listJoin(((m.data || {}).channels || ['email']).map(chLower)) + ' in the brand voice.'; },
    guard: function () { return 'Checking who has heard from us too often.'; },
    sendtime: function () { return 'Looking at when this audience opens its messages.'; },
    pacer: function () { return 'Working out where the next dollar earns the most.'; },
    handoff: function () { return 'Pulling the draft together for your sign-off.'; },
    monitor: function () { return 'Setting up the daily check-in.'; },
    extend: function () { return 'Changing the campaign dates.'; },
    widen: function () { return 'Looking for customers similar to the ones who already respond.'; },
    rewrite: function () { return 'Rewriting the messages for the new offer.'; },
    offer: function () { return 'Checking the offer against the new limit.'; },
    channel: function () { return 'Taking the channel out of the campaign.'; },
    budget: function () { return 'Fitting the budget to the new limit.'; }
  };
  V.progress = function (m, pr, status) {
    var o = m.objective, n = L.metricNoun(o.metric);
    var base = L.fmtMetric(o.metric, pr.value) + ' of ' + L.fmtMetric(o.metric, pr.target) + ' ' + n + ' so far';
    if (o.metric === 'unsubs') return base + '; on this pace we finish near ' + num(pr.forecast) + '.';
    return base + ' (' + pct(pr.target > 0 ? pr.value / pr.target : 0) + '). On this pace we land near ' + L.fmtMetric(o.metric, pr.forecast) + ', somewhere between ' + L.fmtMetric(o.metric, pr.lo) + ' and ' + L.fmtMetric(o.metric, pr.hi) + '.';
  };
  V.listJoin = listJoin;
  V.audienceWord = audienceWord;
})();
