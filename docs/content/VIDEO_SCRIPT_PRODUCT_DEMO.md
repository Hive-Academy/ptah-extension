# Video Script: Ptah — The AI Coding Orchestra for VS Code

## Metadata

- **Length**: 12-15 minutes
- **Type**: Product Demo + Feature Tour
- **Audience**: VS Code developers who want AI-assisted development
- **Goal**: Show Ptah's full product experience — landing page → docs → live demo → drive installs
- **Tone**: Confident, developer-authentic, positions Ptah as its own product (NOT a Claude Code wrapper)
- **Tagline**: "The AI coding orchestra for VS Code, powered by Claude Agent SDK"

---

## Investigation Summary

### Libraries Reviewed

- `libs/frontend/chat/CLAUDE.md` — 48+ components, ExecutionNode architecture
- `libs/frontend/dashboard/CLAUDE.md` — Real-time metrics, Chart.js
- `libs/frontend/setup-wizard/CLAUDE.md` — 6-step wizard flow
- `libs/backend/vscode-lm-tools/CLAUDE.md` — MCP server, 8 API namespaces
- `libs/backend/workspace-intelligence/CLAUDE.md` — Project detection, file indexing
- `libs/backend/agent-sdk/CLAUDE.md` — SDK integration, 10x performance
- `libs/backend/agent-generation/CLAUDE.md` — Agent generation, plugin system

### Key Files Read

- `apps/ptah-landing-page/src/app/pages/docs/docs-page.component.ts` — 7 doc sections
- All 8 docs section components (installation → orchestration)
- `apps/ptah-landing-page/src/app/sections/hero/hero-content-overlay.component.ts`
- `apps/ptah-landing-page/src/app/sections/comparison/comparison-split-scroll.component.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.html`
- `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/` — all 6 wizard steps

---

## PART 1: LANDING PAGE TOUR (0:00 — 3:00)

---

### HOOK (0:00 — 0:20)

#### Visual

_Browser opens to ptah.live. The hero section loads — dark Egyptian-themed background with hieroglyph circuit patterns, floating symbols with parallax effect. The amber "Ptah" headline fades in with a cinematic slide-up._

#### Narration

"What if your AI coding assistant didn't just sit in a terminal — but could see your workspace, understand your architecture, and orchestrate an entire team of specialized agents? That's Ptah."

#### On-Screen

- Badge pulses: "Powered by Claude Agent SDK"
- Headline: "Ptah" in golden gradient
- Subheadline: "The AI coding orchestra for VS Code..."
- CTA: "Try 14 Days Free — Install Now"

---

### HERO WALKTHROUGH (0:20 — 0:50)

#### Visual

_Camera pans down the hero. Highlight the social proof stats: 12 libraries, 48+ components, 60+ DI tokens, 94 message types._

#### Narration

"Ptah is a full VS Code extension — 12 backend and frontend libraries, 48 components, and 94 message types. This isn't a thin wrapper. It's an entire development platform built on the Claude Agent SDK."

#### Action

_Click "Watch 3-Minute Demo" to smooth-scroll down. Then scroll to the features section._

---

### FEATURES TIMELINE (0:50 — 1:40)

#### Visual

_Scroll through the hijacked-scroll features timeline. Each feature card slides in with GSAP animation._

#### Narration — Feature 1: Recursive Agent Visualization

"When your main agent spawns sub-agents, Ptah shows the entire execution tree in real time. Watch the Software Architect hand off to the Frontend Developer. Inspect every tool call, every file change — all in a glassmorphism UI."

_Source: features-hijacked-scroll.component.ts — Feature card 1_

#### Narration — Feature 2: Code Execution MCP Server

"Ptah includes a built-in MCP server with 15 API namespaces. Your AI agents can query workspace structure, search files, check TypeScript diagnostics, access git status, and execute VS Code commands — all in a single call."

_Source: features-hijacked-scroll.component.ts — Feature card 2_

#### Narration — Feature 3: Intelligent Setup Wizard

"The setup wizard scans your codebase, detects your tech stack, and uses LLM-powered generation to create custom agents tailored to your project. Not generic prompts — actual project-specific rules."

_Source: features-hijacked-scroll.component.ts — Feature card 3_

#### Narration — Feature 4: OpenRouter Model Control

"Choose from 200+ models via OpenRouter. Use Claude for complex reasoning. Switch to DeepSeek or Gemini for cost-effective speed. Override model tiers per task — Opus for architecture, Haiku for quick fixes."

_Source: features-hijacked-scroll.component.ts — Feature card 4_

---

### COMPARISON SECTION (1:40 — 2:20)

#### Visual

_Scroll to "The Ptah Difference" comparison. Left column (red) slides in, then right column (green)._

#### Narration

"Before Ptah — terminal switching breaks your flow. 500ms startup overhead on every interaction. Generic agents with no understanding of your project.

With Ptah — native VS Code integration. 50ms session creation — that's 10x faster. Project-adaptive agents customized to your codebase, your stack, your conventions. And full workspace intelligence across 13+ project types."

#### On-Screen — Performance Metrics

_Highlight the three metric cards:_

| Metric              | Before  | With Ptah | Improvement |
| ------------------- | ------- | --------- | ----------- |
| Session Creation    | 500ms   | 50ms      | 10x faster  |
| First Chunk Latency | 1,000ms | 100ms     | 10x faster  |
| Memory Usage        | 50MB    | 20MB      | 60% less    |

_Source: comparison-split-scroll.component.ts — metrics array_

---

### PRICING (2:20 — 2:50)

#### Visual

_Navigate to /pricing. The pyramid background loads with radial gold glow. The "Try 14 days free today" headline appears with 3D text shadow._

#### Narration

"Ptah has a free tier — forever. Community plan gives you the visual interface, real-time streaming, session history, and basic workspace context. No credit card, no strings.

Pro is five dollars a month. You get the setup wizard, MCP server, workspace intelligence, 200+ models via OpenRouter, project-adaptive agents, and real-time cost tracking. And you start with a 14-day free trial."

#### On-Screen

- Community: Free Forever — "Install Free"
- Pro: $5/month — "Start 14-Day Free Trial"

_Source: pricing-cards.component.ts — plans data_

---

### DOCS TRANSITION (2:50 — 3:00)

#### Visual

_Click "Docs" in the navigation bar. The docs page loads with the hero: "Getting Started" and golden gradient divider._

#### Narration

"Let me walk you through the docs — and then I'll show you everything live in VS Code."

---

## PART 2: DOCS PAGE WALKTHROUGH (3:00 — 6:30)

---

### SECTION 1: INSTALLATION & PRO TRIAL (3:00 — 3:40)

#### Visual

_Scroll to the Installation section. The 3-step cards appear with viewport animations._

#### Narration

"Installation is three steps. One — search 'Ptah' in the VS Code extensions panel or install from the marketplace. Two — create your account at ptah.live/signup. No credit card required. Three — open the Ptah sidebar, sign in, and your Pro trial activates automatically."

#### On-Screen — Steps

1. Install from VS Code Marketplace — search "Ptah" in Extensions (Ctrl+Shift+X)
2. Create your Ptah account — sign up at ptah.live/signup
3. Activate your license — open Ptah sidebar, sign in, Pro trial activates

#### Callout

"Your Pro trial includes all 13 AI agents, orchestration workflows, multi-provider support, the plugin system, and the full setup wizard. Free for 14 days."

_Source: installation-section.component.ts_

---

### SECTION 2: AUTHENTICATION SETUP (3:40 — 4:20)

#### Visual

_Scroll to Authentication section. Show the 4 auth method cards._

#### Narration

"Ptah supports four authentication methods. If you have a Claude Max or Pro subscription, use OAuth — run 'claude setup-token', copy the token, paste it in Ptah's settings.

If you prefer pay-per-token, use an Anthropic API key from the developer console.

Or skip Claude entirely — use a third-party provider like OpenRouter, Moonshot, or Z.AI. Bring your own API key, pay through their billing.

Auto mode tries each method in order and uses the first one that works."

#### On-Screen — Auth Methods

| Method   | Key Format        | Billing                     |
| -------- | ----------------- | --------------------------- |
| OAuth    | `sk-ant-oat01-`   | Claude Max/Pro subscription |
| API Key  | `sk-ant-api03-`   | Anthropic pay-per-token     |
| Provider | Provider-specific | OpenRouter/Moonshot/Z.AI    |
| Auto     | (auto-detect)     | Uses first available        |

_Source: authentication-section.component.ts_

---

### SECTION 3: PROVIDER APIs (4:20 — 5:00)

#### Visual

_Scroll to Provider APIs section. Show the three provider cards and model tier mapping._

#### Narration

"Ptah supports three Anthropic-compatible providers. OpenRouter gives you 200+ models through a single API key — Anthropic, OpenAI, Google, Meta, and more.

Moonshot offers Kimi K2 models with extended thinking and up to 256K context. Z.AI's GLM family includes a free-tier flash model — great for testing.

The key concept is model tier mapping. Ptah has three tiers — Opus, Sonnet, and Haiku. You map each tier to a provider model. When Ptah requests 'Opus-level reasoning,' it routes to whatever model you've configured."

#### On-Screen — Tier Mapping Example

- **Opus** → `kimi-k2` (complex architecture tasks)
- **Sonnet** → `claude-sonnet-4` (everyday coding)
- **Haiku** → `GLM-4.7 Flash` (free, quick tasks)

_Source: providers-api-section.component.ts_

---

### SECTION 4: SETUP WIZARD & PLUGINS (5:00 — 5:40)

#### Visual

_Scroll to Setup Wizard section. Show the 6-step flow diagram._

#### Narration

"The setup wizard is where Ptah gets personal. Click 'Setup Wizard' in the sidebar — or run the command from the palette.

It runs a 4-phase analysis: project profile, architecture assessment, quality audit, and an elevation plan. All powered by Claude, all streamed in real time.

Then it recommends agents based on your detected stack — scored by relevance. An Angular monorepo gets different agents than a Python microservice. You pick which ones to generate. Ptah creates project-specific rule files that make every agent understand your conventions."

#### On-Screen — 6 Steps

1. Scan → 2. Analyze → 3. Detect → 4. Select Agents → 5. Generate Rules → 6. Complete

#### Narration — Plugins

"The plugin browser extends Ptah with additional skills. Browse by category, search by keyword, enable or disable anytime. Plugins inject their capabilities into your generated agents automatically."

_Source: setup-wizard-section.component.ts_

---

### SECTION 5: MCP SERVER (5:40 — 6:10)

#### Visual

_Scroll to MCP Server section. Show the 8 MCP tools grid and 15 API namespace list._

#### Narration

"The MCP server is Ptah's secret weapon. It runs inside the VS Code extension host and gives every AI agent direct access to VS Code internals.

Eight dedicated tools — workspace analysis, file search, live TypeScript diagnostics, LSP references and definitions, unsaved file detection, token counting, and the big one: execute_code. That tool gives Claude access to all 15 ptah APIs. Write TypeScript that queries your workspace, finds references via LSP, checks diagnostics — all in one call."

#### On-Screen — Code Example

```typescript
const project = await ptah.workspace.analyze();
// → { type: "angular-nx", frameworks: ["Angular 20", "NestJS"] }

const errors = await ptah.diagnostics.getErrors();
// → [{ file: "app.ts", line: 42, message: "TS2345: ..." }]

const refs = await ptah.ide.lsp.getReferences('src/auth.ts', 15, 8);
// → Find every file that uses this function
```

_Source: mcp-server-section.component.ts — exampleCode_

---

### SECTION 6: CHAT & DASHBOARD (6:10 — 6:30)

#### Visual

_Scroll to Chat & Dashboard section. Show the execution tree example and feature cards._

#### Narration

"The chat interface renders every agent action as a live execution tree. You see the main agent thinking, spawning sub-agents, calling tools — all nested, all in real time.

Six key features: @agent autocomplete, /command autocomplete, streaming text reveal, session management, real-time cost tracking, and file attachments with fuzzy search.

The dashboard tracks everything: total cost, token usage, session count, and agent performance — filterable by time range, exportable as CSV."

_Source: chat-dashboard-section.component.ts_

---

## PART 3: LIVE DEMO IN VS CODE (6:30 — 12:00)

---

### DEMO INTRO (6:30 — 6:45)

#### Visual

_Switch to VS Code. Clean workspace open (an Angular project). Ptah icon visible in Activity Bar._

#### Narration

"Now let me show you all of this working live. I have an Angular project open — let's set up Ptah from scratch."

---

### DEMO 1: AUTH SETUP (6:45 — 7:30)

#### Visual

_Click Ptah icon → sidebar opens → click gear icon → Settings panel appears_

#### Narration

"First, authentication. I'll click the gear icon to open settings. You can see my license status up top — I'm on the Pro trial.

For auth, I'll use OpenRouter. Select the Provider tab, choose OpenRouter, paste my API key, and click 'Save & Test Connection.'"

#### Action

1. Show the license status card (Pro Trial badge)
2. Scroll to Authentication section
3. Select "Provider" tab
4. Choose "OpenRouter" from dropdown
5. Paste API key
6. Click "Save & Test Connection"
7. Show success message: "✓ Connected"

#### Narration (continued)

"Connected. Now I'll set up my model tier mapping. For Opus — the heavy-lifting tier — I'll use Claude Opus. For Sonnet, Claude Sonnet 4. And Haiku stays as the default for quick tasks."

#### Action

8. Scroll to Provider Model Mapping section
9. Search and select models for each tier
10. Show the model count footer: "142 models available · 89 support tool use"

_Source: settings.component.html, provider-model-selector.component.ts_

---

### DEMO 2: SETUP WIZARD (7:30 — 9:00)

#### Visual

_Click "Setup Wizard" button in sidebar — or show Command Palette: "Ptah: Run Setup Wizard"_

#### Narration

"Now the fun part. I'll run the setup wizard. This is going to scan my entire workspace and configure agents specifically for this project."

#### Step 1: Welcome Screen (7:30 — 7:45)

_Show the welcome screen with 3 feature cards: Deep Analysis, Smart Agents, Quick Setup_

"Three capabilities: a 4-phase AI-powered codebase scan, 13 customized agent templates, and it's ready in under 5 minutes. Let's start."

_Click "Start New Analysis"_

#### Step 2: Scanning Progress (7:45 — 8:15)

_Show the scanning interface: phase stepper on top, dual-column layout below_

"Watch the left column — that's Claude analyzing my project in real time. The right column shows detected technologies as they're found."

_Show live detection badges appearing: "Angular", "TypeScript", "Nx", "TailwindCSS", "Jest", "NestJS"_

"Phase 1 scans the file structure. Phase 2 analyzes architecture patterns. Phase 3 audits code quality. Phase 4 creates an elevation plan. All four phases stream live — you see exactly what Claude is thinking."

_Source: scan-progress.component.ts — 4-phase stepper_

#### Step 3: Analysis Results (8:15 — 8:30)

_Show the multi-phase results — collapsible cards with status icons and durations_

"Here are the results. Project profile detected an Angular Nx monorepo with 18 projects. Architecture assessment found layered patterns with tsyringe DI. Quality audit — clean, a few suggestions. Elevation plan recommends signal-based state management improvements."

_Click "Yes, Continue"_

#### Step 4: Agent Selection (8:30 — 8:45)

_Show agent selection grid — agents grouped by category with relevance scores_

"Ptah recommends agents based on what it detected. Frontend Developer scores 92% — it matched Angular, TailwindCSS, and RxJS. Senior Tester at 88% — it found Jest and E2E patterns. Software Architect at 85% for the monorepo structure.

I'll keep the recommended selection and add the Backend Developer for my NestJS services."

_Toggle agents, show "5 selected | 8 recommended" counter_

#### Step 5: Generation Progress (8:45 — 9:00)

_Show real-time generation — agent activity log on left, per-agent progress on right_

"Now it's generating the rule files. Each agent gets a custom .claude/agents/[name].md file with project-specific context. The plugin system also injects any installed skills into the generated rules."

_Show per-agent progress cards completing: ✓ Complete with durations_

_Source: generation-progress.component.ts_

---

### DEMO 3: FIRST CHAT SESSION (9:00 — 10:00)

#### Visual

_Setup wizard completes → click "Start New Chat" → chat interface opens_

#### Narration

"Setup is done. Let's use these agents. I'll type '@' to see the autocomplete..."

#### Action — Agent Autocomplete

1. Type `@` in chat input
2. Show unified suggestions dropdown: built-in agents + project agents
3. Select `@software-architect`
4. Type: "Analyze this workspace and suggest improvements for the authentication module"

#### Action — Execution Tree

_Message sends. Show the execution tree building in real time:_

```
User: "Analyze this workspace..."
└── software-architect [THINKING...]
    ├── TOOL: ptah_workspace_analyze
    │   └── { type: "angular-nx", frameworks: ["Angular 20", "NestJS"] }
    ├── TOOL: ptah_search_files ("auth")
    │   └── 8 files found
    ├── TOOL: ptah_get_diagnostics
    │   └── 2 warnings in auth.service.ts
    └── Response: "Based on my analysis..."
```

#### Narration

"Watch the execution tree. The software architect calls ptah_workspace_analyze — that's the MCP server giving it your project structure in one call. Then it searches for auth-related files, checks diagnostics for warnings, and delivers a structured analysis.

No manual context. No copy-pasting file paths. The agent just knows your workspace."

_Source: execution-node.component.ts, inline-agent-bubble.component.ts_

---

### DEMO 4: ORCHESTRATION (10:00 — 11:00)

#### Visual

_Start a new message in the same session_

#### Narration

"Now let's see the orchestration workflow. I'll type '/orchestrate' — this is the flagship feature."

#### Action

1. Type `/orchestrate Add OAuth login with Google and GitHub providers`
2. Show the orchestration flow begin

#### Narration

"The orchestrator analyzes the task and delegates to specialized agents. First, the Project Manager scopes the work. Then the Software Architect designs the approach. The Team Leader decomposes into tasks. Developers implement. QA verifies. And you approve at every checkpoint."

#### Visual — Agent Spawning

_Show nested execution tree with multiple agents:_

```
/orchestrate "Add OAuth login..."
└── project-manager [THINKING...]
    ├── Scope: OAuth integration with Google + GitHub
    └── AGENT SPAWN: software-architect
        ├── Design: OAuth2 flow, token storage, guard patterns
        └── AGENT SPAWN: frontend-developer
            ├── TOOL: write-file ("src/auth/oauth.service.ts")
            ├── TOOL: write-file ("src/auth/oauth-callback.component.ts")
            └── AGENT SPAWN: senior-tester
                └── TOOL: write-file ("src/auth/oauth.spec.ts")
```

#### Narration

"See the recursion? The architect spawns a frontend developer, who spawns a tester. Each agent is a collapsible bubble — click to expand, see the thinking, inspect every tool call. The model name, token count, cost, and duration are on every agent."

_Source: inline-agent-bubble.component.ts — agent bubble with stats footer_

---

### DEMO 5: DASHBOARD (11:00 — 11:30)

#### Visual

_Navigate to Dashboard tab in the Ptah sidebar_

#### Narration

"After a few sessions, the dashboard shows you everything. Total cost across all sessions. Token usage — input versus output. Session count over time. And a sortable agent performance table.

Filter by 24 hours, 7 days, 30 days. Export as CSV for your team."

#### On-Screen

- Metrics cards: Total Cost, Token Usage, Session Count, Agent Performance
- Cost trend line chart
- Token usage bar chart (input vs output)
- Agent performance table (sortable columns)
- Time range selector: 24h | 7d | 30d | 90d

_Source: dashboard CLAUDE.md — MetricsOverviewComponent, CostChartComponent_

---

### DEMO 6: MCP SERVER IN ACTION (11:30 — 12:00)

#### Visual

_Open a new chat session. Show a request that triggers MCP tools._

#### Narration

"One more thing. Let me show you the MCP server doing something you can't get anywhere else."

#### Action

1. Type: "Find all components that import the AuthService and check if any have TypeScript errors"
2. Show the agent calling MCP tools:
   - `ptah_lsp_references` → finds 12 files referencing AuthService
   - `ptah_get_diagnostics` → checks each for errors
   - Response with structured results

#### Narration

"Two MCP calls. One finds every file that references AuthService via the LSP — not grep, not regex, the actual language server. The other pulls live TypeScript diagnostics. No build step. Instant, accurate results.

This is what 15 API namespaces give your agents. They don't guess — they query."

_Source: mcp-server-section.component.ts — ptah_lsp_references, ptah_get_diagnostics_

---

## PART 4: CLOSING & CTA (12:00 — 12:30)

---

### PROOF POINTS (12:00 — 12:15)

#### Visual

_Switch back to browser. Show the landing page CTA section._

#### Narration

"Ptah is built with 12 libraries, 48 components, and 280+ TypeScript files. 10x faster sessions. 15 MCP API namespaces. 13 project-adaptive agents. 200+ models via OpenRouter. And it starts free."

#### On-Screen — Key Stats

| Stat               | Value               |
| ------------------ | ------------------- |
| Performance        | 10x faster (50ms)   |
| MCP API Namespaces | 15                  |
| AI Agents          | 13 project-adaptive |
| Models Available   | 200+ via OpenRouter |
| Project Types      | 13+ auto-detected   |
| Components         | 48+                 |
| Price              | Free / $5 Pro       |

---

### CTA (12:15 — 12:30)

#### Visual

_Landing page CTA section: "Start Your Free Trial" with amber gradient button_

#### Narration

"Install Ptah from the VS Code Marketplace. 14-day Pro trial. No credit card. Cancel anytime.

Your AI coding orchestra is ready."

#### On-Screen

- URL: **marketplace.visualstudio.com** → search "Ptah"
- Trust signals: 14-Day Free Trial · No Credit Card · Cancel Anytime
- Discord: discord.gg/pZcbrqNRzq

---

## B-ROLL SHOT LIST

| Timestamp | Description                                     | Source Component                          |
| --------- | ----------------------------------------------- | ----------------------------------------- |
| 0:05      | Hero section loading with parallax              | hero.component.ts                         |
| 0:25      | Social proof stats grid                         | hero-content-overlay.component.ts         |
| 0:55      | Feature 1: Agent visualization showcase         | features-hijacked-scroll.component.ts     |
| 1:10      | Feature 2: MCP server showcase                  | features-hijacked-scroll.component.ts     |
| 1:25      | Feature 3: Setup wizard showcase                | features-hijacked-scroll.component.ts     |
| 1:35      | Feature 4: OpenRouter model control             | features-hijacked-scroll.component.ts     |
| 1:50      | Comparison grid — pain points vs benefits       | comparison-split-scroll.component.ts      |
| 2:05      | Performance metric cards animating in           | comparison-split-scroll.component.ts      |
| 2:25      | Pricing hero with pyramid background            | pricing-hero.component.ts                 |
| 2:35      | Pricing cards — Community vs Pro                | pricing-cards.component.ts                |
| 5:50      | MCP tools grid (8 tools)                        | mcp-server-section.component.ts           |
| 5:55      | 15 API namespace badges                         | mcp-server-section.component.ts           |
| 7:00      | Settings panel — auth section                   | settings.component.html                   |
| 7:20      | Provider model selector with search             | provider-model-selector.component.ts      |
| 7:45      | Setup wizard welcome — 3 feature cards          | welcome.component.ts                      |
| 8:00      | Scanning progress — phase stepper + live output | scan-progress.component.ts                |
| 8:20      | Analysis results — collapsible phase cards      | analysis-results.component.ts             |
| 8:35      | Agent selection grid with relevance scores      | agent-selection.component.ts              |
| 8:50      | Generation progress — per-agent status cards    | generation-progress.component.ts          |
| 9:15      | @agent autocomplete dropdown                    | unified-suggestions-dropdown.component.ts |
| 9:30      | Execution tree building in real-time            | execution-node.component.ts               |
| 9:45      | Inline agent bubble with stats footer           | inline-agent-bubble.component.ts          |
| 10:30     | Nested agent spawning (3 levels deep)           | execution-node.component.ts (recursive)   |
| 11:10     | Dashboard metrics cards                         | metrics-overview.component.ts             |
| 11:20     | Cost trend chart                                | cost-chart.component.ts                   |
| 11:25     | Agent performance table                         | agent-performance-table.component.ts      |

---

## TECHNICAL REQUIREMENTS

### UI Recordings Needed

1. **Landing page full scroll** — hero → features → comparison → pricing
2. **Docs page section-by-section** — all 7 sections with dot navigation
3. **VS Code settings panel** — auth config + model mapping
4. **Setup wizard full flow** — all 6 steps, real project scan
5. **Chat with execution tree** — @agent invocation, real-time tree building
6. **Orchestration multi-agent** — /orchestrate command with agent spawning
7. **Dashboard with data** — pre-populated with several sessions
8. **MCP tools in action** — LSP references + diagnostics query

### Code Snippets for Overlay

1. MCP example code (from mcp-server-section.component.ts)
2. Execution tree ASCII diagram (from chat-dashboard-section.component.ts)
3. Model tier mapping concept (from providers-api-section.component.ts)

### Screen Resolution

- Browser: 1920×1080 (landing page)
- VS Code: 1920×1080, dark theme (extension demo)
- Font size: 14px code, visible on 1080p playback

---

## NARRATION GUIDELINES

### Pacing by Section

| Section           | Duration | Pacing               |
| ----------------- | -------- | -------------------- |
| Hook              | 20s      | Fast, punchy         |
| Landing page tour | 2:40     | Steady, descriptive  |
| Docs walkthrough  | 3:30     | Methodical, clear    |
| Live demo         | 5:30     | Deliberate, pauses   |
| Closing & CTA     | 30s      | Enthusiastic, direct |

### Language Rules

- Use "you" and "your" — second person throughout
- Active voice only
- Technical terms from the actual codebase (ExecutionNode, ptah.\*, MCP, LSP)
- No "powerful", "amazing", "revolutionary" — let the demo speak
- Specific numbers over adjectives (10x, 15 APIs, 48 components, 200+ models)

### Transitions

- Landing page → Docs: "Let me walk you through the docs"
- Docs → Demo: "Now let me show you everything live in VS Code"
- Demo → CTA: "Your AI coding orchestra is ready"

---

## MUSIC & SOUND DESIGN

- **Intro**: Subtle electronic ambient (Egyptian undertone if possible)
- **Demo sections**: Low background beats, unobtrusive
- **Key moments**: Soft sound effects on agent spawning, tool calls completing
- **CTA**: Music builds slightly, fades on final line

---

## Technical Validation

- [x] All feature claims grounded in actual component code
- [x] MCP tools list matches mcp-server-section.component.ts (8 tools)
- [x] API namespaces count matches (15 namespaces)
- [x] Performance metrics match comparison-split-scroll.component.ts
- [x] Auth methods match authentication-section.component.ts (4 methods)
- [x] Setup wizard steps match (6 steps, 4-phase analysis)
- [x] Pricing matches pricing-cards.component.ts (Free + $5/mo Pro)
- [x] Agent count matches (13 agents referenced in setup wizard)
- [x] No "Claude Code" branding — consistent "AI coding orchestra" + "Claude Agent SDK" positioning
- [x] All URLs reference Ptah marketplace, not Anthropic
