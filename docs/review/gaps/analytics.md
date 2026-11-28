# Analytics & Insights lead review (role: analytics)
Screenshots: /tmp/claude-0/-home-user-kestrel-marketing-cloud/cbde7910-1a47-5716-97f6-c1d6bcbc808a/scratchpad/gap/analytics/ (r1.png Results simple, r2/r3 detailed, s-lift/s-impact/s-attribution/s-whatif/s-anomalies.png).
Checked live (Results, Home, goal m-lhw) and js/views/analytics.js. Grep of js/ finds no csv/export/download, cohort, retention curve, experiment or saved-view code.

## 1. Day-one jobs (can I do it?)
1. Trust one headline number: PARTLY. $59.8k is consistent Home/Results/Goals (41.3+18.5), but it is last-touch revenue, not incremental (see 4).
2. Compare attribution models and windows: PARTLY. Only last-touch vs linear, fixed 7-day window, no window or click/view toggle (#analytics-sections-attribution).
3. Prove incrementality: PARTLY. Universal 5% holdout is good, but holdouts are 36-75 people; intervals are -49% to +590%. Four of five campaigns "too close to call".
4. Design and read an experiment: NO. Only auto variant split (A 90/B 5/C 5) with "chance best". No hypothesis, MDE, sample size, duration, stop rule, guardrail metric, or a way to ask for a test.
5. Cohort/retention/LTV: NO/barely. Only "predicted LTV" per audience (Return by audience). No cohort tables, retention curves, repeat-purchase or time-to-second-order.
6. Funnel and web/app behaviour: PARTLY. Only a message funnel (sent > delivered > clicked > converted). No site/app events, sessions, product funnel, paths or source/medium; social and web ads have no touch-to-site view.
7. Build/save/schedule a report or export: NO. Filters (campaign/channel/metric/range) exist; no save view, custom report, CSV, scheduled email/Slack digest, share link, or API/warehouse export.
8. Explain why a number moved: PARTLY. Anomalies list says "9.0x the usual swing" but never attributes cause (Nov 24 spike is the Black Friday send, yet it is flagged as an anomaly with only Dismiss).

## 2. Missing sections
- **Experiments** (blocker for my role). Incumbents: Optimizely/Braze Canvas experiment, GA4/Amplitude experiment readouts. Agent-first: I say "does urgency beat warmth for lapsed hikers?"; agent writes the test card (hypothesis, split, sample needed, days to power, guardrails such as unsubscribe), runs it, and ends with one decision card: ship / keep running / stop, with the interval. Needs a "Tests" list under Results, not another nav item.
- **Reports (saved, scheduled, exported)** (major/blocker for CMO reporting). Looker/Braze Report Builder. Agent-first: "Send the CMO a Monday summary" creates a standing agent task; preview, recipients, one-click CSV/PDF, link. Today the only recurring things are agent insights.
- **Cohorts and retention/LTV** (major). Amplitude/Klaviyo. Agent-first: Insight Analyst answers "do win-back customers stay?" with a cohort grid by first-order month and a plain verdict; LTV actual vs predicted by acquisition goal.
- **Measurement settings** (major): attribution model, lookback window, conversion definition, holdout %, timezone, currency, test-significance level. Today hard-coded (7-day, 5%, 95%). Put in Settings with the agent proposing changes.
- **Data health / sources** (major): who feeds numbers (pixel, ESP, ad platforms), freshness, delivery lag, bot-open filtering, duplicate orders. Nothing tells me whether the data is complete.

## 3. Gaps inside existing sections
- Attribution (analytics.js ~1037): no window selector, no first-touch/position-based/data-driven, no click vs view split. Social ads get 55% last-touch vs 37% linear, so channel credit swings by 18 pp and there is no way to say which to believe. Major.
- Lift vs holdout (#analytics-sections-lift): holdout of 36 gives uninformative ranges; no "need N holdout to detect 10%" prompt or ability to raise the holdout for a goal; no per-channel or per-audience incrementality; no geo/ghost-ads. Agent should propose a bigger holdout when interval is too wide. Major.
- Channels ROAS: "SMS returns 173.6x on $20 of spend", Push 111.8x on $5 are artefacts of tiny/uncosted spend and are last-touch, but they top a bar chart as "best". Ranking is misleading. Blocker for trust: show incremental return, cost basis, and suppress ranks below a spend/sample floor.
- Forecast (Revenue over time + insights): good fan chart with 80/95% ranges, but insight copy reads "0% below the $222k goal (46% chance)" and "a chance below 5% of hitting it" next to "heading for 78%" (vague, reads as bug). No scenario/what changed vs last forecast, no backtest or forecast accuracy.
- Anomalies: only Dismiss. No cause (promo, holiday, tracking), no "expected, add as event" so Nov 24 Black Friday spike keeps being flagged; no alert rules/thresholds or notify me.
- Agent impact: "Agents added $0 realized (expected +$1,900)"; realized rows show "$0, $0 to $0" (intervals of zero width, fake-looking) and most rows are still "Measuring..." Causality is explained by promise vs control but not shown with real numbers. Major.
- Variants: A at 90% traffic, B/C 5%, C has 0.00% conv on 156 sends yet "14% chance best". Allocation is neither a fixed test nor a bandit; Chance-best on 1 to 12 conversions is not a readout. Major.
- Filters: ranges fixed 14/30/60/all; no custom date, no compare to previous period/year, no segment filter, no breakdown by audience/device/geo. Minor to major.
- Funnel: message-only; no drop-off by step per campaign, no time-to-convert. Minor.
- Content angles chart: right form (dot+interval, gray=unclear, labels truncated "Urgency with a deadli..."), but email opens only (Apple MPP inflated opens; should be clicks/orders). Minor/major.
- Dataviz: SMS/Push/Email bar chart uses 0 to 180x axis so Social/Web are slivers; ROAS belongs on a log axis or table. Revenue chart: good, but "Today / Thanksgiving / Black Friday" labels overlap at the top and the "$10.3k" label collides with the line (r1.png ~x950,y1065). Dismiss/"More (6)" hides 6 insights.

## 4. Confusing / felt untrustworthy
- Black Friday goal: Results says "Missed $41.3k of $48k"; Home says "Done"; Home agent feed says "Finished at $32.2k of $48k (67%)" while the same page says $41.3k. Three numbers for one goal. (Home recent agent work, r1.png goals card.)
- Win-back: goal page "78 of 400 by Dec 14" vs Results insight "heading for 78% ... About 58 of 75 by Dec 2" (different target, same number 78, no explanation). Goal page also says "743 is enough" (Segment Scout reasoning) vs audience of 671.
- Headline "$59.8k brought in by your goals" = last-touch, while the lift table shows Winter Layering at -42% (clearly harmed) and Black Friday -11%. Result: a hero number that the product's own holdout says is not caused by the campaigns. The page never reconciles "credited $117k of $191k" with "-42% vs holdout". This is the biggest credibility gap; an agent should say it.
- Revenue chart says complete days $189k; attribution text says $191k business revenue over the same 30 days. Small but unexplained.
- Insight cards on Winter Layering say "heading for 90% ... by Fri Nov 27" on Sat Nov 28 (past date).

## 5. Unmistakably agentic and memorable (my role)
1. "Why did this move?" button on any number/spike: Insight Analyst returns a short causal decomposition (promo sent, audience mix, channel, holiday, tracking) with how sure it is, and says when it cannot tell. Anomalies become explained events, not alerts.
2. Agent-run experiments: I state a question; agents design, power, run and call it, and ask me one real decision with the interval and guardrails. Holdout auto-grows when the answer is "too close to call".
3. Standing "Monday readout" agent: writes the CMO summary from the same selectors, flags where attributed revenue and incremental lift disagree, lets me edit and send/export; reproducible numbers with the definition one click away.

## 6. Top 5
1. Reconcile attributed vs incremental: headline and ROAS must show incremental/holdout-validated value, with the disagreement stated (Winter Layering -42% vs $34.9k credited); fix BF Done/Missed/$32.2k conflicts.
2. Add Experiments (agent designs/powers/reads out, one decision card) and raise holdout size automatically when intervals are uninformative.
3. Reports: saved views, scheduled digests, CSV/PDF/link export, custom date and period compare.
4. Attribution settings: model and lookback selector, click/view split, global measurement settings in Settings; suppress ROAS ranks for tiny spend (SMS 173.6x on $20).
5. Cohorts/retention/LTV plus explained anomalies ("why did this move") and data-health/freshness panel.
