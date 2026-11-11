/* Kestrel Marketing Cloud - MC.time: simulated clock arithmetic.
   tick 0 = Sat 2026-11-07 00:00; 1 tick = 1 simulated hour; history days are negative.
   Pure integer calendar math (proleptic Gregorian), never the Date object. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var T = MC.time = MC.time || {};

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fdiv(a, b) { return Math.floor(a / b); }

  // Days since 1970-01-01 for a civil date (H. Hinnant's algorithm).
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = fdiv(y, 400);
    var yoe = y - era * 400;
    var doy = fdiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
    var doe = yoe * 365 + fdiv(yoe, 4) - fdiv(yoe, 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civilFromDays(z) {
    z += 719468;
    var era = fdiv(z, 146097);
    var doe = z - era * 146097;
    var yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100));
    var mp = fdiv(5 * doy + 2, 153);
    var d = doy - fdiv(153 * mp + 2, 5) + 1;
    var m = mp < 10 ? mp + 3 : mp - 9;
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  var EPOCH = daysFromCivil(2026, 11, 7);   // sim day 0

  T.DAY0 = -60;
  T.START = { y: 2026, m: 11, d: 7 };
  T.MONTHS = MONTHS;
  T.MONTH_NAMES = MONTH_NAMES;
  T.DOWS = DOWS;

  T.dayIndex = function (d) { return d - T.DAY0; };
  T.dayOf = function (t) { return Math.floor(t / 24); };
  T.hourOf = function (t) { return ((t % 24) + 24) % 24; };
  T.tickOf = function (day, hour) { return day * 24 + (hour || 0); };
  T.simDay = function (t) { return T.dayOf(t) + 1; };

  // Day of week of a sim day (0 = Sun). Day 0 is a Saturday (6).
  T.dowOfDay = function (day) { return (((EPOCH + day + 4) % 7) + 7) % 7; };
  // Day of week of a tick (0 = Sun); dow(0) === 6.
  T.dow = function (t) { return T.dowOfDay(T.dayOf(t)); };

  T.calendar = function (day) {
    var c = civilFromDays(EPOCH + day);
    var dw = T.dowOfDay(day);
    return { y: c.y, m: c.m, d: c.d, dow: dw, label: DOWS[dw] + ', ' + MONTHS[c.m - 1] + ' ' + c.d };
  };

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  T.ymd = function (day) {
    var c = civilFromDays(EPOCH + day);
    var ys = String(c.y);
    while (ys.length < 4) ys = '0' + ys;
    return ys + '-' + pad2(c.m) + '-' + pad2(c.d);
  };

  // '2026-11-07' -> 0. Returns null for malformed input.
  T.dayOfYmd = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return daysFromCivil(y, mo, d) - EPOCH;
  };

  // Calendar month containing `day`: Nov 2026 = { y:2026, m:11, label:'Nov', fromDay:-6, toDay:23 }.
  T.monthOf = function (day) {
    var c = civilFromDays(EPOCH + day);
    var ny = c.m === 12 ? c.y + 1 : c.y;
    var nm = c.m === 12 ? 1 : c.m + 1;
    var from = daysFromCivil(c.y, c.m, 1) - EPOCH;
    var to = daysFromCivil(ny, nm, 1) - EPOCH - 1;
    return { y: c.y, m: c.m, label: MONTHS[c.m - 1], name: MONTH_NAMES[c.m - 1], fromDay: from, toDay: to, days: to - from + 1 };
  };

  // Quiet-hours test; wraps midnight when start > end.
  T.inQuiet = function (h, quiet) {
    if (!quiet) return false;
    var s = quiet.start, e = quiet.end;
    if (s === e) return false;
    return s > e ? (h >= s || h < e) : (h >= s && h < e);
  };

  T.EVENTS = [
    { day: 19, label: 'Thanksgiving' },
    { day: 20, label: 'Black Friday' },
    { day: 23, label: 'Cyber Monday' }
  ];

  T.eventOn = function (day) {
    for (var i = 0; i < T.EVENTS.length; i++) if (T.EVENTS[i].day === day) return T.EVENTS[i];
    return null;
  };
})();
