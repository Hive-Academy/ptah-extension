---
id: TASK_2026_304
status: backlog
type: feature
title: >-
  Per-session provider selection for interactive chat — two tabs in one
  workspace on two different providers
description: >-
  Today provider selection for the interactive chat path is resolved once per
  WORKSPACE: `ChatSessionService` calls
  `resolveProviderProfileForWorkspace(workspacePath, model)` at both `chat:start`
  and the `chat:continue` resume, so two chat tabs open on the same folder always
  get an identical `ProviderProfile` and therefore an identical provider. The
  per-call seam that would make them differ already exists end to end —
  `AgentSessionStartConfig.providerProfile` is a per-session parameter,
  `SdkAgentAdapter` turns it into `authEnvOverride` + `cliJsPath` + model, and
  `SdkQueryOptionsBuilder` merges it into the SUBPROCESS env only, never into
  `process.env` — and the Ptah-CLI lane already proves the pattern by resolving a
  fully isolated profile per agent id. The only thing missing on the interactive
  path is a SESSION-level key: the resolver is keyed on `workspacePath` alone and
  is gated to return `undefined` unless that workspace carries an explicit
  `anthropicProviderId` / `authMethod` override. Closing that gap is not a
  one-line change, because four things hang off it — the proxy pool is keyed
  `${workspacePath}::${providerId}` and has no session-scoped teardown, the model
  for a turn is read from the ambient `modelSettings.selectedModel` rather than
  from the session's own provider catalogue, `auth:saveSettings` calls
  `sdkAdapter.reset()` process-wide so changing one tab's provider disturbs every
  other, and the frontend selects a provider globally
  (`PtahCliStateService._selectedAgentId` is one signal for the whole webview,
  and `ChatContinueParams` carries no provider id at all, so the backend's
  in-memory tab-to-agent map is the only thing remembering the choice and it does
  not survive a host restart). This task adds the session-level key, scopes the
  proxy lifetime and the auth reset to it, moves provider+model selection into
  per-tab frontend state, and closes the two adjacent always-global holes the
  work exposes (the gateway lane, which passes no profile at all, and the tier
  env leak through `...process.env`). Per-workspace CREDENTIALS stay out of
  scope — `IAuthSecretsService` slots are keyed by provider id alone and OAuth
  token state is machine-global by design.
---

# Per-session provider selection for interactive chat

Machine-owned metadata carrier. Prose lives in `./context.md`; the batch
breakdown lives in `./tasks.md`.
