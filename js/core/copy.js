/* Marketing Cloud - MC.copy: deterministic Fernway Outfitters copy engine.
   Seeded phrase banks by tone x category x offer, channel adapters with length limits,
   a linear engagement model (features -> score), brand & compliance checks with
   deterministic fixes, and token rendering for previews. generate() is pure:
   rng = MC.rng.fork(seed, 'copy', seedKey). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var CP = MC.copy = MC.copy || {};

  CP.TONES = ['practical', 'adventurous', 'warm', 'urgent'];
  CP.TONE_LABEL = { practical: 'Practical', adventurous: 'Adventurous', warm: 'Warm', urgent: 'Urgent' };
  CP.OFFERS = ['none', 'freeship', 'pct15', 'pct25', 'gift'];
  CP.OFFER_LABEL = { none: 'No offer', freeship: 'Free shipping', pct15: '15% off', pct25: '25% off', gift: 'Free gift' };
  CP.OFFER_LIFT = { none: 0, freeship: 0.15, pct15: 0.30, pct25: 0.45, gift: 0.10 };
  CP.DISCOUNT = { none: 0, freeship: 0, pct15: 0.15, pct25: 0.25, gift: 0 };
  CP.LIMITS = { subject: 60, preheader: 90, sms: 160, pushTitle: 40, pushBody: 120, socialText: 125, socialHeadline: 40, headline: 70, cta: 28, alt: 125 };
  CP.HOOK = { email: 'subject', sms: 'sms', push: 'pushTitle', social: 'socialHeadline', web: 'socialHeadline' };
  CP.MAIN = { email: 'body', sms: 'sms', push: 'pushBody', social: 'socialText', web: 'socialText' };
  CP.FIELDS = {
    email: ['subject', 'preheader', 'headline', 'body', 'cta', 'link', 'imageId', 'alt'],
    sms: ['sms', 'link'],
    push: ['pushTitle', 'pushBody', 'link'],
    social: ['socialText', 'socialHeadline', 'cta', 'link', 'imageId', 'alt'],
    web: ['socialText', 'socialHeadline', 'cta', 'link', 'imageId', 'alt']
  };
  CP.FIELD_LABEL = { subject: 'Subject', preheader: 'Preheader', headline: 'Headline', body: 'Body', cta: 'Button label',
    link: 'Link', imageId: 'Image', alt: 'Alt text', sms: 'Message', pushTitle: 'Title', pushBody: 'Body',
    socialText: 'Primary text', socialHeadline: 'Headline' };
  CP.TOKENS = ['{first_name}', '{product}', '{offer}', '{link}'];
  CP.TOKEN_NAMES = ['first_name', 'product', 'offer', 'link'];
  // Any token may carry its own fallback: {first_name|there}. An empty fallback ({first_name|}) drops the token.
  var TOKEN_RE = /\{([a-z_]+)(?:\|([^{}]*))?\}/g;
  CP.IMAGES = [
    { id: 'scene-summit', label: 'Summit at dawn', alt: 'Climber on a granite summit as the sun rises over the ridgeline' },
    { id: 'scene-forest', label: 'Forest trail', alt: 'Runner on a misty forest trail lined with tall firs' },
    { id: 'scene-campfire', label: 'Campfire', alt: 'Camp stove and mugs beside a small campfire at dusk' },
    { id: 'scene-trail', label: 'Ridge trail', alt: 'Hiker in boots crossing a rocky ridge trail above the valley' },
    { id: 'scene-snow', label: 'First snow', alt: 'Person in an insulated jacket walking through fresh snow' },
    { id: 'scene-lake', label: 'Alpine lake', alt: 'Calm alpine lake with a canoe pulled up on the shore' }
  ];

  var CAT_WORDS = {
    hike: { G: 'trail gear', PL: 'the trail', SE: 'shoulder-season hikes', img: 'scene-trail' },
    camp: { G: 'camp kit', PL: 'camp', SE: 'cold-night camping', img: 'scene-campfire' },
    climb: { G: 'climbing gear', PL: 'the crag', SE: 'crisp-weather climbing', img: 'scene-summit' },
    run: { G: 'running kit', PL: 'the trail', SE: 'frosty morning runs', img: 'scene-forest' },
    apparel: { G: 'layers', PL: 'the cold', SE: 'the first frost', img: 'scene-snow' },
    all: { G: 'gear', PL: 'the outdoors', SE: 'the season ahead', img: 'scene-lake' }
  };
  // Offer phrasing: O bare, OP with the product, OS full sentence, OSS short SMS sentence.
  var OFFER_TEXT = {
    none: { O: '', OP: '', OS: '', OSS: '' },
    freeship: { O: 'free shipping', OP: 'free shipping on {THEP}', OPA: 'free shipping on everything', OS: 'Shipping is on us.', OSS: 'Free shipping on your order. ' },
    pct15: { O: '15% off', OP: '15% off {THEP}', OPA: '15% off sitewide', OS: 'Take 15% off your order.', OSS: '15% off your order. ' },
    pct25: { O: '25% off', OP: '25% off {THEP}', OPA: '25% off sitewide', OS: 'Take 25% off your order.', OSS: '25% off your order. ' },
    gift: { O: 'a free gift', OP: 'a free gift with {THEP}', OPA: 'a free gift with every order', OS: 'Every order ships with a free gift.', OSS: 'Free gift with every order. ' }
  };
  CP.OFFER_TEXT = { none: '', freeship: 'free shipping', pct15: '15% off', pct25: '25% off', gift: 'a free gift' };

  // Template entries: [text, flags] where flags 'o' = needs an offer, 'g' = gift offer only.
  var BANK = {
    subject: {
      practical: [['Built for {SE}: {THEP}'], ['{OPC}, this week only', 'o'], ['3 reasons {THEP} earns a spot in your pack'],
        ['{first_name}, your checklist for {SE}'], ['What to pack for {SE}?'], ['Restock your {G} before the weekend'],
        ['Field-tested: why we stand behind {THEP}']],
      adventurous: [['Your next big day starts with {THEP}'], ['{first_name}, {PL} is calling'], ['Go farther this weekend with {O}', 'o'],
        ['Ready for {SE}?'], ['5 routes worth the early alarm'], ['Chase first light with {THEP}']],
      warm: [['{first_name}, we picked this one for you'], ['A little something for {SE}: {O}', 'o'], ['Gear we keep reaching for: {THEP}'],
        ['From our trail crew to yours'], ['Gear we would hand to a friend'], ['{first_name}, thanks for exploring with us']],
      urgent: [['Ends soon: {OP}', 'o'], ['Last call for {THEP}'], ['{first_name}, your offer ends soon', 'o'], ['Time to get {G} sorted'],
        ['Members get {O}', 'o'], ['Don’t miss it: {SE} prep ends soon']]
    },
    preheader: {
      practical: [['Specs, sizing and care tips in one place.'], ['Everything you need for {SE}, nothing you don’t.'],
        ['Free returns within 60 days on every order.'], ['{OPC}. Details inside.', 'o']],
      adventurous: [['The weather window is open. Let’s go.'], ['Pack light, go far, come back with stories.'],
        ['{OPC} while the trails are quiet.', 'o'], ['New routes, fresh gear, big views.']],
      warm: [['A note from the Fernway crew.'], ['Hand-picked for the way you get outside.'],
        ['Our thanks: {O} on your next order.', 'o'], ['Cozy evenings and early starts, covered.']],
      urgent: [['Your offer ends soon.', 'o'], ['Check the fit guide before you order.'], ['{OPC} ends soon.', 'o'], ['Order today and be set for {SE}.']]
    },
    headline: {
      practical: [['Gear that works as hard as you do'], ['Built for {SE}'], ['The {G} checklist']],
      adventurous: [['Go farther this season'], ['Your next adventure starts here'], ['Chase the weather window']],
      warm: [['Picked with you in mind'], ['Warm layers, warmer welcomes'], ['Thanks for getting outside with us']],
      urgent: [['Last chance to gear up'], ['The clock is ticking'], ['Time is running out']]
    },
    body: {
      practical: [['Hi {first_name}. {THEPC} is built for {SE}. It is light, tough and easy to care for. {OS}'],
        ['{THEPC} has earned its place in our own packs. Check the fit guide, pick your size and get set for {SE}. {OS}'],
        ['Good gear saves time out on {PL}. We tested {THEP} through rain, mud and cold. Here is what we learned. {OS}']],
      adventurous: [['{first_name}, the big days start early. Grab {THEP} and head for {PL}. {OS}'],
        ['New season, new routes. {THEPC} is ready when you are. {OS}'],
        ['Bigger views are waiting. Pack {THEP}, check the forecast and go farther. {OS}']],
      warm: [['Hi {first_name}, thank you for exploring with us. We think you will love {THEP} for {SE}. {OS}'],
        ['Our crew picked {THEP} for days like these. It is the gear we hand to friends. {OS}'],
        ['Here is a small thank-you from all of us at Fernway. {OS} We hope to see you out on {PL}.']],
      urgent: [['{first_name}, time is almost up. {OS} Order today so you are set for {SE}.'],
        ['This is the last call for {THEP}. {OS} Once it ends, it ends.'],
        ['Time is running out. {OS} Grab {THEP} before the offer ends.']]
    },
    cta: {
      practical: [['Shop now'], ['See the details'], ['Build your kit'], ['Get yours']],
      adventurous: [['Gear up'], ['Start exploring'], ['Find your route'], ['Shop the collection']],
      warm: [['Take a look'], ['Discover your pick'], ['Shop the picks'], ['Claim your gift', 'g']],
      urgent: [['Shop before it ends', 'o'], ['Get it today'], ['Claim your offer', 'o'], ['Order now']]
    },
    sms: {
      practical: [['Fernway: {THEPC} is ready for {SE}. {OSS}Shop {link}'], ['Fernway: Your checklist for {SE} is here. {OSS}See it: {link}'],
        ['Fernway: Hi {first_name}, field-tested {G} for {SE}. {OSS}Shop {link}']],
      adventurous: [['Fernway: {PLC} is calling, {first_name}. {OSS}Gear up: {link}'], ['Fernway: Big day ahead? {THEPC} is ready. {OSS}Grab it: {link}'],
        ['Fernway: The weather window is open. {OSS}Go farther: {link}']],
      warm: [['Fernway: Hi {first_name}, we picked something for {SE}. {OSS}See it: {link}'], ['Fernway: Thank you for exploring with us. {OSS}Take a look: {link}'],
        ['Fernway: Picked for you by our crew: {THEP}. {OSS}Take a look: {link}']],
      urgent: [['Fernway: Last call, {first_name}. {OSS}Shop before it ends: {link}'], ['Fernway: Time to grab {THEP}. {OSS}Get yours: {link}'],
        ['Fernway: Your pick is waiting. {OSS}Order today: {link}']]
    },
    pushTitle: {
      practical: [['Meet {P}'], ['Your {G} checklist'], ['Built for {SE}']],
      adventurous: [['{PLC} is calling'], ['Ready for a big day?'], ['Go farther this weekend']],
      warm: [['Picked for you, {first_name}'], ['A little thank-you'], ['Our crew picked these']],
      urgent: [['Ends soon', 'o'], ['Last call, {first_name}'], ['Don’t miss out']]
    },
    pushBody: {
      practical: [['{THEPC} is built for {SE}. {OS} Shop now.'], ['Light, tough and easy to care for. Meet {THEP}. {OS}']],
      adventurous: [['Pack {THEP} and head for {PL}. {OS} Gear up.'], ['The weather window is open. Go farther. {OS} Find your route.']],
      warm: [['We think you will love {THEP}. {OS} Take a look.'], ['Our crew picked these for {SE}, with thanks. {OS} See the picks.']],
      urgent: [['{OS} Ends soon. Shop now.', 'o'], ['Don’t wait. {OS} Get yours today.']]
    },
    socialText: {
      practical: [['{THEPC}: built and field-tested for {SE}. {OS}'], ['Restock your {G} with gear we tested ourselves. {OS}']],
      adventurous: [['Your next big day starts here. {PLC} is calling. {OS}'], ['Chase the weather window with {THEP}. {OS}']],
      warm: [['Gear we would hand to a friend, picked by our crew. {OS}'], ['Made for cozy camps and early starts. With thanks from Fernway. {OS}']],
      urgent: [['Ends soon. {OS} Last call for {THEP}.', 'o'], ['Time is running out. {OS}']]
    },
    socialHeadline: {
      practical: [['Built for {SE}'], ['Field-tested {G}'], ['Restock your {G}']],
      adventurous: [['Go farther this season'], ['{PLC} is calling'], ['Chase the weather window']],
      warm: [['Picked for you'], ['From our crew to you'], ['Gear we love, with thanks']],
      urgent: [['Ends soon', 'o'], ['Last call'], ['Last chance to save', 'o']]
    }
  };
  // Tone markers used for toneFit detection on any text (generated or written by hand).
  var TONE_MARKERS = {
    practical: ['built', 'tested', 'checklist', 'specs', 'restock', 'in stock', 'details', 'fit guide', 'care', 'works as hard'],
    adventurous: ['calling', 'farther', 'big day', 'adventure', 'routes', 'weather window', 'chase', 'go far', 'views', 'exploring'],
    warm: ['thank', 'picked', 'friend', 'cozy', 'crew', 'hope', 'love', 'welcome'],
    urgent: ['tonight', 'last call', 'hours', 'hurry', 'ends', 'going fast', 'today', 'final', 'midnight', 'miss']
  };
  CP.TONE_MARKERS = TONE_MARKERS;
  CP.BANK = BANK;
  CP.CAT_WORDS = CAT_WORDS;

  var OPT_OUT = ' Reply STOP to opt out.';
  CP.OPT_OUT = OPT_OUT.trim();
  var NOMINAL_NAME = 'Alexandra';   // length stand-in for {first_name} when measuring limits

  /* ---------------- small helpers ---------------- */
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function str(x) { return typeof x === 'string' ? x : (x === undefined || x === null ? '' : String(x)); }
  function prodOf(id) {
    if (!id) return null;
    var list = (MC.data && MC.data.PRODUCTS) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  CP.productOf = prodOf;
  function catOfProduct(p) { return p ? (typeof p.cat === 'string' ? p.cat : (p.cat && p.cat.id) || 'all') : 'all'; }
  function tidy(s) {
    return str(s).replace(/\s+/g, ' ').replace(/\s+([.,!?:;])/g, '$1').replace(/([.!?])\s*\./g, '$1')
      .replace(/:\s*$/, '').replace(/\s*-\s*$/, '').trim();
  }
  function slugOf(p, cat) { return p ? p.id.replace(/^p-/, '') : (cat === 'all' ? 'shop' : cat); }

  // Template variables for a (product, offer) context.
  function contextFor(productId, offer, category) {
    var p = prodOf(productId);
    var cat = p ? catOfProduct(p) : (category && CAT_WORDS[category] ? category : 'all');
    var cw = CAT_WORDS[cat] || CAT_WORDS.all;
    var off = OFFER_TEXT[offer] ? offer : 'none';
    var ot = OFFER_TEXT[off];
    var thep = p ? 'the ' + p.name : 'our ' + (cat === 'all' ? 'new-season gear' : cw.G);
    var op = off === 'none' ? '' : (p ? ot.OP.replace('{THEP}', thep) : (ot.OPA || ot.O));
    return {
      product: p, cat: cat, offer: off, link: 'fernway.co/' + slugOf(p, cat), img: cw.img,
      vars: { P: p ? p.name : 'New-season gear', THEP: thep, THEPC: cap1(thep), G: cw.G, PL: cw.PL, PLC: cap1(cw.PL),
        SE: cw.SE, O: ot.O, OP: op, OPC: cap1(op), OS: ot.OS, OSS: ot.OSS }
    };
  }
  // Fallback for a bare {first_name} given what comes before it: "Hi {first_name}" reads "Hi there"; anywhere else drop it.
  function nameFallback(before) { return /(^|[\s.!?:])(hi|hello|hey)\s+$/i.test(before) ? 'there' : ''; }
  function fill(tpl, vars) {
    var t = tpl.replace(/\{([A-Z]+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
    t = t.replace(/\{first_name\}/g, function (m, off) { return '{first_name|' + nameFallback(t.slice(0, off)) + '}'; });
    return tidy(t);
  }
  // Length as a reader sees it: tokens replaced by a long first name, the product, offer and link.
  function measure(text, ctx) {
    return expand(text, ctx).length;
  }
  // Text as a reader sees it: tokens replaced by a long first name, the product, offer and link.
  function expand(text, ctx) {
    return str(text).replace(TOKEN_RE, function (m, name) {
      if (name === 'first_name') return NOMINAL_NAME;
      if (name === 'product') return ctx ? ctx.vars.P : 'New-season gear';
      if (name === 'offer') return ctx ? ctx.vars.O : '';
      if (name === 'link') return ctx ? ctx.link : 'fernway.co/shop';
      return m;
    });
  }
  CP.expand = function (text, variant) { var v = variant || {}; return expand(text, contextFor(v.productId, v.offer || 'none')); };
  CP.measure = function (text, variant) {
    var v = variant || {};
    return measure(text, contextFor(v.productId, v.offer || 'none'));
  };
  function limitOf(field, brand) {
    if (field === 'subject' && brand && brand.maxSubject > 0) return brand.maxSubject;
    return CP.LIMITS[field] || 0;
  }
  function clip(text, max) {
    if (!max || text.length <= max) return text;
    var cut = text.slice(0, max), sp = cut.lastIndexOf(' ');
    return tidy((sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[,;:\-–]+$/, ''));
  }

  /* ---------------- generation ---------------- */
  function eligibleTpls(field, tone, offer) {
    var list = (BANK[field] && BANK[field][tone]) || [];
    return list.filter(function (e) {
      var fl = e[1] || '';
      if (fl.indexOf('o') >= 0 && offer === 'none') return false;
      if (fl.indexOf('g') >= 0 && offer !== 'gift') return false;
      return true;
    }).map(function (e) { return e[0]; });
  }
  // Picks template index `first` (if it fits) else the next one that fits the limit; clips as a last resort.
  function pickFit(tpls, first, ctx, max, post) {
    var n = tpls.length, best = null;
    for (var j = 0; j < n; j++) {
      var t = (post || fill)(tpls[(first + j) % n], ctx.vars);
      if (!max || measure(t, ctx) <= max) return t;
      if (best === null || t.length < best.length) best = t;
    }
    return best === null ? '' : clip(best, max);
  }
  function smsPost(ctx) {
    return function (tpl, vars) {
      var t = fill(tpl, vars);
      if (!/^Fernway:/.test(t)) t = 'Fernway: ' + t;
      return tidy(t) + OPT_OUT;
    };
  }

  // Raw drafts (no prediction): used by generate() and to build the bank distribution.
  function draftRaw(opts, rng) {
    var ch = CP.FIELDS[opts.channel] ? opts.channel : 'email';
    var tone = CP.TONES.indexOf(opts.tone) >= 0 ? opts.tone : 'practical';
    var offer = CP.OFFERS.indexOf(opts.offer) >= 0 ? opts.offer : 'none';
    var count = Math.max(1, Math.min(8, (opts.count | 0) || 3));
    var locks = opts.locks || {};
    var ctx = contextFor(opts.productId || null, offer, opts.category);
    var hook = CP.HOOK[ch], fieldList = CP.FIELDS[ch];
    var hookTpls = eligibleTpls(hook, tone, offer);
    var perm = rng.shuffle(hookTpls.map(function (x, k) { return k; }));
    var imgs = CP.IMAGES.map(function (x) { return x.id; });
    var out = [];
    for (var k = 0; k < count; k++) {
      var f = {};
      fieldList.forEach(function (fld) {
        if (fld === 'link') { f.link = ctx.link; return; }
        if (fld === 'imageId') {
          var im = k === 0 ? ctx.img : imgs[rng.int(imgs.length)];
          f.imageId = im; return;
        }
        if (fld === 'alt') return;
        var tpls = eligibleTpls(fld, tone, offer);
        if (!tpls.length) { f[fld] = ''; return; }
        var first = fld === hook ? perm[k % perm.length] : rng.int(tpls.length);
        f[fld] = pickFit(tpls, first, ctx, limitOf(fld, null), fld === 'sms' ? smsPost(ctx) : null);
      });
      if (f.imageId) { var img = imageById(f.imageId); f.alt = img ? img.alt : ''; }
      Object.keys(locks).sort().forEach(function (fld) {
        if (fieldList.indexOf(fld) >= 0 && locks[fld] !== undefined && locks[fld] !== null) f[fld] = str(locks[fld]);
      });
      out.push({ tmpId: '$v' + k, channel: ch, name: String.fromCharCode(65 + k), fields: f, tone: tone, offer: offer,
        productId: ctx.product ? ctx.product.id : null });
    }
    return out;
  }
  function imageById(id) { for (var i = 0; i < CP.IMAGES.length; i++) if (CP.IMAGES[i].id === id) return CP.IMAGES[i]; return null; }
  CP.imageById = imageById;

  // generate({channel, tone, productId, offer, count, locks, seedKey, category}, seed) -> VariantDraft[]
  CP.generate = function (opts, seed) {
    opts = opts || {};
    var rng = MC.rng.fork(seed === undefined || seed === null ? MC.SEED : seed, 'copy', str(opts.seedKey || 'default'));
    return draftRaw(opts, rng).map(function (d) {
      var s = CP.score(d);
      d.predicted = { score: s.score, open: s.predOpen, click: s.predClick };
      return d;
    });
  };

  /* ---------------- features ---------------- */
  var STRONG_CTA = ['shop', 'get', 'claim', 'order', 'buy', 'gear up', 'grab', 'build', 'start', 'find', 'reserve', 'save', 'go farther'];
  var SOFT_CTA = ['see', 'take a look', 'take', 'discover', 'explore', 'learn', 'view', 'browse', 'check', 'meet'];
  var URGENCY_RE = /today|tonight|ends|last|hurry|now/i;
  CP.CTA_VERBS = { strong: STRONG_CTA.slice(), soft: SOFT_CTA.slice() };

  function hasWord(text, w) { return new RegExp('(^|[^a-z])' + w.replace(/ /g, '\\s+') + '([^a-z]|$)').test(text); }
  function ctaOf(text, leading) {
    var t = str(text).toLowerCase().trim();
    if (!t) return 0;
    var i;
    for (i = 0; i < STRONG_CTA.length; i++) if (leading ? t.indexOf(STRONG_CTA[i]) === 0 : hasWord(t, STRONG_CTA[i])) return 1;
    for (i = 0; i < SOFT_CTA.length; i++) if (leading ? t.indexOf(SOFT_CTA[i]) === 0 : hasWord(t, SOFT_CTA[i])) return 0.5;
    return leading ? 0.5 : 0;
  }
  function capsWords(text) {
    var t = str(text).replace(/reply stop to opt out/ig, '').replace(/\{[a-z_]+(\|[^}]*)?\}/g, '');
    return t.match(/\b[A-Z]{4,}\b/g) || [];
  }
  function syllables(w) {
    var s = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return 0;
    var g = (s.match(/[aeiouy]+/g) || []).length;
    if (g > 1 && /e$/.test(s) && !/le$/.test(s)) g--;
    return Math.max(1, g);
  }
  // Flesch–Kincaid grade, clamped 0–18.
  CP.grade = function (text) {
    var t = str(text).replace(/\{first_name(\|[^}]*)?\}/g, 'Maya').replace(/\{link\}|fernway\.co\/[a-z0-9-]*/gi, '').replace(/reply stop to opt out\.?/ig, '');
    var words = t.match(/[A-Za-z0-9'’%$]+/g) || [];
    if (!words.length) return 0;
    var sentences = t.split(/[.!?]+/).filter(function (x) { return /[A-Za-z0-9]/.test(x); }).length || 1;
    var syl = 0;
    words.forEach(function (w) { syl += /[a-z]/i.test(w) ? syllables(w) : 1; });
    var g = 0.39 * words.length / sentences + 11.8 * syl / words.length - 15.59;
    return Math.round(Math.max(0, Math.min(18, g)) * 10) / 10;
  };
  function allText(v) {
    var f = v.fields || {}, ch = v.channel || 'email';
    return (CP.FIELDS[ch] || CP.FIELDS.email).filter(function (k) { return k !== 'link' && k !== 'imageId' && k !== 'alt'; })
      .map(function (k) { return str(f[k]); }).join(' ');
  }
  // Tone detection from marker phrases: 1 when the variant's tone leads, .5 when present but not leading, else 0.
  function toneFitOf(text, tone) {
    var t = str(text).toLowerCase(), counts = {}, best = 0;
    CP.TONES.forEach(function (tn) {
      var c = 0;
      TONE_MARKERS[tn].forEach(function (m) { if (t.indexOf(m) >= 0) c++; });
      counts[tn] = c; if (c > best) best = c;
    });
    var mine = counts[tone] || 0;
    if (!mine) return 0;
    return mine >= best ? 1 : 0.5;
  }
  CP.detectTone = function (text) {
    var t = str(text).toLowerCase(), best = null, bc = 0;
    CP.TONES.forEach(function (tn) {
      var c = 0;
      TONE_MARKERS[tn].forEach(function (m) { if (t.indexOf(m) >= 0) c++; });
      if (c > bc) { bc = c; best = tn; }
    });
    return best;
  };

  // An offer end date exists when the caller passes one (ctx.endDay) or the variant carries one (offerEnd).
  function hasEnd(v, ctx) { return !!((ctx && typeof ctx.endDay === 'number' && isFinite(ctx.endDay)) || (v && typeof v.offerEnd === 'number' && isFinite(v.offerEnd))); }
  CP.features = function (variant, ctx) {
    var v = variant || {}, f = v.fields || {}, ch = CP.HOOK[v.channel] ? v.channel : 'email';
    var hookField = CP.HOOK[ch], mainField = CP.MAIN[ch];
    var hook = str(f[hookField]), main = str(f[mainField]), all = allText({ channel: ch, fields: f });
    var cta = (ch === 'email' || ch === 'social' || ch === 'web') ? (str(f.cta).trim() ? ctaOf(f.cta, true) : 0) : ctaOf(main, false);
    var visual = ch === 'email' || ch === 'social' || ch === 'web';
    return {
      channel: ch, hookField: hookField, len: hook.length,
      hasNumber: /\d/.test(hook) ? 1 : 0,
      personal: /\{first_name[|}]/.test(all) ? 1 : 0,
      urgencyUnbacked: URGENCY_RE.test(hook + ' ' + main) && !hasEnd(v, ctx) ? 1 : 0,
      urgency: URGENCY_RE.test(hook + ' ' + main) && hasEnd(v, ctx) ? 1 : 0,   // no credit for urgency without an offer end date
      question: hook.indexOf('?') >= 0 ? 1 : 0,
      ctaStrength: cta,
      offerStrength: (CP.OFFER_LIFT[v.offer] || 0) / 0.45,
      image: visual && str(f.imageId) ? 1 : 0,
      grade: CP.grade(ch === 'email' ? str(f.body) : main),
      caps: capsWords(all).length ? 1 : 0,
      toneFit: toneFitOf(all, v.tone)
    };
  };

  /* ---------------- engagement model ---------------- */
  var WO = { num: 0.18, personal: 0.22, urgency: 0.12, len: -0.012, toneFit: 0.15, caps: -0.25 };
  var WC = { cta: 0.30, offer: 0.25, image: 0.15, toneFit: 0.20, grade: -0.05 };
  function terms(ft) {
    return {
      o: { num: ft.hasNumber, personal: ft.personal, urgency: ft.urgency, len: Math.max(0, ft.len - 45), toneFit: ft.toneFit, caps: ft.caps },
      c: { cta: ft.ctaStrength, offer: ft.offerStrength, image: ft.image, toneFit: ft.toneFit, grade: Math.max(0, ft.grade - 8) }
    };
  }
  function logits(tm) {
    var lo = -1.35, lc = -2.9, k;
    for (k in WO) if (Object.prototype.hasOwnProperty.call(WO, k)) lo += WO[k] * tm.o[k];
    for (k in WC) if (Object.prototype.hasOwnProperty.call(WC, k)) lc += WC[k] * tm.c[k];
    return { o: lo, c: lc };
  }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }

  // Bank distribution: up to 2,000 drafts over channel × tone × offer × product, computed once.
  var bankStats = null;
  function statsOf(rows) {
    var n = rows.length || 1, mo = 0, mc = 0, so = 0, sc = 0, fo = {}, fc = {}, k;
    Object.keys(WO).forEach(function (x) { fo[x] = 0; });
    Object.keys(WC).forEach(function (x) { fc[x] = 0; });
    rows.forEach(function (r) {
      mo += r.l.o; mc += r.l.c;
      for (k in fo) if (Object.prototype.hasOwnProperty.call(fo, k)) fo[k] += r.t.o[k];
      for (k in fc) if (Object.prototype.hasOwnProperty.call(fc, k)) fc[k] += r.t.c[k];
    });
    mo /= n; mc /= n;
    rows.forEach(function (r) { so += (r.l.o - mo) * (r.l.o - mo); sc += (r.l.c - mc) * (r.l.c - mc); });
    for (k in fo) if (Object.prototype.hasOwnProperty.call(fo, k)) fo[k] /= n;
    for (k in fc) if (Object.prototype.hasOwnProperty.call(fc, k)) fc[k] /= n;
    return { meanO: mo, sdO: Math.max(0.05, Math.sqrt(so / n)), meanC: mc, sdC: Math.max(0.05, Math.sqrt(sc / n)), fo: fo, fc: fc, n: rows.length };
  }
  function computeBank() {
    var rng = MC.rng.fork(0x4b455354, 'copy', 'bank');
    var prods = [null, 'p-trail-boot', 'p-camp-stove', 'p-trail-shoe', 'p-insulated-jacket'];
    var chans = ['email', 'sms', 'push', 'social'], all = [], byCh = {}, byKey = {};
    chans.forEach(function (ch) {
      byCh[ch] = [];
      CP.TONES.forEach(function (tone) {
        CP.OFFERS.forEach(function (offer) {
          var key = ch + '|' + offer;
          byKey[key] = byKey[key] || [];
          prods.forEach(function (pid) {
            draftRaw({ channel: ch, tone: tone, offer: offer, productId: pid, count: 5 }, rng).forEach(function (d) {
              var tm = terms(CP.features(d)), row = { t: tm, l: logits(tm) };
              byCh[ch].push(row); byKey[key].push(row); all.push(row);
            });
          });
        });
      });
    });
    var s = statsOf(all);
    // Scores compare a variant with bank copy on the same channel carrying the same offer (the offer is a
    // campaign decision, not a copy decision); the global means feed the simulator's latent quality.
    var out = { meanO: s.meanO, sdO: s.sdO, meanC: s.meanC, sdC: s.sdC, n: s.n, byChannel: {}, byKey: {} };
    chans.forEach(function (ch) { out.byChannel[ch] = statsOf(byCh[ch]); });
    out.byChannel.web = out.byChannel.social;
    // Bucket means, but the channel-wide spread: within one offer the bank varies too little to scale by.
    Object.keys(byKey).sort().forEach(function (k) {
      var b = statsOf(byKey[k]), c = out.byChannel[k.split('|')[0]];
      b.sdO = Math.max(b.sdO, c.sdO, 0.25); b.sdC = Math.max(b.sdC, c.sdC, 0.2);
      out.byKey[k] = b;
    });
    return out;
  }
  Object.defineProperty(CP, 'BANK_STATS', {
    enumerable: true, configurable: true,
    get: function () { if (!bankStats) bankStats = computeBank(); return bankStats; }
  });

  var HOOK_LABEL = { email: 'subject', sms: 'message', push: 'title', social: 'headline', web: 'headline' };
  function r1(x) { return Math.round(x * 10) / 10; }
  function termLabel(side, k, x, ft, tone) {
    var hk = HOOK_LABEL[ft.channel] || 'subject', HK = cap1(hk), tl = CP.TONE_LABEL[tone] || 'chosen';
    if (k === 'num') return x ? 'Number in ' + hk : 'No number in ' + hk;
    if (k === 'personal') return x ? 'Personalized with first name' : 'Not personalized';
    if (k === 'urgency') return x ? 'Urgency words' : (ft.urgencyUnbacked ? 'Urgency words, but no offer end date (no credit)' : 'No urgency');
    if (k === 'len') return x > 0 ? HK + ' ' + ft.len + ' chars (over 45)' : HK + ' ' + ft.len + ' chars';
    if (k === 'caps') return x ? 'ALL CAPS words' : 'No ALL CAPS';
    if (k === 'toneFit') return (x >= 1 ? 'Matches the ' : (x > 0 ? 'Partly matches the ' : 'Doesn’t sound ')) + tl + (x > 0 ? ' tone' : '') + (side === 'o' ? ' (opens)' : ' (clicks)');
    if (k === 'cta') return x >= 1 ? 'Clear call to action' : (x > 0 ? 'Soft call to action' : 'No call to action');
    if (k === 'offer') return x > 0 ? 'Offer' : 'No offer';
    if (k === 'image') return x ? 'Has an image' : 'No image';
    if (k === 'grade') return x > 0 ? 'Reading grade ' + ft.grade + ' (over 8)' : 'Reading grade ' + ft.grade;
    return k;
  }

  // score(variant, ctx?) -> { score, predOpen, predClick, logitO, logitC, zO, zC, contributions:[{label, delta, key}] }
  CP.score = function (variant, ctx) {
    var v = variant || {};
    var ft = CP.features(v, ctx), tm = terms(ft), lg = logits(tm);
    var B = CP.BANK_STATS, bch = ft.channel === 'web' ? 'social' : ft.channel;
    var S = (B.byKey && B.byKey[bch + '|' + (CP.OFFERS.indexOf(v.offer) >= 0 ? v.offer : 'none')]) || (B.byChannel && B.byChannel[bch]) || B;
    var zO = (lg.o - S.meanO) / S.sdO, zC = (lg.c - S.meanC) / S.sdC;
    var score = Math.round(Math.max(0, Math.min(100, 50 + 25 * zO + 25 * zC)));
    var contributions = [];
    var offerLabel = CP.OFFER_LABEL[v.offer] || 'Offer';
    Object.keys(WO).forEach(function (k) {
      var d = 25 * WO[k] * (tm.o[k] - (S.fo ? S.fo[k] : 0)) / S.sdO;
      contributions.push({ key: 'o:' + k, label: termLabel('o', k, tm.o[k], ft, v.tone), delta: r1(d) });
    });
    Object.keys(WC).forEach(function (k) {
      var d = 25 * WC[k] * (tm.c[k] - (S.fc ? S.fc[k] : 0)) / S.sdC;
      var lab = k === 'offer' ? (tm.c.offer > 0 ? offerLabel + ' offer' : 'No offer') : termLabel('c', k, tm.c[k], ft, v.tone);
      contributions.push({ key: 'c:' + k, label: lab, delta: r1(d) });
    });
    contributions = contributions.filter(function (c) { return Math.abs(c.delta) >= 0.5; })
      .sort(function (a, b) { return (Math.abs(b.delta) - Math.abs(a.delta)) || (a.key < b.key ? -1 : 1); });
    return { score: score, predOpen: sig(lg.o), predClick: sig(lg.c), logitO: lg.o, logitC: lg.c, zO: zO, zC: zC,
      contributions: contributions, features: ft };
  };

  /* ---------------- brand & compliance checks ---------------- */
  // Approved claims: copy may state these because a source backs them. `match` lists extra phrasings the claim covers.
  var DEFAULT_CLAIMS = [
    { id: 'returns-60', text: 'Free returns within 60 days', source: 'Returns policy, updated October 2026' },
    { id: 'primaloft', text: 'PrimaLoft insulation', source: 'Product spec: Summit Insulated Jacket' },
    { id: 'field-tested', text: 'Field-tested by the Fernway crew', match: ['field-tested', 'tested through rain, mud and cold'], source: 'Product testing notes' }
  ];
  var DEFAULT_BRAND = { banned: ['cheap', 'guaranteed', 'act now', '!!!'], smsOptOut: true, maxSubject: 60, maxGrade: 8, noAllCaps: true, claims: DEFAULT_CLAIMS };
  CP.VOICE = {
    pillars: [
      { id: 'honest', title: 'Plain and honest', text: 'Say what the gear does and what the offer is. If we can’t back a claim, we don’t make it.' },
      { id: 'outdoors', title: 'Outdoors first', text: 'Write like someone who has been out there: specific places, weather and routes, never hype.' },
      { id: 'warm', title: 'Warm, not pushy', text: 'Talk to one person. Thank them, help them pack, and let the offer speak for itself.' }
    ],
    pairs: [
      { dont: 'Best jacket ever made. Selling out fast!', doText: 'Built for the first frost, with PrimaLoft insulation.', why: 'Superlatives and stock pressure need a source.' },
      { dont: 'Hurry, ends tonight!', doText: 'Take 25% off through Friday, Nov 27.', why: 'Deadlines match the campaign dates.' },
      { dont: 'Waterproof to 10,000m', doText: 'Seam-sealed shell for wet days on the trail.', why: 'Performance numbers come from the spec sheet.' }
    ]
  };
  var SAFE_SWAP = { cheap: 'great-value', guaranteed: 'built to last', 'act now': 'shop today', '!!!': '!' };
  CP.SAFE_SWAP = SAFE_SWAP;
  var TEXT_FIELDS = ['subject', 'preheader', 'headline', 'body', 'cta', 'sms', 'pushTitle', 'pushBody', 'socialText', 'socialHeadline', 'alt'];
  var HARD_LIMIT = { sms: true, pushTitle: true, pushBody: true, socialText: true, socialHeadline: true, cta: true };
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function phraseRe(p) { return /^[a-z ]+$/i.test(p) ? new RegExp('\\b' + esc(p) + '\\b', 'ig') : new RegExp(esc(p), 'g'); }
  function fieldsOf(v) {
    var ch = CP.FIELDS[v.channel] ? v.channel : 'email';
    return CP.FIELDS[ch].filter(function (k) { return TEXT_FIELDS.indexOf(k) >= 0; });
  }
  function claimInfo(text) {
    var t = str(text).toLowerCase(), pcts = [], m, re = /(\d{1,2})\s?%\s?off/g;
    while ((m = re.exec(t))) pcts.push(+m[1]);
    return { pcts: pcts, ship: /free shipping|shipping is on us/.test(t), gift: /free gift/.test(t), token: t.indexOf('{offer}') >= 0 };
  }
  var OFFER_PCT = { pct15: 15, pct25: 25 };

  /* ---- claims, scarcity, urgency ---- */
  var SUPERLATIVE_RE = /\b(best|greatest|finest|ultimate|unbeatable|unmatched|perfect|#1|number one|world[- ]class|top[- ]rated|award[- ]winning|lightest|warmest|toughest|strongest|most (?:durable|comfortable|popular|reliable|versatile|breathable|advanced)|better than|like no other|ever made)\b/i;
  var PERFORMANCE_RE = /\b(waterproof(?:ing)?|water[- ]resistant|windproof|weatherproof|all[- ]weather|breathable|clinically proven|scientifically proven|proven|tested to|rated to|indestructible|bombproof|lifetime warranty|warranty|price match|free returns|returns? within \d+ days|\d+[- ]day returns|primaloft|gore-tex|merino|recycled|organic|sustainabl\w*|eco-friendly|carbon neutral)\b|-?\d[\d,]*\s?(?:m\b|ft\b|°|degrees?)/i;
  var SCARCITY_RE = /\b(back in stock|in stock|only \d+ left|\d+ left|few left|selling out|sells? out|sold out|going fast|almost gone|nearly gone|while supplies last|limited (?:stock|quantities|supply|edition)|low stock|last (?:ones|pieces|units))\b/i;
  var DEADLINE_RE = /\b(ends? (?:tonight|today|soon|at midnight|in \d+)|ending (?:tonight|today|soon)|tonight|today only|last call|last chance|hurry|final hours|hours? left|\d+ hours|running out|clock is ticking|once it ends|before (?:it ends|midnight)|before the offer ends|time is almost up|this week only|limited time|midnight|(?:thru|through|until|till) (?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)\w*)\b/i;
  var STRICT_TONIGHT_RE = /\b(ends? (?:tonight|today|at midnight)|ending (?:tonight|today)|tonight|today only|midnight|\d+ hours|hours? left|final hours)\b/i;
  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function claimMask(text, claims) {
    var t = str(text);
    (claims || []).forEach(function (c) {
      [c.text].concat(c.match || []).forEach(function (m) { if (m) t = t.replace(new RegExp(esc(str(m)), 'ig'), ' '); });
    });
    return t;
  }
  function firstHit(re, flds, f, claims, masked) {
    for (var i = 0; i < flds.length; i++) {
      var raw = str(f[flds[i]]), m = re.exec(masked ? claimMask(raw, claims) : raw);
      if (m) return { field: flds[i], phrase: m[0] };
    }
    return null;
  }
  // Drops the sentence that holds `phrase`; returns null when nothing else would be left to say.
  function dropSentence(text, phrase) {
    var parts = str(text).split(/(?<=[.!?])\s+/), keep = parts.filter(function (x) { return x.toLowerCase().indexOf(phrase.toLowerCase()) < 0; });
    return keep.length && keep.length < parts.length ? tidy(keep.join(' ')) : null;
  }
  function dayInfo(ctx) {
    var T = MC.time, out = { label: '', dow: -1 };
    if (!ctx || typeof ctx.endDay !== 'number' || !T) return out;
    try { out.label = T.dayLabel(ctx.endDay); out.dow = T.displayCalendar(ctx.endDay).dow; } catch (e) { /* no label */ }
    return out;
  }
  // The campaign's dates for a stored variant, when the app has a world to look them up in.
  function ctxOf(v, ctx) {
    if (ctx) return ctx;
    var out = {};
    if (typeof v.offerEnd === 'number') out.endDay = v.offerEnd;
    try {
      var w = MC.store && typeof MC.store.getState === 'function' ? MC.store.getState() : null;
      var c = w && v.campaignId && w.campaigns && w.campaigns.byId[v.campaignId];
      if (c) {
        if (c.offer && c.offer !== 'none' && typeof c.end === 'number') { out.endDay = Math.floor((c.end - 1) / 24); out.startDay = Math.floor(c.start / 24); }
        out.today = MC.time.dayOf(w.meta.tick);
      }
    } catch (e) { /* no campaign context */ }
    return out;
  }
  CP.ctxOf = ctxOf;

  /* ---- SMS encoding ---- */
  var GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  var GSM_EXT = '^{}\\[~]|€';
  // smsInfo(text) -> { encoding: 'GSM-7'|'Unicode', units, perSegment, segments, odd: [chars that force Unicode] }
  CP.smsInfo = function (text) {
    var t = str(text), units = 0, odd = [], i, ch;
    for (i = 0; i < t.length; i++) {
      ch = t.charAt(i);
      if (GSM_BASIC.indexOf(ch) >= 0) units += 1;
      else if (GSM_EXT.indexOf(ch) >= 0) units += 2;
      else if (odd.indexOf(ch) < 0) odd.push(ch);
    }
    var uni = odd.length > 0;
    if (uni) units = t.length;
    var single = uni ? 70 : 160, multi = uni ? 67 : 153;
    return { encoding: uni ? 'Unicode' : 'GSM-7', units: units, perSegment: single, multiPer: multi, segments: units <= single ? 1 : Math.ceil(units / multi), odd: odd };
  };
  // Straightens curly quotes, dashes and ellipses so a text can go out as GSM-7.
  CP.straighten = function (text) {
    return str(text).replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—−]/g, '-')
      .replace(/…/g, '...').replace(/[   ]/g, ' ');
  };

  /* ---- dedupe ---- */
  function normText(x) { return str(x).toLowerCase().replace(/\{[^}]*\}/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  // dedupe(drafts, existing) -> { kept, dropped }: drops drafts whose hook or whole message matches an existing variant or an earlier draft.
  CP.dedupe = function (drafts, existing) {
    var seenHook = {}, seenAll = {}, kept = [], dropped = [];
    function keys(v) {
      var ch = CP.HOOK[v.channel] ? v.channel : 'email', f = v.fields || {};
      return { hook: ch + '|' + normText(f[CP.HOOK[ch]]), all: ch + '|' + normText(allText({ channel: ch, fields: f })) };
    }
    (existing || []).forEach(function (v) { var k = keys(v); seenHook[k.hook] = 1; seenAll[k.all] = 1; });
    (drafts || []).forEach(function (d) {
      var k = keys(d);
      if (seenHook[k.hook] || seenAll[k.all]) { dropped.push(d); return; }
      seenHook[k.hook] = 1; seenAll[k.all] = 1; kept.push(d);
    });
    return { kept: kept, dropped: dropped };
  };
  function clipMeasured(text, max, ctx) {
    var over = measure(text, ctx) - max;
    return over > 0 ? clip(text, Math.max(1, text.length - over)) : text;
  }

  // check(variant, brand) -> [{id, label, status:'pass'|'warn'|'fail', detail, fix?:{field, value}}]
  CP.check = function (variant, brand, ctx0) {
    var v = variant || {}, f = v.fields || {}, out = [];
    var cx0 = ctxOf(v, ctx0);
    var b = {}; Object.keys(DEFAULT_BRAND).forEach(function (k) { b[k] = brand && brand[k] !== undefined ? brand[k] : DEFAULT_BRAND[k]; });
    var ch = CP.FIELDS[v.channel] ? v.channel : 'email', flds = fieldsOf({ channel: ch });
    var ctx = contextFor(v.productId, v.offer || 'none');
    function item(id, label, status, detail, fix) { var x = { id: id, label: label, status: status, detail: detail }; if (fix) x.fix = fix; out.push(x); }

    // 1. banned words
    var hit = null;
    (b.banned || []).forEach(function (p) {
      if (hit || !p) return;
      for (var i = 0; i < flds.length; i++) if (phraseRe(p).test(str(f[flds[i]]))) { hit = { p: p, field: flds[i] }; return; }
    });
    if (hit) {
      var swap = SAFE_SWAP[hit.p.toLowerCase()] !== undefined ? SAFE_SWAP[hit.p.toLowerCase()] : '';
      item('banned', 'Banned words', 'fail', '“' + hit.p + '” appears in the ' + (CP.FIELD_LABEL[hit.field] || hit.field).toLowerCase() + '.',
        { field: hit.field, value: cap1(tidy(str(f[hit.field]).replace(phraseRe(hit.p), swap))) });
    } else item('banned', 'Banned words', 'pass', 'None of the ' + (b.banned || []).length + ' banned words or phrases appear.');

    // 2. length limits
    var worst = null;
    flds.forEach(function (k) {
      var lim = limitOf(k, b); if (!lim) return;
      var len = measure(f[k], ctx);
      if (len > lim && (!worst || (HARD_LIMIT[k] && !HARD_LIMIT[worst.k]))) worst = { k: k, len: len, lim: lim };
    });
    if (worst) {
      var hard = !!HARD_LIMIT[worst.k], val = str(f[worst.k]);
      if (worst.k === 'sms' && /reply stop to opt out\.?$/i.test(val)) {
        var core = val.replace(/\s*reply stop to opt out\.?$/i, '');
        val = clipMeasured(core, worst.lim - OPT_OUT.length, ctx) + OPT_OUT;
      } else val = clipMeasured(val, worst.lim, ctx);
      item('length', 'Length limits', hard ? 'fail' : 'warn', (CP.FIELD_LABEL[worst.k] || worst.k) + ' is ' + worst.len + ' characters (limit ' + worst.lim + ')' +
        (hard ? '; it would be cut off.' : '; it may be cut off in some inboxes.'), { field: worst.k, value: val });
    } else item('length', 'Length limits', 'pass', 'Every field fits its limit.');

    // 3. call to action
    if (ch === 'email' || ch === 'social' || ch === 'web') {
      if (str(f.cta).trim()) item('cta', 'Call to action', 'pass', 'Button label: “' + str(f.cta).trim() + '”.');
      else item('cta', 'Call to action', 'fail', 'The button label is empty.', { field: 'cta', value: (BANK.cta[v.tone] || BANK.cta.practical)[0][0] });
    } else {
      var main = str(f[CP.MAIN[ch]]);
      if (ctaOf(main, false) > 0) item('cta', 'Call to action', 'pass', 'The message tells people what to do next.');
      else item('cta', 'Call to action', 'warn', 'Add a clear next step such as “Shop now”.');
    }

    // 4. alt text
    if (flds.indexOf('alt') >= 0 && str(f.imageId)) {
      var img = imageById(f.imageId);
      var altT = str(f.alt).trim(), altWords = altT ? altT.split(/\s+/).length : 0, altFix = { field: 'alt', value: img ? img.alt : 'Hiker in outdoor gear on a ridge trail above the valley' };
      if (!altT) item('alt', 'Image alt text', 'fail', 'The image needs alt text for screen readers.', altFix);
      else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(altT) || altT === str(f.imageId)) item('alt', 'Image alt text', 'fail', 'Alt text looks like a file name. Describe what the image shows.', altFix);
      else if (altWords < 5) item('alt', 'Image alt text', 'fail', 'Alt text is ' + altWords + (altWords === 1 ? ' word' : ' words') + '. Describe the image in at least 5 words.', altFix);
      else item('alt', 'Image alt text', 'pass', 'Alt text describes the image.');
    }

    // 5. reading grade
    var g = CP.grade(ch === 'email' ? str(f.body) : str(f[CP.MAIN[ch]]));
    item('grade', 'Reading level', g <= b.maxGrade ? 'pass' : 'warn', 'Grade ' + g.toFixed(1) + (g <= b.maxGrade ? '' : '; aim for ' + b.maxGrade + ' or lower with shorter sentences') + '.');

    // 6. ALL CAPS
    if (b.noAllCaps) {
      var capField = null, words = [];
      flds.forEach(function (k) { var w = capsWords(f[k]); if (w.length && !capField) { capField = k; words = w; } });
      if (capField) {
        var fixed = str(f[capField]);
        words.forEach(function (w) { fixed = fixed.replace(new RegExp('\\b' + w + '\\b', 'g'), cap1(w.toLowerCase())); });
        item('caps', 'No ALL CAPS', 'fail', '“' + words[0] + '” is in all caps, which reads as shouting and trips spam filters.', { field: capField, value: fixed });
      } else item('caps', 'No ALL CAPS', 'pass', 'No words in all caps.');
    }

    // 7. offer claim matches the offer
    var offer = CP.OFFERS.indexOf(v.offer) >= 0 ? v.offer : 'none', want = OFFER_PCT[offer] || 0, bad = null, mentioned = false;
    flds.forEach(function (k) {
      var ci = claimInfo(f[k]);
      if (ci.token || ci.pcts.length || ci.ship || ci.gift) mentioned = true;
      if (bad) return;
      for (var i = 0; i < ci.pcts.length; i++) if (ci.pcts[i] !== want) { bad = { k: k, what: ci.pcts[i] + '% off' }; return; }
      if (ci.ship && offer !== 'freeship') bad = { k: k, what: 'free shipping' };
      else if (ci.gift && offer !== 'gift') bad = { k: k, what: 'a free gift' };
    });
    if (bad) {
      var rep = OFFER_TEXT[offer].O;
      var fv = str(f[bad.k]).replace(/\d{1,2}\s?%\s?off/ig, rep).replace(/free shipping|shipping is on us/ig, rep).replace(/free gift/ig, offer === 'gift' ? 'free gift' : rep);
      item('offer', 'Offer matches', 'fail', 'The copy promises ' + bad.what + ' but the offer is ' + CP.OFFER_LABEL[offer].toLowerCase() + '.', { field: bad.k, value: tidy(fv) });
    } else if (offer !== 'none' && !mentioned) {
      var mf = CP.MAIN[ch], add = tidy(str(f[mf]).replace(/\s*reply stop to opt out\.?$/i, '') + ' ' + (ch === 'sms' ? OFFER_TEXT[offer].OSS : OFFER_TEXT[offer].OS));
      if (ch === 'sms') add += OPT_OUT;
      item('offer', 'Offer matches', 'warn', 'The ' + CP.OFFER_LABEL[offer].toLowerCase() + ' offer isn’t mentioned.', { field: mf, value: add });
    } else item('offer', 'Offer matches', 'pass', offer === 'none' ? 'No discount is promised.' : 'The copy matches the ' + CP.OFFER_LABEL[offer].toLowerCase() + ' offer.');

    // 7b. claims, stock and deadlines
    var claims = b.claims || [];
    var cl = firstHit(SUPERLATIVE_RE, flds, f, claims, true) || firstHit(PERFORMANCE_RE, flds, f, claims, true);
    if (cl) {
      var isSup = SUPERLATIVE_RE.test(cl.phrase);
      var cfx = dropSentence(f[cl.field], cl.phrase);
      item('claims', 'Claims backed', 'fail', '“' + cl.phrase + '” in the ' + (CP.FIELD_LABEL[cl.field] || cl.field).toLowerCase() + ' isn’t in the approved claims. ' +
        (isSup ? 'Superlatives need a source.' : 'Performance and product claims need a source.'), cfx ? { field: cl.field, value: cfx } : null);
    } else item('claims', 'Claims backed', 'pass', 'No superlatives or performance claims outside the approved list.');
    var sc = firstHit(SCARCITY_RE, flds, f, claims, true);
    if (sc) {
      var sfx = dropSentence(f[sc.field], sc.phrase);
      item('scarcity', 'Stock claims', 'fail', '“' + sc.phrase + '” says something about inventory we can’t confirm here.', sfx ? { field: sc.field, value: sfx } : null);
    } else item('scarcity', 'Stock claims', 'pass', 'No scarcity or stock claims.');
    var dl = firstHit(DEADLINE_RE, flds, f, claims, false), di = dayInfo(cx0);
    var today = typeof cx0.today === 'number' ? cx0.today : null, left = null;
    if (typeof cx0.endDay === 'number' && today !== null) left = cx0.endDay - Math.max(today, typeof cx0.startDay === 'number' ? cx0.startDay : today);
    if (!dl) item('urgency', 'Deadlines match', 'pass', 'No deadline or urgency phrases.');
    else if (typeof cx0.endDay !== 'number') {
      item('urgency', 'Deadlines match', 'warn', '“' + dl.phrase + '” implies a deadline, but no offer end date is set. Set one, or soften the line.');
    } else {
      var strict = firstHit(STRICT_TONIGHT_RE, flds, f, claims, false), badDay = null, wd = /\b(thru|through|until|till|by)\s+(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)[a-z]*/i;
      flds.forEach(function (k) {
        var m = wd.exec(str(f[k])); if (m && !badDay) { var dw = -1; WEEKDAYS.forEach(function (n, ix) { if (n.indexOf(m[2].toLowerCase()) === 0) dw = ix; }); if (dw >= 0 && di.dow >= 0 && dw !== di.dow) badDay = { k: k, m: m }; }
      });
      if (strict && left !== null && left >= 2) {
        var sf = str(f[strict.field]).replace(/\b(ends?|ending)\s+(tonight|at midnight|today)\b/i, '$1 ' + di.label).replace(/\btoday only\b/i, 'through ' + di.label)
          .replace(/\b\d+\s+hours?\s+left\b/i, 'ends ' + di.label);
        item('urgency', 'Deadlines match', 'fail', '“' + strict.phrase + '” says it’s ending now, but the offer runs until ' + di.label + '.', sf !== str(f[strict.field]) ? { field: strict.field, value: tidy(sf) } : null);
      } else if (badDay) {
        item('urgency', 'Deadlines match', 'fail', '“' + badDay.m[0] + '” doesn’t match the offer end date, ' + di.label + '.',
          { field: badDay.k, value: tidy(str(f[badDay.k]).replace(wd, '$1 ' + di.label)) });
      } else item('urgency', 'Deadlines match', 'pass', 'Deadline wording fits the offer end date, ' + di.label + '.');
    }

    // 8. SMS encoding and segments, then opt-out
    if (ch === 'sms') {
      var si = CP.smsInfo(expand(f.sms, ctx));
      if (si.encoding === 'Unicode') {
        var shown = si.odd.slice(0, 3).map(function (c) { return '“' + c + '”'; }).join(' ');
        var sfix = CP.straighten(f.sms);
        item('sms-encoding', 'Text encoding', 'warn', shown + ' switches this text to Unicode: ' + si.segments + (si.segments === 1 ? ' segment' : ' segments') +
          ' at ' + si.perSegment + ' characters each instead of 160.', CP.smsInfo(expand(sfix, ctx)).encoding === 'GSM-7' ? { field: 'sms', value: sfix } : null);
      } else item('sms-encoding', 'Text encoding', 'pass', 'Standard characters: ' + si.segments + (si.segments === 1 ? ' segment' : ' segments') + ' (' + si.units + ' of ' + si.perSegment + ').');
    }
    if (ch === 'sms' && b.smsOptOut) {
      var s = str(f.sms);
      if (/reply stop/i.test(s)) item('optout', 'SMS opt-out', 'pass', 'Includes “Reply STOP to opt out”.');
      else item('optout', 'SMS opt-out', 'fail', 'Texts must say how to opt out.', { field: 'sms', value: clipMeasured(tidy(s), CP.LIMITS.sms - OPT_OUT.length, ctx) + OPT_OUT });
    }

    // 9. merge fields
    var badTok = null;
    flds.forEach(function (k) {
      if (badTok) return;
      (str(f[k]).match(/\{[^}]*\}/g) || []).forEach(function (tk) {
        var pm = /^\{([a-z_]+)(?:\|[^{}]*)?\}$/.exec(tk);
        if (!badTok && (!pm || CP.TOKEN_NAMES.indexOf(pm[1]) < 0)) badTok = { k: k, tk: tk };
      });
    });
    if (badTok) item('tokens', 'Merge fields', 'fail', badTok.tk + ' isn’t a merge field we can fill. Use ' + CP.TOKENS.join(', ') + ', or add a fallback like {first_name|there}.',
      { field: badTok.k, value: tidy(str(f[badTok.k]).split(badTok.tk).join('')) });
    else {
      var noFb = null;
      flds.forEach(function (k) { if (!noFb && /\{first_name\}/.test(str(f[k]))) noFb = k; });
      if (noFb) {
        var before = str(f[noFb]).split('{first_name}')[0];
        item('tokens', 'Merge fields', 'warn', '{first_name} has no fallback, so people without a name would read “' + (nameFallback(before) || 'there') + '”. Add one, like {first_name|there}.',
          { field: noFb, value: str(f[noFb]).replace(/\{first_name\}/, '{first_name|' + nameFallback(before) + '}') });
      } else item('tokens', 'Merge fields', 'pass', 'All merge fields can be filled.');
    }
    return out;
  };
  CP.DEFAULT_BRAND = DEFAULT_BRAND;

  // Applies one check fix to a variant-like object; returns a new object (never mutates).
  CP.applyFix = function (variant, fix) {
    if (!variant || !fix || !fix.field) return variant;
    var fields = Object.assign({}, variant.fields || {});
    fields[fix.field] = fix.value;
    return Object.assign({}, variant, { fields: fields });
  };
  // Applies fixes repeatedly (max 8 passes) until no failing check has a fix.
  CP.fixAll = function (variant, brand) {
    var v = variant;
    for (var i = 0; i < 8; i++) {
      var f = CP.check(v, brand).filter(function (x) { return x.status === 'fail' && x.fix; })[0];
      if (!f) break;
      v = CP.applyFix(v, f.fix);
    }
    return v;
  };

  /* ---------------- rendering ---------------- */
  CP.LONG_NAME = 'Maximilian-Alexander';
  // render(variant, world, profileIdx, opts) -> fields with {first_name} {product} {offer} {link} filled.
  // A token's own fallback ({first_name|there}) is used when there is no value; opts.name overrides the profile's
  // first name ('' previews someone with no name on file).
  CP.render = function (variant, world, profileIdx, opts) {
    var v = variant || {}, f = v.fields || {}, out = {};
    var first = '';
    if (opts && typeof opts.name === 'string') first = opts.name;
    else if (world && world.profiles && profileIdx >= 0 && profileIdx < world.profiles.n) first = str(world.profiles.name[profileIdx]).split(' ')[0];
    var p = prodOf(v.productId);
    if (!p && world && world.campaigns && v.campaignId) { var c = world.campaigns.byId[v.campaignId]; if (c) p = prodOf(c.productFocus); }
    var link = str(f.link) || contextFor(p ? p.id : null, v.offer || 'none').link;
    var vals = { first_name: first, product: p ? p.name : '', offer: OFFER_TEXT[v.offer] ? OFFER_TEXT[v.offer].O : '', link: link };
    var dflt = { product: 'our new-season gear' };
    Object.keys(f).forEach(function (k) {
      var s = str(f[k]), startsWithToken = /^\s*\{/.test(s);
      s = s.replace(TOKEN_RE, function (m, name, fb, off) {
        if (!Object.prototype.hasOwnProperty.call(vals, name)) return m;
        if (vals[name]) return vals[name];
        if (fb !== undefined) return fb;
        if (name === 'first_name') return nameFallback(s.slice(0, off)) || 'there';
        return dflt[name] || '';
      });
      if (k === 'imageId' || k === 'link') { out[k] = str(f[k]); return; }
      s = tidy(s).replace(/,\s*([.!?])/g, '$1').replace(/^[,;:\s]+/, '');
      out[k] = startsWithToken ? cap1(s) : s;
    });
    out.firstName = first || 'there';
    out.productName = p ? p.name : null;
    return out;
  };
})();
