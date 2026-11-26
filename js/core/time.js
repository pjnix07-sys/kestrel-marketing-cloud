/* Marketing Cloud - MC.time: clock arithmetic.
   tick 0 = Sat 2026-11-07 00:00 on the internal calendar; 1 tick = 1 hour; history days are negative.
   Pure integer calendar math (proleptic Gregorian). The only Date read is the display anchor:
   display dates shift the internal calendar so the boot day shows as the real current date (§11.1).
   Tick arithmetic (dayOf, hourOf, tickOf, dow, ...) is unchanged. The calendar-facing functions
   (calendar, ymd, dayOfYmd, monthOf) return DISPLAY dates so every label, date input and month
   boundary agrees with what the marketer sees; sim* twins keep the fixed internal calendar
   (tick 0 = Sat 2026-11-07), which is also what anchorDisplay('2026-11-07') makes the display. */
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

  T.simCalendar = function (day) {
    var c = civilFromDays(EPOCH + day);
    var dw = T.dowOfDay(day);
    return { y: c.y, m: c.m, d: c.d, dow: dw, label: DOWS[dw] + ', ' + MONTHS[c.m - 1] + ' ' + c.d };
  };

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  T.simYmd = function (day) {
    var c = civilFromDays(EPOCH + day);
    var ys = String(c.y);
    while (ys.length < 4) ys = '0' + ys;
    return ys + '-' + pad2(c.m) + '-' + pad2(c.d);
  };

  // '2026-11-07' -> 0. Returns null for malformed input.
  T.simDayOfYmd = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return daysFromCivil(y, mo, d) - EPOCH;
  };

  // Calendar month containing `day`: Nov 2026 = { y:2026, m:11, label:'Nov', fromDay:-6, toDay:23 }.
  T.simMonthOf = function (day) {
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

  /* ======================= display mapping (§11.1) ======================= */
  // Display day = internal day + offset, where the anchor internal day (0 = the boot day) shows as
  // the real local date the first time any display helper (or anchorDisplay) runs.
  var anchorCivil = null, anchorSimDay = 0;
  function todayCivilDays() {
    try { var d = new Date(); return daysFromCivil(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    catch (e) { return EPOCH; }
  }
  function off() {
    if (anchorCivil === null) anchorCivil = todayCivilDays();
    return anchorCivil - EPOCH - anchorSimDay;
  }
  // Freezes the anchor now (engine.boot calls it). ymd ('2026-11-07' = identity) pins it for dev/tests.
  T.anchorDisplay = function (ymd, simDay) {
    var m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd)) : null;
    anchorCivil = m ? daysFromCivil(+m[1], +m[2], +m[3]) : (anchorCivil === null || ymd === null ? todayCivilDays() : anchorCivil);
    if (typeof simDay === 'number' && isFinite(simDay)) anchorSimDay = Math.floor(simDay);
    return off();
  };
  T.displayOffset = function () { return off(); };

  // Display calendar of an internal day: { y, m, d, dow, label:'Wed, Nov 25', ymd }.
  T.displayCalendar = function (day) {
    var z = EPOCH + day + off(), c = civilFromDays(z);
    var dw = (((z + 4) % 7) + 7) % 7;
    return { y: c.y, m: c.m, d: c.d, dow: dw, label: DOWS[dw] + ', ' + MONTHS[c.m - 1] + ' ' + c.d,
      ymd: String(c.y) + '-' + pad2(c.m) + '-' + pad2(c.d) };
  };
  T.displayYmd = function (day) { return T.displayCalendar(day).ymd; };
  // '2026-11-25' as shown in a date input -> internal day (null if malformed).
  T.dayOfDisplayYmd = function (s) { var d = T.simDayOfYmd(s); return d === null ? null : d - off(); };
  // Display month containing an internal day, bounds in internal days.
  T.displayMonthOf = function (day) {
    var o = off(), m = T.simMonthOf(day + o);
    return { y: m.y, m: m.m, label: m.label, name: m.name, fromDay: m.fromDay - o, toDay: m.toDay - o, days: m.days };
  };

  var DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function finite(x) { return typeof x === 'number' && isFinite(x); }
  // opts.style: 'short' "Nov 25" | 'medium' (default) "Wed, Nov 25" | 'long' "Wednesday, November 25"; opts.year adds ", 2026".
  T.dayLabel = function (day, opts) {
    if (!finite(day)) return '—';
    var c = T.displayCalendar(day), st = (opts && opts.style) || 'medium', s;
    if (st === 'short') s = MONTHS[c.m - 1] + ' ' + c.d;
    else if (st === 'long') s = DOW_NAMES[c.dow] + ', ' + MONTH_NAMES[c.m - 1] + ' ' + c.d;
    else s = c.label;
    return opts && opts.year ? s + ', ' + c.y : s;
  };
  T.dateLabel = function (tick, opts) { return finite(tick) ? T.dayLabel(T.dayOf(tick), opts) : '—'; };
  // "2 pm", "12 am".
  T.timeLabel = function (tick) {
    if (!finite(tick)) return '—';
    var h = T.hourOf(tick), h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (h < 12 ? ' am' : ' pm');
  };
  // "Nov 25, 2 pm".
  T.stampLabel = function (tick) { return finite(tick) ? T.dayLabel(T.dayOf(tick), { style: 'short' }) + ', ' + T.timeLabel(tick) : '—'; };

  // Relative time of a tick seen from nowTick: "just now", "3h ago", "yesterday", "4 days ago", "Nov 12";
  // future: "in 3h", "tomorrow", "in 4 days", "Dec 2".
  T.relative = function (tick, nowTick) {
    if (!finite(tick) || !finite(nowTick)) return '—';
    var d = nowTick - tick, a = Math.abs(d);
    var dd = Math.abs(T.dayOf(nowTick) - T.dayOf(tick));
    if (a < 1) return 'just now';
    if (dd === 0 || a < 6) return d > 0 ? a + 'h ago' : 'in ' + a + 'h';
    if (dd === 1) return d > 0 ? 'yesterday' : 'tomorrow';
    if (dd < 7) return d > 0 ? dd + ' days ago' : 'in ' + dd + ' days';
    return T.dayLabel(T.dayOf(tick), { style: 'short' });
  };
  // Day heading relative to today: "Today", "Yesterday", "Tomorrow", else "Wed, Nov 25".
  T.relativeDay = function (day, today) {
    if (!finite(day)) return '—';
    if (finite(today)) {
      if (day === today) return 'Today';
      if (day === today - 1) return 'Yesterday';
      if (day === today + 1) return 'Tomorrow';
    }
    return T.dayLabel(day);
  };
  // Worded cadence from hours: "every hour", "every 6 hours", "daily", "every 2 days", "weekly".
  // Calendar-facing API (display dates). Internal-calendar twins: simCalendar, simYmd, simDayOfYmd, simMonthOf.
  T.calendar = function (day) { var c = T.displayCalendar(day); return { y: c.y, m: c.m, d: c.d, dow: c.dow, label: c.label }; };
  T.ymd = function (day) { return T.displayYmd(day); };
  T.dayOfYmd = function (s) { return T.dayOfDisplayYmd(s); };
  T.monthOf = function (day) { return T.displayMonthOf(day); };

  T.cadence = function (hours) {
    if (!finite(hours) || hours <= 0) return '—';
    if (hours === 1) return 'every hour';
    if (hours < 24 || hours % 24) return 'every ' + hours + ' hours';
    var days = hours / 24;
    if (days === 1) return 'daily';
    if (days === 7) return 'weekly';
    return 'every ' + days + ' days';
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
