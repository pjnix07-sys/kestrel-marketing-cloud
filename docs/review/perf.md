# Perf review

Local gzip server, Chromium 1243, Lighthouse 13.6, Playwright (CPU 1x and 4x).

**Verdict.** Network is cheap (about 450 KB gzip, 56 same-origin requests). The cost is main-thread time: synchronous world generation plus catch-up to today (tick 469 on 26 Nov) blocks the page about 1.3 s on desktop and about 5 s on a throttled phone. First paint is fine (80 to 180 ms), but the app is not usable for 2 s (desktop) to 5 s (4x CPU). Steady ticking is light and the heap is flat, so there is no leak.

## Numbers

| | Score | FCP | LCP | TBT | TTI |
|---|---|---|---|---|---|
| home desktop | 68 | 0.5 s | 1.6 s | 670 ms | 2.3 s |
| home mobile | 42 | 1.8 s | 7.6 s | 5,240 ms | 10.5 s |
| campaigns desktop | 70 | 0.4 s | 1.0 s | 1,010 ms | 2.6 s |
| campaigns mobile | 51 | 1.8 s | 4.7 s | 5,600 ms | 10.9 s |

CLS 0.04 to 0.06.

Playwright, home:
- Interactive (`#page-title` present): 1.2 to 2.1 s; 4.8 s at 4x.
- First 10 s: 11 to 13 long tasks, 0.9 to 1.4 s total, max 204 ms. At 4x: 4.3 s total, max 540 ms. Lighthouse mobile saw 18 long tasks, worst 1,294 ms, all from the `js/app.js` boot chain.
- Steady 1x (one tick per 1.2 s): 0 long tasks in 20 s. Per tick: about 30 DOM mutations, 12 to 20 ms (about 40 ms at 4x; engine tick alone about 2.6 ms). Campaigns: 5 to 10 mutations.
- Heap: 17 MB after boot, 9.3 MB after 2 min plus GC. Flat.

## Bytes (gzip)

- vendor: 144 KB raw, 47 KB gz (react-dom 43 KB gz).
- js: 1,438 KB raw, 391 KB gz, 49 files. Largest: `views/campaigns.js` 134 KB (35 gz), `core/catalog.js` 90 KB (20 gz), `views/analytics.js` 88 KB (23 gz), `views/content.js` 86 KB (23 gz). The 7 views are 507 KB raw, 133 KB gz.
- css: 176 KB raw, 27 KB gz, 8 files.
- font: one woff2, 46.7 KB; gzip does not help. Preloaded, `font-display: swap`.
- Lighthouse unused JS: 76 KB, nearly all non-home views.

## Findings

1. **High: boot and catch-up are long main-thread tasks.** `js/core/engine.js:190-201` replays 469 ticks (about 2.6 ms each) in 48-tick chunks, each about 125 ms (about 500 ms on a phone). World generation (`engine.js:151-178`) is also on the main thread. Fix: shrink the chunk to about 12 ticks (one-line change), then consider a Web Worker (needs a core-only bundle via `importScripts`, because the code shares `MC` globals) or a precomputed snapshot so only a delta replays. Late-season dates cost more: 31 Dec is about 2.8x tick 469.
2. **High: no code splitting.** All 49 scripts run before first render (`index.html:23-69`), including 507 KB of view code for views not on screen. Lighthouse attributes 6.2 s of mobile bootup to `app.js`. Fix: load a view's JS and CSS on first navigation; keep home eager. Expect about 100 KB gz less on the wire and a large mobile TBT drop.
3. **Medium: mobile LCP of 7.6 s is the boot card waiting on the sim, not bytes.** Paint the real shell and skeletons first, then fill in (around `js/app.js:729-761`). LCP should approach FCP (about 1.8 s).
4. **Low: per-tick render has no memoisation.** `js/views/home.js` has no `React.memo`. 12 to 20 ms is fine at 1x, but 16x speed (75 ms pace) is tight at 40 ms on a throttled CPU. Memoise home cards and return stable references from `useSel` selectors (`js/app.js:50`).
5. **Low: font.** 46.7 KB variable woff2. Subsetting to used weights saves an estimated 20 KB (not measured).
6. **Low: caching.** Pages sets a 10-minute max-age and the 49 script URLs are unversioned. A `?v=` or hash suffix lets returning visitors skip revalidation.

## Top 5 savings

1. Lazy-load the 6 non-home views and CSS: about 100 KB gz, about 400 KB raw parse, biggest TBT win.
2. Chunk catch-up at 12 ticks, or move generation and catch-up to a Worker: removes the 125 ms (500 ms phone) tasks; TBT toward 1 s on mobile.
3. Snapshot or skip replay: desktop boot from about 1.3 s to under 0.5 s.
4. Paint the real shell before the sim finishes: mobile LCP from 7.6 s toward 2 s.
5. Memoise home and selectors, subset the font: less per-tick work at 4x and 16x, about 20 KB.

## Quick wins

- `engine.js:195`: `+ 48` to `+ 12`.
- Merge the 8 CSS files, or load view CSS with its view.
- Version script URLs.

## Assumptions

Local server with no real latency, so network numbers are optimistic. Lighthouse mobile used its default 4x CPU and simulated slow 4G. The 2-minute heap run was on home at 1x speed.
