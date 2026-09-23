---
status: planned
type: feature
title: 'Task intake classification: typed intake, gate triggers and routing (local-first, BYO TypeSafe key)'
depends_on: [TASK_2026_535, TASK_2026_536]
blocks: []
---

# TASK_2026_537 — Harden task intake with classifiers

## Why

Routing and gating live in prose the orchestrator can skip. PR #575 was a
"replace an existing surface" request that no rule forced through a parity
inventory or a design gate. A typed intake result lets CODE enforce the gates
added in TASK_2026_533, and lets routing use evidence from TASK_2026_535/536.

## Principles
- **Local-first.** Default classifier runs on the user's machine using data we
  own. User data never leaves the machine unless the user opts in.
- **Bring your own key.** TypeSafe (Jev, `POST /v1/systemone`, Choice / Noul /
  Score primitives with calibrated probabilities) is an optional adapter using the
  user's own key, stored via `AuthSecretsService.setProviderKey`
  (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:263-279`,
  `ptah.auth.provider.<id>`). Request text only by default — never source code
  unless the user enables it per workspace.
- **Rules before models.** Exact codebase facts (Nx tags, settings writers, UI
  components, file ownership) come from the AST / symbol index / grep, not a model.
- **Augment, never rewrite** the user's prompt: attach a typed intake block.

## Scope

1. **Port** `ITaskClassifier` (backend, runtime-agnostic lib; logs through
   `IOutputChannel`, not vscode-core): input = request text + workspace facts;
   output `IntakeResult` = taskType (Choice), depth (Score), flags (Noul each:
   replacesExistingSurface, touchesUiSurface, changesPersistedSettings, ambiguous,
   destructive), requiredGates (derived by CODE from flags), routeSuggestion per
   phase (lane + model from `ptah_agent_list({includeModels})` + scorecards),
   per-answer confidence, `mustAskUser`. Follow the `SkillJudgeService` pattern
   (schema-validated, unknown → null, never invented).
2. **Adapters**
   - `local`: our own classifiers — embeddings with the bundled local embedder
     (`Xenova/bge-small-en-v1.5`, `memory-curator/.../embedder-worker-client.ts:60`)
     + kNN / logistic heads trained on the TASK_2026_536 dataset and
     `.ptah/specs/**/task.md` history. No network.
   - `typesafe` (opt-in, BYO key): one request with all questions over one `state`;
     backoff on 429/529; timeout; falls back to `local`.
   - `llm` fallback: existing internal query path with a JSON schema.
3. **MCP tool** `ptah_task_classify` + RPC; orchestration pre-flight calls it.
   Flag → gate mapping enforced in code and in the plugin `orchestration` skill:
   replacesExistingSurface ⇒ `parity-inventory.md` + Gate 1.7;
   touchesUiSurface ⇒ designer + prototype + visual review;
   changesPersistedSettings ⇒ write-path trace; ambiguous ⇒ Gate 0.
   Confidence zones (start: ≥0.9 act, 0.5–0.9 confirm, <0.5 ask) are settings,
   calibrated on our eval set — not constants.
4. **Review classifiers** on the same port: does a finding's evidence support its
   claim (citation-check pattern), severity/category, dedupe across reviewers.
5. **Evaluation harness**: labeled set from `.ptah/specs` history (type from
   frontmatter; hand-label "replaced a surface" incl. TASK_2026_523) +
   TASK_2026_536 lane outcomes. Report accuracy / calibration per question and per
   adapter; the gate thresholds ship only with a passing eval.
6. **Settings UI** (Providers → Intelligence, designed via Gate 1.7): adapter
   choice, BYO TypeSafe key, "send code context" toggle, thresholds.

## Research first (Gate before design)
- TypeSafe: measured latency and cost per intake call, rate limits, data
  retention/privacy terms, determinism. Docs do not state latency or pricing.
- Local classifier baseline accuracy vs `llm` fallback on the eval set.

## Acceptance
- On the eval set, the `replacesExistingSurface` flag fires for TASK_2026_523.
- With no key configured, intake works fully offline via `local`.
- BYO key never logged, never sent anywhere except the TypeSafe endpoint.
- Orchestration skill uses the tool; missing tool/host → current prose flow.
