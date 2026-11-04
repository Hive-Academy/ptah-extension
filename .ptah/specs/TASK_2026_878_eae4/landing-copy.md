# Landing copy below the hero

Audience: a developer who already trusts the hero. Outcome: reach Download. Voice: the hero’s short sentences. Eight sections. Hero copy and the hero video stay as they are.

Public fields are the only words for the page. `Sources`, `Anchors`, and `Note` stay internal. No F-IDs, paths, or sample numbers on the page.

---

## S1 · command-center

**Anchors:** `#command-center` `#features`

**Eyebrow:** On your desktop

**Headline:** One rail. Nine running. One bell.

**Subline:** Twenty session tiles per workspace. Answer a permission or a question from the bell without leaving the thread.

**Points:**

1. Twenty tiles. Nine may run together.
2. The bell splits needs-you from notices.
3. Git changes beside chat. Foreign trees stay read-only.

**Visual:** `apps/ptah-landing-page/public/assets/live-demo/command-center.mp4` (poster `command-center.jpg`)

**Sources:** F20 session rail (20 tiles, 9 running, not a grid). F25 attention bell (“Needs you” / “Recent notices”). F27 git review dock (Changes, Commit, Task, History; foreign-worktree Changes is read-only). README “Desktop command center.”

---

## S2 · voice-and-apps

**Anchors:** `#voice-and-apps`

**Eyebrow:** Title bar

**Headline:** Talk to the work. Use the app.

**Subline:** Voice is a spoken stage of the work on the desktop. Apps builds a form, chart, or table in its own chat.

**Points:**

1. Interrupt it. It speaks briefly, then hands the rest off.
2. Voice off until set. Local Whisper, Kokoro; ElevenLabs optional.
3. Fixed parts only. Not HTML you write.

**Visual:** `apps/ptah-landing-page/public/assets/live-demo/command-center.mp4` (poster `command-center.jpg`)

**Note:** Same clip as S1. The live-demo set has no separate Voice or Apps file.

**Sources:** F21. Voice is a title-bar tab (`electron-shell.component.ts`, view `command-center`), desktop only. Interrupt: `command-voice-hud.component.ts` and `interruptSpeech` in `command-voice-loop.ts` (spec covers the control). Short reply, then the rest is handed off: `command-center-persona.ts` (“1-2 plain spoken sentences”; delegations), asserted in `command-center-persona.spec.ts`. Chip stays “Voice unavailable” until both speech-to-text and text-to-speech exist (`command-center-page.component.ts`). Local engines are Whisper (`whisper-pipeline.ts`) and Kokoro (`kokoro-pipeline.ts`). ElevenLabs is optional in `voice-provider-registry.ts` and needs a key. Do not say offline or no-network. This tab is not a gateway voice note. F22. Apps is the next title-bar tab (`openApps`). The prompt puts a form, chart, or table beside that conversation (`apps-system-prompt.ts`). The catalog is closed (`surface-catalog.ts`): fixed kinds, not arbitrary HTML. “Its own chat” means that Apps conversation, not the coding chat, and not a privacy claim.

---

## S3 · decision-model-loop

**Anchors:** `#decision-model-loop`

**Eyebrow:** Who runs it

**Headline:** How Ptah decides the work.

**Subline:** A fast model proposes the job. Ninety days of local results, plus hard rules, shape who runs it.

**Diagram:**

1. Classify type and depth
2. Fast model, 3-second abort
3. Blend 90-day evidence
4. Drop same-family review
5. Routing reminder in chat
6. Check files, feed back

**Sentence:** Declared files count only when each one exists, is not empty, and was modified at or after the run started; the same agent cannot review its own run; and those rates update the 90-day evidence.

**Visual:** diagram (closed loop: step 6 returns to step 3)

**Sources:** F01, F02, F10. README “How Ptah decides who does the work,” steps 1–6. Task types and depths, the 3-second client abort, the 90-day matrix blended with a seed prior, the same-family review ban, the overridable routing reminder when host routing is on, and the file checks are in that section. The seed prior is not named on the page.

---

## S4 · tribunal

**Anchors:** `#tribunal`

**Eyebrow:** In the chat

**Headline:** Several vendors debate one call.

**Subline:** Ask in the chat you already have. It is not a separate screen.

**Points:**

1. Vendors review or debate one decision.
2. You confirm the panel before it starts.
3. Too few vendor families, and it says so.

**Visual:** `apps/ptah-landing-page/public/assets/live-demo/tribunal-council.mp4` (poster `tribunal-council.jpg`)

**Sources:** F08. `plugins/ptah-core/skills/tribunal/SKILL.md`: chat skill; panel of installed vendors; user confirms before any spawn; fewer than two families is said out loud and is not a tribunal. Owner decision: feature it, and do not describe a Tribunal screen. Mode names (Council, Forge, Race, Crucible, Relay) stay off the page.

---

## S5 · multi-vendor

**Anchors:** `#multi-vendor-orchestration`

**Eyebrow:** Beside the chat

**Headline:** Claude or Codex up front.

**Subline:** Background work uses the command-line agents already installed on your machine.

**Points:**

1. Up to three child chats, each in a worktree.
2. A new chat can adopt work still running.
3. Past 150,000 tokens or 10 idle minutes: fresh brief.

**Visual:** `apps/ptah-landing-page/public/assets/live-demo/multi-agent.mp4` (poster `multi-agent.jpg`)

**Sources:** F03 main chat on Claude’s agent runtime or Codex’s app-server (no mid-session carry-over claim). F04 installed CLIs; steer can be unsupported. That steer point left the page so the resume gate could take the third slot. F05 up to three child sessions, each with its own worktree. F06 a new chat can adopt in-flight lanes. F12 `RESUME_GATE_MAX_CONTEXT_TOKENS = 150_000` and `RESUME_GATE_MAX_IDLE_MS = 600_000` in `lane-resume-gate.ts`: over either limit the decision is `fresh` (a fresh lane with a short brief). README “Multi-vendor orchestration.” Cache weights, the 85% budget warning, idle compaction, and “refused before it starts” left with the cost section.

---

## S6 · memory-and-skills

**Anchors:** `#memory-intelligence` `#the-onboarding-problem` `#skills-orchestration`

**Eyebrow:** On this machine

**Headline:** It remembers. You apply the diff.

**Subline:** Memory stays local. A skill file changes only when you apply it.

**Points:**

1. Keywords and vectors, keywords if vectors fail.
2. Named corpora can prime a session.
3. Symbol hits can include a coverage receipt.

**Visual:** diagram

**Note:** `apps/ptah-landing-page/public/assets/images/showcase/sim-thoth-memory.webp` exists, but it is outside the allowed still set. Use a diagram unless that still is copied into an allowed path.

**Sources:** F34 hybrid search with BM25 fallback when vectors are unavailable. F35 named corpora (needs a workspace and a session). F37 skill diff writes only on Apply; nothing promotes itself. F41 coverage receipt, which can be unknown on the first index. README “Memory and skills.”

---

## S7 · always-on

**Anchors:** `#always-on`

**Eyebrow:** Off the desk

**Headline:** Hand the live chat to your phone.

**Subline:** Pair Telegram, Discord, or Slack. The desktop composer locks until you take it back.

**Points:**

1. No binding yet: the control stays disabled.
2. Session switching is Discord only.
3. Catch-up within a day: none, last, or all.

**Visual:** diagram

**Sources:** F39 Electron hand-off to an approved binding; desktop tab stays read-only until taken back; control stays visible and disabled with a reason when nothing is paired. Discord list/switch commands are not claimed for Telegram or Slack. F40 local schedules; catch-up inside 24 hours; policy `none`, `last`, or `all`. README “From your phone, and on a schedule.”

---

## S8 · providers

**Anchors:** `#providers`

**Eyebrow:** Your accounts

**Headline:** Bring the accounts you already have.

**Subline:** A named Claude account is certified before launch, and the live subscription is checked.

**Points:**

1. Claude, Codex, Copilot, OpenRouter, Ollama.
2. Named Claude accounts stay on their own.
3. First run reads the repo. You pick the team.

**Visual:** `apps/ptah-docs/public/screenshots/setup-hub.png`

**Note:** Copy this still into landing `public/assets/` before shipping. The OpenRouter “200+” figure is the chip already on the page; this draft does not repeat it.

**Sources:** F19 named Claude accounts certified before launch or resume; first init checks the live subscription. F29 setup hub: workspace analysis and an AI team builder. Provider names from `provider-strip.component.ts` and README. F18 key-rotation proxies are omitted (too much mechanism for one line). Plan windows, shown only when the provider reports them, left with the cost section. The resume-gate line is on S5.

### Final CTA

**Anchors:** `#cta`

**Headline:** Free. No account. No license key.

**Line:** MIT license. No trial and no credit card.

**Buttons:**

| Label | URL |
| --- | --- |
| Download PtahCode | `/download` |
| Read the docs | `https://docs.ptah.live` |

**Sources:** Owner decision: “Free, no account, no license key” is true. Hero footnote already says “No account, no license key, no credit card.” README: MIT, no trial, no credit card. Download route and docs URL from `navigation.component.ts` and `footer.component.ts`. Download page offers Windows, macOS, and Linux when a build exists; this line does not promise a file for every OS.

---

## Word count

Public words only (eyebrow, headline, subline, points or diagram labels, the decision sentence, CTA line and button labels). Hyphenated words count as one. `command-line` is one word.

| Section | Public words |
| --- | ---: |
| S1 command-center | 47 |
| S2 voice-and-apps | 57 |
| S3 decision-model-loop | 78 |
| S4 tribunal | 42 |
| S5 multi-vendor | 45 |
| S6 memory-and-skills | 41 |
| S7 always-on | 44 |
| S8 providers | 43 |
| Final CTA | 19 |
| **Total** | **416** |

S2 breaks down as eyebrow 2, headline 7, subline 22, points 10 + 9 + 7.

S3 breaks down as eyebrow 3, headline 5, subline 18, six labels 22, sentence 30.

S5 breaks down as eyebrow 3, headline 5, subline 11, points 9 + 8 + 9. The third point replaced “Some lanes steer. Others say they cannot.” (7 words).

---

## Decisions

1. **Decision:** Eight sections below the hero: desktop, decision loop, tribunal, multi-vendor, memory and skills, cost, phone, providers. The CTA closes the providers band.
   **Options:** Keep the draft’s nine sections; fold tribunal into multi-vendor; drop cost or phone.
   **Evidence:** The density cap is 6–8 and requires a dedicated decision section. Tribunal has its own clip and an owner order to feature it. Voice, Apps, harness sync, and cache weights lost the cut.
   **Reversible:** Yes. Voice and Apps can return as a ninth section only if the cap is raised.

2. **Decision:** Tribunal is three points plus the council clip, not a mode menu and not a screen.
   **Options:** Name Council, Forge, Race, Crucible, and Relay; leave Tribunal only in the hero.
   **Evidence:** Owner: it ships as a chat skill; do not describe a dedicated screen. The skill confirms the panel, the confirmation step, and the fewer-than-two-families stop.
   **Reversible:** Yes. A later pass can add one mode name if the owner wants a specific story.

3. **Decision:** Do not say you can switch Claude and Codex mid-session and keep the workspace.
   **Options:** Keep the draft’s switch line; say only which runtime the main chat sits on.
   **Evidence:** `design-spec-review.md` finding 5. The carry-over projector was not confirmed. README says the main chat can sit on either runtime.
   **Reversible:** Yes, after that projector is confirmed.

4. **Decision:** Cost copy is Ptah’s own gates. No competitor sentence, no sample window percents, no “save 90%.”
   **Options:** Keep the draft’s “most agent hosts…” subhead; print 0.1× weights as savings.
   **Evidence:** Review findings 4 and 6. Claims to verify: weights are code rules, not a billing study. 150,000 and 10 minutes are constants in `lane-resume-gate.ts`. 85% is `NEAR_BUDGET_RATIO`.
   **Reversible:** Yes, if a measured bill is added later. Do not invent one.

5. **Decision:** “Free. No account. No license key.” is the CTA headline. Docs stay the only secondary button.
   **Options:** Repeat “Free, Forever / No Credit Card, Ever”; add a VS Code Marketplace button; use `docs.ptahcode.com` or `github.com/ptahcode/ptah`.
   **Evidence:** Owner override. Live links are `/download`, `https://docs.ptah.live`, and `https://github.com/Hive-Academy/PtahCode` (`navigation.component.ts`, `footer.component.ts`). Review finding 1 forbids the marketplace link and the wrong hosts.
   **Reversible:** Yes, if the owner wants GitHub as a third button. Community links stay in the existing nav and footer, not in this CTA.

6. **Decision:** Drop Voice, Apps, the vibe-coded chart, Demo vs Production, Multi-Tenant Isolation, Billing Correctness, the lifecycle rail, and the drag-and-resize grid.
   **Options:** Give Voice a conditional section; keep the comparison meter with new rows.
   **Evidence:** Owner approved those removals. Voice stays off until STT and TTS are configured, and local speech must not be called offline (Claims to verify). That condition does not fit a 22-word subline without becoming the whole section.
   **Reversible:** Yes for Voice and Apps. The removed comparison rows should not return without new evidence.

7. **Decision:** Memory’s visual is a diagram, not the Thoth webp, and docs screenshots are named with a copy note.
   **Options:** Cite `sim-thoth-memory.webp` anyway; invent stills.
   **Evidence:** The task allows live-demo video, `apps/ptah-docs/public/screenshots/*.png`, or a diagram. The webp is real but outside that set. `chat-cost-bar.png` and `setup-hub.png` exist; the landing app cannot serve the docs folder (review, Assets).
   **Reversible:** Yes, once those files are copied into landing `public/assets/`.

8. **Decision:** Voice and Apps is S2, and the cost section is gone. One cost fact remains, as the third point on multi-vendor (S5): past 150,000 tokens or 10 idle minutes, a lane starts from a fresh brief. This supersedes the cost slot in decision 1, the cost-section framing in decision 4, and the Voice cut in decision 6.
   **Options:** Put “plan windows, when the provider reports them” on providers; keep cost as a ninth section; leave Voice off the page.
   **Evidence:** The ask keeps eight sections plus the CTA and places `voice-and-apps` after command-center. F21 and F22 checked in this worktree: title-bar Voice and Apps, interrupt, one or two spoken sentences, local Whisper and Kokoro, optional ElevenLabs, the tab off until both speech sides exist, and a closed Apps catalog. `lane-resume-gate.ts` is the old section’s headline fact (`150_000`, `600_000` ms, decision `fresh`). Plan windows are weaker as the single surviving line because they appear only when a provider reports them. Public copy says local, not offline. Steer can still be unsupported; that point moved to Sources to keep three points.
   **Reversible:** Yes. Cost can return as its own section if the cap rises.
