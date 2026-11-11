/* Kestrel Marketing Cloud - MC.segments: audience rules over the columnar profile store.
   ATTRS catalogue, validation, closure-compiled evaluation into Uint8Array bitsets, per-day
   member caches, plain-language descriptions and names, a phrase-lexicon parser for
   "Describe your audience", trait summaries, overlap and per-condition eliminations.
   Rule = { op:'all'|'any', items:[Cond|Rule] } (nesting <= 3); Cond = { attr, cmp, value }. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var S = MC.segments = MC.segments || {};

  var MAX_DEPTH = 3;
  var NUM_OPS = ['gt', 'gte', 'lt', 'lte', 'between'];
  var CAT_OPS = ['in', 'notIn'];
  var BOOL_OPS = ['is'];
  var SYM = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
  var WORD = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most' };
  var BEST_CH = [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'push', label: 'Push' }, { value: 'none', label: 'None' }];
  var BEST_CODE = { email: 0, sms: 1, push: 2, none: 255 };
  var AFF = [['affHike', 'Hiking affinity', 'hiking affinity'], ['affCamp', 'Camping affinity', 'camping affinity'],
    ['affClimb', 'Climbing affinity', 'climbing affinity'], ['affRun', 'Trail running affinity', 'trail running affinity'],
    ['affApparel', 'Apparel affinity', 'apparel affinity']];

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function isGroup(x) { return !!x && typeof x === 'object' && Array.isArray(x.items); }
  function D() { return MC.data || {}; }
  function NEVER() { return D().NEVER !== undefined ? D().NEVER : -9999; }
  function curDay(world) { return Math.floor(world.meta.tick / 24); }
  function idOf(x) { return typeof x === 'string' ? x : (x && (x.id || x.code)); }
  function labelOf(x) { return typeof x === 'string' ? x : (x && (x.label || x.name || x.id)); }
  function trimNum(x, dp) { var s = x.toFixed(dp); if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, ''); return s; }
  function fmtMoney(v) { return (MC.fmt && MC.fmt.money) ? MC.fmt.money(v) : '$' + Math.round(v); }
  function fmtPctV(v) { return trimNum(v * 100, v * 100 % 1 ? 1 : 0) + '%'; }
  function fmtHour(h) { return (MC.fmt && MC.fmt.hour) ? MC.fmt.hour(h) : (h + ':00'); }
  function fmtInt(v) { return (MC.fmt && MC.fmt.num) ? MC.fmt.num(Math.round(v)) : String(Math.round(v)); }
  function fmtAff(v) { return trimNum(v, 2); }

  /* ---------------- attribute catalogue ---------------- */
  function numAttr(key, label, group, phrase, fmt, extra) {
    var a = { key: key, label: label, group: group, type: 'num', ops: NUM_OPS.slice(), phrase: phrase, fmt: fmt };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }
  function catAttr(key, label, group, phrase, values) {
    return { key: key, label: label, group: group, type: 'cat', ops: CAT_OPS.slice(), phrase: phrase, values: values };
  }
  function boolAttr(key, label, ch, chLabel) {
    return { key: key, label: label, group: 'Profile', type: 'bool', ops: BOOL_OPS.slice(), phrase: label.toLowerCase(), channel: ch, chLabel: chLabel };
  }

  var attrsCache = null;
  function buildAttrs() {
    var d = D();
    if (!d.STATES || !d.REGIONS || !d.TIERS || !d.CATEGORIES) return null;
    var states = d.STATES.map(function (s) { var id = idOf(s); return { value: id, label: id }; });
    var regions = d.REGIONS.map(function (r) { return { value: idOf(r), label: labelOf(r) }; });
    var tiers = d.TIERS.map(function (t) { return { value: idOf(t), label: labelOf(t) }; });
    var cats = d.CATEGORIES.map(function (c) { return { value: idOf(c), label: labelOf(c) }; });
    var list = [
      catAttr('state', 'State', 'Profile', 'state', states),
      catAttr('region', 'Region', 'Profile', 'region', regions),
      numAttr('age', 'Age', 'Profile', 'age', fmtInt, { min: 18, max: 90, step: 1 }),
      catAttr('tier', 'Loyalty tier', 'Profile', 'loyalty tier', tiers),
      numAttr('tenureDays', 'Customer for (days)', 'Profile', 'customer for', fmtInt, { min: 0, max: 3650, step: 1, suffix: ' days' }),
      boolAttr('canEmail', 'Can receive email', 'email', 'email'),
      boolAttr('canSms', 'Can receive SMS', 'sms', 'SMS'),
      boolAttr('canPush', 'Can receive push', 'push', 'push'),
      boolAttr('canAds', 'Reachable by ads', 'social', 'ads'),
      numAttr('lastOrderDays', 'Last order (days ago)', 'Behavior', 'last order', fmtInt, { min: 0, max: 365, step: 1, suffix: ' days ago' }),
      numAttr('orders', 'Orders', 'Behavior', 'orders', fmtInt, { min: 0, max: 100, step: 1 }),
      numAttr('spend', 'Lifetime spend', 'Behavior', 'lifetime spend', fmtMoney, { unit: '$', min: 0, max: 20000, step: 10 }),
      numAttr('aov', 'Average order value', 'Behavior', 'average order value', fmtMoney, { unit: '$', min: 0, max: 1000, step: 5 }),
      numAttr('visits30', 'Site visits (30 days)', 'Behavior', 'site visits in 30 days', fmtInt, { min: 0, max: 60, step: 1 }),
      catAttr('topCategory', 'Top category', 'Behavior', 'top category', cats)
    ];
    AFF.forEach(function (a) { list.push(numAttr(a[0], a[1], 'Behavior', a[2], fmtAff, { min: 0, max: 1, step: 0.05 })); });
    list.push(
      numAttr('engRate', 'Engagement rate', 'Behavior', 'engagement rate', fmtPctV, { min: 0, max: 1, step: 0.01, pct: true }),
      numAttr('fatigue', 'Fatigue score', 'Behavior', 'fatigue score', function (v) { return trimNum(v, 1); }, { min: 0, max: 10, step: 0.5 }),
      numAttr('sent7', 'Messages in last 7 days', 'Behavior', 'messages in the last 7 days', fmtInt, { min: 0, max: 30, step: 1 }),
      numAttr('prop', 'Propensity to buy (30 days)', 'Predictions', 'propensity to buy', fmtPctV, { min: 0, max: 1, step: 0.01, pct: true, predicted: true }),
      numAttr('churn', 'Churn risk', 'Predictions', 'churn risk', fmtPctV, { min: 0, max: 1, step: 0.01, pct: true, predicted: true }),
      numAttr('ltv', 'Predicted LTV (12 months)', 'Predictions', 'predicted LTV', fmtMoney, { unit: '$', min: 0, max: 5000, step: 10, predicted: true }),
      catAttr('bestCh', 'Best channel', 'Predictions', 'best channel', BEST_CH.slice()),
      numAttr('bestHr', 'Best send hour', 'Predictions', 'best send hour', fmtHour, { min: 0, max: 23, step: 1, predicted: true })
    );
    list.forEach(function (a) { if (a.key === 'bestCh') a.predicted = true; });
    return list;
  }
  function attrList() {
    if (!attrsCache) attrsCache = buildAttrs();
    return attrsCache || [];
  }
  Object.defineProperty(S, 'ATTRS', { enumerable: true, configurable: true, get: function () { return attrList(); } });
  function attrMap() {
    var list = attrList();
    if (attrMap.src !== list) { attrMap.src = list; attrMap.map = {}; list.forEach(function (a) { attrMap.map[a.key] = a; }); }
    return attrMap.map;
  }
  S.attr = function (key) { return attrMap()[key] || null; };

  /* ---------------- validation ---------------- */
  S.validate = function (rule) {
    var errs = [];
    if (!isGroup(rule)) { errs.push('The rule is incomplete.'); return errs; }
    var A = attrMap(), haveAttrs = attrList().length > 0, n = 0;
    function walk(g, depth, path) {
      if (g.op !== 'all' && g.op !== 'any') errs.push('Group ' + path + ' needs “all” or “any”.');
      if (depth > MAX_DEPTH) { errs.push('Groups can nest at most ' + MAX_DEPTH + ' levels.'); return; }
      g.items.forEach(function (x, k) {
        var p = path ? path + '.' + (k + 1) : String(k + 1);
        if (isGroup(x)) { walk(x, depth + 1, p); return; }
        n++;
        if (!x || typeof x !== 'object') { errs.push('Condition ' + p + ' is empty.'); return; }
        var a = A[x.attr];
        if (!a) { if (haveAttrs) errs.push('Condition ' + p + ': pick an attribute.'); return; }
        if (a.ops.indexOf(x.cmp) < 0) { errs.push(a.label + ': pick a comparison.'); return; }
        if (a.type === 'num') {
          if (x.cmp === 'between') {
            if (!Array.isArray(x.value) || x.value.length !== 2 || !fin(x.value[0]) || !fin(x.value[1])) errs.push(a.label + ': enter both ends of the range.');
            else if (x.value[0] > x.value[1]) errs.push(a.label + ': the range starts after it ends.');
          } else if (!fin(x.value)) errs.push(a.label + ': enter a number.');
        } else if (a.type === 'cat') {
          if (!Array.isArray(x.value) || !x.value.length) errs.push(a.label + ': pick at least one value.');
          else {
            var ok = {}; a.values.forEach(function (v) { ok[v.value] = true; });
            for (var i = 0; i < x.value.length; i++) if (!ok[x.value[i]]) { errs.push(a.label + ': unknown value “' + x.value[i] + '”.'); break; }
          }
        } else if (typeof x.value !== 'boolean') errs.push(a.label + ': choose yes or no.');
      });
    }
    walk(rule, 1, '');
    if (n > 60) errs.push('Rules are limited to 60 conditions.');
    return errs;
  };

  /* ---------------- column access ---------------- */
  // Derived columns are cached per (profiles rev, day) on world._segCols (excluded from digests).
  function derived(world, key) {
    var P = world.profiles, d = curDay(world);
    var ck = (world.rev ? world.rev.profiles : 0) + '|' + d + '|' + P.n;
    var cache = world._segCols;
    if (!cache || cache.key !== ck || cache.P !== P) cache = world._segCols = { key: ck, P: P, cols: {} };
    if (cache.cols[key]) return cache.cols[key];
    var n = P.n, out, i, k;
    if (key === 'lastOrderDays') {
      out = new Float64Array(n); var NV = NEVER();
      for (i = 0; i < n; i++) out[i] = P.lastOrder[i] === NV ? NaN : d - P.lastOrder[i];
    } else if (key === 'engRate') {
      out = new Float64Array(n);
      for (i = 0; i < n; i++) {
        var s = 0, oc = 0, b = i * 9;
        for (k = 0; k < 3; k++) { s += P.eng[b + k * 3]; oc += P.eng[b + k * 3 + 1] + P.eng[b + k * 3 + 2]; }
        out[i] = oc / (s + 5);
      }
    } else if (key === 'sent7') {
      out = new Float64Array(n);
      for (i = 0; i < n; i++) { var t = 0; for (k = 0; k < 21; k++) t += P.sent7[i * 21 + k]; out[i] = t; }
    } else {
      var ai = ['affHike', 'affCamp', 'affClimb', 'affRun', 'affApparel'].indexOf(key);
      out = new Float32Array(n);
      for (i = 0; i < n; i++) out[i] = P.aff[i * 5 + ai];
    }
    cache.cols[key] = out;
    return out;
  }
  var DIRECT = { age: 'age', tenureDays: 'tenure', orders: 'orders', spend: 'spend', aov: 'aov', visits30: 'visits30',
    fatigue: 'fatigue', prop: 'prop', churn: 'churn', ltv: 'ltv', bestHr: 'bestHr' };
  function numCol(world, key) { return DIRECT[key] ? world.profiles[DIRECT[key]] : derived(world, key); }

  function catCodes(key, values) {
    var d = D(), tbl = new Uint8Array(256), list;
    if (key === 'bestCh') { values.forEach(function (v) { if (BEST_CODE[v] !== undefined) tbl[BEST_CODE[v]] = 1; }); return tbl; }
    if (key === 'state') list = d.STATES; else if (key === 'region') list = d.REGIONS;
    else if (key === 'tier') list = d.TIERS; else list = d.CATEGORIES;
    var ids = (list || []).map(idOf);
    values.forEach(function (v) { var k = ids.indexOf(v); if (k >= 0) tbl[k] = 1; });
    return tbl;
  }
  var CAT_COL = { state: 'state', region: 'region', tier: 'tier', topCategory: 'cat', bestCh: 'bestCh' };

  /* ---------------- compile / evaluate ---------------- */
  function TRUE() { return true; }
  function compileNode(world, node) {
    if (isGroup(node)) {
      var fns = node.items.map(function (x) { return compileNode(world, x); });
      var m = fns.length;
      if (!m) return TRUE;
      if (m === 1) return fns[0];
      if (node.op === 'any') return function (i) { for (var j = 0; j < m; j++) if (fns[j](i)) return true; return false; };
      return function (i) { for (var j = 0; j < m; j++) if (!fns[j](i)) return false; return true; };
    }
    var a = attrMap()[node.attr];
    if (!a) throw new Error('Unknown attribute ' + node.attr);
    var P = world.profiles, v = node.value;
    if (a.type === 'bool') {
      var bit = MC.CH.BIT[a.channel], con = P.consent, un = P.unsub, want = v !== false;
      return function (i) { return ((con[i] & bit) !== 0 && (un[i] & bit) === 0) === want; };
    }
    if (a.type === 'cat') {
      var tbl = catCodes(a.key, Array.isArray(v) ? v : []), col = P[CAT_COL[a.key]];
      return node.cmp === 'notIn' ? function (i) { return tbl[col[i]] !== 1; } : function (i) { return tbl[col[i]] === 1; };
    }
    var c = numCol(world, a.key);
    switch (node.cmp) {
      case 'gt': return function (i) { return c[i] > v; };
      case 'gte': return function (i) { return c[i] >= v; };
      case 'lt': return function (i) { return c[i] < v; };
      case 'lte': return function (i) { return c[i] <= v; };
      case 'between':
        var lo = v[0], hi = v[1];
        return function (i) { var x = c[i]; return x >= lo && x <= hi; };
      default: throw new Error('Unknown comparison ' + node.cmp);
    }
  }
  // compile(rule, world?) -> (i) => bool. Without a world it binds to the live store.
  S.compile = function (rule, world) {
    var w = world || (MC.store && MC.store.getState && MC.store.getState());
    if (!w) throw new Error('No world to compile against.');
    return compileNode(w, rule || { op: 'all', items: [] });
  };

  function now() { return (MC.util && MC.util.now) ? MC.util.now() : 0; }
  S.evaluate = function (world, rule) {
    var t0 = now();
    var P = world.profiles, n = P.n, bits = new Uint8Array(n), count = 0;
    var fn = compileNode(world, rule || { op: 'all', items: [] });
    for (var i = 0; i < n; i++) if (fn(i)) { bits[i] = 1; count++; }
    return { bits: bits, count: count, ms: now() - t0 };
  };

  function countBits(bits) { var c = 0; for (var i = 0; i < bits.length; i++) c += bits[i]; return c; }
  S.countBits = countBits;

  // members(world, id) -> Uint8Array (cached per segment ver and rev.segCounts), or null when missing.
  S.members = function (world, id) {
    var s = world.segments && world.segments.byId[id];
    if (!s) return null;
    var key = s.ver + '|' + (world.rev ? world.rev.segCounts : 0) + '|' + world.profiles.n;
    var cache = world._segCache || (world._segCache = {});
    var e = cache[id];
    if (e && e.key === key && e.rule === s.rule) return e.bits;
    var bits = S.evaluate(world, s.rule).bits;
    cache[id] = { key: key, rule: s.rule, bits: bits };
    return bits;
  };

  // Union of segmentId + include minus suppress (go-live enrollment audience).
  S.audienceOf = function (world, c) {
    var n = world.profiles.n, out = new Uint8Array(n), i, b;
    var inc = [c.segmentId].concat(c.include || []).filter(Boolean);
    inc.forEach(function (id) { b = S.members(world, id); if (b) for (i = 0; i < n; i++) if (b[i]) out[i] = 1; });
    (c.suppress || []).forEach(function (id) { b = S.members(world, id); if (b) for (i = 0; i < n; i++) if (b[i]) out[i] = 0; });
    return out;
  };

  // Day-roll recount: count, countDay, countHist (last 8) for every segment; bumps rev.segCounts.
  S.recount = function (world, day) {
    var segs = world.segments, byId = Object.assign({}, segs.byId), fresh = {};
    if (day === undefined) day = curDay(world);
    segs.order.forEach(function (id) {
      var s = byId[id]; if (!s) return;
      var r = S.evaluate(world, s.rule);
      fresh[id] = r.bits;
      var hist = (s.countHist || []).concat([r.count]);
      if (hist.length > 8) hist = hist.slice(hist.length - 8);
      byId[id] = Object.assign({}, s, { count: r.count, countDay: day, countHist: hist });
    });
    world.segments = Object.assign({}, segs, { byId: byId });
    if (MC.util && MC.util.bump) MC.util.bump(world, 'segCounts'); else { world.rev = world.rev || {}; world.rev.segCounts = (world.rev.segCounts || 0) + 1; }
    var cache = world._segCache = {};
    Object.keys(fresh).sort().forEach(function (id) {
      cache[id] = { key: byId[id].ver + '|' + world.rev.segCounts + '|' + world.profiles.n, rule: byId[id].rule, bits: fresh[id] };
    });
    return world;
  };

  /* ---------------- plain language ---------------- */
  function listJoin(arr, conj) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' ' + conj + ' ' + arr[arr.length - 1];
  }
  function fmtVal(a, v) { return a.fmt ? a.fmt(v) : String(v); }
  function catLabels(a, vals) {
    var m = {}; a.values.forEach(function (x) { m[x.value] = x.label; });
    return (vals || []).map(function (v) { return m[v] || v; });
  }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // short = chip/elimination form ("Last order > 120 days ago"); long = sentence form.
  function condText(c, short) {
    var a = attrMap()[c && c.attr];
    if (!a) return short ? 'Unknown condition' : 'an unknown condition';
    var v = c.value;
    if (a.type === 'bool') {
      var yes = v !== false;
      if (a.key === 'canAds') return short ? (yes ? 'Reachable by ads' : 'Not reachable by ads') : (yes ? 'reachable by ads' : 'not reachable by ads');
      return (short ? (yes ? 'Can' : 'Can’t') : (yes ? 'can' : 'can’t')) + ' receive ' + a.chLabel;
    }
    if (a.type === 'cat') {
      var labs = catLabels(a, v), neg = c.cmp === 'notIn';
      var head = short ? a.label : a.phrase;
      return head + (neg ? ' is not ' : ' is ') + listJoin(labs, 'or');
    }
    if (a.key === 'lastOrderDays') {
      if (c.cmp === 'between' && Array.isArray(v)) return (short ? 'Last order ' : 'last order ') + v[0] + '–' + v[1] + ' days ago';
      if (short) return 'Last order ' + SYM[c.cmp] + ' ' + v + ' days ago';
      if (c.cmp === 'gt') return 'last order more than ' + v + ' days ago';
      if (c.cmp === 'gte') return 'last order at least ' + v + ' days ago';
      if (c.cmp === 'lt') return 'ordered within the last ' + v + ' days';
      return 'ordered in the last ' + v + ' days';
    }
    if (a.key === 'tenureDays' && !short) {
      if (c.cmp === 'between' && Array.isArray(v)) return 'customer for ' + v[0] + '–' + v[1] + ' days';
      return 'customer for ' + WORD[c.cmp] + ' ' + v + ' days';
    }
    var name = short ? a.label : a.phrase;
    if (c.cmp === 'between' && Array.isArray(v)) {
      return name + (short ? ' ' : ' between ') + fmtVal(a, v[0]) + (short ? '–' : ' and ') + fmtVal(a, v[1]);
    }
    return name + ' ' + (short ? SYM[c.cmp] : WORD[c.cmp]) + ' ' + fmtVal(a, v);
  }
  S.condLabel = function (c) { return condText(c, true); };

  function describeNode(g, top) {
    var parts = g.items.map(function (x) { return isGroup(x) ? describeNode(x, false) : condText(x, false); }).filter(Boolean);
    if (!parts.length) return top ? '' : '';
    var s = parts.join(g.op === 'any' ? ' or ' : ' and ');
    return top || parts.length === 1 ? s : '(' + s + ')';
  }
  S.describe = function (rule) {
    if (!isGroup(rule) || !rule.items.length) return 'Everyone';
    var s = describeNode(rule, true);
    return s ? cap1(s) : 'Everyone';
  };

  function leaves(rule, path, out) {
    out = out || []; path = path || [];
    (rule && rule.items || []).forEach(function (x, k) {
      if (isGroup(x)) leaves(x, path.concat([k]), out); else out.push({ path: path.concat([k]), cond: x });
    });
    return out;
  }
  S.leaves = function (rule) { return leaves(rule, [], []); };

  var NOUN = { affHike: 'hikers', affCamp: 'campers', affClimb: 'climbers', affRun: 'trail runners', affApparel: 'apparel shoppers',
    hike: 'hikers', camp: 'campers', climb: 'climbers', run: 'trail runners', apparel: 'apparel shoppers' };
  S.nameFor = function (rule) {
    var ls = leaves(rule, [], []).map(function (l) { return l.cond; });
    var adj = [], nouns = [], place = null, tierPart = null, extra = [];
    function addN(x) { if (x && nouns.indexOf(x) < 0) nouns.push(x); }
    ls.forEach(function (c) {
      if (!c || !c.attr) return;
      var up = c.cmp === 'gt' || c.cmp === 'gte', down = c.cmp === 'lt' || c.cmp === 'lte', v = c.value;
      var a = attrMap()[c.attr];
      switch (c.attr) {
        case 'tier':
          if (c.cmp === 'in' && Array.isArray(v) && a) {
            var labs = catLabels(a, v);
            tierPart = labs.length === 1 ? labs[0] + '-tier' : labs.join(' & ');
          }
          break;
        case 'region': case 'state':
          if (c.cmp === 'in' && Array.isArray(v) && a) place = c.attr === 'region' ? catLabels(a, v).join(' & ') : v.join('/');
          break;
        case 'topCategory': if (c.cmp === 'in' && Array.isArray(v)) v.forEach(function (x) { addN(NOUN[x]); }); break;
        case 'affHike': case 'affCamp': case 'affClimb': case 'affRun': case 'affApparel': if (up) addN(NOUN[c.attr]); break;
        case 'lastOrderDays': if (up && v >= 60) adj.push('lapsed'); else if (down && v <= 45) adj.push('recent'); break;
        case 'tenureDays': if (down) adj.push('new'); else if (up && v >= 365) adj.push('long-time'); break;
        case 'prop': if (up) adj.push('likely-to-buy'); break;
        case 'churn': if (up) adj.push('at-risk'); else if (down) adj.push('loyal'); break;
        case 'ltv': if (up) adj.push('high-LTV'); break;
        case 'spend': if (up) adj.push('big-spending'); break;
        case 'aov': if (up) adj.push('big-basket'); break;
        case 'orders': if (up && (c.cmp === 'gte' ? v >= 2 : v >= 1)) adj.push('repeat'); else if (down) adj.push('first-order'); break;
        case 'engRate': if (up) adj.push('engaged'); else if (down) adj.push('quiet'); break;
        case 'visits30': if (up) adj.push('frequent-visitor'); break;
        case 'sent7': case 'fatigue': if (up) adj.push('heavily messaged'); break;
        case 'age': if (c.cmp === 'between' && Array.isArray(v)) extra.push(v[0] + '–' + v[1]); else if (down) adj.push('under-' + v); else if (up) adj.push(v + '+'); break;
        case 'bestCh': if (c.cmp === 'in' && Array.isArray(v) && v.length === 1 && v[0] !== 'none') adj.push((v[0] === 'sms' ? 'SMS' : v[0]) + '-first'); break;
        case 'canSms': if (v !== false) extra.push('SMS'); break;
        case 'canPush': if (v !== false) extra.push('push'); break;
        default: break;
      }
    });
    var noun = nouns.length ? (nouns.length > 2 ? 'outdoor shoppers' : nouns.join(' & ')) : (tierPart && !adj.length ? 'members' : 'customers');
    var parts = [];
    if (tierPart) parts.push(tierPart);
    var seen = {};
    adj.forEach(function (x) { if (!seen[x]) { seen[x] = true; parts.push(x); } });
    parts.push(noun);
    var name = parts.join(' ');
    if (extra.length) name += ' (' + extra.join(', ') + ')';
    if (place) name += ', ' + place;
    if (!ls.length) name = 'Everyone';
    else if (!nouns.length && !adj.length && !tierPart && !place && !extra.length) name = 'Custom audience';
    name = cap1(name);
    if (name.length > 48) {
      var cut = name.slice(0, 48), sp = cut.lastIndexOf(' ');
      name = (sp > 20 ? cut.slice(0, sp) : cut).replace(/[,&(/\-\s]+$/, '');
    }
    return name;
  };

  /* ---------------- "Describe your audience" parser ---------------- */
  function pctl(world, key, q) {
    if (!world || !world.profiles) return null;
    var col = numCol(world, key), arr = [];
    for (var i = 0; i < col.length; i++) if (fin(col[i]) && (key !== 'ltv' || col[i] > 0)) arr.push(col[i]);
    if (!arr.length) return null;
    arr.sort(function (a, b) { return a - b; });
    return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
  }
  function roundFor(key, v) {
    if (key === 'ltv' || key === 'spend') return Math.max(10, Math.round(v / 10) * 10);
    if (key === 'prop' || key === 'churn') return Math.round(v * 100) / 100;
    return Math.round(v);
  }
  function C(attr, cmp, value) { return { attr: attr, cmp: cmp, value: value }; }
  function top25(key, fallback) {
    return function (world) {
      var v = pctl(world, key, 0.75);
      return { cond: C(key, 'gte', v === null ? fallback : roundFor(key, v)), note: ' (top 25%)' };
    };
  }
  function bottom25(key, fallback) {
    return function (world) {
      var v = pctl(world, key, 0.25);
      return { cond: C(key, 'lt', v === null ? fallback : roundFor(key, v)), note: ' (lowest 25%)' };
    };
  }
  function fixed(attr, cmp, value) { return function () { return { cond: C(attr, cmp, value) }; }; }

  var LEX_SRC = [
    [['lapsed', 'lapsed customers', 'lapsed buyers', 'inactive', 'dormant', 'haven’t ordered', 'haven\'t ordered', 'havent ordered', 'haven\'t bought', 'haven’t bought', 'win-back', 'win back'], fixed('lastOrderDays', 'gt', 120)],
    [['recent buyers', 'recent customers', 'recently purchased', 'bought recently', 'ordered recently', 'active buyers', 'active customers'], fixed('lastOrderDays', 'lte', 30)],
    [['new customers', 'new', 'newcomers', 'just joined'], fixed('tenureDays', 'lt', 90)],
    [['long-time', 'longtime', 'long time', 'loyal', 'veterans'], fixed('tenureDays', 'gte', 730)],
    [['repeat buyers', 'repeat customers', 'repeat', 'frequent buyers'], fixed('orders', 'gte', 3)],
    [['one-time buyers', 'first-time buyers', 'one-time', 'single-purchase'], fixed('orders', 'lte', 1)],
    [['hikers', 'hiker', 'hiking', 'backpackers', 'backpacking'], fixed('affHike', 'gte', 0.3)],
    [['car campers', 'campers', 'camper', 'camping'], fixed('affCamp', 'gte', 0.35)],
    [['climbers', 'climber', 'climbing', 'boulderers', 'bouldering'], fixed('affClimb', 'gte', 0.3)],
    [['trail runners', 'trail running', 'runners', 'runner', 'running'], fixed('affRun', 'gte', 0.35)],
    [['cold-weather shoppers', 'cold weather shoppers', 'apparel shoppers', 'apparel', 'jacket buyers', 'layering'], fixed('affApparel', 'gte', 0.3)],
    [['pacific northwest', 'the pacific northwest', 'pnw', 'northwest'], fixed('region', 'in', ['pnw'])],
    [['west coast', 'the west', 'western', 'west'], fixed('region', 'in', ['west'])],
    [['mountain west', 'mountain states', 'rocky mountains', 'rockies', 'mountain'], fixed('region', 'in', ['mountain'])],
    [['midwest', 'midwestern', 'the midwest'], fixed('region', 'in', ['midwest'])],
    [['the south', 'southern', 'southeast', 'south'], fixed('region', 'in', ['south'])],
    [['northeast', 'new england', 'east coast', 'the northeast'], fixed('region', 'in', ['northeast'])],
    [['summit and peak', 'summit & peak', 'summit or peak', 'top tier', 'top-tier', 'vip', 'vips', 'loyalty members', 'members'], fixed('tier', 'in', ['summit', 'peak'])],
    [['summit tier', 'summit-tier', 'summit'], fixed('tier', 'in', ['summit'])],
    [['peak tier', 'peak-tier', 'peak'], fixed('tier', 'in', ['peak'])],
    [['trailhead tier', 'trailhead'], fixed('tier', 'in', ['trailhead'])],
    [['base tier'], fixed('tier', 'in', ['base'])],
    [['high predicted ltv', 'high predicted lifetime value', 'high ltv', 'high-ltv', 'high lifetime value', 'high value', 'high-value', 'most valuable', 'valuable'], top25('ltv', 480)],
    [['likely to buy', 'likely buyers', 'ready to buy', 'high propensity', 'high intent', 'in-market', 'in market'], top25('prop', 0.3)],
    [['at risk', 'at-risk', 'churn risk', 'likely to churn', 'high churn', 'churning'], top25('churn', 0.6)],
    [['low churn', 'unlikely to churn'], bottom25('churn', 0.3)],
    [['big spenders', 'high spenders', 'top spenders'], top25('spend', 600)],
    [['highly engaged', 'engaged', 'openers', 'active readers'], fixed('engRate', 'gte', 0.2)],
    [['unengaged', 'disengaged', 'not engaged'], fixed('engRate', 'lt', 0.05)],
    [['email subscribers', 'emailable', 'can email', 'on email', 'email'], fixed('canEmail', 'is', true)],
    [['sms subscribers', 'textable', 'texting', 'text', 'sms'], fixed('canSms', 'is', true)],
    [['push subscribers', 'app users', 'push'], fixed('canPush', 'is', true)],
    [['ad audiences', 'ads'], fixed('canAds', 'is', true)],
    [['prefer email', 'best on email', 'email-first'], fixed('bestCh', 'in', ['email'])],
    [['prefer sms', 'best on sms', 'sms-first', 'prefer texts'], fixed('bestCh', 'in', ['sms'])],
    [['prefer push', 'best on push', 'push-first'], fixed('bestCh', 'in', ['push'])],
    [['fatigued', 'over-messaged', 'overmessaged', 'heavily messaged'], fixed('sent7', 'gte', 4)],
    [['frequent visitors', 'window shoppers', 'browsers', 'browsing'], fixed('visits30', 'gte', 4)],
    [['young', 'younger', 'gen z'], fixed('age', 'lt', 30)],
    [['older', 'seniors'], fixed('age', 'gte', 55)],
    [['evening openers', 'night owls'], fixed('bestHr', 'between', [18, 23])],
    [['morning openers', 'early birds'], fixed('bestHr', 'between', [5, 10])],
    [['gift givers', 'gift buyers', 'gifters'], function () { return { group: { op: 'any', items: [C('orders', 'gte', 4), C('aov', 'gte', 120)] }, label: 'Orders ≥ 4 or average order ≥ $120' }; }]
  ];
  var STATE_NAMES = { washington: 'WA', oregon: 'OR', idaho: 'ID', california: 'CA', nevada: 'NV', arizona: 'AZ', utah: 'UT',
    colorado: 'CO', montana: 'MT', wyoming: 'WY', 'new mexico': 'NM', illinois: 'IL', minnesota: 'MN', michigan: 'MI',
    wisconsin: 'WI', ohio: 'OH', texas: 'TX', georgia: 'GA', 'north carolina': 'NC', tennessee: 'TN', florida: 'FL',
    'new york': 'NY', massachusetts: 'MA', vermont: 'VT', pennsylvania: 'PA', maine: 'ME' };
  var STOP = ['in', 'the', 'a', 'an', 'and', 'or', 'of', 'who', 'are', 'is', 'from', 'to', 'that', 'all', 'our', 'me', 'show',
    'find', 'people', 'customers', 'buyers', 'shoppers', 'users', 'folks', 'everyone', 'living', 'live', 'based', 'audience'];
  var LEX = null;
  function lexicon() {
    if (LEX) return LEX;
    LEX = [];
    LEX_SRC.forEach(function (e) { e[0].forEach(function (p) { LEX.push({ words: p.toLowerCase().split(' '), phrase: p, make: e[1] }); }); });
    Object.keys(STATE_NAMES).forEach(function (nm) { LEX.push({ words: nm.split(' '), phrase: nm, make: fixed('state', 'in', [STATE_NAMES[nm]]) }); });
    LEX.sort(function (a, b) { return (b.words.length - a.words.length) || (b.phrase.length - a.phrase.length) || (a.phrase < b.phrase ? -1 : (a.phrase > b.phrase ? 1 : 0)); });
    return LEX;
  }
  var NUM_PATTERNS = [
    [/^(?:bought |ordered |purchased )?(?:in|within) (?:the )?(?:last|past) (\d+) days?/, function (m) { return C('lastOrderDays', 'lte', +m[1]); }],
    [/^(?:more than|over|at least) (\d+) days?(?: ago| since (?:their |a )?last order)?/, function (m) { return C('lastOrderDays', 'gt', +m[1]); }],
    [/^(\d+)\+? ?(?:days?|d)\+? (?:ago|lapsed|inactive|since)/, function (m) { return C('lastOrderDays', 'gt', +m[1]); }],
    [/^(\d+)d\+/, function (m) { return C('lastOrderDays', 'gt', +m[1]); }],
    [/^(?:aged?|ages) (\d+) ?(?:to|-|–|and) ?(\d+)/, function (m) { var a = +m[1], b = +m[2]; return C('age', 'between', [Math.min(a, b), Math.max(a, b)]); }],
    [/^(?:under|younger than) (\d+)(?! days| orders)/, function (m) { return +m[1] >= 16 && +m[1] <= 99 ? C('age', 'lt', +m[1]) : null; }],
    [/^(?:over|older than) (\d+)(?! days| orders| dollars)/, function (m) { return +m[1] >= 16 && +m[1] <= 99 ? C('age', 'gt', +m[1]) : null; }],
    [/^(?:who )?(?:spent|spend|spending) (?:over|more than|at least) \$?(\d+)/, function (m) { return C('spend', 'gte', +m[1]); }],
    [/^(?:at least |more than )?(\d+)(?: or more|\+)? orders/, function (m, s) { return C('orders', /^more than/.test(s) ? 'gt' : 'gte', +m[1]); }],
    [/^(?:propensity|likelihood) (?:above|over) (\d+)%/, function (m) { return C('prop', 'gte', +m[1] / 100); }]
  ];

  S.parse = function (text, world) {
    var raw = String(text || '');
    var norm = raw.replace(/[“”"(),;:!?]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
    var orig = norm ? norm.split(' ') : [];
    var low = orig.map(function (w) { return w.toLowerCase(); });
    var states = (D().STATES || []).map(idOf);
    var found = [], ignored = [], matchedWords = 0, p = 0, k;
    while (p < low.length) {
      var rest = low.slice(p).join(' '), hit = null;
      for (k = 0; k < NUM_PATTERNS.length && !hit; k++) {
        var m = NUM_PATTERNS[k][0].exec(rest);
        if (m && (rest.length === m[0].length || rest.charAt(m[0].length) === ' ')) {
          var c = NUM_PATTERNS[k][1](m, rest);
          if (c) hit = { n: m[0].split(' ').length, cond: c };
        }
      }
      if (!hit && /^[A-Z]{2}$/.test(orig[p]) && states.indexOf(orig[p]) >= 0) hit = { n: 1, cond: C('state', 'in', [orig[p]]) };
      if (!hit) {
        var L = lexicon();
        for (k = 0; k < L.length; k++) {
          var e = L[k], ok = p + e.words.length <= low.length;
          for (var j = 0; ok && j < e.words.length; j++) if (low[p + j] !== e.words[j]) ok = false;
          if (ok) { var r = e.make(world); hit = { n: e.words.length, cond: r.cond, group: r.group, note: r.note, label: r.label }; break; }
        }
      }
      if (hit) {
        var phrase = orig.slice(p, p + hit.n).join(' ');
        found.push({ phrase: phrase, cond: hit.cond || null, group: hit.group || null,
          label: hit.label || (S.condLabel(hit.cond) + (hit.note || '')) });
        matchedWords += hit.n; p += hit.n;
      } else {
        if (STOP.indexOf(low[p]) < 0) ignored.push(orig[p]);
        p++;
      }
    }
    // assemble: merge cat 'in' lists per attribute, OR multiple affinities, later numbers replace earlier
    var items = [], catAt = {}, numAt = {}, affs = [], affPos = -1;
    found.forEach(function (f) {
      if (f.group) { items.push(f.group); return; }
      var c = f.cond, a = attrMap()[c.attr];
      if (/^aff/.test(c.attr)) { if (affPos < 0) { affPos = items.length; items.push(null); } if (!affs.some(function (x) { return x.attr === c.attr; })) affs.push(c); return; }
      if (a && a.type === 'cat' && c.cmp === 'in') {
        if (catAt[c.attr] !== undefined) { var t = items[catAt[c.attr]]; c.value.forEach(function (v) { if (t.value.indexOf(v) < 0) t.value.push(v); }); return; }
        catAt[c.attr] = items.length; items.push({ attr: c.attr, cmp: 'in', value: c.value.slice() }); return;
      }
      var nk = c.attr + '|' + (c.cmp === 'gt' || c.cmp === 'gte' ? 'up' : (c.cmp === 'lt' || c.cmp === 'lte' ? 'down' : c.cmp));
      if (numAt[nk] !== undefined) { items[numAt[nk]] = Object.assign({}, c); return; }
      numAt[nk] = items.length; items.push(Object.assign({}, c));
    });
    if (affPos >= 0) items[affPos] = affs.length === 1 ? affs[0] : { op: 'any', items: affs };
    var matched = found.map(function (f) { return { phrase: f.phrase, attr: f.cond ? f.cond.attr : 'group', label: f.label, cond: f.cond || f.group }; });
    var total = matchedWords + ignored.length;
    return {
      rule: { op: 'all', items: items }, matched: matched, ignored: ignored,
      confidence: matchedWords ? Math.round(100 * matchedWords / total) / 100 : 0
    };
  };

  /* ---------------- traits / overlap / eliminations ---------------- */
  function bins(lo, hi, k) {
    var out = [], step = (hi - lo) / k;
    for (var j = 0; j < k; j++) out.push({ x0: lo + j * step, x1: lo + (j + 1) * step, count: 0 });
    return out;
  }
  function binIdx(v, lo, hi, k) {
    if (!(hi > lo)) return 0;
    var j = Math.floor((v - lo) / (hi - lo) * k);
    return j < 0 ? 0 : (j >= k ? k - 1 : j);
  }

  // traits(world, bits) -> { count, reach:{email,sms,push,ads}, hist:{prop,churn,ltv:[{x0,x1,count}]},
  //   region:number[] (REGIONS order), tier:number[] (TIERS order), bestCh:{email,sms,push,none},
  //   bestHr:number[24], sample:int[<=5], meanProp, meanChurn, meanLtv }
  S.traits = function (world, bits) {
    var P = world.profiles, n = P.n, B = MC.CH.BIT, i;
    var nReg = (D().REGIONS || []).length || 6, nTier = (D().TIERS || []).length || 4;
    var maxLtv = 0;
    for (i = 0; i < n; i++) if (P.ltv[i] > maxLtv) maxLtv = P.ltv[i];
    if (!(maxLtv > 0)) maxLtv = 1;
    var out = {
      count: 0, reach: { email: 0, sms: 0, push: 0, ads: 0 },
      hist: { prop: bins(0, 1, 10), churn: bins(0, 1, 10), ltv: bins(0, maxLtv, 10) },
      region: [], tier: [], bestCh: { email: 0, sms: 0, push: 0, none: 0 }, bestHr: [], sample: [],
      meanProp: 0, meanChurn: 0, meanLtv: 0
    };
    for (i = 0; i < nReg; i++) out.region.push(0);
    for (i = 0; i < nTier; i++) out.tier.push(0);
    for (i = 0; i < 24; i++) out.bestHr.push(0);
    var names = ['email', 'sms', 'push'], sp = 0, sc = 0, sl = 0;
    function can(i2, bit) { return (P.consent[i2] & bit) !== 0 && (P.unsub[i2] & bit) === 0; }
    for (i = 0; i < n; i++) {
      if (!bits || !bits[i]) continue;
      out.count++;
      if (can(i, B.email)) out.reach.email++;
      if (can(i, B.sms)) out.reach.sms++;
      if (can(i, B.push)) out.reach.push++;
      if (can(i, B.social)) out.reach.ads++;
      out.hist.prop[binIdx(P.prop[i], 0, 1, 10)].count++;
      out.hist.churn[binIdx(P.churn[i], 0, 1, 10)].count++;
      out.hist.ltv[binIdx(P.ltv[i], 0, maxLtv, 10)].count++;
      if (P.region[i] < nReg) out.region[P.region[i]]++;
      if (P.tier[i] < nTier) out.tier[P.tier[i]]++;
      out.bestCh[P.bestCh[i] === 255 ? 'none' : (names[P.bestCh[i]] || 'none')]++;
      out.bestHr[P.bestHr[i] % 24]++;
      sp += P.prop[i]; sc += P.churn[i]; sl += P.ltv[i];
    }
    if (out.count) {
      out.meanProp = sp / out.count; out.meanChurn = sc / out.count; out.meanLtv = sl / out.count;
      var want = Math.min(5, out.count), seen = 0, next = 0, pick = 0;
      for (i = 0; i < n && pick < want; i++) {
        if (!bits[i]) continue;
        if (seen === next) { out.sample.push(i); pick++; next = Math.floor(pick * out.count / want); }
        seen++;
      }
    }
    return out;
  };

  // overlap(world, ids) -> { ids, counts[r][c] = |r ∩ c|, pct[r][c] = counts[r][c] / counts[r][r] }
  S.overlap = function (world, ids) {
    ids = (ids || []).filter(function (id) { return world.segments.byId[id]; });
    var n = world.profiles.n, sets = ids.map(function (id) { return S.members(world, id); });
    var counts = ids.map(function () { return ids.map(function () { return 0; }); });
    for (var i = 0; i < n; i++) {
      for (var r = 0; r < sets.length; r++) {
        if (!sets[r][i]) continue;
        var row = counts[r];
        for (var c = 0; c < sets.length; c++) if (sets[c][i]) row[c]++;
      }
    }
    var pct = counts.map(function (row, r) { var b = row[r]; return row.map(function (v) { return b ? v / b : 0; }); });
    return { ids: ids, counts: counts, pct: pct };
  };

  function withoutPath(rule, path) {
    function rec(g, depth) {
      var items = [];
      g.items.forEach(function (x, k) {
        if (k === path[depth]) {
          if (depth === path.length - 1) return;
          var sub = rec(x, depth + 1);
          if (sub.items.length) items.push(sub);
          return;
        }
        items.push(x);
      });
      return { op: g.op, items: items };
    }
    return rec(rule, 0);
  }
  S.withoutPath = withoutPath;

  // eliminations(world, rule) -> [{path, label, remaining, removedPct}]
  //   remaining = count with that leaf removed; removedPct = share of all profiles the leaf alone rules out (0-1).
  S.eliminations = function (world, rule) {
    var n = world.profiles.n;
    return leaves(rule, [], []).map(function (l) {
      var remaining = 0, alone = n;
      try { remaining = S.evaluate(world, withoutPath(rule, l.path)).count; } catch (e) { remaining = 0; }
      try { alone = S.evaluate(world, { op: 'all', items: [l.cond] }).count; } catch (e2) { alone = n; }
      return { path: l.path, label: S.condLabel(l.cond), remaining: remaining, removedPct: n ? 1 - alone / n : 0 };
    });
  };

  S.MAX_DEPTH = MAX_DEPTH;
  S.OPS = { num: NUM_OPS.slice(), cat: CAT_OPS.slice(), bool: BOOL_OPS.slice() };
  S.OP_LABEL = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', between: 'between', in: 'is any of', notIn: 'is none of', is: 'is' };
})();
