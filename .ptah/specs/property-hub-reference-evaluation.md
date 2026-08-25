# property-hub as the Builders Cohort Reference Implementation — Evaluation

Date: 2026-08-01
Scope: `D:\projects\property-hub` ("Pro-Estate Egypt") evaluated as the missing reference SaaS for the Ptah Builders cohort, against `D:\projects\nx-knowledge-base\foundational-course\` (38 files, 6 modules).
Companion document: `.ptah\specs\premium-course-pack-assessment.md` (cited throughout as **[PA]**; its course analysis is not repeated here).
Method: read-only inspection. No file in `property-hub` or `nx-knowledge-base` was modified; no build, install, migration, or git-write command was run in either.

---

## 0. Verdict (read this first)

**Adopt it — but as a _reference_, not as _the thing the cohort builds_, and only after three corrections and a legal/commercial scrub.**

property-hub solves [PA]'s single biggest finding decisively. [PA] §1c found "no shared build, no shared domain — zero hits for a narrative spine." property-hub is a real, coherent, actively developed multi-tenant SaaS: **1,885 commits between 2026-01-31 and 2026-07-18, 1,014 of them in the last 90 days**, two primary engineers, conventional commits, 146 Nx projects, ~2,215 hand-authored TypeScript files / ~447,000 lines (the ~2,872 figure in the brief includes generated Prisma/ZenStack output; authored code is the smaller number). It is not a demo. It is not abandoned. Its debt markers are extraordinary for its size: **24 TODOs, 0 FIXME, 0 HACK, 0 `@ts-ignore`** across the tree.

It also silently fixes [PA] §1b's version-drift problem. The course teaches Angular 16/17/19 and NestJS ^10; property-hub runs **Angular 21.2, NestJS 11, Nx 22.4.4, TypeScript 5.9, Prisma 6.19, Tailwind 4, DaisyUI 5, `@ngrx/signals` 21** — essentially version-matched to Ptah itself. Its CI uses `actions/checkout@v4` / `setup-node@v4` / `upload-artifact@v4`, directly replacing the broken `@v3` example [PA] §1b flagged as an embarrassment-in-waiting. Its docs app runs **Astro 6.4.6 + Starlight 0.39.3 — the same stack as `ptah-docs`**.

But three findings block using it as a finished exemplar, and one of them is serious:

1. **The ZenStack access-control layer is dead code.** 224 policy rules (`@@allow` ×217, `@@deny` ×7) across 11 `.zmodel` files, and **nothing in the application ever activates them.** Independently verified: zero `@zenstackhq` imports outside generated code, no `enhance()` call anywhere in `libs/` or `apps/`, and `libs\common\data-access-orm\src\prisma-orm\prisma.service.ts` is a bare `export class PrismaService extends PrismaClient`. Meanwhile `docs\architecture\multi-tenancy.md:72-89` asserts as fact: _"Data isolation is enforced at the ORM level using ZenStack policies… Even if API parameters are tampered with, ZenStack blocks cross-tenant access."_ **That statement is false in the running system.** Tenant isolation is real but is hand-written `organizationId` where-clauses — 2,229 of them. Teaching a paying cohort a security model that does not execute is the one thing here that would be genuinely indefensible.
2. **There is no billing.** No Stripe, Paddle, Paymob, or Fawry SDK; no billing module, webhook, seat model, or entitlement engine. What exists is four unused columns on `Organization`, one read-only getter, a marketing pricing page, and one entitlement guard that can never fire because nothing ever writes a non-`TRIAL` status. The team's own `docs\product\known-issues.md:217-221` rates this **"Severity: High — blocks monetization."**
3. **The flagship e2e suite is red and disabled.** `.github\workflows\e2e.yml` header, verified verbatim: _"TEMPORARILY MANUAL-ONLY: the suite is currently failing in CI, so it no longer gates PRs or pushes."_ Its trigger is `workflow_dispatch:` only. The repo elsewhere cites "437+ cases" as an asset.

None of the three is fatal. All three are, in fact, _excellent cohort curriculum_ — wiring ZenStack in, building Paddle billing, and turning an e2e suite green are exactly the weeks-4-through-7 work a member should do. The danger is only in shipping them framed as finished.

Two further honesty corrections that change how capabilities must be _marketed_:

- **"Social media integration" is not platform integration.** There are zero direct Facebook/Instagram/TikTok/YouTube/LinkedIn API clients. Every platform is reached through one commercial aggregator SaaS, **Zernio**. A repo-wide grep for `graph.facebook.com|open.tiktokapis|googleapis.com/youtube|api.linkedin.com|api.twitter.com` returns exactly one hit, and it is a comment in a test helper. A prior generation of direct-Meta code was deliberately deleted (`libs\common\social-media\CLAUDE.md:81-92`). What remains is an outstanding **vendor anti-corruption layer** — which is a better lesson than most courses teach, but it is a different lesson.
- **"AI agents with advanced memory and skills" and "deep agent harnesses" substantially over-deliver.** This is the strongest material in the repo and the least covered by the course. Details in §2.

**Recommended shape:** ship property-hub as a **sanitized, read-only reference** the curriculum cites into, plus a **deliberately reduced teaching variant** the member actually grows. Do not hand a cohort 146 Nx projects and a 12-service docker-compose. See §4 and §5.

---

## 1. Fitness as the cohort reference — layer by layer

Verdicts: **EXEMPLARY** (hold it up as-is) / **SOLID** (teach it) / **ADEQUATE** (works, don't call it a model) / **WEAK** / **MISSING**.

| Layer                                 | Verdict                              | One-line reason                                                                     |
| ------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Nx monorepo structure                 | **SOLID**                            | 146 projects, boundaries enforced as `error`; overwhelming at this size             |
| Multi-tenancy                         | **ADEQUATE**                         | Real and working, but hand-rolled and mis-documented                                |
| Access control (ZenStack)             | **WEAK**                             | 224 rules, all inert                                                                |
| Access control (`libs/common/access`) | **EXEMPLARY**                        | Isomorphic 48-permission RBAC catalog shared by Angular + NestJS                    |
| Auth                                  | **SOLID**                            | Refresh tokens, Redis revocation, magic links; no MFA/SSO/email-verify              |
| Billing                               | **MISSING**                          | Four unused DB columns and a pricing page                                           |
| Background jobs                       | **SOLID**                            | 8 Bull queues, 9 processors, 13 crons, real backoff                                 |
| Real-time                             | **SOLID**                            | Two Socket.IO gateways, JWT on connect, org-scoped rooms                            |
| Storage                               | **EXEMPLARY**                        | Magic-byte sniffing + image re-encode + CSV formula guard                           |
| i18n / RTL                            | **EXEMPLARY**                        | 7,758 keys × 2 locales, zero missing, RTL verified by computed style                |
| Angular frontend                      | **EXEMPLARY**                        | 468/477 components OnPush, **zero NgModules**, 38 signal stores                     |
| Testing                               | **SOLID**                            | 397 specs, 2.05 assertions/test, 1.4% trivial — but no coverage gates, e2e disabled |
| CI                                    | **ADEQUATE**                         | Good affected-graph CI on current actions; no deploy pipeline, e2e off              |
| Docker                                | **SOLID**                            | 6-stage build, non-root, healthchecks, pinned bases                                 |
| Docs                                  | **SOLID but wrong where it matters** | 122 files, well organized; the two load-bearing claims are false                    |

### Where it is strong enough to teach from

**Angular is the standout, and it is exactly what the course is missing.** 468 of 477 components declare `ChangeDetectionStrategy.OnPush` (98%). **Zero `@NgModule` in the entire tree** — fully standalone. 425 files use `inject()`. 38 `signalStore`s using `withMethods` / `withComputed` / `rxMethod` / `patchState`. [PA] §1b's complaint that "none of the course material was written against 21" is answered completely.

**`libs\common\access\src\lib\access-control.ts`** (469 lines) — a framework-free RBAC catalog with 48 permissions, roles `OWNER|ADMIN|MANAGER|AGENT|VIEWER`, consumed by NestJS guards _and_ by Angular `*phHasRole` / `*phCan` directives. Its spec asserts exact permission counts and ordering — invariant tests that would actually catch a regression. This is the single best answer to "why a monorepo" in the whole repo, and it directly supersedes the course's duplicated `authorization-rbac.md` / `authorization-roles-claims.md` pair ([PA] §1a).

**Secure file upload** — `libs\common\storage\src\lib\`: `sniff\magic-bytes.util.ts` (content type from magic bytes, not client MIME), `image\reencode.util.ts` (sharp re-encode as payload defense), `extract\formula-guard.util.ts` (CSV/Excel formula injection). All with specs. Rare, correct, and completely absent from the course.

**Webhook hardening** — `libs\api\social-webhooks\src\lib\zernio-webhook.controller.ts` (318 lines) is the best single teaching file in the repo: HMAC-SHA256 with `crypto.timingSafeEqual` plus a length pre-check, fail-closed in prod / fail-open in dev, Redis `SET NX EX` idempotency marked _before_ emit (explicit at-most-once), tenant resolution via LRU with a first-touch fallback, and always-200 so a downstream failure enqueues instead of triggering vendor retry storms. An entire lesson in one file.

**Multi-replica cron safety** — `libs\api\social-posts\src\lib\services\scheduled-post.service.ts:66-73` claims work atomically by nulling `scheduledAt` via `updateMany` and checking `claimed.count === 0`, restoring on failure. Eight lines, and it teaches a concept most senior engineers get wrong.

**Real-time** — both gateways JWT-verify on connect and join org-qualified rooms (`org:{organizationId}`, `user:{organizationId}:{userId}`). Correct tenant isolation, honestly documented. Caveat to state aloud: no Redis adapter, so it assumes a single instance.

**Docker** — `Dockerfile` is 6 stages (hardened `node:24-alpine3.21` base with `apk upgrade`, split `deps`/`prod-deps`, shared builder, then `api` / `web` nginx / `tenant-ssr` runtimes), non-root `appuser:1001`, `HEALTHCHECK` in both Node runtimes. Directly teachable; supersedes the course's `deployment-docker-deployment.md`.

**Test quality is real.** 397 spec files, 4,803 `it()` blocks, 9,823 `expect()` calls (≈2.05 assertions per test), and only 67 occurrences of `should be defined`/`should create` — **1.4% trivial**. `libs\api\inbox\src\lib\inbox.service.spec.ts` alone is 2,706 lines. This is materially better than most reference repos.

### Where I would NOT hold it up as exemplary

**The ZenStack fiction (§0.1).** Beyond the dead rules, the fiction has metastasized into code comments — `libs\api\notifications\src\lib\notification.service.ts:49` says writes go through _"the raw PrismaService (NOT the ZenStack-enhanced client),"_ implying an enhanced client exists somewhere. It does not. And dead policy rots: `schemas\properties.zmodel:117-120` carries `@@allow('read', true)` on a child model — harmless today, a live vulnerability the moment someone switches enforcement on.

Compounding it: **30 of 75 models have no `organizationId` at all**, relying on transitive scoping through a parent (`LeadActivity`, `PropertyAsset`, `Message`, `OpportunityLead`, `MetaCampaign`, `CustomFieldValue`, …). That is a legitimate pattern, but with no ORM-level net beneath it, each one is an unbounded query away from a cross-tenant leak. And there is **no `AsyncLocalStorage`, no `nestjs-cls`, no request-scoped Prisma provider** — tenant context rides on `request.user` and every caller must remember to merge scope fragments. `access-scope.service.ts`'s own docblock says: _"All callers MUST combine the returned where-clause fragment with their own org-scoped base clause."_ That is discipline-as-security. It works; it is not a model.

**God objects.** Three files will undercut every SRP lesson you teach if shown whole:

- `libs\common\social-media\src\zernio\zernio.client.ts` — **5,483 lines, ~186 methods**, every vendor endpoint in one class.
- `libs\api\ai-agent\src\lib\agent.service.ts` — **2,489 lines, ~30 constructor dependencies**; does prompt assembly, agent construction, caching, SSE mapping, delegation guards, HITL resume, memory recall, and persistence.
- `libs\api\social-posts\src\lib\social-posts.controller.ts` — 1,148 lines, 50 route handlers (the lib has six _other_ controllers, so the split exists; this one just never got carved).

Also `libs\api\ai-agent\src\lib\tools\pages.tools.ts` (1,519 lines, 29 tools) and `libs\admin\feature-ai-agent\src\lib\stores\agent-chat.store.ts` (1,289 lines). Teach _extracts_; never open these whole.

**Duplicated auth.** `libs\admin\auth` (455-line store, 5 guards) and `libs\tenant\auth` (503-line store, 6 guards) are two independently written stacks sharing only `libs\common\access`; `libs\saas\auth` is a 95-line stub. In a monorepo whose entire pitch is code sharing, a sharp student will find this in week 2 and ask about it. Have the answer ready — or make consolidating it a cohort exercise.

**The architecture contract is aspirational, not enforced.** `ARCHITECTURE_CONTRACT.md:17-18` states _"HttpClient injection is allowed ONLY in `libs/shared/client/http/base-api.service.ts`."_ In reality **~20 non-generated source files inject `HttpClient` directly**, including `libs\admin\feature-coach\...\strategy-api.service.ts`, `libs\admin\feature-roles\...\roles.store.ts`, `libs\admin\feature-ai-agent\...\agent-api.service.ts`, and `libs\tenant\data-access\...\content-api.service.ts`. Nothing lints it. This is a _great_ teachable moment ("here is what happens to a locked contract with no enforcement — now let's write the ESLint rule"), but it must be framed that way rather than presented as compliance. Note too that `eslint.config.js:217` turns `@nx/enforce-module-boundaries` **`'off'`** in a later override block — read that before holding the boundary lesson up.

**Stale/contradictory docs.** `docs\product\production-readiness.md` (April) and `docs\product\known-issues.md` (July) disagree on CI, health checks, structured logging, and test coverage — the April file marks as "not done" several things the July file records as resolved. A member reading them in the wrong order gets a false picture. Pick one, delete or archive the other.

**Other gaps worth naming:** no MFA, no SSO/social login for user auth, no email verification; JWT accepted from a `?token=` query parameter in `jwt.strategy.ts` (teach as a counter-example — tokens land in access logs and Referer headers); **zero enforced coverage thresholds** (`jest.preset.js` is three lines); `libs/tenant` has only 8 specs against `libs/admin`'s 95; **Bull v4, not BullMQ** (v4 is in maintenance — teaching it in 2026 dates the material); `removeOnFail: false` is the only dead-letter story; no deploy pipeline at all (Dokploy auto-deploy on push, by design).

---

## 2. The three called-out capabilities — what they actually are

### 2a. Social media integration — **REAL, mature, but not what the label implies**

**What it is:** a single-vendor anti-corruption layer over **Zernio** (`app.zernio.com`), an Ayrshare-class aggregator that, per `.env.example`, provides _"FB + IG + WhatsApp + YouTube + TikTok + Snapchat via a single Embedded Signup flow."_

**Scale:** ~350 files, ~65,000 hand-written lines, 950+ test cases across `libs/common/social-media` (47 files, 20,880 lines, 316 `it()`), `libs/common/zernio-client`, `libs/api/social-posts` (82 files, 214 `it()`), `libs/api/social-webhooks` (13 files, 75 `it()`), `libs/api/ads` (34 files, 199 `it()`), `libs/admin/feature-social` (74 files), `libs/admin/feature-ads` (39 files).

**Honest platform coverage:** 21 platforms appear in the enum. **Five have real platform-aware code** — Facebook, Instagram, WhatsApp, LinkedIn (`linkedin-metadata.util.ts`), TikTok (`tiktok-metadata.util.ts`). The other 16 are a capability table plus a generic `platforms[]` passthrough. Bluesky is declared but disabled (`canPublish: false`, _"credential modal not yet implemented"_).

**Architecture (the teachable part):** clean ports in `libs\common\social-media\src\contracts\` — `MessagingPlatformAdapter`, `PublishingPlatformAdapter`, `AccountConnectionAdapter`, `AdsPlatformAdapter`, `PostsListingAdapter`, `MessagingWindowGuard` — with Symbol DI tokens and a comment explaining _why_ Symbol over string (a mismatch surfaces as "Unknown dependency" rather than a silent boot deadlock). `libs\common\zernio-client` is a small, portable middleware chain: circuit breaker → rate limit → retry → fetch, LIFO order documented in the header, each middleware separately spec'd, over an OpenAPI-generated schema.

Be precise with students: **this is not a strategy pattern.** One interface, exactly one implementation each, all named `Zernio*`. Platform variance is handled by _data_ (capability tables), not polymorphism.

**Where the abstraction leaks:** the vendor-agnostic ports name Zernio's own REST paths in their doc comments (`publishing-platform.adapter.ts:89, :214, :252`); `SinglePostAnalytics` is a discriminated union modelled on Zernio's four HTTP status codes; `platformOverrides?: Partial<Record<SocialPlatformKey, unknown>>` is an untyped escape hatch the doc comment admits is unvalidated.

**Two real blemishes to teach as smells, not patterns:** `zernio-event.normalizer.ts:302-305` sets `const PLATFORM_AGNOSTIC_PLACEHOLDER = 'facebook'` — a required field filled with a hardcoded lie, commented as safe. And `zernio-ads.adapter.ts:553-563` `getLeadData()` throws a 501 telling the caller to go use Meta's Graph API directly — an interface-segregation failure. Also: `libs/api/ads` is full of `meta-ads-*` filenames and `MetaAdAccount`/`MetaInsight` models even though it now serves Google, LinkedIn, TikTok and X ads. The `Meta` prefix is a leftover lie; students will trip on it.

**What it cannot teach:** OAuth token refresh, token encryption, expiry handling (Zernio holds all tokens — the old `token-manager.service.ts` with AES-256-GCM was deleted); per-platform rate-limit budgets; chunked/resumable video upload (the app hands Zernio a URL and Zernio does TikTok/YouTube uploads); per-platform error taxonomies. **All the hard parts are on the vendor's side of the wire.** This teaches the client half of an integration, thoroughly, and the provider half not at all.

**Teachability: high, if sold as "how to integrate a vendor SaaS without letting it colonize your domain."** Sold as "build social media integrations," students will feel misled the moment they open `zernio.client.ts`.

### 2b. AI agents with advanced memory and skills — **REAL, and the strongest asset in the repo**

**Scale:** 418 TypeScript files, ~76,200 lines, 110 spec files, ~1,120 `it()` blocks across 12 libs. Zero `TODO`/`FIXME`/`not implemented` in non-spec source. `libs\api\ai-agent` alone: **149 files, 36,460 lines, 43 specs**.

**Stack:** LangChain JS + LangGraph 1.3 + **`deepagents`** (LangChain's deep-agents harness — imported 20 times) + `@langchain/langgraph-checkpoint-postgres` + `neo4j-driver` against **Memgraph** + Ollama embeddings + `@composio/core`. Provider abstraction in `model\model.factory.ts` (389 lines) covers Anthropic, OpenAI, and any OpenAI-compatible endpoint (Ollama local/cloud, Groq, Together, OpenRouter, LM Studio, vLLM), resolved per-org.

**Six agents:** admin orchestrator (staff copilot, 10 subagents), tenant sales concierge, sales coach (with ElevenLabs/Kokoro voice behind a port), SaaS marketing concierge (Turnstile-gated), inbox analysis (honestly _not_ an agent — one structured-output pass), plus 12–13 named subagents.

**Memory — genuinely three-tier, not "we save the transcript":**

- **Tier A, pgvector:** `agent.entity_embeddings`, 768-dim `nomic-embed-text-v2-moe`, with four migrations that read like a textbook chapter — `20260614000000_formalize_entity_embeddings` (`CREATE EXTENSION vector`), `20260603120000_hnsw_entity_embeddings` (HNSW `m=16, ef_construction=64`, per-query `SET LOCAL ef_search=40`), `20260615000000_entity_embeddings_sparse_tsv` (generated `tsvector` + GIN, deliberately using `'simple'` not `'english'` **because the corpus is bilingual Arabic/English and `'english'` would silently drop Arabic tokens**), and `20260615120000_platform_docs`. Hybrid dense+sparse retrieval fused by **Reciprocal Rank Fusion** (`reranking\rrf.ts`), motivated in the migration comment by a measured baseline (~84% of retrievals were falling through to `ILIKE`).
- **Tier B, Memgraph graph memory:** `memory\memgraph-memory.service.ts` (1,040 lines) over Bolt/Cypher with its own `CREATE VECTOR INDEX fact_embedding_idx`. Node model: `Organization`, `Fact` (with `confidence`, `decayedConfidence`, `supersededAt`, `reinforceCount`, embedding), `Episode` + `TOUCHED` edges, org `Preference`, per-customer `VisitorPreference`, per-rep `RepNote`. `memory\memgraph.store.ts` (240 lines) is a **custom LangGraph `BaseStore` implementation** — a textbook "plug your own backend into a framework" artifact.
- **Tier C, LangGraph Postgres checkpointer:** `checkpointer\pg-checkpointer.service.ts`, thread key `org:user:threadId`.

**The curation pipeline is the genuinely advanced part.** `memory\memory-curator.service.ts` (440 lines) implements five documented hygiene policies: semantic dedup at cosine ≥0.9; reinforcement (confidence boost, capped at 1); contradiction detection in the 0.7–0.89 similarity band marking `supersededAt`; **exponential decay `confidence * e^(-0.01 * ageDays)`** with a 0.2 prune floor; and a top-500-per-org cap — with an explicit _pure `curate()` vs. writing `applyHygiene()`_ contract and a 494-line spec. Feeding it: `memory-session.listener.ts` → Bull `ai-memory` queue → `memory-pipeline.processor.ts` (808 lines, 8 documented steps, hallucination-drop validation against Prisma enum sets) → `memory-updater.service.ts` (420 lines, LLM reflection producing typed facts with confidence and a `contradicts` signal).

Recall into the prompt: `agent.service.ts:2080-2162` `buildMemoryContext()` — three tiers (entity-scoped / vector-relevance / confidence-ordered global), tiers 1+2 concurrent, a hard **1,500 ms `raceTimeout`** so a hung embedder can't stall first-token, merged and capped at a 25-fact budget.

**Skills — a real two-layer system, and it mirrors Ptah's own.** Layer 1 is **22 `SKILL.md` files** across 14 domains (`ads`, `analytics`, `docs`, `emit-ui`, `inbox`, `leads`, `notifications`, `onboarding`, `opportunities`, `pages`, `properties`, `sales-coach` ×7, `social`, `team`), mounted via `skills-backend.ts` (62 lines) using deepagents' `CompositeBackend` so **only** the `/skills/` route touches real disk while everything else stays ephemeral — a genuine security consideration, well commented. That is Anthropic-style progressive disclosure, the same format `.agents/skills/` uses in this repo. Layer 2 is **183 uniquely-named zod-schema'd tools**, plus `middleware\tool-search.middleware.ts` (234 lines) — a `search_tools(query)` meta-tool for progressive tool disclosure, with an argued rejection of the LLM-selector alternative. External federation via **Composio** with OAuth and envelope-encrypted tokens (`secret-cipher.service.ts`, stored as `Bytes`). Per-tenant configuration is real: Prisma model `OrgIntegrationPolicy` gates `providers[]`, `allowedApps[]`, `allowedActions[]`, `webToolsEnabled`, `semanticSearchEnabled`, `memoryEnabled` — and the resolved policy is **hashed into the agent instance cache key**.

### 2c. Deep agent harnesses — **REAL, literally `deepagents`, and the most teachable AI material**

`createDeepAgent` from `deepagents`, wrapped in a substantial production layer:

- **Loop control:** `AGENT_RECURSION_LIMIT = 120` (overriding deepagents' 10,000 default), `MAX_DELEGATIONS_PER_SUBAGENT = 6`, `MAX_DELEGATIONS_PER_TURN = 10`, `MAX_CONSECUTIVE_TOOL_REPEATS = 3` (byte-identical-args streak, resets on arg change) — with ~35 lines of comment explaining _why each number_.
- **Human-in-the-loop:** `agent.constants.ts` `HITL_TOOL_CONFIG` gates ~30 tools (sends, publishes, deletes, membership changes), resumed via `new Command({ resume: { decisions } })`, with an explicit invariant that the widened attachment config may never _remove_ a tool. Frontend: `hitl-card.component.ts`. End-to-end approval loop across both sides.
- **Resumable streaming:** `agent-run-manager.service.ts` (178 lines) decouples generation from the HTTP request, buffering events and multiplexing to N sinks so a hard browser refresh re-attaches to a still-running turn. Small, framework-agnostic, immediately reusable.
- **Context management:** `middleware\compaction.middleware.ts` truncates old `ToolMessage` content outside a 12-message window while preserving `tool_call_id`+`name` so provider AI/Tool pairing never breaks — motivated by a cited real incident (_"a single pages-editor build measured 229,642 input tokens in ONE turn"_) and deliberately ordered first so it doesn't bust Anthropic prompt caching.
- **Guardrails:** `uploads\untrusted-fence.util.ts` (prompt-injection fencing), `agent-access.guard.ts`, `conversation-store.surface-bleed.spec.ts` (an explicit cross-tenant leak test), `agent.p3-security.spec.ts`.
- **Evals** — `libs\api\ai-agent-evals` (15 files, 2,873 lines, 5 specs): runs the **real** agent with a provider override, collects traces, and scores via **LLM-as-judge** (`faithfulness`, `answerRelevancy`, `contextPrecision`, `contextRecall`, `correctness`) plus deterministic `tool_correctness`/`tool_efficiency` and retrieval `hitRate@k`/`mrr`/`recall@k`. Emits `report.json`, `report.md`, and a Ragas-compatible `.jsonl`. **34 dataset cases**, deliberately including paired exact-vs-paraphrase queries to measure hybrid-retrieval recall, and a write→recall memory pair. CI-gateable via `thresholds`. `eval-results/` holds **9 real historical runs** (2026-06-14 → 06-20) including honest failures — one glm-5.2 run scores `faithfulness 0.38` with a case flagged because the agent called `list_properties` instead of `semantic_search`. Nobody fabricates results that make their own agent look bad.

**Teachability: very high.** The best artifacts are small and self-contained: `memory-curator.service.ts`, `memgraph.store.ts`, `buildMemoryContext()`, the four pgvector migrations, `compaction.middleware.ts`, `tool-search.middleware.ts`, `agent-run-manager.service.ts`, `skills-backend.ts`, and the whole evals lib. The weak spots are the two god files (`agent.service.ts`, `pages.tools.ts`) and a dangling reference: `tool-search.middleware.ts:5-6,37,192` cites `safe-tool-selector.middleware.ts`, **which does not exist** — a deleted file whose comments were left behind.

**This is also where Ptah's own story converges.** property-hub independently arrived at memory curation with decay, SKILL.md progressive disclosure, and a checkpointed agent harness — the same concerns as `libs/backend/memory-curator`, `skill-synthesis`, and `agent-sdk`. That parallel is the single most compelling thing to put in front of a prospective member: _the tool you're buying and the app you're building solved the same problems._

---

## 3. Gap map — course ↔ property-hub

### Course modules with production-grade counterparts

| Course module                                                    | property-hub counterpart                                                                                                                                                    | Fit                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `01-nx-foundation/` (6 files)                                    | 146 Nx projects, domain-sliced scopes, `@nx/enforce-module-boundaries: 'error'` with buildable-dep enforcement, custom generators, `docs\architecture\module-boundaries.md` | **Strong** — but 146 projects is far past what a week-1 reader can absorb; teach the _rules_, show a 6-project subset |
| `03-modern-angular/` (8 files)                                   | Angular 21.2, 98% OnPush, 0 NgModules, 38 signal stores, `apps/storybook`, 95 admin specs, `docs\guides\angular-best-practices.md` (49 KB)                                  | **Excellent** — resolves [PA] §1b drift outright                                                                      |
| `04-saas-operations/angular-multi-language-support-transloco.md` | 7,758 keys × en/ar, `direction.service.ts`, `lang.service.ts`, Tailwind 4 `rtl:` variants, RTL e2e                                                                          | **Best-in-class** — property-hub far exceeds the course text                                                          |
| `04-saas-operations/jwt-authentication.md`                       | `auth.service.ts` (1,534 lines): refresh tokens, Redis blacklist, magic links, invites, dual staff/customer paths                                                           | **Strong**                                                                                                            |
| `04-saas-operations/deployment-docker-deployment.md`             | 6-stage `Dockerfile`, non-root, healthchecks, 3 runtimes                                                                                                                    | **Strong**                                                                                                            |
| `nx-enterprise/` (5 files, unindexed per [PA] §1)                | `ci.yml` on `@v4` actions with `nx affected`, husky + commitlint + lint-staged, 13 KB `eslint.config.js`                                                                    | **Strong** — and fixes [PA] §1b's deprecated `@v3` example                                                            |

### Course topics with NO usable counterpart

1. **`04-saas-operations/stripe-integration.md` (901 lines) + `clerk-integration.md` (507 lines).** property-hub has **no billing and no third-party auth provider.** [PA] §1b already flagged the Stripe/Clerk-vs-Paddle/WorkOS credibility mismatch. property-hub does not resolve it — it _widens_ the gap by having nothing at all. **Silver lining:** its own plan of record is `docs\integrations\paddle-payments.md`, and Paddle is exactly what `apps/ptah-license-server` runs. This is the cleanest opportunity in the whole program: make billing the week where the cohort builds what the reference lacks, against Ptah's own license server as the worked example.
2. **`05-strategic-patterns/` — DDD and CQRS (`ddd-implementation.md`, `cqrs-implementation.md`, ~2,500 lines of the course's highest-value content per [PA] §1a).** property-hub is **not** a DDD or CQRS codebase. There are no aggregates, value objects, domain events, repositories-as-domain-abstractions, command buses, or read models. It is a pragmatic layered NestJS service-over-Prisma architecture. Do not pretend otherwise. Either teach these modules as _contrast_ ("here is what property-hub chose instead, and what it cost") or cut them to the `/reference/` appendix. Presenting property-hub as a DDD exemplar would be the second-most-dishonest thing available.
3. **`02-multitenant-backend/prisma-zenstack-nestjs-nx-guide.md` (968 lines).** A painful one: the course's deepest backend document teaches ZenStack, and property-hub's ZenStack **does not run**. The `.zmodel` files are excellent _source material_ for teaching policy authoring, and the repo is a perfect worked example of policy-vs-guard drift — but the member must be told the truth up front.
4. **`02-multitenant-backend/multi-database-setup.md`.** property-hub is single-database shared-schema. No counterpart.

### property-hub capabilities with NO course coverage — the "advanced materials" to add

Ranked by teaching value per unit of effort:

1. **Deep agent harnesses** — deepagents/LangGraph loop control, subagent delegation, HITL approval, resumable SSE runs, context compaction, progressive tool disclosure. _No course coverage whatsoever._
2. **Advanced agent memory** — pgvector + HNSW + hybrid RRF retrieval, graph memory, LLM reflection, and confidence decay/dedup/supersession curation.
3. **Agent skills** — SKILL.md progressive disclosure, a 183-tool zod registry, per-tenant policy gating, Composio federation.
4. **LLM evaluation** — judges, datasets, Ragas export, CI thresholds, and 9 committed regression runs.
5. **Vendor integration as an architectural discipline** — ports/adapters ACL, circuit breaker + retry + rate-limit middleware, OpenAPI-generated clients.
6. **Webhook hardening** — signature verification, timing-safe comparison, idempotency, fail-closed semantics.
7. **Secure file upload** — magic bytes, image re-encode, CSV formula injection.
8. **Multi-tenant real-time** — Socket.IO auth-on-connect and org-scoped rooms.
9. **Background jobs at production depth** — 8 queues, 13 crons, atomic multi-replica claim.
10. **Production RTL/bilingual engineering** — including the Postgres FTS `'simple'`-over-`'english'` decision.

Items 1–4 are the honest answer to "what does the Builders membership give me that I can't get from a $20 Udemy course."

---

## 4. Pack composition

### Recommendation: three artifacts, not one

[PA] §4 proposed `/curriculum/week-N/` + `/reference/` + `/saas-project/`. That structure survives; the question was what `/saas-project/` becomes. **Answer: it does not become property-hub.** Split the difference:

```
/README.md                        Cohort welcome, calendar, how to use the three trees
/00-orientation/                  (unchanged from [PA] §4)

/curriculum/week-01..08/          Week-numbered. Each week's reading CITES into /reference/
  reading.md                      Deduped course text, version-refreshed to the 21/11/6 stack
  reference-tour.md               "Open these 4 files in /reference/, here's what to notice"
  ship-this-week.md               Deliverable + acceptance checklist

/reference/pro-estate/            SANITIZED READ-ONLY SNAPSHOT of property-hub
                                  Members read it; they never build in it.
  SANITIZATION-NOTES.md           What was removed and why (builds trust, teaches diligence)
  CORRECTIONS.md                  The ZenStack truth, the billing gap, the red e2e suite
/reference/deep-dives/            The surviving deduped course originals ([PA] §4)

/saas-project/                    THE REDUCED TEACHING VARIANT — a scaffold, not a copy
  README.md                       What you're building, and how it maps to /reference/
  docs/build-log/                 Week-by-week decision log
/community/showcase.md
```

**Why `/reference/` is a snapshot, not a fork:** members must be able to see how a real system looks at 447K lines — that is the thing [PA] said was missing and the thing no tutorial provides. But they cannot _build_ in it: it needs a paid Zernio key, a 12-service docker-compose, and a Memgraph instance. Reading is free; running is not.

**Why `/saas-project/` is a reduced variant:** see §5.

### What a member receives in week 1 vs week 8

**Week 1 (day one):**

- `/00-orientation/` + `/curriculum/week-01/`
- **The full sanitized `/reference/pro-estate/` immediately.** Do not drip this. Its value is precisely that it is complete and overwhelming — "this is where you're headed" is motivating, and [PA] §4 already established that GitHub access is all-or-nothing anyway, so pretending to gate it is theatre.
- `/saas-project/` at **week-1 state**: an Nx workspace with `libs/shared/contracts`, `libs/shared/client/http` (BaseApiService), `libs/common/config`, one NestJS app, one Angular app, husky+commitlint+lint-staged, and a green `ci.yml` on `@v4` actions. Roughly the `libs/shared/client/http` (748 lines) + `libs/common/config` (592 lines) footprint — small enough to read in an afternoon.
- `CORRECTIONS.md` on day one. Leading with the repo's own known gaps is a credibility asset, not a liability.

**Week 8 (what they've built):**

- A running multi-tenant SaaS of their own domain: shared-schema tenancy with a **working** ZenStack `enhance()` (the correction becomes their week-2/3 win), the isomorphic RBAC catalog pattern, JWT + refresh + Redis revocation, **two or three** domain verticals end-to-end, Transloco + RTL, one Bull queue with a cron, one hardened webhook endpoint, Socket.IO real-time on one surface, a Dockerfile that builds, and **Paddle billing** — the module where they surpass the reference.
- Realistically ~15,000–25,000 lines with Ptah assisting. That is 3–5% of property-hub, and it is an honest, achievable, demo-able outcome.
- Optional advanced track for the ambitious: one agent with tool-calling, one SKILL.md, and a 5-case eval harness. Ship it as a stretch module, not a requirement.

### What CANNOT ship in a pack

**Legal blocker — fix before anything ships:**

- **There is no license.** `package.json` declares `"license": "UNLICENSED"`, `"private": true`, and there is **no `LICENSE` file in the repo**. As it stands, members would receive code granting them no usage rights at all. An explicit grant (source-available / educational-use, with a no-redistribution clause) must be written before a single invite goes out. This is the one item that is purely blocking.

**Commercially sensitive — currently TRACKED IN GIT, must be removed from the snapshot (11 files):**

- `docs\CLIENT-PROPOSAL.md` and `docs\CLIENT-PROPOSAL.pdf`
- `docs\PITCH-DECK.md`
- `docs\fundraising\` — all six files, including **`financial-model-and-data-room.md`** and `founder-inputs-worksheet.md`. A financial model and data room going to 100+ paying strangers is a serious and irreversible commercial leak.
- `docs\product\zernio-pricing-analysis.md` — a vendor's commercial terms; likely also a contractual confidentiality issue.
- `docs\integrations\social-publishing-competitor-analysis.md`

**Third-party brand / client content — must be removed:**

- `scripts\seed-emaar-pages.ts` (600 lines, 50 references to **Emaar**, a major listed developer) — trademark and content risk.
- `scripts\seed-itqanlab.ts` (2,022 lines) — apparent real client.
- `libs\common\data-access-orm\prisma\seed-hills-property-landing.ts` and `seed-hills-property-properties.ts` (913 + N lines) — apparent real client.
- Replace all four with one fictional seed org. `scripts\seed-demo-org.ts` (1,396 lines) is the right base.
- `apps\docs\src\assets\screenshots\` (52 images) — review for real org data before shipping.

**Needs a licensing review before redistribution:**

- `apps\pro-estate-video-studio\assets\music\rising-dawn.mp3` and `assets\sfx\{chime,tick,whoosh}.mp3`. `MUSIC-CREDITS.md` / `SFX-CREDITS.md` exist, so terms are at least documented — but "licensed for our product" rarely means "licensed to redistribute to 100 members." Easiest path: drop `pro-estate-video-studio` from the snapshot entirely (7 files, 495 lines — no teaching loss).

**Internal process artifacts — recommend removing (judgment call, not a legal one):**

- `task-tracking\` — **178 task folders, 661 tracked files.** Arguably a fascinating look at real workflow; more likely overwhelming noise that also leaks internal decision-making, client names, and incident detail. Cut it, and if the workflow story is worth telling, extract 3–5 exemplary task folders into a curated `/reference/process/`.

**Would confuse a general audience — sanitize:**

- **Egypt/brand coupling is substantial:** 128 files reference Egypt, 121 Cairo, 119 EGP, 106 the `+20` phone prefix, 118 "Pro-Estate", 50 `pro-estate.net`. The concentration is telling — the largest single cluster is **`libs\api\ai-agent` (39 files)**, because the agent prompts, all 22 SKILL.md files, and both eval datasets are saturated with real-estate and Egyptian-market specifics (Maadi, Zamalek, New Cairo, payment plans, delivery/handover).
- Good news: **the coupling is concentrated in prompts, skills, datasets, seeds, and test fixtures — not in infrastructure.** Roughly 70% of the agent infrastructure is domain-neutral and lifts cleanly (`memgraph.store.ts`, `memory-curator.service.ts`, all four middleware, `agent-run-manager.service.ts`, `skills-backend.ts`, `model.factory.ts`, `pg-checkpointer.service.ts`, the pgvector migrations, the entire evals lib minus its two dataset JSONs). The backend social libs are essentially clean — every Egypt hit there is a test fixture. The one genuine domain leak is `publishing-orchestrator.service.ts:60-66`'s optional `projectId`, ~10 lines, trivially generalized.
- On the frontend the coupling is quarantined: deleting `libs\admin\feature-social\src\lib\property-post-creator\` and `post-composer\attach-project-section\` removes essentially all of it, leaving a generic composer, previews, calendar, and moderation UI intact.
- **Recommendation: do NOT scrub the domain out of `/reference/`.** A real app is about _something_, and the specificity is what makes it credible. Scrub it from `/saas-project/`, and use "re-point the prompts, skills, and eval datasets at your own domain" as an explicit, high-value cohort exercise — the eval harness gives members a scoreboard for doing it well.

**Operational constraints to disclose before someone pays:**

- **Zernio is a paid third-party dependency.** No `ZERNIO_API_KEY`, no social features. Disclose at the sales page, not in week 5.
- The full local stack is **12 docker-compose services** including Ollama, a reranker, Memgraph, and voice STT/TTS. Many cohort laptops will not run it. `/saas-project/` must need only Postgres + Redis (+ MinIO optionally).

**Confirmed safe:** `.env` is correctly gitignored; `.env.test` contains only dummy values; `eval-results/` and the real `eval.*.config.json` files are gitignored, and the two tracked `eval.*.example.json` files carry only `<PLACEHOLDER>` / `${ENV_VAR}` values. Secret hygiene in this repo is genuinely good — `docs\product\known-issues.md`'s claim of "no hardcoded secrets in source code" holds up.

---

## 5. Scale realism — the honest answer

**A cohort cannot build property-hub in 6–8 weeks. Not a chance, and not close.** It represents roughly six months of work by two full-time senior engineers (1,885 commits, 2026-01-31 → 2026-07-18). A member working evenings for eight weeks has perhaps 5–8% of that budget, and unlike the original team they are also _learning_ the stack.

**Recommendation: a deliberately reduced teaching variant, with the full repo as read-only reference. Both. Not one or the other.**

The sizing supports this concretely. Measured end-to-end domain slices in property-hub:

| Domain          | API                    | Admin (feature + data-access) | Total         |
| --------------- | ---------------------- | ----------------------------- | ------------- |
| `contacts`      | 8 files / 1,526 lines  | 16 files / 2,575 lines        | ~4,100 lines  |
| `opportunities` | 27 files / 3,696 lines | 15 files / 4,466 lines        | ~8,200 lines  |
| `properties`    | 15 files / 3,686 lines | 17 files / 6,128 lines        | ~9,800 lines  |
| `leads`         | 23 files / 7,279 lines | 25 files / 9,336 lines        | ~16,600 lines |

Plus a shared foundation of `libs/api/auth` (4,923), `libs/shared/contracts` (2,800), `libs/api/util` (4,185), `libs/common/access` (707), `libs/common/config` (592), `libs/shared/client/http` (748) ≈ **14,000 lines**.

So a realistic 8-week member outcome is **foundation (~14K, mostly guided/scaffolded) + two-to-three of the smaller verticals (~12–20K)** = **~15,000–25,000 lines**, or 3–5% of property-hub. That is a genuinely impressive portfolio artifact and an honest promise. Promising more will produce refunds.

**Design the teaching variant to these constraints:**

- **Postgres + Redis only** for the required path. MinIO optional in the storage week. Ollama/Memgraph/reranker/voice belong strictly to the optional advanced-agent track, with a hosted-API fallback (Anthropic or OpenAI key) so nobody is blocked by hardware.
- **Target ~15 Nx projects, not 146.** Teach the boundary _rules_ against the reference's 146; practise them at 15.
- **Two or three domains, chosen by the member for their own product.** `contacts`-scale, not `leads`-scale.
- **No Zernio.** Substitute one webhook-based integration a member can actually get credentials for.
- **Ptah is the force multiplier and should be measured as such.** `saas-workspace-initializer` scaffolds week 1; `nestjs-backend-patterns` and `angular-frontend-patterns` carry weeks 2–5. The realistic 15–25K estimate already assumes Ptah is doing the boilerplate — which is, not incidentally, the product demonstration.

**Where the full repo earns its keep:** as the answer to "what does this look like when it's real?" — the god objects, the drift between a locked contract and 20 violations of it, the dead ZenStack layer, the disabled e2e suite. Senior engineers learn as much from a well-annotated real system's compromises as from a clean toy. `CORRECTIONS.md` turns every one of those flaws into curriculum instead of embarrassment.

---

## 6. The Arabic angle — a genuine asset, not incidental

**This is the strongest single argument for property-hub, and it is not close.**

Programmatically verified leaf-key counts:

| File pair                           | en        | ar        | missing in ar |
| ----------------------------------- | --------- | --------- | ------------- |
| `apps\admin\src\assets\i18n\`       | 5,876     | 5,876     | 0             |
| `apps\tenant\src\assets\i18n\`      | 1,146     | 1,146     | 0             |
| `apps\saas\src\assets\i18n\`        | 587       | 587       | 0             |
| `libs\shared\i18n\src\assets\i18n\` | 149       | 149       | 0             |
| **Total**                           | **7,758** | **7,758** | **0**         |

**Zero missing keys.** Only ~1.2% of Arabic values contain no Arabic characters, and those are legitimate non-translatables (brand names, "WhatsApp", "CRM", numerals). The `ar.json` files are consistently **~28% larger in bytes** than their `en.json` counterparts (378 KB vs 295 KB for admin) — the UTF-8 signature of genuine Arabic text, not copied English. This is not a stubbed locale.

**RTL is engineered, not bolted on:**

- `libs\shared\i18n\src\lib\direction.service.ts` — signal-based, sets both `document.documentElement.dir` and `lang`, SSR-safe via `isPlatformBrowser` with the signal updated regardless so hydration matches.
- `lang.service.ts` — `switchLanguage()` drives Transloco + direction + `localStorage` in one call.
- **Tailwind 4 native `rtl:` variants — 76 usages across 28 files**, plus ~145 files using logical properties (`ms-`/`me-`/`ps-`/`pe-`/`text-start`) against only 17 still using physical `ml-`/`mr-`/`text-left`. That ratio is the tell: RTL-first was the actual working convention, not an afterthought.
- **RTL is tested end-to-end.** `apps\admin-e2e\src\post-detail\i18n-rtl.spec.ts` seeds `localStorage.language='ar'` pre-bootstrap, asserts `<html dir="rtl">`, and — the sophisticated part — verifies the Tailwind `rtl:` variant by reading **computed margin** via `page.evaluate` rather than asserting class names.

**And the bilingual constraint drove real architectural decisions**, which is what elevates this from "translated UI" to teachable engineering:

- The Postgres full-text migration deliberately uses the `'simple'` FTS config rather than `'english'` **because no Arabic stemmer exists and `'english'` would silently drop Arabic tokens** — documented in `20260615000000_entity_embeddings_sparse_tsv\migration.sql`.
- A locale-driven reply-language directive in the agent system prompt.
- `LANGUAGE_NORM_MAP` normalizing LLM output `"Arabic"` → `LeadLanguage.AR`.
- A `lang` column on `agent.platform_docs`; `.ar.md`/`.en.md` variants throughout the starter knowledge content.

**Verdict: a genuine, first-class asset for the Arabic cohort — arguably the reason to run one.** The course's own `angular-multi-language-support-transloco.md` is thin by comparison. An Arabic-language cohort can be taught against a codebase where Arabic is a _design constraint that shaped the database_, taught by engineers who actually did it, in a market the reference app was built for. That is a differentiator no competing course can copy.

Two caveats: the language switcher lives in the admin shell rather than being one shared component across all three apps, and `docs\product\known-issues.md:64-72` records that _property content_ multilingual support is only partially done (`titleAr` exists in the schema, but neither `libs/admin` nor `libs/tenant` reads the `*Ar` fields yet). The **UI chrome** is fully bilingual; **user-generated content** is not. Say so plainly.

---

## 7. Summary for the busy reader

- **Verdict: adopt as reference, not as the build target.** property-hub is a real, actively developed (1,885 commits in <6 months), unusually clean (0 `@ts-ignore` across ~2,215 files) multi-tenant SaaS. It resolves [PA]'s two biggest findings — the missing narrative spine and the version drift — in one move, and is stack-aligned with Ptah itself (Angular 21 / NestJS 11 / Nx 22 / Astro 6 Starlight).
- **Three things must be corrected before selling seats:** (1) **224 ZenStack policy rules are dead code** while `docs\architecture\multi-tenancy.md` claims they enforce tenant isolation — independently verified false; (2) **billing does not exist** in any form; (3) **the e2e suite is red and disabled in CI**. All three make excellent cohort curriculum; none can ship framed as finished.
- **Social media integration is a vendor ACL over Zernio, not platform integration.** Zero direct platform API clients. Superb ports/adapters, circuit-breaker/retry/rate-limit middleware, and the best webhook-hardening file I've seen — but the hard parts (OAuth refresh, token encryption, resumable video upload, rate-limit budgets) all live on the vendor's side. Market it as vendor-integration architecture and it's an asset; market it as "build social integrations" and students will feel misled.
- **The AI capabilities substantially over-deliver and have zero course coverage.** Literally `deepagents` + LangGraph + Postgres checkpointer; three-tier memory (pgvector/HNSW/hybrid-RRF, Memgraph graph memory, LangGraph checkpoints) with an LLM reflection and confidence-decay curation pipeline; a two-layer skill system (22 `SKILL.md` progressive-disclosure files + 183 zod tools + Composio federation + per-tenant policy gating); HITL approval; resumable SSE runs; and a real eval harness with LLM judges, 34 cases, Ragas export, CI thresholds, and 9 committed regression runs _including honest failures_. **This is the material that justifies the membership price**, and it converges remarkably with Ptah's own `memory-curator` / `skill-synthesis` / `agent-sdk` — the best possible proof point.
- **Scale: reduced teaching variant, definitively — plus the full repo read-only.** ~447K authored lines across 146 Nx projects is ~6 engineer-months. A member can realistically ship **15–25K lines: a shared foundation plus two or three `contacts`-scale verticals**, which is 3–5% of the reference and an honest, demo-able outcome. Keep the required local stack at Postgres + Redis; the full 12-service compose (Ollama, Memgraph, reranker, voice) belongs to an optional advanced track with a hosted-API fallback.
- **Arabic is the sleeper asset.** 7,758 keys × 2 locales with **zero** missing, genuine Arabic (not English fallback), Tailwind 4 `rtl:` variants, RTL verified by _computed style_ in e2e — and bilingualism that drove a real database decision (Postgres FTS `'simple'` over `'english'`). This alone justifies the Arabic cohort.
- **Must not ship:** no `LICENSE` exists at all (`UNLICENSED`) — a hard blocker until an explicit grant is written; **11 commercially sensitive docs are currently tracked in git**, including `docs\fundraising\financial-model-and-data-room.md`, `CLIENT-PROPOSAL.{md,pdf}`, `PITCH-DECK.md`, a vendor pricing analysis, and a competitor analysis; seed scripts carrying real third-party brands (**Emaar**, ItqanLab, Hills Property); bundled music/SFX needing a redistribution review; and 661 files of internal `task-tracking/`. Egypt/brand coupling (128 files) should be scrubbed from the teaching variant but **kept** in the reference — specificity is what makes it credible.

---

## Appendix — key file references

**Read these first, in this order:** `ARCHITECTURE_CONTRACT.md` · `docs\architecture\multi-tenancy.md` (then immediately `libs\common\data-access-orm\src\prisma-orm\prisma.service.ts` to see the contradiction) · `docs\product\known-issues.md` · `LOCAL_SETUP.md`.

**Best teaching artifacts:** `libs\api\social-webhooks\src\lib\zernio-webhook.controller.ts` · `libs\common\access\src\lib\access-control.ts` · `libs\api\ai-agent\src\lib\memory\memory-curator.service.ts` · `libs\api\ai-agent\src\lib\memory\memgraph.store.ts` · `libs\api\ai-agent\src\lib\middleware\compaction.middleware.ts` · `libs\api\ai-agent\src\lib\agent-run-manager.service.ts` · `libs\api\ai-agent\src\lib\skills-backend.ts` · `libs\api\ai-agent-evals\` (whole lib) · `libs\common\storage\src\lib\{sniff,image,extract}\` · `libs\api\social-posts\src\lib\services\scheduled-post.service.ts:66-73` · `libs\shared\i18n\src\lib\direction.service.ts` · `apps\admin-e2e\src\post-detail\i18n-rtl.spec.ts` · `Dockerfile` · the four `libs\common\data-access-orm\prisma\migrations\2026061*` pgvector migrations.

**Do not show whole (extract only):** `libs\common\social-media\src\zernio\zernio.client.ts` (5,483 lines) · `libs\api\ai-agent\src\lib\agent.service.ts` (2,489) · `libs\api\social-posts\src\lib\social-posts.controller.ts` (1,148) · `libs\api\ai-agent\src\lib\tools\pages.tools.ts` (1,519) · `libs\admin\feature-ai-agent\src\lib\stores\agent-chat.store.ts` (1,289).
