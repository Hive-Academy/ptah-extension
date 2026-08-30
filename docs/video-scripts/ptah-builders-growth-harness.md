# Ptah Builders Growth Harness — Google Search + Exa + HubSpot — Full Script

**Length:** 5.5–6.5 min · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** (your default desktop model — [VERIFY badge on camera])
**Goal:** Use Ptah to build the team that markets Ptah — find solo founders and small teams building SaaS in TypeScript, push the fit ones into HubSpot, and draft LinkedIn posts and direct messages that invite them into Ptah Builders early access, free.
**Controlling thesis:** I built a coding agent and I am using it to build a SaaS with it. Now I use the same harness builder to run the outreach for the program itself. Search is built in — Google through Serper, Exa for semantic search. A human still approves every message before anything goes out.

> Standalone promo, not part of the SaaS-on-open-weights series. Follows `SCRIPT-STYLE-GUIDE.md` for voice and format. Voice reference: the "Voice notes" block at the top of `sales-harness-apollo-hubspot-zernio.md` — first person, "basically" as the reset word, numbers flat, zero hype adjectives.
>
> Supersedes `sales-harness-apollo-hubspot-zernio.md`. That script built a dummy pipeline against Apollo and Zernio. This one builds the real pipeline for Ptah Builders.

## The offer, stated once so every scene agrees

- **Ptah Builders early access is free.** No checkout on camera. No price on screen. [VERIFY: the exact wording of the offer, the seat count if any, and the landing URL. Do not say "limited" unless a real limit exists.]
- What a Builder gets: a seat in the 8-week foundational SaaS course, taught against one real production application; the Ptah workflow that built it (agents, skills, orchestrations, specs); the weekly live session; the private Builders Lounge on `community.ptah.live`. [VERIFY each item against the current program state before recording — the course modules are not authored yet as of 2026-08-25; say "the course is being authored with the first cohort" rather than "the course is ready".]
- Who it is for: solo founders and small teams who build SaaS on TypeScript — Nx, NestJS, Angular or React, Prisma. That is the ICP the harness searches for.

## Pre-record checklist

- **Web search provider set.** Open Ptah settings → Web Search. Set the provider to **Serper** (Google Search API) and add the key. Run the built-in "Test" button so the status shows connected. Then repeat with **Exa**. [VERIFY: the provider selector holds one active provider at a time (`web-search-config.component.ts`). The harness cannot call both at once through `ptah_web_search`. Two options: (a) record the discovery scene twice with the provider switched between, or (b) connect Exa as its own MCP server through Connected Apps so both are live. Decide off camera. Option (b) is the cleaner scene — one tool that does Google, one that does semantic.]
- **HubSpot MCP connected** — endpoint `mcp.hubspot.com`, OAuth 2.0. Needs a user-level app with read **and write** scopes (contacts, companies) on the HubSpot Developer Platform. Use a HubSpot **sandbox/test portal**, never a live customer account. Connect through Ptah's Connected Apps surface before recording — the build scene shows the builder detecting it, not you configuring it.
- **No secrets to blur.** Search keys are entered in settings before recording and never shown. HubSpot connects through RFC 9728 / 8414 / 7591 discovery — you authorize in the browser. Nothing is typed on screen.
- **Draft-and-queue only, human-in-the-loop — non-negotiable.** LinkedIn's terms of service prohibit automation. GDPR and CAN-SPAM govern cold contact. Search and enrichment from public web pages is read-only and fine. The outreach-drafting step targets **the founder's own seeded test contacts** in the HubSpot sandbox, never the real people found in the discovery scene. Drafts are written to files. Approval moves a file from `drafts/` to `queued/`, never to "sent". There is no send tool in this harness at all — that is the whole point of the allowlist scene.
- **Dry-run the harness before recording.** Build it once off camera. Open every generated `.claude/agents/*.md`. Read each `tools:` frontmatter line. Confirm it is non-empty (an empty array omits the line, which grants every tool instead of none). Confirm no HubSpot tool with `send`, `enroll`, `sequence`, or `email` in its name appears on `outreach-drafter`. Write the exact line down so you know what you point at on camera.
- **Seed three test contacts** into the HubSpot sandbox with email addresses you own. Even an accidental write reaches only you.
- **Workspace ready.** Open `D:\projects\ptah-growth` as the active workspace before opening the AI Team Builder. The builder pins to whichever workspace is active when it starts and has no directory picker. [VERIFY folder name; create it empty with a one-line README before the shoot.]
- **Builders landing page live** at the URL you say in the CTA. [VERIFY: the free early-access path must work without the Paddle checkout flip. `BUILDERS_CHECKOUT_ENABLED` is still false per Seshat `OPERATIONS.md`. Confirm the provisioning path that puts a free Builder into the `builders-founding` Discourse group before you publish the video.]
- Harness-builder prompt drafted and ready to paste (see below).

## Assets / overlays

- Lower-thirds for each subagent as it is created: `founder-finder`, `fit-analyst`, `crm-sync`, `content-drafter`, `outreach-drafter`.
- A persistent "Draft only — human approves" badge, visible from the moment `outreach-drafter` first appears through the approval scene.
- Callout box for the HubSpot record created — the "this is a real CRM write" proof frame.
- Callout box on the `tools:` frontmatter line of `outreach-drafter.md`.
- Small "Google via Serper · Exa semantic — built in" caption the first time the search tools appear.
- End card: Ptah logo · GitHub repo URL · "Ptah Builders — early access, free → [VERIFY URL]".

---

### [00:00–00:25] Cold open

- **VISUAL:** Ptah Desktop chat. Model badge visible. One connected-app tile in the tool list: HubSpot. Web search status shows connected.
- **VO:** "I have been building a coding agent for a year and a half, and I use it to build a SaaS application with it. It is open source. Now I am opening a program around it — Ptah Builders — where a small group builds a SaaS with me over eight weeks, and early access is free. So I need to find those people and talk to them. Basically, I am going to use Ptah to build the team that does that, and I approve every message myself before anything goes out."
- **ON-SCREEN:** (none)

### [00:25–00:55] What is already wired

- **VISUAL:** Open Ptah settings → Web Search. Show the provider dropdown: Tavily, Serper, Exa. Serper selected, status connected. Then the Connected Apps surface with HubSpot showing "Connected". [VERIFY exact navigation labels on camera.]
- **VO:** "Search is built into Ptah. Serper gives me Google results. Exa gives me semantic search — 'find pages like this one' instead of keywords. Both are a key in settings, that's it. For the CRM I connected HubSpot. That one is a URL and a browser tab — Ptah finds the auth server, registers a client, handles the token. Nothing typed on screen."
- **ON-SCREEN (lower-third):** "Google via Serper · Exa semantic — built in" then "HubSpot — OAuth, zero manual config"

### [00:55–01:15] Open the AI Team Builder

- **VISUAL:** Setup Hub → "AI Team Builder" card → builder view opens ("Describe your AI team").
- **VO:** "This is the AI Team Builder. I am not going to configure agents one by one. I describe the job and it designs the team."
- **ON-SCREEN:** (none)

### [01:15–01:55] The prompt

- **VISUAL:** Paste the growth-harness prompt into the builder's message box. Scroll it briefly — the ICP, the five subagents, the draft-only clause.
- **VO:** "Here is the job. Find solo founders and small teams who build SaaS on TypeScript — Nx, NestJS, Angular, Prisma. Work out who is a fit for Builders. Push the fit ones into HubSpot. Draft the LinkedIn posts and the first messages. And never send anything without me."
- **VISUAL:** Submit.
- **ON-SCREEN:** Pasted prompt visible.

### [01:55–02:40] The build

- **VISUAL:** Build streams in the execution tree — tool detection, subagent proposals, skill files being created, `proposeConfig` calls filling the side-panel config preview.
- **VO:** "It sees web search and HubSpot are already there and picks what each subagent needs. A founder finder that runs the searches. A fit analyst that reads what it found and scores it against the profile. A CRM sync agent. A content drafter for the public posts. An outreach drafter for the direct messages. Also it writes skills next to them — what a Builder looks like, how to write a first message that does not read like a template, and the voice rules from my own transcripts."
- **ON-SCREEN (lower-thirds, as each appears):** "founder-finder" · "fit-analyst" · "crm-sync" · "content-drafter" · "outreach-drafter"
- **VISUAL:** "Configuration looks ready to apply" banner → click **Apply to Workspace**.
- **VO:** "Apply writes it into the workspace — CLAUDE.md, the agent files, the skills. From here it is just running it."

### [02:40–03:05] The tool allowlist

- **VISUAL:** Open the newly written `.claude/agents/outreach-drafter.md` in the editor. Hold on the `tools:` frontmatter line.
- **VO:** "This agent gets a list. Read a HubSpot contact. Write a file. That's it. No send in it, because there is no send tool in this harness at all. That is not a line in my prompt — it is in the file. If a tool is not on this list, the agent cannot call it."
- **ON-SCREEN (callout):** Highlight the `tools:` line; caption — "Every subagent gets its own allowlist."

### [03:05–03:50] Find founders — live, real search

- **VISUAL:** Type the discovery request on camera in the built harness.
- **VO:** "Real request: find solo founders and small teams building SaaS on Nx with NestJS and Angular or React, who write about it publicly — blog posts, GitHub READMEs, LinkedIn articles, Show HN posts from this year."
- **VISUAL:** Search calls stream — Google queries through Serper, then Exa "find similar" calls fanning out from the first hits. A short list appears: name, company or project, the URL that proves the fit, and a one-line reason.
- **VO:** "Google gets me the obvious ones. Exa takes one good hit and finds pages like it — that is where the ones nobody has heard of come from. This is reading public pages. Nothing goes out to anyone."
- **ON-SCREEN (callout):** Highlight the list with the evidence URL column.

### [03:50–04:20] Score and push to HubSpot — live, real CRM write

- **VISUAL:** Ask it to score the list and push the fits into HubSpot.
- **VO:** "Now score them against the Builder profile and push the ones that qualify into HubSpot as contacts, with the evidence link on the record."
- **VISUAL:** Confirmation streams; cut to the HubSpot sandbox portal showing the new contact records with the source URL in a property.
- **ON-SCREEN (callout):** Highlight the new HubSpot contact record.

### [04:20–04:50] Draft the public posts

- **VISUAL:** Ask `content-drafter` for three LinkedIn posts about Builders early access.
- **VO:** "Three posts. One about why the program exists. One about what you actually leave with — the working codebase and the Ptah setup that built it. One that just says early access is free and how to get in. In my voice, from my own transcript, not marketing voice."
- **VISUAL:** Drafts stream to `content/posts/`. Scroll one on screen.
- **ON-SCREEN (callout):** Highlight a line that names a real file or real number from the repo — the proof it read the source.

### [04:50–05:30] Draft direct messages — seeded test contacts only

- **VISUAL:** Switch targets explicitly. Point at the three seeded test contacts in the HubSpot sandbox.
- **VO:** "For the direct messages I am not touching the founders we just found — that would be real outreach to real people on camera, and that is not what this is. These three are test contacts I seeded myself. Everything from here targets them."
- **VISUAL:** Ask `outreach-drafter` to write a first message to each, referencing the evidence link on the record.
- **VISUAL:** Three drafts stream into `content/outreach/drafts/`. Each starts with the specific thing that person built.
- **ON-SCREEN (badge, persistent from here):** "Draft only — human approves"

### [05:30–06:00] Approve — queued, not sent

- **VISUAL:** Open one draft. Edit a line that reads templated. Run the approve command; the file moves to `content/outreach/queued/`.
- **VO:** "I read every one before it moves. Approve does not send — it queues. What is queued I paste into LinkedIn myself, by hand, later. Nothing leaves Ptah on its own."
- **ON-SCREEN (callout):** Highlight the `queued/` folder. No "sent" state appears anywhere.

### [06:00–06:30] CTA / End screen

- **VISUAL:** GitHub repository README, then the Builders landing page.
- **VO:** "The whole team is in the repo — the prompt that built it and the harness it produced. Ptah is open source; if you want to use it or work on it with me, the code is there. And if you build SaaS on TypeScript and want to build one with me over eight weeks, Builders early access is free. Link is below. You can decide if that fits how you work."
- **ON-SCREEN:** End card — Ptah logo · repo URL · "Ptah Builders — early access, free → [VERIFY URL]".

---

## The harness builder prompt

Exact text to paste into the AI Team Builder on camera:

```
Be the growth lead for Ptah Builders, a free early-access program where
solo founders and small teams build a production SaaS with me over eight
weeks using Ptah, an open-source coding orchestra.

Ideal profile: solo founders and teams of one to five who build SaaS on
TypeScript — Nx workspaces, NestJS, Angular or React, Prisma — and who
write about their work in public: blog posts, GitHub READMEs, LinkedIn
articles, Show HN posts.

Build five subagents:
- founder-finder — runs web searches to find people matching the profile.
  Use Google search for keyword queries and Exa for "find pages like this
  one" from the good hits. Every result must carry the URL that proves
  the fit.
- fit-analyst — reads each result and scores it against the profile with
  a one-line reason. Drops anyone without public evidence.
- crm-sync — pushes qualified people into HubSpot as contacts, with the
  evidence URL stored on the record.
- content-drafter — writes LinkedIn posts about Builders early access in
  my voice. Read my voice rules from the skill before writing. Output to
  content/posts/.
- outreach-drafter — writes short first messages to specific contacts,
  each opening with the concrete thing that person built. Output to
  content/outreach/drafts/.

Use only what is already wired: Ptah web search and the connected HubSpot
server. Give each subagent only the tools it needs.

Draft-only, always. No subagent may have any tool that sends, enrolls,
sequences, or emails. Every message is a file in drafts/ and stops there.
I approve by hand and move it to queued/. Build the team so that is the
only way a message can ever leave.
```

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, model badge, HubSpot tile, web search connected.
2. Settings → Web Search: provider dropdown, Serper connected. Connected Apps: HubSpot "Connected".
3. Setup Hub → "AI Team Builder" card → builder opens.
4. Paste the growth-harness prompt; scroll ICP / five subagents / draft-only clause.
5. Submit; build streams — tool detection, subagent + skill proposals, config preview filling in.
6. Subagents appearing — lower-thirds per agent.
7. "Configuration looks ready to apply" → Apply to Workspace.
8. Open `.claude/agents/outreach-drafter.md` — highlight the `tools:` line, no send tool present.
9. Live: founder discovery — Serper queries, then Exa fan-out — callout on the evidence URL column.
10. Live: score + push to HubSpot — cut to sandbox showing new contact records with source URL.
11. Live: three LinkedIn posts drafted to `content/posts/` — callout on a real file or number.
12. Switch targets to seeded test contacts — explain on camera why.
13. Live: three first messages drafted to `content/outreach/drafts/` — badge on.
14. Review + edit one draft, approve — file moves to `queued/`. No "sent" state.
15. GitHub repository README, Builders landing page.
16. End card.

## [VERIFY] flags

- **Two search providers at once.** `web-search-config.component.ts` holds one active provider for `ptah_web_search`. Confirm whether the harness can reach Serper and Exa in the same run. If not, connect Exa as a separate MCP server through Connected Apps, or record the discovery scene per provider and cut between. Do not fake a single tool that does both.
- **Free early-access path.** The Seshat `OPERATIONS.md` ledger shows the launch gate (`BUILDERS_CHECKOUT_ENABLED`) still off and the Builders group synced from Paddle webhooks. A free Builder needs a provisioning path that does not go through checkout. Confirm it exists and works before the video is public. Record this decision in `D:\projects\seshat\OPERATIONS.md` as D5.
- **Offer wording.** Seat count, duration of "early access", and the landing URL. Do not say "limited" without a real limit.
- **Course state.** As of 2026-08-25 no week module is authored (`OPERATIONS.md` curriculum table). Say the course is authored with the first cohort. Do not show or promise finished modules.
- **The subagent tool allowlist is real enforcement, with two preconditions.** `HarnessSubagentDesignService.designSubagentFleet` (`libs/backend/rpc-handlers/src/lib/harness/ai/harness-subagent-design.service.ts`) requires a `tools: string[]` per subagent. `HarnessAgentFileWriterService.composeAgentFile` (`libs/backend/rpc-handlers/src/lib/harness/config/harness-agent-file-writer.service.ts:75-86`) writes it into the frontmatter only `if (tools.length > 0)` — an empty array omits the line and grants every tool. (1) Confirm the array is non-empty for `outreach-drafter`. (2) This is the Claude Code subagent-file convention; it holds only if the orchestrator is a Claude Code session. Other CLI providers are not guaranteed to honor `tools:` the same way. The config preview (`harness-config-preview.component.ts`) shows subagent names only, so the only place to film the allowlist is the written file after Apply.
- **HubSpot sandbox scopes.** Confirm a free developer portal grants read + write on contacts and companies on record day. Confirm the custom property for the evidence URL exists in the sandbox.
- **Exact on-screen behavior of `proposeConfig` / `createSkill`** in the execution tree — confirm whether they render as discrete cards so the build scene callouts match.
- **Exact Settings → Web Search and Marketplace → Connected Apps navigation paths** and the strings to type on camera. `oauth-surface.component.ts` ships quick-connect chips for Sentry / Notion / Linear only — HubSpot is pasted by URL.
- **"AI Team Builder" is the on-screen label** to say aloud, not "harness builder".
- **Search and HubSpot latency.** Pre-warm both. Speed-ramp the discovery and build scenes if slow.
- No real outreach on camera at any point. The "Draft only — human approves" badge stays visible through the whole drafting and approval sequence. No "sent" state may appear in the recording.
