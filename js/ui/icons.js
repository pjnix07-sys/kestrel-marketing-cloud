/* Marketing Cloud - inline SVG icons (MC.icons: name -> 24x24 stroke path data),
   MC.ui.Icon and MC.ui.Scene (the six synthetic Fernway product illustrations).
   Colors come from currentColor or CSS tokens only. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.icons = MC.icons || {};
  MC.ui = MC.ui || {};

  // Circle helper as path data (so every icon is a single `d` string).
  function c(cx, cy, r) {
    return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0';
  }

  var P = {
    // navigation
    home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5',
    campaigns: 'M4 10v4M4 12h2l9 5V7L6 12M18 9.5a3 3 0 0 1 0 5M8 14.5l1.5 5h2.5l-1.3-4.3',
    content: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3M14.5 7.5l3 3',
    audiences: c(9, 8, 3.2) + 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6' + c(17, 9, 2.4) + 'M16 14.2c2.8.2 5 2.5 5 5.3',
    analytics: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
    agents: 'M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6zM18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9zM5.5 15.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z',
    // brand mark: a customer journey drawn as an M (full-colour version: assets/mark.svg)
    mark: 'M4 20L7 6l5 7 5-9 3 16',
    // actions
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6 6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    warn: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3',
    info: c(12, 12, 9) + 'M12 11v5.5M12 7.8v.3',
    'check-circle': c(12, 12, 9) + 'M8 12.3l2.8 2.7L16 9.6',
    'x-circle': c(12, 12, 9) + 'M9 9l6 6M15 9l-6 6',
    'chevron-down': 'M6 9.5l6 6 6-6',
    'chevron-up': 'M6 14.5l6-6 6 6',
    'chevron-left': 'M14.5 6l-6 6 6 6',
    'chevron-right': 'M9.5 6l6 6-6 6',
    'arrow-right': 'M5 12h14M13 6l6 6-6 6',
    'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
    'arrow-up': 'M12 19V5M6 11l6-6 6 6',
    'arrow-down': 'M12 5v14M6 13l6 6 6-6',
    menu: 'M4 7h16M4 12h16M4 17h16',
    more: c(5.5, 12, 1.2) + c(12, 12, 1.2) + c(18.5, 12, 1.2),
    search: c(10.5, 10.5, 6) + 'M15 15l5 5',
    filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5z',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
    refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
    edit: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' + c(12, 12, 3),
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    // simulation
    play: 'M7 5v14l12-7z',
    pause: 'M8 5v14M16 5v14',
    step: 'M6 5v14l9-7zM18 5v14',
    clock: c(12, 12, 9) + 'M12 7v5l3.5 2',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4',
    // theme
    sun: c(12, 12, 4) + 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
    // inbox / approvals
    inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 2.5h5L16 13h5',
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6zM8.8 12l2.3 2.3 4.2-4.6',
    gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4-5',
    target: c(12, 12, 9) + c(12, 12, 5) + c(12, 12, 1.2),
    trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    sparkle: 'M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6z',
    users: c(9, 8, 3.2) + 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6' + c(17, 9, 2.4) + 'M16 14.2c2.8.2 5 2.5 5 5.3',
    user: c(12, 8, 4) + 'M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
    gift: 'M4 10h16v4H4zM5 14h14v7H5zM12 10v11M12 10c-1-3-5-4-5-1.5S10.5 10 12 10zM12 10c1-3 5-4 5-1.5S13.5 10 12 10z',
    image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6' + c(16, 9, 1.5),
    dollar: 'M12 3v18M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.8 0-4.5 1.4-4.5 3.2 0 4.3 9.5 2.3 9.5 6.8 0 1.9-1.9 3.2-4.8 3.2-2.3 0-4-.8-4.9-2.2',
    layers: 'M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5',
    flow: 'M4 6h5v4H4zM15 4h5v4h-5zM15 16h5v4h-5zM9 8h3v10h3M12 6h3',
    split: 'M5 4v5a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v5M5 20v-5a3 3 0 0 1 3-3',
    // channels
    email: 'M3 6h18v12H3zM3 7l9 6.5L21 7',
    sms: 'M4 5h16v11H9l-5 4zM8 10h8M8 13h5',
    push: 'M7 3h10v18H7zM11 18h2M14.5 7.5h.01',
    social: c(6, 12, 2.5) + c(18, 6, 2.5) + c(18, 18, 2.5) + 'M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6',
    web: c(12, 12, 9) + 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
    ads: 'M4 9v6h3l6 4V5L7 9zM17 9.5a3.5 3.5 0 0 1 0 5'
  };
  Object.keys(P).forEach(function (k) { if (!MC.icons[k]) MC.icons[k] = P[k]; });

  // Aliases commonly reached for by views.
  var ALIAS = {
    close: 'x', cross: 'x', fail: 'x-circle', pass: 'check-circle', warning: 'warn', alert: 'warn', approvals: 'inbox',
    planner: 'flag', optimizer: 'split', sendtime: 'clock', pacer: 'gauge', guard: 'shield', scout: 'target',
    analyst: 'trend', 'copy-agent': 'edit', settings: 'gauge', delete: 'trash', back: 'arrow-left', forward: 'arrow-right',
    system: 'monitor', light: 'sun', dark: 'moon', journey: 'flow', budget: 'dollar', segment: 'users'
  };
  Object.keys(ALIAS).forEach(function (k) { if (!MC.icons[k]) MC.icons[k] = P[ALIAS[k]]; });

  // Filled glyphs (rendered with fill rather than stroke).
  var FILLED = { play: true, step: false };

  function h() { return MC.html; }

  MC.ui.Icon = function Icon(p) {
    var html = h();
    var name = p.name;
    var d = MC.icons[name] || MC.icons.info;
    var size = p.size || 16;
    var filled = p.filled != null ? !!p.filled : !!FILLED[name];
    var title = p.title || null;
    var style = Object.assign({ flex: '0 0 auto', display: 'inline-block', verticalAlign: 'middle' }, p.style || null);
    return html`<svg className=${'k-icon' + (p.className ? ' ' + p.className : '')} width=${size} height=${size} viewBox="0 0 24 24"
        fill=${filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth=${p.strokeWidth || 1.75}
        strokeLinecap="round" strokeLinejoin="round" style=${style}
        role=${title ? 'img' : null} aria-label=${title} aria-hidden=${title ? null : 'true'} focusable="false">
      ${title ? html`<title>${title}</title>` : null}
      <path d=${d} />
    </svg>`;
  };

  /* ---------------- Scenes: six synthetic product illustrations ---------------- */
  var SCENES = {
    'scene-summit': { label: 'Summit at sunrise', alt: 'A snow-capped peak at sunrise above two ridgelines.' },
    'scene-forest': { label: 'Evergreen forest', alt: 'A dense stand of evergreen trees under a pale sky.' },
    'scene-campfire': { label: 'Campfire night', alt: 'A tent beside a small campfire under a night sky.' },
    'scene-trail': { label: 'Winding trail', alt: 'A trail winding through rolling hills toward the mountains.' },
    'scene-snow': { label: 'Fresh snow', alt: 'Snow falling over a quiet pine slope.' },
    'scene-lake': { label: 'Alpine lake', alt: 'A still alpine lake reflecting the mountains around it.' }
  };
  function sceneMeta(id) {
    var list = (MC.copy && MC.copy.IMAGES) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return { label: list[i].label || (SCENES[id] || {}).label, alt: list[i].alt || (SCENES[id] || {}).alt };
    }
    return SCENES[id] || null;
  }
  function f(token) { return { fill: 'var(--' + token + ')' }; }
  function s(token, w) { return { stroke: 'var(--' + token + ')', strokeWidth: w || 3, fill: 'none', strokeLinecap: 'round' }; }

  function sceneBody(id) {
    var html = h();
    switch (id) {
      case 'scene-summit':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('accent-soft')} />
          <circle cx="250" cy="58" r="22" style=${f('chart-3')} />
          <path d="M0 200 L70 110 L120 150 L190 60 L260 140 L320 100 L320 200 Z" style=${f('chart-1')} />
          <path d="M190 60 L170 86 L182 82 L192 94 L204 80 L214 88 Z" style=${f('surface')} />
          <path d="M0 200 L60 160 L130 180 L210 150 L320 175 L320 200 Z" style=${f('chart-4')} />`;
      case 'scene-forest':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('surface-2')} />
          <rect x="0" y="168" width="320" height="32" style=${f('chart-5')} />
          ${[20, 70, 120, 170, 220, 270].map(function (x, i) {
            var top = i % 2 ? 50 : 70;
            return html`<g key=${x}>
              <path d=${'M' + x + ' 180 L' + (x + 24) + ' ' + top + ' L' + (x + 48) + ' 180 Z'} style=${f(i % 2 ? 'chart-2' : 'chart-5')} />
              <rect x=${x + 21} y="176" width="6" height="12" style=${f('chart-3')} />
            </g>`;
          })}`;
      case 'scene-campfire':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('chart-1')} />
          ${[[30, 30], [80, 52], [140, 22], [210, 40], [280, 26], [250, 70], [110, 70]].map(function (pt) {
            return html`<circle key=${pt[0] + '-' + pt[1]} cx=${pt[0]} cy=${pt[1]} r="2" style=${f('surface')} />`;
          })}
          <rect x="0" y="160" width="320" height="40" style=${f('chart-4')} />
          <path d="M40 165 L95 90 L150 165 Z" style=${f('chart-3')} />
          <path d="M95 90 L95 165 L80 165 Z" style=${f('chart-6')} />
          <path d="M205 172 L265 156 M205 156 L265 172" style=${s('chart-3', 7)} />
          <path d="M235 160 C220 140 232 128 236 112 C242 128 256 140 240 160 Z" style=${f('chart-6')} />
          <path d="M236 158 C230 148 236 140 238 132 C242 142 248 148 240 158 Z" style=${f('chart-3')} />`;
      case 'scene-trail':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('accent-soft')} />
          <path d="M0 120 L80 60 L140 100 L220 40 L320 110 L320 200 L0 200 Z" style=${f('chart-4')} />
          <path d="M0 150 C80 120 160 150 320 125 L320 200 L0 200 Z" style=${f('chart-5')} />
          <path d="M150 200 C170 175 120 165 160 148 C190 136 180 126 200 120" style=${s('surface', 6)} />`;
      case 'scene-snow':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('accent-soft')} />
          <path d="M0 200 L0 150 C90 120 200 130 320 110 L320 200 Z" style=${f('surface')} />
          ${[60, 110, 250].map(function (x, i) {
            return html`<path key=${x} d=${'M' + x + ' ' + (150 - i * 6) + ' L' + (x + 18) + ' ' + (88 - i * 6) + ' L' + (x + 36) + ' ' + (150 - i * 6) + ' Z'} style=${f('chart-2')} />`;
          })}
          ${[[30, 40], [90, 20], [150, 55], [200, 25], [260, 50], [300, 18], [180, 90], [40, 95]].map(function (pt) {
            return html`<circle key=${pt[0] + '-' + pt[1]} cx=${pt[0]} cy=${pt[1]} r="3" style=${f('chart-1')} />`;
          })}`;
      case 'scene-lake':
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('surface-2')} />
          <path d="M0 115 L70 50 L120 90 L190 30 L260 85 L320 60 L320 115 Z" style=${f('chart-4')} />
          <rect x="0" y="115" width="320" height="85" style=${f('chart-1')} />
          <path d="M0 115 L70 165 L120 135 L190 185 L260 140 L320 155 L320 115 Z" style=${{ fill: 'var(--chart-4)', opacity: 0.45 }} />
          <path d="M40 150 H90 M180 168 H250 M120 186 H170" style=${s('surface', 2)} />`;
      default:
        return html`
          <rect x="0" y="0" width="320" height="200" style=${f('surface-2')} />
          <path d="M0 200 L90 110 L160 160 L230 90 L320 170 L320 200 Z" style=${f('line-strong')} />`;
    }
  }

  MC.ui.Scene = function Scene(p) {
    var html = h();
    var id = p.imageId || 'scene-summit';
    var meta = sceneMeta(id) || { label: 'Illustration', alt: 'Illustration' };
    var label = p.title || meta.alt || meta.label;
    return html`<svg className=${'k-scene' + (p.className ? ' ' + p.className : '')} viewBox="0 0 320 200" role="img" aria-label=${label}
        preserveAspectRatio="xMidYMid slice" focusable="false"
        style=${Object.assign({ display: 'block', width: '100%', height: 'auto', borderRadius: 'var(--radius-md)' }, p.style || null)}>
      <title>${label}</title>
      ${sceneBody(id)}
    </svg>`;
  };
  MC.ui.Scene.META = SCENES;
})();
