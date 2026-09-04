# Ptah Builders Growth Harness — Assets and Welcome Scene

This document supplements [ptah-builders-growth-harness.md](file:///D:/projects/ptah-extension/docs/video-scripts/ptah-builders-growth-harness.md) with an upfront welcome scene, a comprehensive asset specification, and a production brief.

---

## 1. Welcome / overview section (new opening scene, to be inserted after the cold open, ~30-40 seconds)

### Purpose

Set a clear baseline with the audience about what will happen in the video so nobody is surprised later. It maps out the seven concrete steps, explains the boundaries upfront, and confirms that Ptah Builders early access is free.

### Placement & Timing

- **Insertion point:** Immediately after the cold open ([00:00–00:25]), before "[00:25–00:55] What is already wired".
- **Target duration:** ~30–40 seconds. The welcome scene occupies [00:25–01:00].
- **Timestamp shift:** Every scene after the cold open moves later by 35 seconds once this scene is inserted. The asset brief below uses the base script timestamps for `OVERLAY-02` onward. Add 35 seconds to each of them in the final cut. Only `OVERLAY-01-TIMELINE-STRIP` uses the shifted timeline.

### VISUAL

Ptah Desktop stays on screen. The chat interface dims slightly with a subtle dark backdrop. A clean, horizontal 7-step timeline strip animates across the center-upper section of the viewport. Each of the seven steps illuminates in sequence as the narration covers it:

1. Search tools (Google via Serper, Exa semantic) + HubSpot connected.
2. AI Team Builder designs five subagents (`founder-finder`, `fit-analyst`, `crm-sync`, `content-drafter`, `outreach-drafter`).
3. Live founder discovery across public web sources.
4. Score leads and push qualified contacts into HubSpot with evidence URLs.
5. Draft three LinkedIn posts in the founder's voice.
6. Draft direct messages targeting seeded test contacts only.
7. Review and approve one message into `queued/` (never sent).

Below the timeline strip, three small safety callout pills light up: `Draft-only pipeline`, `Zero automated sends`, `Free early access`. As the section ends, the timeline strip smoothly docks into a minimized progress indicator at the top edge of the screen and the interface returns to full brightness.

### ON-SCREEN Timeline Graphic Description

A horizontal 7-step timeline strip styled using `brand.config.ts values`.

- **Layout:** 7 rectangular milestone cards connected by a thin horizontal track.
- **Card contents:** Number (1–7), step label, and sub-label.
- **Labels:**
  1. `1. Search & CRM` — Serper, Exa, HubSpot already wired
  2. `2. AI Team Builder` — 5 subagents designed from prompt
  3. `3. Founder Discovery` — Live search on public web
  4. `4. Score & Push` — HubSpot CRM write with evidence URL
  5. `5. Public Posts` — 3 LinkedIn drafts to `content/posts/`
  6. `6. Direct Messages` — Seeded test contacts only
  7. `7. Review & Approve` — Move to `queued/`, zero sends

### VO (English) — about 95 words, fits 35 seconds at the style-guide pace

"Before I build anything, here is what happens in this video. Search and HubSpot are already wired. I describe the job to the AI Team Builder and it designs five subagents. Then I run it live: find founders, score them and push the fits into HubSpot, draft three LinkedIn posts, and draft first messages. Basically, every message stays a draft until I read it. Approve moves a file to queued. Nothing is sent on camera. The direct messages go to three test contacts I seeded myself. And Ptah Builders early access is free."

### VO (Egyptian Arabic — عامية مصرية)

"قبل ما أبني أي حاجة، ده اللي هيحصل في الفيديو. الـ search وHubSpot متوصّلين أصلاً. أنا بوصف الشغل للـ AI Team Builder وهو بيصمّم خمس subagents. بعدين بشغّله live: بنلاقي founders، بنديهم score وبنحط المناسبين في HubSpot، بنكتب تلات LinkedIn posts، وبنكتب أول الرسايل. يعني، كل رسالة بتفضل draft لحد ما أقراها. الـ approve بينقل الملف لـ queued. مفيش حاجة بتتبعت على الكاميرا. الرسايل المباشرة بتروح لتلات test contacts أنا حطيتهم بنفسي. والـ early access بتاع Ptah Builders ببلاش."

---

## 2. Asset brief

### Visual Style Notes

- **Colors:** Do not hardcode ad-hoc palette values. Use `brand.config.ts values` across all overlays.
  - Background surface for cards/badges: `BRAND.theme.bgDeep` (`#0e1015`) with subtle border in `BRAND.theme.textFaint`.
  - Accent for callouts, highlights, and focus borders: `BRAND.theme.amber` (`#f5a524`) or `BRAND.theme.amberLight` (`#ffbb4d`).
  - Accent for the persistent "Draft only — human approves" safety badge: `BRAND.theme.emerald` (`#34d399`) or `BRAND.theme.amber` (`#f5a524`).
  - Primary text: `BRAND.theme.textStrong` (`#ffffff`).
  - Secondary text: `BRAND.theme.textSoft` (`rgba(255,255,255,0.72)`).
- **Typography:** `BRAND.theme.font` (Inter, Segoe UI, system-ui). Monospace numbers and file paths (`ui-monospace`, Menlo, Consolas).
- **Motion:** Clean 200ms ease-out slide or fade. No distracting bounces.

### Overlay Specifications

#### Asset ID: `OVERLAY-01-TIMELINE-STRIP`

- **Type:** Timeline strip.
- **Exact text:**
  - Step 1:
    - EN: `1. Search & CRM (Serper + Exa + HubSpot)`
    - AR: `١. أدوات البحث وCRM (Serper + Exa + HubSpot)`
  - Step 2:
    - EN: `2. AI Team Builder (5 Subagents Designed)`
    - AR: `٢. AI Team Builder (تصميم ٥ subagents)`
  - Step 3:
    - EN: `3. Live Discovery (TypeScript SaaS ICP)`
    - AR: `٣. استكشاف المؤسسين (TypeScript SaaS)`
  - Step 4:
    - EN: `4. Score & Push (HubSpot CRM + URL)`
    - AR: `٤. تقييم وإضافة (HubSpot + لينك الإثبات)`
  - Step 5:
    - EN: `5. Draft Public Posts (3 LinkedIn Drafts)`
    - AR: `٥. مسودات المحتوى (٣ بوستات LinkedIn)`
  - Step 6:
    - EN: `6. Draft Direct Messages (Seeded Test Contacts)`
    - AR: `٦. مسودات الرسايل (بيانات تجريبية Seeded)`
  - Step 7:
    - EN: `7. Approve = Queued (Zero Sends)`
    - AR: `٧. موافقة = في الانتظار (بدون إرسال)`
  - Safety Pills:
    - EN: `Draft-only pipeline · Zero automated sends · Free early access`
    - AR: `مسودات فقط · مفيش إرسال تلقائي · التسجيل المبكر مجاني`
- **Timestamps:** Appears at 00:25; disappears at 01:00 (Welcome scene).
- **Position on screen:** Center screen, upper-third (Y: 280px).
- **Size hint:** 1680px width, 140px height.
- **State:** Starts full center. Active node pulses as spoken. Slides into a 32px top-docked mini-bar at 00:58.

#### Asset ID: `OVERLAY-02-CAPTION-SEARCH-HUBSPOT`

- **Type:** Caption / lower-third.
- **Exact text:**
  - Part A:
    - EN: `Google via Serper · Exa semantic — built in`
    - AR: `Google عن طريق Serper · Exa semantic — جوه Ptah`
  - Part B:
    - EN: `HubSpot — OAuth, zero manual config`
    - AR: `HubSpot — OAuth، صفر إعداد يدوي`
- **Timestamps:** Appears at 00:25 (base script timestamp, or ~01:00 with welcome scene); Part A holds 15 seconds, Part B holds 15 seconds; disappears at 00:55.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 480px width, 52px height.
- **State:** Fade in, switch text smoothly between Part A and Part B, fade out.

#### Asset ID: `OVERLAY-03-LOWERTHIRD-FOUNDER-FINDER`

- **Type:** Lower-third.
- **Exact text:**
  - EN: `Subagent: founder-finder · Web Search & Discovery`
  - AR: `وكيل: founder-finder · البحث والاستكشاف على الويب`
- **Timestamps:** Appears at 02:00; disappears at 02:08.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 420px width, 56px height.
- **State:** Slide in from left, hold, dissolve into next subagent lower-third.

#### Asset ID: `OVERLAY-04-LOWERTHIRD-FIT-ANALYST`

- **Type:** Lower-third.
- **Exact text:**
  - EN: `Subagent: fit-analyst · ICP Scoring & Qualification`
  - AR: `وكيل: fit-analyst · تقييم ومطابقة معايير البرنامج`
- **Timestamps:** Appears at 02:08; disappears at 02:16.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 420px width, 56px height.
- **State:** Slide in from left, hold, dissolve into next subagent lower-third.

#### Asset ID: `OVERLAY-05-LOWERTHIRD-CRM-SYNC`

- **Type:** Lower-third.
- **Exact text:**
  - EN: `Subagent: crm-sync · HubSpot Contact Sync`
  - AR: `وكيل: crm-sync · مزامنة جهات الاتصال مع HubSpot`
- **Timestamps:** Appears at 02:16; disappears at 02:24.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 420px width, 56px height.
- **State:** Slide in from left, hold, dissolve into next subagent lower-third.

#### Asset ID: `OVERLAY-06-LOWERTHIRD-CONTENT-DRAFTER`

- **Type:** Lower-third.
- **Exact text:**
  - EN: `Subagent: content-drafter · Public LinkedIn Content`
  - AR: `وكيل: content-drafter · مسودات منشورات LinkedIn العامة`
- **Timestamps:** Appears at 02:24; disappears at 02:32.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 420px width, 56px height.
- **State:** Slide in from left, hold, dissolve into next subagent lower-third.

#### Asset ID: `OVERLAY-07-LOWERTHIRD-OUTREACH-DRAFTER`

- **Type:** Lower-third.
- **Exact text:**
  - EN: `Subagent: outreach-drafter · Seeded Contact Outreach`
  - AR: `وكيل: outreach-drafter · مسودات الرسايل لجهات الاتصال التجريبية`
- **Timestamps:** Appears at 02:32; disappears at 02:40.
- **Position on screen:** Bottom-left (X: 80px, Y: 940px).
- **Size hint:** 420px width, 56px height.
- **State:** Slide in from left, hold, fade out on scene transition.

#### Asset ID: `OVERLAY-08-CALLOUT-ALLOWLIST-TOOLS`

- **Type:** Callout box.
- **Exact text:**
  - EN: `Every subagent gets its own allowlist. No send tool present.`
  - AR: `كل subagent له صلاحيات محددة. مفيش أي أداة إرسال.`
- **Timestamps:** Appears at 02:45; disappears at 03:00.
- **Position on screen:** Anchored over code editor line `tools:` in `.claude/agents/outreach-drafter.md` (approx. X: 640px, Y: 320px).
- **Size hint:** 460px width, 72px height callout box with accent pointer.
- **State:** Highlight rectangle surrounds `tools:` frontmatter line with border color from `brand.config.ts values`. Text card floats above line.

#### Asset ID: `OVERLAY-09-CALLOUT-EVIDENCE-URL`

- **Type:** Callout box.
- **Exact text:**
  - EN: `Public evidence link required for qualification`
  - AR: `رابط الإثبات العام مطلوب للتأهيل`
- **Timestamps:** Appears at 03:30; disappears at 03:45.
- **Position on screen:** Anchored over discovery results table, evidence URL column (approx. X: 980px, Y: 520px).
- **Size hint:** 380px width, 60px height.
- **State:** Glowing border around evidence column; tooltip box pointing to URL.

#### Asset ID: `OVERLAY-10-CALLOUT-HUBSPOT-RECORD`

- **Type:** Callout box.
- **Exact text:**
  - EN: `Live CRM write: Contact record + evidence URL property`
  - AR: `كتابة حية في CRM: جهة الاتصال + رابط الإثبات`
- **Timestamps:** Appears at 04:05; disappears at 04:18.
- **Position on screen:** Anchored over HubSpot sandbox contact view (approx. X: 720px, Y: 440px).
- **Size hint:** 440px width, 64px height.
- **State:** Rectangular focus outline on contact properties panel; callout pill above.

#### Asset ID: `OVERLAY-11-CALLOUT-GROUNDING-PROOF`

- **Type:** Callout box.
- **Exact text:**
  - EN: `Grounded in real repository code and metrics`
  - AR: `مبني على أرقام وملفات حقيقية من المشروع`
- **Timestamps:** Appears at 04:35; disappears at 04:48.
- **Position on screen:** Anchored over opened draft in `content/posts/` (approx. X: 620px, Y: 480px).
- **Size hint:** 400px width, 60px height.
- **State:** Soft highlight on lines containing actual repository statistics and file paths.

#### Asset ID: `OVERLAY-12-BADGE-DRAFT-ONLY`

- **Type:** Badge (persistent).
- **Exact text:**
  - EN: `Draft only — human approves`
  - AR: `Draft بس — بني آدم بيوافق`
- **Timestamps:** Appears at 04:50; disappears at 06:00.
- **Position on screen:** Top-right corner (X: 1540px, Y: 40px).
- **Size hint:** 320px width, 44px height pill.
- **State:** Persistent across cuts from 04:50 through 06:00. Gentle pulse on entry; remains pinned with solid high-contrast border.

#### Asset ID: `OVERLAY-13-CALLOUT-QUEUED-FOLDER`

- **Type:** Callout box.
- **Exact text:**
  - EN: `Moved to content/outreach/queued/ · No automated sends`
  - AR: `تم النقل إلى content/outreach/queued/ · بدون إرسال تلقائي`
- **Timestamps:** Appears at 05:45; disappears at 05:58.
- **Position on screen:** Anchored over file explorer showing `content/outreach/queued/` (approx. X: 260px, Y: 460px).
- **Size hint:** 460px width, 64px height.
- **State:** Highlight box around `queued/` folder icon. Green dot status indicator.

#### Asset ID: `OVERLAY-14-END-CARD`

- **Type:** End card.
- **Exact text:**
  - Header: Ptah Logo + Wordmark
  - Line 1:
    - EN: `GitHub: github.com/Hive-Academy/ptah-extension`
    - AR: `GitHub: github.com/Hive-Academy/ptah-extension`
  - Line 2:
    - EN: `Ptah Builders — early access, free → [VERIFY URL]`
    - AR: `Ptah Builders — early access، ببلاش ← [VERIFY URL]`
  - The GitHub URL matches the `origin` remote of this repository. The Builders landing URL is not in this repository. Do not put a URL on the card until the script's "Offer wording" VERIFY item is closed.
- **Timestamps:** Appears at 06:00; disappears at 06:30.
- **Position on screen:** Full-screen centered card (1920x1080px).
- **Size hint:** Centered card with 800px content block.
- **State:** Fade in from desktop view; persistent call-to-action button; fade to black.

---

## 3. Production brief

### Video Goal

Demonstrate Ptah's AI Team Builder by creating an automated growth harness that identifies solo founders and small teams building SaaS on TypeScript, syncs qualified leads into HubSpot, and drafts tailored public posts and direct messages for Ptah Builders early access.

### Target Audience

Solo founders and 1–5 person development teams building SaaS products on TypeScript (Nx workspaces, NestJS, Angular or React, Prisma).

### Runtime

- **Base script:** 5.5–6.5 minutes.
- **With welcome scene:** ~6.0–7.0 minutes.

### Controlling Thesis

I built a coding agent and I am using it to build a SaaS with it. Now I use the same harness builder to run the outreach for the program itself. Search is built in — Google through Serper, Exa for semantic search. A human still approves every message before anything goes out.

### Non-Negotiable Constraints

1. **Draft-only pipeline:** Every message is written as a file to `content/outreach/drafts/` and stops there.
2. **Seeded test contacts:** Direct outreach on camera targets only founder-owned test contacts seeded in the HubSpot sandbox, never real people discovered during search.
3. **HubSpot sandbox:** Use a dedicated HubSpot developer test portal; never touch a live production customer portal.
4. **Zero automated sends:** Subagents have no send, email, enroll, or sequence tools. Approval moves a file from `drafts/` to `queued/`. No "sent" state appears on screen anywhere.
5. **No secret exposures:** Search API keys and OAuth tokens are configured before recording and never typed on screen.

### Deliverable List

1. **Final Master Video:** MP4, 16:9, 1080p, with the Egyptian Arabic voice track and the English voice track delivered as separate versions.
2. **Timeline Graphic:** 7-step horizontal timeline strip asset (`OVERLAY-01-TIMELINE-STRIP`).
3. **Lower-Thirds & Captions:** Search/HubSpot captions (`OVERLAY-02`) and 5 subagent lower-thirds (`OVERLAY-03` through `OVERLAY-07`).
4. **Persistent Safety Badge:** "Draft only — human approves" badge (`OVERLAY-12`).
5. **Callout Highlights:** Code allowlist (`OVERLAY-08`), evidence URL (`OVERLAY-09`), CRM write (`OVERLAY-10`), grounding proof (`OVERLAY-11`), and queued folder (`OVERLAY-13`).
6. **End Card Graphic:** Centered outro asset with logo, GitHub link, and early-access CTA (`OVERLAY-14`).

### Open [VERIFY] Items (Copied from Script)

The following items from [ptah-builders-growth-harness.md](file:///D:/projects/ptah-extension/docs/video-scripts/ptah-builders-growth-harness.md) must be verified and closed before recording:

1. **Two search providers at once:**
   `web-search-config.component.ts` holds one active provider for `ptah_web_search`. Confirm whether the harness can reach Serper and Exa in the same run. If not, connect Exa as a separate MCP server through Connected Apps, or record the discovery scene per provider and cut between. Do not fake a single tool that does both.
2. **Free early-access path:**
   The Seshat `OPERATIONS.md` ledger shows the launch gate (`BUILDERS_CHECKOUT_ENABLED`) still off and the Builders group synced from Paddle webhooks. A free Builder needs a provisioning path that does not go through checkout. Confirm it exists and works before the video is public. Record this decision in `D:\projects\seshat\OPERATIONS.md` as D5.
3. **Offer wording:**
   Seat count, duration of "early access", and the landing URL. Do not say "limited" without a real limit.
4. **Course state:**
   As of 2026-08-25 no week module is authored (`OPERATIONS.md` curriculum table). Say the course is authored with the first cohort. Do not show or promise finished modules.
5. **Subagent tool allowlist preconditions:**
   `HarnessSubagentDesignService.designSubagentFleet` (`libs/backend/rpc-handlers/src/lib/harness/ai/harness-subagent-design.service.ts`) requires a `tools: string[]` per subagent. `HarnessAgentFileWriterService.composeAgentFile` (`libs/backend/rpc-handlers/src/lib/harness/config/harness-agent-file-writer.service.ts:75-86`) writes it into the frontmatter only `if (tools.length > 0)` — an empty array omits the line and grants every tool. (1) Confirm the array is non-empty for `outreach-drafter`. (2) This is the Claude Code subagent-file convention; it holds only if the orchestrator is a Claude Code session. Other CLI providers are not guaranteed to honor `tools:` the same way. The config preview (`harness-config-preview.component.ts`) shows subagent names only, so the only place to film the allowlist is the written file after Apply.
6. **HubSpot sandbox scopes:**
   Confirm a free developer portal grants read + write on contacts and companies on record day. Confirm the custom property for the evidence URL exists in the sandbox.
7. **Execution tree card rendering:**
   Confirm exact on-screen behavior of `proposeConfig` / `createSkill` in the execution tree — confirm whether they render as discrete cards so the build scene callouts match.
8. **Navigation paths:**
   Confirm exact Settings → Web Search and Marketplace → Connected Apps navigation paths and the strings to type on camera. `oauth-surface.component.ts` ships quick-connect chips for Sentry / Notion / Linear only — HubSpot is pasted by URL.
9. **UI Builder nomenclature:**
   "AI Team Builder" is the on-screen label to say aloud, not "harness builder".
10. **Search and HubSpot latency:**
    Pre-warm both. Speed-ramp the discovery and build scenes if slow.
11. **Orchestrator badge:**
    Confirm orchestrator model badge is visible on camera during the cold open and overview.
12. **Workspace folder setup:**
    Open `D:\projects\ptah-growth` as the active workspace before opening the AI Team Builder. Ensure the folder exists and contains a one-line README before recording.
