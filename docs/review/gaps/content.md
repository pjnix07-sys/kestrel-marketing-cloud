# Gap review: Content & Brand lead

Verified live (https://pjnix07-sys.github.io/kestrel-marketing-cloud/#content, Library / Compose / Intelligence, Detailed on) and in code (js/views/content.js, js/core/content.js, js/core/copy.js, js/views/console.js). Screenshots: scratchpad/gap/content/{lib,compose,intel}.png.

## 1. Day-one jobs
1. Find and reuse approved copy: **yes**. Library has filters, "Used in N places", and blocks vs messages. Solid.
2. Write a new message/campaign copy from scratch: **partly**. There is no "New message" or "New block" button in Content (the view dispatches only block/create for forks, never message/create). The empty state says "write one in Compose", but Compose only picks an existing message. New copy comes only via a Goal.
3. Preview every channel and test-send: **partly**. Five live channel renders with char counts are good (compose.png). No test send, no device/dark-mode/client preview, no per-persona preview picker (render supports `profile`, the UI never exposes it; preview shows "Hi there" for {first_name}).
4. Enforce brand voice: **partly**. Checks run (banned words, claims whitelist, reading grade, SMS opt-out) and show "Passes every check", but the voice pillars and do/don't pairs (`CP.VOICE` in copy.js) are shown nowhere in the UI. Banned list lives under Agents > guardrails, not in Content.
5. Review/approve with comments and roles: **no**. Only a status chip plus "Move back to draft". Every seeded block is `approved`, so the review queue is empty and untestable. No comments, assignee, reviewer, due date, or Legal/Brand sign-off step.
6. Plan content over time: **no**. Content has no calendar or editorial plan (Campaigns has a calendar, but it is campaign-level, not content-level).
7. Manage images/assets: **no**. Images are 4 fixed "scenes" shown by id ("scene-snow"). No upload, alt-text editing, crop, rights/expiry, folders.
8. Localize: **no**. Code supports `block.i18n`, but 0 of 45 blocks have it, so the Language picker never appears. Dead feature.

## 2. Missing sections
- **Brand & claims book** (blocker for governance). What: a page showing voice pillars, do/don't pairs, banned/preferred terms, approved claims with source and expiry, mandatory disclaimers per product/offer. Incumbents: Frontify/Acrolinx/Contentful validations. Agent-first: the Brand agent drafts the book by reading Fernway's site and best-performing copy, then asks "Is this how you sound?"; every proposal is scored against it and the reason is shown inline. The data exists (`CP.VOICE`, `DEFAULT_CLAIMS` with sources) but is hidden.
- **Content plan / calendar** (major). What: a timeline of what ships, when, per channel, with drafting and review status and gaps ("No SMS content for Dec 1 gifting push"). Agent-first: Planner proposes the next 4 weeks of content from goals plus seasons; you approve or move.
- **Asset library / DAM** (major). Upload, tag, rights, alt text, focal point; agents auto-tag, flag missing alt text and expiring licences, and pick images by what performs (Intelligence already has an "Image" dimension).
- **Templates / layouts** (major). Messages are only slot stacks rendered by a fixed template. No email layout, header/footer, landing-page templates, or brand-locked modules. Agent-first: the Designer agent proposes a template from your site; you lock the brand pieces.
- **Localization** (minor now, major for any non-US brand). Translation memory, per-locale review, glossary; agent translates and asks a native reviewer only for flagged items.

## 3. Broken or missing inside existing sections
- **Compose editing**: raw textareas with `{first_name}` tokens in the body and no token picker, no fallback editor, and no dynamic-content rules ("show jacket block to cold-weather segment"). Personalization lives only as merge tags. Major.
- **Review state**: `none waiting for review` while Fatigue Guard shows two "Retire everywhere it runs" proposals inside Compose. Two approval systems (message review chip vs. proposals) and unclear which one counts. Approvals (inbox rail icon, badge 7) is the right home. Confusing, major.
- **Version history**: just "v1 You created the message"; no diff view, no restore, though the CONTENT.md spec promises both. Major.
- **Accessibility**: alt text is only a char count (56/125). It is not editable and there is no contrast, reading-level (grade is a guardrail setting), heading, link-text or colour-only check surfaced. Minor to major.
- **Legal/claims**: a check exists (PERFORMANCE_RE flags "waterproof", "free returns" unless in the approved-claims list), but the claim block "PrimaLoft insulation" shows no source, owner, or expiry; Library cannot filter by "Claim". Major.
- **Intelligence**: matrix is good, but most cells read "not enough data yet" for SMS and Push, and block rows show opaque text like "scene-snow". No "why" or "what to write next" action button beyond reading. Minor.
- **Image slot** carries angle tag "Warmth and comfort" on a "Trail season" message, with no warning about tag mismatch. Minor.
- **Sign-off** "From the Fernway crew." is flagged used in 6 messages: the fatigue idea is smart, but shows reuse fatigue is applied to a sign-off, which is noise for a brand person (signature elements should be exempt). Minor.

## 4. Confusing or fake-feeling
- "Passes every check" in green on every channel: no list of what was checked, so I cannot trust it (compose.png). Expand to show the rules and sources.
- All 45 blocks and 18 messages are "Approved" with author "user", but the history says "You created the message 33d ago". No human ever reviewed anything, so it feels staged.
- Message names like "Winter Layering Launch: trail season (A)" encode test variants, not editorial names.
- "Web ads" renders as a hero card, not a landing page; there is no landing page or email layout editing despite the nav promising channels.

## 5. Unmistakably agentic and memorable
1. **"Brand Editor" agent that edits in the open**: you drop a draft or goal; it rewrites against the voice book and shows redlines with the reason ("'guaranteed' needs a source; swapped to 'built to last'"). You only decide on the claims it cannot support.
2. **Content plan that writes itself**: a four-week strip where agents have already drafted every gap, each cell showing status (drafted, checked, waiting on you, scheduled). One tap approves a week.
3. **Claim watchdog**: when the returns policy changes, agents find every live message using "Free returns within 60 days" and propose replacements in one decision card.

## 6. Top 5
1. No content authoring entry: cannot create a message/block or upload anything in Content; Compose only edits seeded items.
2. Brand voice book and approved-claims registry are hidden in code (`CP.VOICE`, `DEFAULT_CLAIMS`), not shown or editable.
3. Review/approval workflow is a status chip: no comments, reviewer/legal roles, diffs or restore; review queue empty by seed.
4. No content calendar/editorial plan or asset library (alt text, rights, upload).
5. Personalization and localization are shallow: bare `{first_name}` tokens with no picker, fallback or dynamic rules, and `i18n` has no seeded data so the language picker never shows; no test send or persona preview.
