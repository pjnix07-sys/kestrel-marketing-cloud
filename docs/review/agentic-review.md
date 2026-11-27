# Agentic review (rules 4 and 6), live build

Screenshots: /tmp/claude-0/agentic-review/ (01-43). Checked 1440 and 390, light and dark. No console errors.

## Verdict
This is a real change of kind. The goal headline, the agent lanes with dependency wiring and the one dark ask card read as a team working, and steering and New goal genuinely re-plan live. It is still a polished mission page bolted onto an incumbent shell. Team, Content, Campaigns and Audiences are untouched admin screens, and the agents mostly report what they did rather than show what they are deciding. A cold viewer gets "a team is on my goal"; they do not yet get "I would hand it my job".

## Ten-second test (#missions, cold)
Understood: a goal ("win back 400 lapsed hikers, max 15% off"), 51 of 400 so far, a named agent needs a yes/no, and six named agents have done some steps with others queued. The ask's "24 to 45 win-backs" shows the cost of waiting.
Confused:
- "24 to 45" against a gap of 349 never says if it is added or total; nothing says whether the goal will be hit.
- The seed beats are "6 days ago", so it reads as history, not now.
- Nobody explains what a lane block is, or what "Campaign draft" and "692 people" tags are.
- Below the fold: four dense panels (SMS preview, journey, budget) with equal weight.
- Reached, Sent and Revenue are three loose numbers at the very bottom.
- No indication of who is working this second; a cold viewer sees a finished board, not activity.

## Top 10 changes, by impact
1. **Forecast verdict next to the goal.** "On pace for 212 of 400 (150 to 260); the extension and a Dec 8 reminder close most of the gap." Show a pacing line (done, forecast band, target) on the headline. Files: mission progress/forecast in `js/core/missions.js`, mission header component.
2. **Show deliberation, not just outcomes.** Each ask and re-plan lists the options the agent weighed with numbers ("SMS: 9% of wins, $0.31 each; dropped"). Lead's first reply should show the plan as options.
3. **Visible handoff batons.** The design spec calls for payload chips on the wires. Today the wires are plain lines. Put "692 people", "$5,100 split" on the orange wire and pulse the receiving block for 300ms.
4. **Steering shows a diff.** After "skip SMS", highlight changed blocks, strike the SMS preview and journey node, and list "removed 1 channel, moved $900, forecast -6". Today SMS lingers in four places (bugs 1 to 3).
5. **Agents disagree.** Let Fatigue Guard veto or push back on Copy Drafter or Budget Pacer ("not sending: 412 got 3 messages this week") as a signal-coloured counter-ask. This is the memorable moment.
6. **Replace the Team and Campaigns pages with one "agents at work" view.** Each lane shows its current block across all missions. Campaigns and Content become artifacts opened from a block. Files: team and campaigns views, nav in `index.html`.
7. **Make time real.** Rename the sim clock to clear time labels and tie beats to "today" (Nov 27). Fix the "yesterday/13h ago" seed text.
8. **One live "now" strip.** A single line, "Budget Pacer is checking 3 channels...", with a working dot, and Reached, Sent and Revenue moved beside the headline.
9. **Collapse artifacts into one row of tabs, with the message panel hero-sized.** Show the real email render first; the journey is a detail.
10. **Ask quality.** Add a third option ("Extend and cap at $500") and show the impact for each choice, not just for yes.

## Bugs (repro)
1. **SMS survives "skip SMS"** (win-back mission): Skip SMS chip, then Journey still has "Send SMS" and Message still shows an SMS tile. Same on a New goal with "no SMS": the SMS tile and "3 channels" are shown while the budget has no SMS.
2. **"returns about $0.00"** in the Budget Pacer beat after Skip SMS ("where the next $1 returns about $0.00").
3. **Spend drifts on every click.** $3,939, $3,915, $3,925, $3,935 while only steering. Segment size also moves (692, 697, 692). Acting seems to advance the sim clock, so a click changes unrelated numbers. Also "16 days left" becomes 17.
4. **Asks badge jumps** 9, 11, 12, 8 with one visible ask. It never explains the count.
5. **New goal "sign-off" dead end.** The new mission says "waiting for sign-off" but shows no ask card. Only a dashed step "Hand the draft over for your sign-off", with Asks unchanged at 9.
6. **Contradictions:** Campaigns lists Lapsed Hiker Win-back as "no end date" while the mission says Wave 1 stops Dec 2. Black Friday and Winter Layering say "Live" with end dates of Nov 27, while the dark card says "Team: nothing running right now" over active missions. Win-back audience is 743 in a beat and 692 in the panel. Mission count and Fernway data wording "$11.4k back against $3.9k spent" is not tied to the 51 wins.
7. **Revenue figure overflows** its column ($11,425 spills past the lane width at 1440).
8. **Journey panel is clipped** after "Offer reminder email" at 1440; the Last chance node is cut.
9. **Focus ring on page h1** (Team, Campaigns) after nav. A black box around the title looks broken.
10. **Hash routes #asks, #artifacts, #intelligence** silently show the mission page.
11. **Content library is a 9,800px unvirtualised wall** of cards.
12. **Orange is used for Social ads in the budget bar**, diluting "needs you".

## Where it still reads as a marketing cloud or theatre
Team (settings, autonomy, schedule dropdowns), Campaigns (kanban), Audiences (data table), Content (library with filters). The "just now / 1h ago / 2h ago" beat times after one click are theatre; they are not real elapsed time.

## Mobile
Usable and good: the goal is first, the ask is full width, the lane list is compact, the Lead bar is sticky with "Talk to Lead", and there is no horizontal overflow. The lane wiring is lost (a plain list), so handoffs are invisible. The Lead bar overlaps content in full-page captures only.

## What NOT to do
No replay or playhead, no scripted demos, no countdowns. No AI sparkle icon for Lead. No KPI tile wall for the headline. Do not add more incumbent pages. Do not hide the Claude/rules brain difference with fake latency.
