# E06 — Monetize: Billing + Webhooks — Full Script

**Length:** 11–13 min · **Trial day:** Day 11 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Add freemium and paid tiers, a webhook-driven subscription state machine, and a pre-checkout/portal flow — then test the live checkout in-app with the MCP browser tool.
**Controlling thesis:** Billing is a state machine — model it explicitly, verify every webhook signature, handle replays safely, and the tricky parts become ordinary NestJS code.

## Pre-record checklist

- Tasks engine from E05 merged and green (lint/test/build passing).
- Sandbox payment provider account in test mode only. Webhook secret and API keys stored off-camera; editor blurs any `.env` values that appear on screen. No real keys ever visible.
- Local webhook tunnel running and pre-tested (endpoint reachable from the payment provider's sandbox).
- State machine diagram prepared and ready to overlay — acts as the source of truth throughout the episode so viewers don't get lost.
- Parallel agent tiles (subscription state machine and webhook ingress) pre-arranged.
- Idempotency test: pre-generate a duplicate webhook payload to replay in the demo.
- Feature gate: a "Tasks per month" limit enforced at the service layer for the free tier — pre-staged to make the gate visible.
- MCP browser tool confirmed working in a dry run inside Ptah Desktop Electron.

## Assets / overlays

- Subscription state-machine animation: trial → active → past-due → canceled.
- MCP-browser checkout capture.
- Webhook-replay idempotency overlay: "Same event ID — no double grant."
- Tier-gate callout: "Free tier: 20 tasks/month · Paid tier: unlimited."
- Trial-day counter "Day 11 / 100".
- Test-mode banner — "SANDBOX MODE — TEST KEYS ONLY" visible whenever billing UI is on screen.

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat open. Open-weight model badge visible. File tree shows the Tasks module from E05 — green, clean.
- **ON-SCREEN (lower-third):** "Day 11 / 100"
- **VO:** "We have auth, tenancy, and a Tasks engine. Now we add billing: freemium tiers, a subscription state machine, a webhook handler that handles replays safely, and a checkout flow we can test without leaving this app."

### [00:20–01:00] Context handoff from E05

- **VISUAL:** Brief scroll through the E05 session — domain events, SSE stream, Tasks module green.
- **VO:** "Episode Five gave us a Tasks engine with domain events and real-time updates. The billing layer builds on the same foundation: a `BillingContext` bounded context that was modeled in E03, tenant-scoped by the ZenStack policies from E04, and reacting to domain events from E05. The bounded-context seam was already drawn. Today we implement it."
- **ON-SCREEN (lower-third):** "Continuing from E05 Tasks engine"

### [01:00–02:20] Design the billing system — saas-platform-patterns

- **VISUAL:** Kimi's response streams in. It references `saas-platform-patterns` and lays out the design.
- **VO:** "The skill for this episode is `saas-platform-patterns`. It encodes four patterns we need: freemium model, subscription state machine, license lifecycle, and checkout and portal flow. Kimi reads our roadmap, the memory from E01 where we defined our tiers, and the domain model from E03. The output is a concrete design."
- **VISUAL:** Kimi produces: two tiers (Free: 20 tasks/month, Paid: unlimited + team features), the state machine diagram (trial → active → past-due → canceled), the checkout/portal flow, and the webhook events list.
- **ON-SCREEN:** State-machine animation overlays: trial → active → past-due → canceled. Each state labeled with the webhook event that triggers the transition.
- **VO:** "Keep this diagram in mind. Every transition in the subscription lifecycle is driven by a webhook event from the payment provider. We're not polling. We're not trusting the client. The payment provider tells us what happened, we verify the signature, update the state, and act."

### [02:20–03:40] Parallel agents — state machine and webhook ingress

- **VISUAL:** Two Ptah chat tiles active. [VERIFY parallel tile setup path.]
- **VO:** "Two tracks again. One agent builds the subscription state machine — the NestJS service that owns subscription state, enforces tier limits, and handles transitions. The other builds the webhook ingress — the endpoint that receives payment events, verifies signatures, and triggers state transitions. They need each other at the end, but they can build independently."
- **VISUAL:** Left tile: `SubscriptionService` and `SubscriptionStateMachine` code streaming in. State machine transitions visible — `activate()`, `markPastDue()`, `cancel()`.
- **VO:** "The state machine makes every transition explicit. You can only go from `trial` to `active` on a successful payment, from `active` to `past-due` on a failed renewal. No ad-hoc status strings, no boolean `isPaid` flags — explicit states, explicit transitions."
- **ON-SCREEN:** Code callout: state machine `activate()` guard — `if (this.state !== 'trial' && this.state !== 'past-due') throw`.
- **ON-SCREEN (lower-third):** "Track A: Subscription state machine · Track B: Webhook ingress"

### [03:40–05:10] Webhook architecture — three-layer pattern

- **VISUAL:** Right tile: webhook ingress code. The three-layer structure appears: ingest → verify → dispatch.
- **VO:** "The webhook ingress follows the `webhook-architecture` skill's three-layer pattern. Layer one: ingest the raw body and return a 200 immediately — you don't want the payment provider to time out waiting for your business logic. Layer two: verify the signature synchronously — wrong signature, stop here. Layer three: dispatch the verified event to the state machine asynchronously."
- **VISUAL:** Signature verification code on screen. The raw body buffer is used, not the parsed JSON — Hmac verification against the webhook secret. Secret value is blurred/omitted.
- **VO:** "Signature verification uses the raw request body — not the parsed JSON. Parsers can reformat whitespace and break the Hmac. Raw bytes in, expected signature computed, mismatch means drop the event. The webhook secret is off-camera."
- **ON-SCREEN:** Code callout: `verifySignature(rawBody, headers['stripe-signature'])` — secret value blurred.
- **VISUAL:** Idempotency key: event ID stored to a `processed_webhook_events` table before dispatching. Check on insert — duplicate ID skips dispatch.
- **VO:** "And idempotency. Every webhook event has an ID from the payment provider. We insert it into a `processed_webhook_events` table before doing anything. Duplicate ID means we already handled it — skip dispatch, return 200."
- **ON-SCREEN:** Code callout: `if (alreadyProcessed(eventId)) return;`

### [05:10–05:50] CLI delegate — webhook fixture tests

- **VISUAL:** `ptah_agent_spawn` kicks off a `ptah-cli` delegate. Task: "Generate webhook fixture payloads and replay test harness for the payment provider events — payment succeeded, payment failed, subscription canceled."
- **VO:** "The fixture tests go to a CLI agent. Spawn a `ptah-cli` task: generate webhook payload fixtures and a replay harness for the three events we care about. Spawn, poll, read. While that runs, the orchestrator finishes the state machine integration."
- **ON-SCREEN (lower-third):** "CLI delegate: ptah-cli · webhook fixtures + replay harness"

### [05:50–07:30] MCP browser tool — live test checkout

- **VISUAL:** The MCP browser tool activates inside Ptah Desktop. A browser viewport appears within the app. [VERIFY: confirm the MCP browser tool surfaces as an embedded viewport or as a controlled external browser from within Ptah Desktop Electron.]
- **VO:** "Now the MCP browser tool. Instead of switching to a browser and clicking through a checkout manually, I drive it from inside Ptah. The orchestrator can read the page, click elements, fill forms, and observe the result — all as part of the same session."
- **VISUAL:** Browser navigates to the TaskFlow checkout page (sandbox mode). Test-mode banner clearly visible on screen: "SANDBOX MODE — TEST KEYS ONLY."
- **ON-SCREEN:** "SANDBOX MODE — TEST KEYS ONLY" persistent banner.
- **VO:** "This is the sandbox checkout. Test keys only — the billing UI is using test-mode credentials kept off-camera. Real card forms, fake card numbers, no actual charge."
- **VISUAL:** MCP browser fills the checkout form with test card credentials (e.g. standard test card number — blurred or shown as placeholder `4242 4242...`). Submits.
- **VO:** "Fill the form with the payment provider's test card. Submit."
- **VISUAL:** Checkout success page loads. In another panel, the webhook event arrives in the terminal log — event ID visible, `payment_intent.succeeded` type visible.
- **VO:** "Checkout succeeded. The webhook arrived — event type: payment intent succeeded. The ingress layer caught it, verified the signature, checked idempotency, and dispatched to the state machine."
- **VISUAL:** Database query or log shows the subscription state flipped from `trial` to `active`.
- **VO:** "Subscription state: trial to active. Browser action to state transition, in one Ptah session. The browser is a tool the orchestrator can use."
- **ON-SCREEN:** MCP-browser checkout capture overlay. Webhook arrival + state transition callout.

### [07:30–08:30] Prove idempotency — replay the same webhook

- **VISUAL:** The CLI agent's replay harness sends the same webhook event a second time — same event ID.
- **VO:** "Now prove idempotency. The CLI agent's replay harness fires the same `payment_intent.succeeded` event a second time — identical event ID."
- **VISUAL:** Webhook ingress log shows the event arriving. The idempotency check fires. Log line: "Event already processed — skipping dispatch." Subscription state unchanged. Still `active`.
- **ON-SCREEN:** "Same event ID — no double grant" overlay.
- **VO:** "Already processed — skip. No second state transition, no double grant. The subscription is still in `active` state exactly once."

### [08:30–09:30] Tier gate — free tier enforced

- **VISUAL:** Log in as a free-tier tenant in the TaskFlow app. Create tasks up to the limit (20). On the 21st task attempt, the API returns a 403 or a specific tier-gate error.
- **VO:** "Last piece: enforce the tier gate. Free-tier tenants get twenty tasks per month in this demo — that's a configurable value, not a fixed limit. The TaskService checks the tenant's current subscription state and task count before allowing creation. Twenty is fine. The twenty-first gets rejected."
- **VISUAL:** Twenty-first task attempt returns an error: "Free tier limit reached — upgrade to continue."
- **ON-SCREEN:** Tier-gate callout: "Free tier: 20 tasks/month · Paid tier: unlimited."
- **VO:** "The gate is at the service layer, not the client. There is no way to bypass it from the frontend — the service rejects it before the DbService ever runs."

### [09:30–10:30] Close green — full build pass

- **VISUAL:** `nx run-many -t lint test build` in the xterm terminal. All targets green.
- **VO:** "Full green — lint, unit tests, integration tests, build. Billing is live: state machine enforcing correct transitions, webhooks verified and idempotent, checkout tested end-to-end in the browser from inside Ptah, and the free tier gated at the service layer. Day eleven."
- **ON-SCREEN (lower-third):** "Day 11 / 100 · Build: green"

### [10:30–11:30] CTA / End screen

- **VISUAL:** Ptah chat, billing layer visible in the file tree. State-machine diagram on screen. End card animates in.
- **VO:** "Freemium and paid tiers, webhook-driven billing, signature-verified and idempotent, and a checkout we tested end-to-end without leaving Ptah. The backend is done — auth, tenancy, tasks, billing. Next episode: we build the frontend. Angular, signals, a real-time task board, and a landing page. I'll see you in Episode Seven."
- **ON-SCREEN:** End card — "Next: The Frontend" · "Day 14 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop with open-weight badge, E05 Tasks module in file tree.
2. E05 context handoff — domain events and SSE green.
3. `saas-platform-patterns` design output — state machine diagram animates.
4. Parallel tiles: subscription state machine code (Track A) + webhook ingress three-layer pattern (Track B).
5. Signature verification code — secret value blurred. Idempotency key insert callout.
6. CLI delegate: `ptah_agent_spawn` → `ptah-cli` for webhook fixtures + replay harness.
7. MCP browser tool activates — browser viewport inside Ptah Desktop.
8. Sandbox checkout form filled (test card, blurred number), submit, checkout success.
9. Webhook event arrival in terminal — state transition from `trial` to `active`.
10. Idempotency replay: same event ID sent twice → "skip dispatch" log line → "no double grant" overlay.
11. Tier gate: 21st task rejected — "upgrade to continue" error.
12. `nx run-many` green build.
13. End card.

## [VERIFY] flags

- Exact MCP browser tool surface in Ptah Desktop Electron: confirm whether it renders an embedded browser viewport inside the app or controls an external browser window; adjust the VO phrase "browser viewport appears within the app" to match the real behavior.
- Confirm the MCP browser tool available in Ptah Desktop is `ptah_browser_navigate` / `ptah_browser_click` / `ptah_browser_type` family (from `libs/backend/vscode-lm-tools`) — verify these are accessible from the Electron orchestrator session and not VS Code-only.
- Payment provider choice: the script is provider-agnostic (uses "payment provider" throughout) — confirm which sandbox (Stripe, Paddle, LemonSqueezy) is used for the TaskFlow demo so the correct test card numbers and webhook event names (`payment_intent.succeeded` vs `order.completed` etc.) are scripted accurately.
- Webhook tunnel: confirm the exact local tunnel tool used (ngrok, Cloudflare Tunnel, etc.) and whether setup is shown on camera or pre-established off-camera. The script assumes pre-established.
- Parallel agent tile setup: same [VERIFY] as E04 — confirm whether two canvas tiles, two background workspaces, or subagent delegation is the visual pattern for the "two parallel tracks" on screen.
- `ptah_agent_spawn` priority confirmation for webhook fixture task: `ptah-cli > codex > copilot`.
- Idempotency table name (`processed_webhook_events`) — confirm this is what `saas-platform-patterns` or `webhook-architecture` actually generates, or adjust to be generic.
- Tier-gate limit (20 tasks/month) — labeled on screen as a configurable demo value, not a hardcoded Ptah limit.
