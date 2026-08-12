# Voice notes (source: `apps/ptah-video-studio/selfshot/ptah-opensource/words.json`)

Reconstructed prose from the transcript, for reference:

> Hi, I have been working on a coding agent for a year and a half now and while I'm working on it, I'm also using it to build a SaaS application. Currently, it's fully open source, the code is on GitHub and I want more contributors and other developers who can use it and enhance it alongside me. For the name, I am a big fan of Egyptology, so I called it Ptah, also I wanted to discuss from where I'm coming from and why I built it in the first place. Basically, I have been using Nx workspaces and the TypeScript stack like Angular, React for the front end, NestJS and Prisma was different ORMs and the backend following domain-driven design to build a maintainable SaaS application and through the years I have been using the different coding agent and each time I found they are very good at writing a code but they almost struggled to understand how I built and how I designed the architecture. That's why I built Ptah. To encode this architecture into the coding agent itself and stop re-explaining myself and my architecture to the coding agent each time I use it. So basically, Ptah is a provider agnostic coding orchestra where you can use your different subscriptions, like whether you have Claude Code, Codex, or a Llama subscription or any open source model. You can utilize it with Ptah while having your agentic harness and context harness into just the application itself or at the application layer. Ptah ships with 24 skills and around 15 agent templates and all of this is fully customized where you can pick what you want and then install it. Ptah will wire it into your workspace and install it in the coding agent you are using. They are not just prompts. [...] They are actually the way I have been coding and I have been architecting my SaaS application for all of my years of experience. For example, how you would lay out or how you would create a library or defines first the domain driven design architecture into your workspace [...]. Also, it doesn't hand you generic agent. It is a setup wizard as well that understands your architecture and your tech stack and everything you are using. Also, it like have an evaluation for your weaknesses and the strengths and based off all of this information, it generates tailored agents and skills for your projects. All of that run in three places, a VS Code extension, a desktop application and a CLI tool. [...] On our canvas, you can run up to nine different agents with different models and also different providers [...] from one shared workspace. It also has a memory that resists over session, so the thing you define to it while you are working on the first day of the week, it will exist on Friday until you say so. And once you finish your work, it has a trajectory that run all over your session and try to understand how you could offer you new skills [...] to use into your project from now on.

**What to match:**

- First person, plain declarative sentences. No throat-clearing marketing lead-in — he starts with what he's been doing ("I have been working on a coding agent for a year and a half now").
- **Explains WHY before WHAT.** Close to half the transcript is personal history and motivation before he ever describes a feature.
- **"Basically" is a reset word** — he uses it to signal "now I'll get concrete," twice, both times right before the real explanation starts.
- **"Also" chains points additively** instead of subordinating clauses — "Also, it doesn't hand you generic agent," "Also, it like have an evaluation..." He lists, he doesn't nest.
- Numbers land flat, mid-sentence, no fanfare: "24 skills," "around 15 agent templates," "up to nine different agents," "three places." No adjective in front of them.
- Repeats the product name ("Ptah") rather than leaning on pronouns — brand reinforcement by repetition, not styling.
- Addresses the viewer directly and often: "you can pick what you want," "you are using," "how you would lay out."
- Sentences frequently open with "It," "Also," or "So" — conversational rhythm, not polished copy-deck cadence.
- Closes a run of features with one plain summary line, not a flourish ("All of that run in three places...").
- **Zero hype adjectives.** No "powerful," "seamless," "game-changing." The specificity of the numbers carries the weight instead.
- Do **not** imitate the grammar slips (article drops, tense agreement, "was different ORMs," "resists over session") — match the register, not the errors.

---

# Sales Harness — Apollo + HubSpot + Zernio — Full Script

**Length:** 5.5–6.5 min · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** (your default desktop model — [VERIFY badge on camera])
**Goal:** Connect three OAuth MCP servers, build a sales-prospecting harness in the harness builder ("AI Team Builder"), then run it live — find leads matching an ICP, enrich them, push to HubSpot, draft personalized outreach, and approve it on camera.
**Controlling thesis:** The tools for prospecting already exist — Apollo, HubSpot, Zernio, 496 tools between them. Wiring that by hand doesn't scale. Ptah's harness builder does it from one sentence, and a human still approves every message before anything goes out.

> Standalone promo, not part of the SaaS-on-open-weights series. Follows the shared style guide for voice and format (see `AEC-harness-ifc-autodesk.md`).

## Pre-record checklist

The harness builder assembles a specialist **around MCP servers that are already connected to the workspace**. Connect all three via Ptah's "Connected Apps" OAuth surface before recording — the build scene should show the builder detecting them, not you configuring them.

- **Apollo MCP connected** — [VERIFY, prominent]: Apollo publishes no endpoint URL; it describes a "native connector" chosen from inside each AI platform's own connector directory. Whether Ptah's generic OAuth-URL connect flow can reach it is **unconfirmed**. Resolve this days before the shoot, not on camera. Fallback: Apollo's API-key path (any Apollo plan qualifies, including free) — if OAuth doesn't work, connect Apollo via API key instead and say so on camera rather than improvising.
- **HubSpot MCP connected** — endpoint `mcp.hubspot.com`, OAuth 2.0. Requires a user-level app with read **and write** scopes (contacts, companies) registered on the new HubSpot Developer Platform. Use a HubSpot **sandbox/test portal** — never a real customer's account.
- **Zernio MCP connected** — endpoint `https://mcp.zernio.com/mcp`, OAuth or `Authorization: Bearer`. 496 tools total (~50 core, the rest via on-demand `search_tools` discovery). Use a Zernio test account so nothing can actually post or broadcast.
- **No secrets to blur** — Ptah connects any spec-compliant remote MCP server with zero manual config: RFC 9728 (protected-resource metadata) discovers the auth server, RFC 8414 discovers its endpoints, RFC 7591 registers a client automatically. You authorize in the browser; nothing is typed on screen. This is a real advantage over the AEC shoot (client secrets there had to be blurred) — call it out.
- **Draft-and-queue only, human-in-the-loop — non-negotiable.** Do not script automated outreach being sent to real people. LinkedIn's ToS prohibits automation; GDPR/CAN-SPAM govern cold contact by email. Lead search and enrichment against Apollo's real database is fine (read-only). The outreach-drafting step must target **the founder's own seeded test contacts** — a handful of contacts he controls, pushed into the HubSpot sandbox himself before recording — never the real Apollo leads pulled earlier in the demo. He reviews and approves each draft on camera; approval moves it to "queued," never "sent."
- **Dry-run the harness before recording.** The harness builder writes the outreach subagent's behavior from a natural-language prompt — its exact tool calls are not fully predictable ahead of time. Build the harness once, off camera, and confirm the outreach-drafter subagent only ever calls draft/create-style HubSpot and Zernio endpoints, never a send, publish, or live-enroll endpoint. If the generated subagent has access to a send-capable tool at all, tighten the harness-builder prompt (or the OAuth scopes) until it doesn't, and re-run the dry run before trusting it on camera.
- **Tool-allowlist scene setup** — during that same dry run, open the actual generated `.claude/agents/outreach-drafter.md` and read its `tools:` frontmatter line. Confirm it is non-empty (an empty array means the file omits the `tools:` line entirely, which grants the subagent _every_ tool instead of none) and confirm no send-capable tool name appears in it. Write down the exact line so you know what you're pointing at before recording, and have the file ready to open in the editor pane right after Apply.
- Seeded test contacts use email addresses the founder personally owns/controls, so even an accidental send could not reach a real inbox.
- Harness-builder prompt drafted and ready to paste (see below).

## Assets / overlays

- Lower-thirds for each sub-agent as it's created (lead finder, enrichment analyst, CRM sync, outreach drafter).
- A persistent "Draft only — human approves" badge, visible from the moment the outreach drafter first appears through the approval scene.
- Callout box for the HubSpot record created (contact/company) — the "this is a real CRM write" proof frame.
- Callout box for the Zernio draft card — highlight the "Draft" / "Queued" status pill, never a "Sent" state.
- Small "OAuth connected · zero manual config" caption the first time the three servers appear in the connected-tools list.
- End card: Ptah logo · GitHub repo URL · "Download Ptah → ptah.live".

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat. Three connected-app tiles visible in the tool list: Apollo, HubSpot, Zernio.
- **VO:** "Sales prospecting is the same five steps every time. Find leads that match your ICP, enrich them, get them into your CRM, write the first message. I connected Apollo, HubSpot, and Zernio to Ptah, then asked it to build a team that does that — and I approve every message myself before anything goes out."
- **ON-SCREEN:** (none)

### [00:20–01:00] Connect the three servers

- **VISUAL:** Ptah's "Connected Apps" surface (Marketplace → OAuth). Paste each server URL, click Connect, browser opens, authorize, return to Ptah — status pill flips to "Connected." Repeat for all three. [VERIFY exact Marketplace/Connected Apps navigation path on camera.]
- **VO:** "Basically, connecting these is just a URL and a browser tab. Ptah does the discovery itself — finds the auth server, registers a client, handles the token. No API keys typed on screen, nothing to blur. Apollo for finding and enriching leads, HubSpot for the CRM, Zernio for the outreach side — that one alone is 496 tools."
- **ON-SCREEN (lower-third):** "Connected: Apollo · HubSpot · Zernio — OAuth, zero manual config"

### [01:00–01:20] Open the AI Team Builder

- **VISUAL:** Setup Hub → "AI Team Builder" card → harness builder view opens ("Describe your AI team").
- **VO:** "This is the AI Team Builder. I'm not going to configure agents one by one — I'm going to describe the job and let it design the team."
- **ON-SCREEN:** (none)

### [01:20–02:00] The prompt

- **VISUAL:** Paste the sales-harness prompt into the builder's message box. Scroll it briefly — persona, subagents, the three servers, the draft-only line.
- **VO:** "Four hundred and ninety-six tools across three services. I'm not wiring that by hand — I'm describing the job." _(beat)_ "Be a sales development specialist. Find leads, enrich them, push the good ones into HubSpot, draft the outreach — and never send anything without me."
- **VISUAL:** Submit.
- **ON-SCREEN:** Pasted prompt visible.

### [02:00–02:45] The build

- **VISUAL:** Build streams in the execution tree — server detection, subagent proposals, skill files being created, `proposeConfig` calls firming up the side-panel config preview.
- **VO:** "It sees the three servers are already connected and picks the tools each subagent actually needs — it's not handing all 496 to one agent. It designs a lead finder, an enrichment analyst, a CRM sync agent, and an outreach drafter. And it writes skills alongside them — how to score a lead against my ICP, how to personalize a first message without sounding like a template."
- **ON-SCREEN (lower-thirds, as each appears):** "lead-finder" · "enrichment-analyst" · "crm-sync" · "outreach-drafter"
- **VISUAL:** "Configuration looks ready to apply" banner → click **Apply to Workspace**.
- **VO:** "Apply writes it into the workspace — CLAUDE.md, the agent files, the skills, the MCP config. From here it's just running it."

### [02:45–03:10] The tool allowlist

- **VISUAL:** Open the newly written `.claude/agents/outreach-drafter.md` in the editor. Scroll to the YAML frontmatter and hold on the `tools:` line.
- **VO:** "Four hundred ninety-six tools across three servers. This one agent gets a list — read a HubSpot contact, write a HubSpot contact, draft a Zernio message, draft a Zernio post. That's it. No send in it. That's not a line in my prompt — it's in the file. If a tool isn't on this list, the agent cannot call it."
- **ON-SCREEN (callout):** Highlight the `tools:` frontmatter line; small caption — "Every subagent gets its own allowlist, not just this one."

### [03:10–03:45] Find and enrich leads — live, real Apollo data

- **VISUAL:** Type the ICP question on camera in the built harness.
- **VO:** "Real request: find me marketing leads at Series A SaaS companies, twenty to two hundred employees, and enrich the ones that look like a fit."
- **VISUAL:** Answer streams; a short list of leads with enrichment data (title, company, size) appears.
- **VO:** "This is Apollo's real database — this is just search and enrichment, nothing goes out to anyone yet."
- **ON-SCREEN (callout):** Highlight the enriched lead list.

### [03:45–04:15] Push to HubSpot — live, real CRM write

- **VISUAL:** Ask it to push the matched leads into HubSpot.
- **VO:** "Now push the ones that qualify into HubSpot as contacts and companies."
- **VISUAL:** Confirmation streams; switch briefly to the HubSpot sandbox portal to show the new contact/company records landed.
- **ON-SCREEN (callout):** Highlight the new HubSpot contact record.

### [04:15–05:05] Draft outreach — seeded test contacts only

- **VISUAL:** Switch targets explicitly. Point at three seeded test contacts already in the HubSpot sandbox.
- **VO:** "For the actual message, I'm not touching the leads we just pulled — that would be real outreach to real people on camera, and that's not what this is. These three are test contacts I seeded myself. Everything from here targets them."
- **VISUAL:** Ask the outreach drafter to write personalized first messages for the three test contacts via Zernio.
- **VISUAL:** Draft messages stream in, each tagged with a "Draft" status pill.
- **ON-SCREEN (badge, persistent from here):** "Draft only — human approves"

### [05:05–05:35] Approve — queued, not sent

- **VISUAL:** Review one drafted message on camera, edit a line if it reads templated, click Approve.
- **VO:** "I read every one of these before it moves. Approve doesn't send it — it queues it. Nothing leaves Ptah without me clicking send myself, later, for real."
- **VISUAL:** Status pill flips from "Draft" to "Queued." No "Sent" state appears anywhere in the scene.
- **ON-SCREEN (callout):** Highlight the "Queued" pill.

### [05:35–06:05] CTA / End screen

- **VISUAL:** GitHub repo and README.
- **VO:** "The whole team is shareable — the prompt that built it is in the repo. To run this yourself: download Ptah, connect Apollo, HubSpot, and Zernio, paste the prompt, and it builds the same team for your pipeline. What you send after that is always up to you."
- **ON-SCREEN:** End card — Ptah logo · repo URL · "Download Ptah → ptah.live".

---

## The harness builder prompt

Exact text to paste into the AI Team Builder on camera:

```
Be a sales development specialist for my pipeline. Find leads that match
my ideal customer profile using Apollo, enrich them with company and
contact data, and push the qualified ones into HubSpot as contacts and
companies. Then draft short, personalized outreach messages using Zernio.

Build four subagents:
- lead-finder — searches Apollo for leads matching my ICP
- enrichment-analyst — pulls contact and company detail on matched leads
- crm-sync — pushes qualified leads into HubSpot as contacts/companies
- outreach-drafter — writes short, personalized first-touch messages

Use the three MCP servers that are already connected: Apollo, HubSpot,
Zernio. There are 496 tools between them — give each subagent only the
tools it actually needs, not the whole surface.

Draft-only, always. No subagent may call a send, publish, schedule-live,
or enroll-in-live-sequence tool, period. Every outreach message goes into
a draft or a queue and stops there. I approve every message by hand
before anything goes out — build the team so that's the only way a
message can ever leave.
```

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, three connected-app tiles visible.
2. Connected Apps surface — paste URL, browser authorize, status pill flips per server (×3).
3. Setup Hub → "AI Team Builder" card → harness builder opens.
4. Paste the sales-harness prompt; scroll persona / subagents / servers / draft-only clause.
5. Submit; build streams — server detection, subagent + skill proposals, config preview filling in.
6. Subagents appearing — lower-thirds per agent.
7. "Configuration looks ready to apply" → Apply to Workspace.
8. Open `.claude/agents/outreach-drafter.md` in the editor — highlight the `tools:` frontmatter line, no send tool present.
9. Live: ICP lead search + enrichment via Apollo — callout on the enriched list.
10. Live: push qualified leads to HubSpot — cut to HubSpot sandbox showing new records.
11. Switch targets to seeded test contacts — explain on camera why.
12. Live: draft personalized outreach via Zernio for the seeded contacts — "Draft" pills.
13. Review + edit one draft, click Approve — pill flips to "Queued," never "Sent."
14. GitHub repo + README + prompt file.
15. End card.

## [VERIFY] flags

- **Apollo connectivity is the biggest risk in this script.** Apollo publishes no MCP endpoint URL — it's a native connector picked from inside each platform's own directory. Confirm days before the shoot whether Ptah's generic OAuth-URL "Connected Apps" flow can reach it at all. If not, fall back to Apollo's API-key path on camera and say so plainly rather than staging a fake OAuth connect.
- **The subagent tool allowlist is a real enforcement mechanism, not a hope — but confirm both preconditions before filming it.** `HarnessSubagentDesignService.designSubagentFleet` (`libs/backend/rpc-handlers/src/lib/harness/ai/harness-subagent-design.service.ts`) requires the design LLM to return a `tools: string[]` array per subagent — a required field in its output schema, passed through unmodified. `HarnessAgentFileWriterService.composeAgentFile` (`libs/backend/rpc-handlers/src/lib/harness/config/harness-agent-file-writer.service.ts:75-86`) writes that array into the `tools:` line of the generated `.claude/agents/<slug>.md` frontmatter — the standard Claude Code subagent convention, which the Claude Code runtime enforces structurally: a subagent invoked from a file with a `tools:` allowlist genuinely has no other tools in its context, not merely an instruction it could ignore. Two things to confirm before trusting it on camera: (1) the array must actually come back **non-empty** for `outreach-drafter` — `composeAgentFile` only writes the `tools:` line `if (tools.length > 0)`; an empty array silently _omits_ the line, which grants the subagent every tool instead of none, the opposite of the on-camera claim; (2) this enforcement is a Claude Code subagent-file convention, so it holds only if the demo's orchestrator is a Claude Code session — Ptah is provider-agnostic, and other CLI providers are not guaranteed to honor the same `tools:` frontmatter the same way. **Where it's visible for filming:** nowhere in the harness builder UI — the side-panel Config Preview (`harness-config-preview.component.ts`) lists subagent count and names only, never per-agent tool lists — so the only way to show this on camera is opening the written `.claude/agents/outreach-drafter.md` file after Apply, in the editor. Keep the off-camera dry run (reading that exact `tools:` line, confirming it's non-empty and send-free) as the fallback check regardless — the allowlist is real enforcement of whatever list the LLM chose to write, and that choice itself still deserves a human read before it's trusted on camera.
- **HubSpot Developer Platform app scopes** — confirm a free/dev sandbox portal can actually grant the read+write scopes (contacts, companies) this demo needs; confirm on record day, not assumed from docs.
- **Zernio draft-vs-send tool separation** — confirm, via a `search_tools` call ahead of time, that Zernio's 496-tool surface has clearly distinct draft/queue endpoints from its send/broadcast endpoints, so the harness can be scoped to the former only.
- **Exact on-screen behavior of `proposeConfig` / `createSkill` tool calls** in the execution tree during the build — confirm whether they render as discrete cards (per the `ptah.harness` tool names in `harness-constants.ts`) so Scene 5's callouts match what's actually on screen.
- **Exact Marketplace → Connected Apps navigation path** and the on-screen wording of the connect form (`libs/frontend/marketplace/src/lib/oauth-surface.component.ts` ships default quick-connect chips for Sentry/Notion/Linear only — Apollo/HubSpot/Zernio must be pasted by URL; confirm the exact strings to type on camera).
- **Confirm "AI Team Builder" is the correct on-screen label** to say out loud (the Setup Hub card and the builder's own header both use this name, not "harness builder" — that's the internal/repo name only).
- **HubSpot and Zernio API latency** — pre-warm both connections before recording; speed-ramp the build and live-run scenes if either is slow.
- No real outreach on camera at any point — the "Draft only — human approves" badge must be visible for the entire outreach-drafting and approval sequence, and no "Sent" state may appear anywhere in the recording.
