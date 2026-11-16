# Echo — Pilot Playbook

The goal is 2–3 real trades companies using Echo for 4 weeks, ending in a clear
go/no-go on building Phases 2–3. Run it after the deployment in
[DEPLOY.md](DEPLOY.md) passes its smoke test.

## Who to recruit

Pick from existing SiteAssist / Relay / Quill customers. They already trust
RainCode, and their feedback tells you whether Echo works as a suite module.

| Good pilot | Why |
| --- | --- |
| 3–15 field workers, 1–2 office people | Large enough for the owner to feel the pain, small enough to onboard in one call |
| Crews spread across multiple sites daily | That's where "what did the crew see?" hurts |
| Owner not on site most of the day | They're the one reading the notes |
| **At least one bilingual or Spanish-speaking crew** | Tests the differentiator directly |
| Trades with materials and change orders (roofing, HVAC, landscaping, GC) | Structured extraction shows its value |

Avoid solo operators (no handoff to capture) and companies mid-way through
switching to a new FSM tool.

## Outreach message (adapt per customer)

> Subject: Free early access — voice notes from your crews, straight to your dashboard
>
> Hi {name},
>
> We're piloting a new RainCode tool called **Echo** with a few {trade}
> companies we already work with. Your crews tap a link on their phone, enter
> a 4-digit PIN (no app, no accounts), and talk for 30 seconds about what
> they're seeing on site. They can attach photos. Echo turns it into a
> summary, a materials list, action items and an urgency flag on your
> dashboard. It works in English or Spanish.
>
> We're looking for 2–3 companies to use it free for 4 weeks and tell us
> honestly what's useful and what's not. Setup is a 30-minute call. We set
> it up with you and print a QR code for the trucks.
>
> Interested? Reply with a couple of times that work this week.

## Onboarding call (30 minutes)

1. **(5 min)** Ask what happens today when a crew finds something unexpected
   on site. Write down their exact words; they become the success story or
   the reason it failed.
2. **(10 min)** Sign them up live. Set the company name and trade, add every
   crew member with a PIN, and print the QR poster (Team → entry link).
   In Settings, add the owner's mobile, turn on **Urgent alerts**, and press
   **Send test alert** while you're on the call.
3. **(10 min)** The owner records a test note on their own phone, then you
   walk the dashboard together: review, mark reviewed, link to a job.
4. **(5 min)** Agree on the ask: every crew lead records at least one note
   per job per day for 4 weeks. Book the weekly 15-minute check-ins.

## What to measure

Pull these from the Convex dashboard (data browser) weekly, per company:

| Metric | Target by week 4 | Where |
| --- | --- | --- |
| Notes per active crew member per week | ≥3, not decaying | `voiceNotes` by `teamMemberId`, `createdAt` |
| % notes reviewed by owner | ≥70% | `status = reviewed` |
| Median capture → review time | <24h | `reviewedAt − createdAt` |
| AI failure rate | <5% | `aiStatus = failed` (read `aiErrorMessage`) |
| Notes flagged urgent | Any; check each was real | `workerFlaggedUrgent` |

## Weekly check-in questions (15 minutes)

1. Which note this week was actually useful? What did you do because of it?
2. Which crew members aren't recording, and why? (Ask them directly if you can.)
3. Did the AI summary or materials list get anything wrong?
4. Did anything fail to save, or did anyone give up mid-recording?
5. What did you wish happened *after* the note came in? (This sizes Phase 2:
   alerts, digests, materials orders.)

## Go / no-go after week 4

**Go:** at least 2 of 3 pilots meet the usage targets, *and* each has at least
one concrete "this saved me a trip / callback / mis-order" story, *and* the
owners would pay (or ask to keep it).

**Iterate:** usage is there but the value is fuzzy. Usually that means the
loop after the note is missing. Build the top Phase 2 item they asked for and
re-run for 2 weeks.

**Stop or fold into SiteAssist:** crews stop recording by week 2 despite
owner push. Capture is the hard part; if that fails, a standalone product
won't work, but the extraction pipeline can still power a SiteAssist feature.

## Pricing conversation (end of pilot)

Test willingness to pay, don't announce a price. Example framing: *"If this
were $49/month for your whole company, unlimited crew, would you keep it? What
about $99?"* Note which features they mention when they justify the higher
number.
