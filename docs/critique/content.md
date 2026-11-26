# Content & Creative critique: Content Studio and Copy Drafter

## 1. Verdict

The Studio's bones are right: a three-pane compose, preview and check layout, live-variant protection ("Save as new variant"), a Fix button that edits only the draft, and the rule that agents add variants rather than overwrite them (P3) are what a content team would ask for. The trouble is that the checks are thin and the scoring rewards things it can't verify. The seeded live copy already contradicts itself: "Last call… 25% off thru Sunday. Shop before it ends tonight" on an *Early Access* campaign gets 79/100 and "All clear". Until claims, approvals and version history are first-class, no editor would let Copy Drafter or Haiku write anything that ships.

## 2. Top 8 issues, ranked by impact

1. **Claims checking is cosmetic.** `MC.copy.check` only matches offer percentages, free shipping and four banned words. I ran "Clinically proven warmth", "Waterproof to 10,000m", "Best jacket ever made", "Back in stock" and "ends tonight" (with no offer set) through it, and all passed. The seeded bank also writes "Free returns within 60 days", "Back in stock" and "48 hours left" with nothing backing them. **Change:** add a `claims` registry to the brand book: approved claims with their source, plus deadline phrases tied to the offer's end date. Add a check that flags superlatives, performance claims, unbacked scarcity, and urgency phrases that contradict each other or the campaign dates. Haiku must cite a registry claim ID for every factual sentence, and the validator rejects anything it can't cite.

2. **No review workflow.** Every library row reads "Live" or "Draft", and variants on *Scheduled* campaigns also show "Live". **Change:** add the states Draft → In review → Changes requested → Approved → Scheduled/Live. Agent and Haiku variants always enter as *In review*, and autopilot can't skip legal or brand review on new copy. Add a "Needs my review" filter.

3. **No version history, comments or diff.** The conflict chip protects the draft, but nobody can see who changed a subject line, when, or why. **Change:** keep a per-variant version list (author, time, note) with a word-level diff against the previous version and against the live control. Add inline comments anchored to a field ("Legal: soften 'waterproof'"), resolved before approval.

4. **The score rewards tactics, not truth or voice.** Urgency words add +10 and first name adds +11–14, so the model pushes every variant toward false scarcity. SMS shows "18.3% opens" (SMS has no opens). **Change:** zero the urgency credit unless an offer end date exists. Show clicks and conversions only for SMS and push. Replace the ring with a banded label ("Likely above control") plus the reasons, and show the live variant's actual results next to it.

5. **Generation output isn't editable or comparable.** Cards show only subject and preheader. Here, card 1 duplicated the live Email A subject, card 4 duplicated live Email B, and 3 of 4 reused the same preheader, which means the near-duplicate filter isn't applied in the Studio. **Change:** dedupe against live variants, and expand each card to the full message with edit-in-place before "Add to campaign". The tone control is four exclusive buttons. Make it two sliders (Practical↔Adventurous, Warm↔Urgent), and add a free-text brief line that Haiku reads.

6. **Previews stop at one light-mode desktop card.** **Change:** add toggles for desktop, mobile (375px), dark mode (inverted background, logo-on-dark check) and an images-off view of the email. Truncate mobile subjects at about 35 characters inside a fake inbox. For SMS, show segment count and encoding: the bank uses curly apostrophes ("Don’t"), which forces UCS-2 and 70-character segments, so a "119/160" counter is a cost bug.

7. **Personalisation fallbacks are unsafe.** With no name, `{first_name}` renders "there", which gives "Last call, there." and "there, 48 hours left". **Change:** let each token carry its own fallback (`{first_name|Hey}`) or a whole fallback line per field. Add "Preview as: no name / long name / no product affinity".

8. **The brand book is hardcoded and invisible.** Voice lives in `DEFAULT_BRAND` (four banned words) and in phrase banks nobody can see or edit. **Change:** add a Brand voice page under Content with voice pillars, do/don't example pairs, a banned list with approved swaps, a claims registry (#1), terminology and per-locale rules. It feeds both the checker and Haiku's cached context.

## 3. Quick wins (≤ 5)

- Name variants by angle, not letter: "Email B · Big day / adventurous", with the letter kept as an ID.
- Agent-drafted variants get a one-line rationale ("Leader's CTR fell 18% from peak") and the brief they came from, shown above the fields.
- Make the "All clear" header honest: "8 checks passed · claims not reviewed" until a person approves.
- Alt text check: require at least 5 words and not the filename; "x" passes today.
- Fix the casing in "Fresh sms copy" and show "Live performance" as "Not sent yet" when sends = 0.

## 4. What NOT to add

- No free-form "write me anything" chat box in the composer.
- No auto-applying Haiku copy on autopilot, at any autonomy level. New words always need a human approval. The optimizer can move traffic among *approved* variants only.
- No sentiment or "emotion score" dials, AI-detector scores or sparkle badges (§12.7 is right).
- No full DAM. Scenes plus tags, rights expiry and alt text are enough.
- No translation engine yet. Add a locale field and a "needs localisation" state first. Machine-translated claims are a legal risk, not a feature.
