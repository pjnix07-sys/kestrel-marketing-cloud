/* Marketing Cloud - namespace root (core).
   Creates window.MC, MC.html, shared buckets, channel/fact constants and the
   runtime contract checker. Sample tenant: Fernway Outfitters (synthetic data). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  MC.VERSION = '1.0.0';
  // Cache-busting build id. Bump it on every deploy and update the ?v= on each script and stylesheet in index.html to match
  // (tools/smoke.js fails if they differ).
  MC.BUILD = '2026.11.27-1';
  MC.SEED = 20261107;
  MC.TENANT = 'Fernway Outfitters';

  // htm bound to React.createElement. If the CDN libraries failed, app.js reports it.
  if (typeof window.htm === 'function' && window.React && typeof window.React.createElement === 'function') {
    MC.html = window.htm.bind(window.React.createElement);
  }

  // Buckets: created, never overwritten.
  ['views', 'agents', 'ui', 'charts', 'icons', 'hooks', 'dev', 'planner',
   'util', 'fmt', 'time', 'rng', 'catalog', 'store', 'uiStore', 'nav', 'select'].forEach(function (k) {
    MC[k] = MC[k] || {};
  });

  MC.CH = {
    ALL: ['email', 'sms', 'push', 'social', 'web'],
    OWNED: ['email', 'sms', 'push'],
    PAID: ['social', 'web'],
    IDX: { email: 0, sms: 1, push: 2, social: 3, web: 4 },
    BIT: { email: 1, sms: 2, push: 4, social: 8, web: 8 },
    LABEL: { email: 'Email', sms: 'SMS', push: 'Push', social: 'Social ads', web: 'Web ads' }
  };

  MC.F = { SENT: 0, DELIV: 1, OPEN: 2, CLICK: 3, CONV: 4, REV: 5, COST: 6, UNSUB: 7, IMPR: 8, REACT: 9, LEN: 10 };

  MC.ROUTES = ['home', 'campaigns', 'content', 'audiences', 'analytics', 'agents'];
  MC.AGENT_IDS = ['optimizer', 'sendtime', 'pacer', 'guard', 'scout', 'copy', 'analyst', 'planner'];

  /* ---------------- contract ---------------- */
  function group(prefix, names) {
    return names.split(' ').map(function (n) { return prefix + '.' + n; });
  }

  var REQUIRED = [].concat(
    group('MC.util', 'fnv1a fnvBytes canon digest clamp lerp sigmoid logit round sum mean sd quantile argmax stableSort shallowEqual arrayEqual wilson memo now hex8 normCdf bump'),
    group('MC.fmt', 'money num pct pp delta ratio range date time stamp rel hour'),
    group('MC.time', 'dayOf hourOf dow tickOf calendar dayIndex ymd dayOfYmd monthOf simDay inQuiet EVENTS'),
    group('MC.rng', 'create fork'),
    group('MC.catalog', 'define get reduce inverse apply dispatchUser'),
    group('MC.store', 'init getState subscribe dispatch applyInternal batch bump'),
    group('MC.uiStore', 'getState set subscribe'),
    group('MC.nav', 'go route'),
    group('MC.hooks', 'useSelect useShallow useUi useTick useDraft useFrozen useDebounced useWidth useReducedMotion'),
    group('MC.data', 'generate generateSteps journeyTemplate'),
    group('MC.models', 'fitPropensity scoreProfiles holt goalProbability ewma fitResponse response marginal probBest attribution unsubRisk explain'),
    group('MC.segments', 'ATTRS compile evaluate traits overlap parse describe validate members eliminations nameFor'),
    group('MC.copy', 'generate features score check render'),
    group('MC.guardrails', 'define evaluate preflight'),
    group('MC.sim', 'step dayRoll latentFor dailyBudget enroll curvesFor'),
    group('MC.select', 'kpis campaignRows campaignStats variantStats series forecast funnel channelCompare attribution liftVsControl agentMarkers openProposals proposalsFor feed agentRoster agentImpact segmentRows movers insights journeyStats profileRow previewProfiles variantLibrary campaignGoal'),
    group('MC.runtime', 'register defs def runDue preview observeView statusOf apply undoCheck runAgent'),
    group('MC.engine', 'boot setSpeed getSpeed step restart tickOnce advance'),
    group('MC.replay', 'digestWorld run verify'),
    group('MC.dev', 'selfTest'),
    group('MC.planner', 'plan'),
    group('MC.ui', 'Button IconButton Segmented Field TextInput TextArea NumberInput Select Slider Checkbox ChipToggle Tabs Badge Pill StatusPill StatusDot Panel KPI Meter ProgressBar DataTable EmptyState Skeleton Drawer Sheet InlineConfirm Popover Tooltip ToastHost ConflictChip NewItemsPill Delta Money Num SampleDataBadge Icon Scene AgentChip ProposalCard GuardrailList DiffTable AllocationBar ImpactBadge TraceView AgentPulse AutonomyControl'),
    group('MC.charts', 'Sparkline LineChart ForecastChart BarChart StackedBar Funnel Histogram HourStrip Heatmap ResponseCurve ScoreRing FlowDiagram Gantt'),
    group('MC.views', 'home campaigns content audiences analytics agents')
  );

  var OWNERS = {
    util: 'core', fmt: 'core', time: 'core', rng: 'core', catalog: 'core', store: 'core', uiStore: 'core',
    nav: 'core', select: 'core', models: 'core', segments: 'core', copy: 'core', data: 'core',
    guardrails: 'core', sim: 'core', runtime: 'core', engine: 'core', replay: 'core', dev: 'core',
    hooks: 'core/ui', ui: 'ui', charts: 'ui', icons: 'ui', planner: 'agents', agents: 'agents',
    views: 'views'
  };

  function lookup(path) {
    var parts = String(path).split('.');
    var cur = window;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  MC.contract = MC.contract || {};
  MC.contract.REQUIRED = REQUIRED;
  MC.contract.lookup = lookup;

  MC.contract.require = function (path) {
    var full = String(path).indexOf('MC.') === 0 ? String(path) : 'MC.' + path;
    var v = lookup(full);
    if (v === undefined || v === null) {
      var bucket = full.split('.')[1];
      throw new Error(full + ' missing (owner: ' + (OWNERS[bucket] || 'unknown') + ')');
    }
    return v;
  };

  MC.contract.check = function () {
    var missing = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      var v = lookup(REQUIRED[i]);
      if (v === undefined || v === null) missing.push(REQUIRED[i]);
    }
    // Agent registrations.
    var ids = [];
    try {
      if (MC.runtime && typeof MC.runtime.defs === 'function') {
        var defs = MC.runtime.defs() || [];
        if (Array.isArray(defs)) ids = defs.map(function (d) { return d && d.id; });
        else ids = Object.keys(defs);
      }
    } catch (e) { ids = []; }
    MC.AGENT_IDS.forEach(function (id) {
      if (ids.indexOf(id) < 0) missing.push('agent:' + id);
    });
    return { missing: missing };
  };
})();
