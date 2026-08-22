# Context — TASK_2026_299

## User intent

Repair two internal MCP tools that are broken across runtimes:

1. **`ptah_search_files`** — promises glob discovery but sends the glob text to a
   fuzzy substring index and swallows failures into `[]`. Must become a true
   filesystem glob operation.
2. **`ptah_get_diagnostics`** — reads live VS Code diagnostics, but Electron and
   CLI are intentional empty stubs; the formatter wrongly labels every empty
   result as "No issues found." Must return an honest available/unavailable
   contract and back Electron/CLI with a real TypeScript compiler diagnostics
   provider.

## Source plan

The user supplied a full implementation plan (architecture + phased steps +
scope guardrails). It is reproduced verbatim below and serves as the
implementation-plan deliverable — the PM/Architect phases are effectively
pre-completed by it.

---

## Plan: Repair internal file search and diagnostics across runtimes

### Context

ptah_search_files promises glob discovery but sends the glob text to a fuzzy
substring index and swallows failures into []. ptah_get_diagnostics reads live
VS Code diagnostics, but Electron and CLI are intentional empty stubs; the
formatter wrongly labels every empty result as "No issues found." History
confirms commit 71aed800f introduced the Electron stub, while TASK_2026_200
fixed Electron workspace-index scoping, not project diagnostics.

### Decisions

- Keep glob discovery and fuzzy relevance separate. ptah_search_files becomes a
  true filesystem glob operation; relevance tools keep fuzzy behavior.
- Use `IFileSystemProvider.findFiles(pattern, excludes, limit, cwd)` with the
  calling session's workspace root. Do not route glob search through the fuzzy
  index.
- Remove catch-to-empty behavior. Existing MCP dispatcher error handling will
  return `isError: true`; only a successful zero-match operation returns `[]`.
- Change `IDiagnosticsProvider.getDiagnostics(workspaceRoot?)` to async and
  capability-aware:
  - `{ status: 'available', source, diagnostics }`
  - `{ status: 'unavailable', source, reason }`
- VS Code remains backed by `vscode.languages.getDiagnostics()`, scoped to the
  requested root.
- Electron and CLI share a focused `TypeScriptDiagnosticsProvider` in
  workspace-intelligence. It uses the TypeScript compiler API against workspace
  `tsconfig*.json` files and project references. Runtime composition replaces
  the Phase 0 placeholder after workspace-intelligence registration, avoiding
  adapter-to-domain dependencies.
- Do not spawn Nx or shell commands. Add `typescript` to shipped Electron/CLI
  dependencies and external build lists.
- Do not cache diagnostics in this fix; workspace-switch correctness takes
  priority.

### Implementation

#### 1. True glob search

- Update `vscode-lm-tools/.../core-namespace.builders.ts` to inject
  `IFileSystemProvider`, resolve the session root per call, invoke `findFiles()`
  with `DEFAULT_WORKSPACE_EXCLUDES`, and return normalized workspace-relative
  paths.
- Keep `getRelevantFiles()` fuzzy, but propagate thrown and `{ success:false }`
  failures.
- Pass the filesystem provider through `PtahAPIBuilder`'s `coreDeps`.
- Update `VscodeFileSystemProvider.findFiles()` to honor `cwd` with
  `vscode.RelativePattern`, matching its watcher implementation.
- Update focused tool/help wording.
- Tests prove wildcard delegation, session-root use, relative output, true
  no-match behavior, explicit errors, VS Code RelativePattern, and MCP
  `isError: true` routing.

#### 2. Honest diagnostics contract

- Extract diagnostic severity/entry/result types in platform-core; update its
  barrel, mocks, and adapter contract tests.
- Update `DiagnosticsNamespace` to preserve status/source/reason with flattened
  diagnostics.
- Pass the session-aware root into the provider and filter severities without
  losing capability metadata.
- Update `formatDiagnostics()` so unavailable is explicit and "No issues found"
  appears only for an available source with zero diagnostics.
- Update Ptah help/system-prompt descriptions.

#### 3. Runtime diagnostics

**VS Code**

- Return the async available result with `source: 'vscode-languages'`.
- Filter diagnostics to the requested workspace root.
- Preserve severity mapping and zero-based line numbers.

**Electron and CLI**

- Add `workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`:
  - Discover non-ignored `tsconfig*.json` files under the requested root,
    excluding generated/vendor trees.
  - Parse configs with the TypeScript API and collect config, syntactic,
    options, global, and semantic diagnostics.
  - Traverse project references once, deduplicate by
    file/start/code/message, flatten message chains, map severity, and
    calculate source lines.
  - Return unavailable for no root, no config, or missing compiler; throw only
    for genuine execution failures.

**Composition and packaging:**

- Change Electron/CLI Phase 0 placeholders from `[]` to explicit unavailable
  results.
- After workspace-intelligence registration, override
  `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` with the shared provider in Electron
  and CLI full runtime composition.
- Add `typescript` to `apps/ptah-electron/package.json` and
  `apps/ptah-cli/package.json`, plus their external bundle lists.
- Tests cover clean/error projects, project references, malformed/no config,
  deduplication, workspace switching, Windows paths, full-runtime DI
  replacement, and placeholder unavailability.

#### 4. Verification

- Run affected typechecks, Jest suites, and Electron/CLI builds for
  platform-core, all three platform adapters, workspace-intelligence,
  vscode-lm-tools, cli-engine, ptah-electron, and ptah-cli.
- Then exercise:
  - `ptah_search_files` with `**/*diagnostic*.ts`, a no-match glob, and an
    error/no-root case.
  - Diagnostics against clean and intentionally broken fixtures in VS Code,
    Electron, and CLI, checking source/status wording.
  - A final code-logic-reviewer pass focused on session-root containment,
    project-reference traversal, deduplication, and unavailable-vs-clean
    semantics.

### Scope guardrails

- No frontend changes.
- No long-lived language server or Monaco bridge.
- No Nx-specific process execution.
- No redesign of fuzzy relevance tools or the live file index.

## Orchestration notes

- Task type: BUGFIX (repair) + REFACTORING (contract change).
- Workflow: Full, but implementation-plan supplied by user — PM/Architect
  phases pre-completed. Proceed to team-leader MODE 1 (decompose into batches)
  then execute.
- CLI delegation: **disabled** (Checkpoint 0.1 → user chose sub-agents only).
  All work via Task sub-agents (backend-developer, senior-tester,
  code-logic-reviewer). No CLI fan-out.
