# Script 02 — Prototype to Production

**Mode:** `talking-head` with b-roll cutaways
**Target duration:** 2–3 min
**Synopsis:** The positioning piece — AI coding tools get you a demo fast, the hard part is everything after it, and how Ptah approaches that gap.

---

AI coding tools are good at one thing in particular: getting you a demo fast. Describe an app, and something like Lovable or Bolt will scaffold you a working prototype in an afternoon. That part isn't the problem.

[keyword: demo]

The problem is what comes after the demo. Multi-tenancy — making sure one customer's data can't leak into another's. Billing — subscriptions, webhooks, failed payments, plan changes. A security review that actually holds up. None of that shows up in a five-minute walkthrough, and none of it gets built by accident.

[keyword: multi-tenancy]
[keyword: billing]

One security firm — escape.tech — scanned live apps that had been built with these tools and found that sixty-five percent had security issues once they were actually running in production. That's not a knock on the tools themselves. It's what happens when the fast path skips the parts that don't show up in a demo.

[stat-card: 65% — security issues in live vibe-coded apps (escape.tech)]

That gap has already created its own market. Boilerplate kits that sell for a few hundred dollars. Security audits priced from five hundred to three thousand. Rescue retainers running five to twenty-five thousand a month, for teams that shipped fast and then got stuck.

[keyword: rescue retainers]

Here's how Ptah approaches that gap. It keeps a persistent memory of your architecture — the tenant model you chose, the billing provider you're on, the decisions you made and why — so an agent working on your billing code six weeks from now still knows how your auth is scoped.

[b-roll: memory-recall — while saying "persistent memory of your architecture"]

It also builds skills out of your own delivery patterns. Once you've solved multi-tenant row-level security or a billing webhook correctly, that pattern gets captured and reused — not reinvented from scratch on the next feature.

[b-roll: skills-tour — while saying "builds skills"]

And instead of one agent doing everything, you can run multiple agents with a review pass built in — one implements, another checks the diff, before anything merges.

[b-roll: canvas-orchestra — while saying "multiple agents"]
[b-roll: tribunal-tour — while saying "review pass"]

That's the difference we're building for — not shipping a demo, but shipping the parts that come after it.

[layout: screen-full-with-bubble]

---

## Recording notes

- **Keywords to enunciate**: `demo`, `multi-tenancy`, `billing`, `rescue retainers`, `persistent memory of your architecture`, `builds skills`, `multiple agents`, `review pass`.
- **The stat is load-bearing** — say "one security firm, escape.tech" before the number, every take, so the attribution survives any re-edit. Never state the 65% figure without the source.
- **Do not name-drop competitors beyond category references** ("app builders like Lovable or Bolt") — no head-to-head trash talk, no unverified claims about their output quality beyond the attributed stat.
- **Draft-beats command**:
  ```bash
  npm run selfshot:draft -- --slug prototype-to-production \
    --keywords "demo,multi-tenancy,billing,rescue retainers,persistent memory of your architecture,builds skills,multiple agents,review pass" \
    --title "Abdallah Khalil" --subtitle "Founder, Ptah"
  ```
- This one runs b-roll cutaways under `screen-demo`/`hybrid` framing — record a `screen.mp4` pass of the three referenced tours (or reuse existing showcase MP4s) if you want live footage instead of pulling the showcase clips as `broll.src`.

---

## YouTube metadata

**Title:** The prototype-to-production gap in AI coding tools

**Description:**

```
AI coding tools are good at getting you a working demo fast. The part that actually decides whether you ship is what comes after: multi-tenancy, billing, webhooks, a security review that holds up. One security firm, escape.tech, found that 65% of live apps built this way had security issues in production.

In this video I walk through that gap and how Ptah approaches it — persistent memory of your architecture, skills that encode your own delivery patterns, and multiple agents with a review pass before anything merges.

▶ More Ptah tours: [PLAYLIST_LINK]
✅ Ptah is free & open source: https://ptah.live
🚀 Join the Ptah Builders waitlist — founding members get 35% off monthly / 50% off yearly: https://ptah.live/?utm_source=youtube#waitlist
📚 Docs: https://docs.ptah.live
💬 Community: [DISCORD_LINK]
```

**Tags:** vibe coding, production saas, ai coding tools, multi-tenancy, saas security, ai coding orchestra
