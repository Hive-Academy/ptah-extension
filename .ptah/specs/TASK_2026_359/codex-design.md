# TASK_2026_359 design

Baseline: committed `HEAD`, because the worktree changed concurrently during design. The existing generator makes one structured call per template, accepts arbitrary section strings, and substitutes authored fallback only for missing output (`libs/backend/agent-generation/src/lib/services/content-generation.service.ts:211-365`). The design keeps the one-call shape but replaces its input, prompt, schema, and per-section acceptance gate.

## A. Generation prompt

### Evidence projection

Do not send `AgentProjectContext` or phase Markdown directly. `AgentProjectContext` currently exposes ungrounded stack summaries plus an `analysisDir` escape hatch (`libs/backend/agent-generation/src/lib/types/core.types.ts:313-371`); `formatAnalysisData()` serializes percentages and censuses (`libs/backend/agent-generation/src/lib/services/content-generation.service.ts:650-735`), while `readPhaseContextForRole()` sends raw phase files (`libs/backend/agent-generation/src/lib/services/content-generation.service.ts:819-925`). Replace both paths with one projection:

```ts
interface SectionEvidenceInput {
  roleId: string;
  sectionId: SectionId;
  topic: string;
  roleQuestion: string;
  authoredFallback: string; // format/intent only; never evidence
  allowedEvidencePaths: string[]; // normalized, workspace-relative, unique
  evidenceFacts: Array<{ claim: string; evidencePath: string }>;
}
```

Build `allowedEvidencePaths` from `relevantFiles[].relativePath`, `fullAnalysis.keyFileLocations`, and path-shaped `architecturePatterns[].evidence`; the schema already carries those fields (`libs/backend/agent-generation/src/lib/services/wizard/analysis-schema.ts:208-267`). Include an evidence fact only when its path is an exact member of that set. Path-backed `qualityIssues[].description/recommendation` may be included only if the normalized analysis contract is extended to retain an allowlisted `affectedFiles` entry; normalization currently drops it (`analysis-schema.ts:381-395,491-499`), so omit these facts until then. Path-cited facts extracted from phase documents may be included after the same check; never pass the raw documents.

The prompt may receive only the fields above. It must not receive raw `projectType`, `frameworks`, `techStack`, `codeConventions`, `languageDistribution`, confidence, coverage, issue counts, quality score, file count, sizes, token estimates, dependency versions, timestamps, `rootPath`, `analysisDir`, or uncited phase prose. The numeric fields that must be withheld are visible in `analysis-schema.ts:269-331,332-380,381-410`. A framework/tool name may appear only inside a path-backed `evidenceFact`, not merely because a detector returned it.

Do not append `enhancedPromptContent` or discovered plugin-skill prose to this call: both are uncited claim channels today (`content-generation.service.ts:271-279`). If either supplies formatting constraints, normalize those into non-factual prompt controls; it never becomes evidence. Disable MCP/tool wiring for this evidence-bound call as well; the current call enables it despite telling the model it has no tools (`content-generation.service.ts:257-264,288-298`).

### Section topics

| Section ID                 | Role question                                                                          | Allowed topic                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `FRAMEWORK_CONVENTIONS`    | Developer: “How is code written with the frameworks used here?”                        | Path-backed API usage, state/DI/validation/error idioms, naming and lifecycle conventions.                                            |
| `ARCHITECTURE_PATTERNS`    | Developer: “Where does code belong and how is it wired here?”                          | Boundaries, dependency direction, module layout, ports/repositories/services, integration seams.                                      |
| `BUILD_AND_DEPLOY_SURFACE` | DevOps: “How does this repository build, test, package, migrate, release, and deploy?” | Commands, configuration ownership, workflow/trigger patterns, artifacts, migration and rollback conventions.                          |
| `TEST_INFRASTRUCTURE`      | Tester: “How are tests written and run here?”                                          | Runner/config, suite placement, fixtures, mocking, harnesses, canonical commands and test levels.                                     |
| `EXISTING_PATTERNS`        | Architect: “Which proven shapes should a design reuse?”                                | Existing component boundaries, wiring, contracts, failure seams and test seams.                                                       |
| `REVIEW_FOCUS`             | Reviewer: “What should this reviewer look for in this repository?”                     | Style: boundaries/conventions; logic: failure/data-flow/wiring risks; visual: tokens/layout/states/accessibility. Select by `roleId`. |

### Replacement system prompt (full text)

```text
You generate repository-specific guidance sections for software-agent templates.

You have no tools and must not explore the filesystem. The caller supplies the complete, prevalidated evidence set. Treat only EVIDENCE FACTS as factual. The authored fallback explains the intended shape but is never evidence.

For every requested section:
- Answer the role question for that section, not a generic repository summary.
- Write only stable conventions and recurring patterns: how code is written, where it belongs, how it is wired, built, tested, or reviewed.
- Produce 8 to 15 non-empty physical lines. Every line must be one Markdown bullet beginning "- "; do not wrap a bullet onto another line.
- Put one actionable claim in each bullet.
- End every bullet with exactly one evidence path in parentheses, copied exactly from ALLOWED EVIDENCE PATHS, for example: (src/example.ts).
- Use a claim only when the matching EVIDENCE FACT names that same path. A path's mere presence does not prove a convention.
- If fewer than eight distinct supported claims exist, return an empty string for that section so the caller can keep the authored generic fallback.

Never output counts or censuses, version numbers, semantic versions, percentages, dates, coverage or confidence values, quality scores, repository-size claims, temporary status, or predictions. Never invent or alter a path. Never cite a URL, absolute path, glob, directory guess, or path absent from ALLOWED EVIDENCE PATHS. Never turn detected framework, language, package-manager, or project-type labels into a claim unless an EVIDENCE FACT supports the claim with the cited path.

Section values are Markdown bullets only: no headings, prose preface, tables, code fences, template markers, placeholders, or JSON embedded inside a value. Return exactly the JSON object required by the supplied schema and no other text.
```

### Per-section user prompt (full text)

Render this block once per requested section and concatenate the blocks under `SECTION REQUESTS`; the SDK call remains one per template (`content-generation.service.ts:203-207`; `content-generation.service.spec.ts:451-486`). `{{TOPIC}}` and `{{ROLE_QUESTION}}` are the exact values in the section-topic table above, not a free-form humanization of the ID.

```text
SECTION REQUEST
Role: {{ROLE_ID}}
Section ID: {{SECTION_ID}}
Topic: {{TOPIC}}
Role question: {{ROLE_QUESTION}}

AUTHORED FALLBACK (intent and format only; do not copy it and do not cite it):
{{AUTHORED_FALLBACK}}

ALLOWED EVIDENCE PATHS (copy one exactly at the end of each bullet):
{{ALLOWED_EVIDENCE_PATHS_AS_JSON}}

EVIDENCE FACTS (the only factual source):
{{EVIDENCE_FACTS_AS_JSON}}

Write the answer for sections.{{SECTION_ID}}. Use 8-15 one-line Markdown bullets, one supported convention or pattern per bullet, with exactly one matching evidence path in final parentheses. For this role, answer “{{ROLE_QUESTION}}”. Do not describe repository size, inventory, versions, percentages, dates, scores, or transient status. If the evidence cannot support eight distinct bullets, set sections.{{SECTION_ID}} to the empty string; do not fill gaps with general advice.
END SECTION REQUEST
```

The call-level suffix is:

```text
Return only: {"sections":{"<requested id>":"<markdown or empty string>"}}. Include every requested ID exactly once and no unrequested key.
```

Replace the schema at `content-generation.service.ts:226-253` with:

```js
{
  type: 'object',
  additionalProperties: false,
  properties: {
    sections: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(sectionIds.map(id => [id, {
        type: 'string',
        maxLength: 6000,
        description: 'Eight to fifteen one-line path-backed Markdown bullets, or empty to request authored fallback.'
      }])),
      required: sectionIds
    }
  },
  required: ['sections']
}
```

Remove the generated `description` field and its NestJS example (`content-generation.service.ts:238-253`); descriptions are authored metadata, addressed in D.

## B. Post-generation validator

Validate each string before replacement in the loop at `content-generation.service.ts:327-343`. Use a pure `validateGeneratedSection(section, allowedEvidencePaths, evidenceFacts)` returning `{ ok: true, value } | { ok: false, reasons }`.

1. Normalize CRLF to LF and trim outer blank lines. Require 8-15 non-empty lines. Every line must match `^- .+ \(([^()\r\n]+)\)$`; reject headings, continuations, tables and multiple/empty citations. Optionally cap a physical line at 300 characters.
2. Normalize candidate paths by converting `\\` to `/` and removing one leading `./`. Reject absolute paths, `..`, URL schemes, globs and empty segments. Preserve case. Require exact membership in normalized `allowedEvidencePaths`, and require a matching `evidenceFact` for that bullet/path pair. Do not accept a merely existing path as support.
3. Mask only the validated terminal evidence parenthesis before lexical checks. Semver: `/\bv?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g`. Also reject a detected technology name followed by a major/version token, built dynamically from analysis labels: `\b(?:<escaped names>)\s+v?\d+(?:\.\d+)*\b`, plus `/\bversion\s+v?\d+(?:\.\d+)*\b/i` and `/@[0-9]+\.[0-9]+(?:\.[0-9]+)?\b/`.
4. Bare census: reject digits with `/(?<![\w/:.-])\d{1,3}(?:,\d{3})*(?:\.\d+)?\s+(?:apps?|libraries|libs?|files?|folders?|directories|packages?|projects?|modules?|components?|services?|tests?|specs?|tokens?|routes?|endpoints?|workflows?|targets?|dependencies|warnings?|errors?|issues?|lines?(?:\s+of\s+code)?|loc)\b/i`. Reject spelled counts with `/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozen)(?:-[a-z]+)?\s+(?:apps?|libraries|libs?|files?|folders?|directories|packages?|projects?|modules?|components?|services?|tests?|specs?|tokens?|routes?|endpoints?|workflows?|targets?|dependencies|warnings?|errors?|issues?|lines?)\b/i`.
5. Percentage: `/\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s+percent(?:age)?\b/i`.
6. Date/year: `/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)?\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b/i`.
7. Scan the claim text for path-shaped tokens (slash/backslash tokens and filename code spans); every extracted path must also be allowlisted and linked to an evidence fact. The terminal-citation grammar remains authoritative, so an extra path does not replace the required final one.

Semver/date text is allowed only inside the final evidence path after that path passes exact membership, e.g. `migrations/v1.2.3/schema.sql`. It is an immutable identifier, not a generated version claim. A prose claim such as “Use React 18.2.0 (package.json)” is rejected: naming `package.json` does not make a copied version durable. This narrowly permits real versioned/date-stamped paths without reopening the stale-version defect.

Tests, using allowlist `['package.json', 'src/api/order-service.ts', 'migrations/v1.2.3/schema.sql']`:

| Candidate                                                                                                                  | Result                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Eight lines shaped like `- Route handlers delegate domain work to services (src/api/order-service.ts)` with matching facts | accept                                                                   |
| Seven or sixteen otherwise valid bullets                                                                                   | reject `LINE_COUNT`                                                      |
| `- Use React 18.2.0 for components (package.json)`                                                                         | reject `VERSION`                                                         |
| `- Use the framework version recorded in the manifest (package.json)`                                                      | accept only if that convention is an evidence fact; no number is emitted |
| `- Migration scripts follow the versioned directory convention (migrations/v1.2.3/schema.sql)`                             | accept with matching fact; semver is inside an allowlisted path          |
| `- The workspace contains 15 libs (package.json)` / `- Register all 22 tokens (src/api/order-service.ts)`                  | reject `CENSUS`                                                          |
| `- The workspace contains fifteen libraries (package.json)`                                                                | reject `CENSUS`                                                          |
| `- Tests cover 72% of code (package.json)`                                                                                 | reject `PERCENTAGE`                                                      |
| `- This pattern was adopted on 2026-08-29 (package.json)` / `- Adopted in 2026 (package.json)`                             | reject `DATE`                                                            |
| `- Keep handlers thin (src/api/missing.ts)`                                                                                | reject `UNKNOWN_PATH`                                                    |
| `- Keep handlers thin because src/api/missing.ts owns persistence (src/api/order-service.ts)`                              | reject extra `UNKNOWN_PATH`                                              |
| A heading, wrapped bullet, table, marker, or bullet without final parentheses                                              | reject `SHAPE`                                                           |

On any rejection, replace only that section with `section.content`, log one structured warning containing `templateId`, `sectionId`, and reason codes, and add the same concise warning to the orchestration summary. Never include rejected model text in logs. Other valid sections from the same call survive. Empty output follows the same fallback path. Existing tests already pin authored fallback for null, thrown, and empty output (`content-generation.service.spec.ts:328-448`); extend them for each reason above and mixed valid/invalid multi-section output.

## C. Ptah-only/source-stack denylist

### Offending authored text in `HEAD`

These are all repository-specific assumptions in the five identified templates, grouped without omitting repeated occurrences:

| Template            | Ptah-specific term or phrase                                                                                                                                                                                 | `HEAD` references                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| backend-developer   | `platform-core` ports, `tsyringe`, NestJS license server, Prisma, SQLite, RPC handlers, agent-SDK, harness-sync; `libs/backend`, `libs/api`, `libs/shared`, `apps/ptah-license-server`, Zod, Angular/webview | `backend-developer.template.md:13-20`             |
| backend-developer   | `libs/backend/platform-core`, `PLATFORM_TOKENS`, `platform-vscode`, `platform-electron`, `platform-cli`, fourth-adapter rule                                                                                 | `backend-developer.template.md:76-80`             |
| backend-developer   | tsyringe, `Symbol.for(...)`, `UPPER_SNAKE`, per-lib `register.ts`                                                                                                                                            | `backend-developer.template.md:81-83`             |
| backend-developer   | Zod boundary list; `catch (error: unknown)`, `instanceof Error`, `@ts-expect-error` convention                                                                                                               | `backend-developer.template.md:84-87`             |
| backend-developer   | RPC dual registration, `libs/shared/src/lib/types/rpc.types.ts`, `ALLOWED_METHOD_PREFIXES`, `libs/backend/vscode-core/src/messaging/rpc-handler.ts`                                                          | `backend-developer.template.md:88-91`             |
| backend-developer   | exact `libs/backend`/`libs/frontend`/`libs/api`/`libs/web` isolation and `libs/shared`/`libs/api-contracts` bridges; NestJS `ConfigService` and `ValidationPipe` rules                                       | `backend-developer.template.md:92-97`             |
| backend-developer   | 700-line/facade convention; `npx nx run-many`, bad `nx test projA projB`, Jest-filter failure, `Running target test for N projects`                                                                          | `backend-developer.template.md:98-101,112-115`    |
| frontend-developer  | Angular 21, signals, `libs/frontend`, webview/Electron renderer, `libs/web`, `apps/ptah-extension-webview`, Tailwind, daisyui, RPC/NestJS                                                                    | `frontend-developer.template.md:14-20`            |
| frontend-developer  | Angular signals + `inject()`, `ChangeDetectionStrategy.OnPush`, zoneless libs/Zone shell                                                                                                                     | `frontend-developer.template.md:79-81`            |
| frontend-developer  | `[innerHTML]`, `libs/frontend/markdown`, DOMPurify; exact frontend/backend/web/shared/api-contract isolation, `@ptah-extension/shared/testing`                                                               | `frontend-developer.template.md:82-89,162-164`    |
| frontend-developer  | RPC client, `VSCodeService`, `libs/frontend/core`, dual registration                                                                                                                                         | `frontend-developer.template.md:90-93`            |
| frontend-developer  | Floating-UI `Native*`, legacy CDK, Tailwind 3, daisyui 4, `lucide-angular`, GSAP, `@hive-academy/angular-gsap`                                                                                               | `frontend-developer.template.md:94-97`            |
| frontend-developer  | Zod/error rule, 700-line/facade rule, `npx nx run-many`, bad Nx/Jest invocation and target-count header                                                                                                      | `frontend-developer.template.md:98-102,115-118`   |
| devops-engineer     | Nx/project.json, esbuild, ng-packagr, electron-builder, GitHub Actions path, Postgres/Prisma, content manifest, VSIX; negative Kubernetes/Terraform/Helm census                                              | `devops-engineer.template.md:11-18`               |
| devops-engineer     | “eighteen GitHub Actions workflows” and “four publish paths”                                                                                                                                                 | `devops-engineer.template.md:49-53`               |
| devops-engineer     | exact Nx targets/scripts, Electron subtargets, bad Nx/Jest invocation, `run-many` header                                                                                                                     | `devops-engineer.template.md:71-78`               |
| devops-engineer     | VS Code/CLI/TUI esbuild, Angular/ng-packagr, Astro, electron-builder, `ptah-electron`, native rebuild paths/scripts                                                                                          | `devops-engineer.template.md:80-84`               |
| devops-engineer     | Postgres license-server setup, `DATABASE_URL`, root `.env`, Prisma commands/error, license-server spec path                                                                                                  | `devops-engineer.template.md:86-90`               |
| devops-engineer     | complete named GitHub workflow inventory and matching Nx invocation                                                                                                                                          | `devops-engineer.template.md:92-98`               |
| devops-engineer     | `release/electron                                                                                                                                                                                            | landing                                           | docs`, Sync Release Branch, fast-forward, husky/`nx format:write`, `GITHUB_TOKEN` dispatch behavior | `devops-engineer.template.md:100-105` |
| devops-engineer     | content-manifest generator/check/generate/pruning behavior and `~/.ptah/plugins`                                                                                                                             | `devops-engineer.template.md:107-110`             |
| devops-engineer     | VSIX scanner/trademark/JS/WASM/`.vscodeignore`/runtime-download/burned-ID rules                                                                                                                              | `devops-engineer.template.md:112-116`             |
| devops-engineer     | Nx/manifest verification and exact config-only output list; absent Kubernetes/Helm/Terraform                                                                                                                 | `devops-engineer.template.md:118-130,141,150,166` |
| code-style-reviewer | hexagonal/DI/Angular signal/OnPush assumptions in description                                                                                                                                                | `code-style-reviewer.template.md:11-17`           |
| code-style-reviewer | exact lib bridges and platform adapters; `Symbol.for`, `UPPER_SNAKE`, `register.ts`                                                                                                                          | `code-style-reviewer.template.md:83-91`           |
| code-style-reviewer | Angular OnPush/`inject()`/signals/`innerHTML`/frontend paths; NestJS `process.env`/`ConfigService`/`ValidationPipe`                                                                                          | `code-style-reviewer.template.md:92-100`          |
| code-style-reviewer | 150/700-line facade rules, `kebab-case.ts`, `I`-prefix, `{platform}-{capability}.ts`, Angular-specific checklist                                                                                             | `code-style-reviewer.template.md:101-107,181-190` |
| code-logic-reviewer | Zod-specific external-boundary rule; Ptah RPC half-registration with `libs/shared`, `ALLOWED_METHOD_PREFIXES`, `rpc-handler.ts`, tsyringe and `register.ts`                                                  | `code-logic-reviewer.template.md:94-99`           |

`ptah_get_diagnostics`, `ptah_browser_*`, `.ptah/specs`, task-document names, and shared marker protocol are legitimate harness contracts, not analyzed-repository claims; do not deny them. Likewise, `applicabilityRules`, `templateVersion`, and routing metadata are not emitted instructions.

### Guard regexes

Add the guard to `template-sharing.guard.spec.ts`, which already discovers the fixed 15-template corpus (`template-sharing.guard.spec.ts:49-60`). For each file parse gray-matter and scan `String(data.description) + '\n' + content`. This includes frontmatter descriptions and every `LLM` fallback, but excludes applicability/version routing metadata. Do not strip LLM ranges.

| Regex (case-insensitive unless shown)       | Why / false-positive policy     |
| ------------------------------------------- | ------------------------------- | ---------------------------------- | ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------- | ---------------------- |
| `/(?:@ptah-extension\/                      | apps\/ptah-                     | ~\/\.ptah\/plugins                 | libs\/(?:backend       | frontend                                    | api                                                                                                                       | web                                              | shared                              | api-contracts)(?:\/                                                                                                                                                      | \b))/i`                                            | Exact Ptah package/app/lib topology. Deliberately does not match `.ptah/specs`. |
| `/\b(?:platform-core                        | platform-vscode                 | platform-electron                  | platform-cli           | PLATFORM_TOKENS                             | ALLOWED_METHOD_PREFIXES                                                                                                   | VSCodeService                                    | harness-sync                        | agent-SDK)\b/i`                                                                                                                                                          | Ptah ports, runtime adapters, guards and services. |
| `/\b(?:Angular(?:\s+\d+)?                   | ChangeDetectionStrategy\.OnPush | DOMPurify                          | Floating-UI            | daisyui                                     | lucide-angular                                                                                                            | angular-gsap                                     | Tailwind\s+\d+                      | zoneless                                                                                                                                                                 | Zone-based                                         | legacy CDK)\b/i`                                                                | Frontend stack/conventions observed in authored instructions. “Angular” is generic, but a source template must say “detected UI framework”; applicability metadata remains exempt. |
| `/\b(?:tsyringe                             | NestJS                          | Prisma                             | SQLite                 | Zod                                         | ConfigService                                                                                                             | ValidationPipe                                   | ng-packagr                          | electron-builder                                                                                                                                                         | esbuild                                            | Astro                                                                           | Postgres                                                                                                                                                                           | Jest             | VSIX)\b/i`        | Backend/build stack bindings. Prisma is a legitimate generic ORM, but hardcoding it in a shipped generic role is still the defect; it may appear later only in validated generated output. |
| `/(?:Symbol\.for\(\.\.\.\)                  | UPPER_SNAKE                     | catch \(error: unknown\)           | instanceof Error       | @ts-ignore                                  | @ts-expect-error                                                                                                          | kebab-case\.ts                                   | \{platform\}-\{capability\}\.ts)/i` | Ptah coding-standard literals that belong in generated conventions, not authored fallback. Common TypeScript patterns are intentionally denied only in source templates. |
| `/(?:npx nx run-many                        | nx test projA projB             | Running target test for N projects | nx format:write        | nx package ptah-electron)/i`                | Exact Ptah/Nx operational rules; broad `Nx` is not denied because role-owned portable skills may legitimately discuss Nx. |
| `/(?:Sync Release Branch                    | sync-release-branch\.yml        | release\/(?:electron               | landing                | docs)                                       | GITHUB_TOKEN)/i`                                                                                                          | Ptah release topology and trigger behavior.      |
| `/(?:ci                                     | semgrep                         | content-manifest                   | nightly-coverage       | cli-e2e                                     | electron-e2e                                                                                                              | vscode-e2e                                       | webview-e2e                         | deploy-docs                                                                                                                                                              | deploy-landing                                     | deploy-server                                                                   | publish-cli                                                                                                                                                                        | publish-electron | publish-extension | render-showcase                                                                                                                                                                            | upload-recordings | authorize-workstation-key)\.yml/i` | Named workflow census. |
| `/(?:scripts\/generate-content-manifest\.js | manifest:(?:check               | generate)                          | prisma:migrate:(?:dev  | deploy)                                     | docker:db:start                                                                                                           | apps\/ptah-electron\/scripts\/rebuild-native\.js | \.vscodeignore)/i`                  | Ptah-only scripts, manifest, migration and packaging rules.                                                                                                              |
| `/(?:700-line                               | 150 lines                       | eighteen GitHub Actions workflows  | four publish paths)/i` | Ptah-specific numeric conventions/censuses. |

Guard specs: all 15 cleaned templates pass; each regex fails when injected into an ordinary body; one offender injected into `description` fails; one offender inside `<!-- LLM:X -->...<!-- /LLM:X -->` fails; `projectTypes: [Angular]`, `templateVersion`, `.ptah/specs`, and `ptah_get_diagnostics` pass. Existing description coverage is at `template-sharing.guard.spec.ts:157-160`.

## D. Description precedence

Rule: the authored `template.description.trim()` is the sole normal source. If absent, use deterministic stack-agnostic fallback `${humanizeName(template.name)} agent`; never use LLM output. All shipped templates are already required to declare a description (`template-sharing.guard.spec.ts:157-160`), so an LLM description adds drift without a useful success path.

Remove `description` from the generation schema/result and remove `llmDescription` from `buildAgentFileContent`. This directly replaces the current LLM-first order (`orchestrator.service.ts:1014-1031`) rather than maintaining two competing sources. Keep newline/quote escaping and the harness length cap (`orchestrator.service.ts:1032-1045`).

Specs in `orchestrator.service.spec.ts`: when an LLM/mock returns a conflicting description, emitted frontmatter equals the template description; blank/missing template metadata uses `<Humanized Name> agent`; multiline/quoted authored descriptions remain escaped; authored descriptions still obey the existing cap. Invert the stale expectation that currently asserts “Fresh description” wins (`orchestrator.service.spec.ts:664-685`) and update the length fixtures that currently source the value from LLM output (`orchestrator.service.spec.ts:688-725`).

## E. Template replacements and section map

Generated sections sit in `## Method`, after role-independent inputs and before the static working sequence. Authored fallbacks are deliberately short and are exempt from the generated 8-15-line gate.

| Template                 | Stack-agnostic replacement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | LLM section and placement                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| backend-developer        | Replace description with: “Writes server-side code using the repository's established service, data, boundary, and integration patterns. Use for backend application code, shared contracts, persistence, migrations, external-boundary validation, or server-side tests; not UI or delivery pipelines.” Replace `:73-101` with the fallbacks below. Replace Nx verification at `:112-115` with “Run the repository-defined type, lint, build and affected-test commands; verify the command actually selected every intended target.” | `FRAMEWORK_CONVENTIONS`, then `ARCHITECTURE_PATTERNS`, inside Method before “Working sequence”. |
| frontend-developer       | Replace description with: “Writes accessible interface code using the repository's established component, state, styling, and client-integration patterns. Use for components, views, routes, client state, styles, accessibility, or interface tests; not server services or delivery pipelines.” Replace `:76-102` with fallbacks. Replace `:115-118` with repository-defined build/lint/test verification. Make Role say “affected interface projects”, not Angular (`:50`).                                                        | `FRAMEWORK_CONVENTIONS`, then `ARCHITECTURE_PATTERNS`, inside Method before “Working sequence”. |
| devops-engineer          | Replace description with: “Maintains the repository's build, test, packaging, release, deployment, migration, and local-infrastructure configuration. Use for automation, project targets, workflow triggers, containers, publishing, or operational scripts; not application feature code.” Replace the census in `:49-53`, the complete stack inventory in `:69-116`, and enumerated output list in `:125-130` with generic ownership/verification language plus fallback below.                                                     | `BUILD_AND_DEPLOY_SURFACE` at the start of Method.                                              |
| code-style-reviewer      | Replace description's hexagonal/Angular list (`:11-13`) with “boundaries, dependency direction, registration and wiring, type precision, naming, cohesion, and maintenance cost.” Replace the entire Style hunt list (`:81-109`) with fallback. Rename the Angular checklist row (`:188`) to “Detected framework and state conventions”.                                                                                                                                                                                               | `REVIEW_FOCUS` under `### Style hunt list`.                                                     |
| code-logic-reviewer      | Keep its generic description and universal failure-method text. Replace only the Zod and Ptah half-registration bullets (`:94-99`) with fallback; do not duplicate generic stale-read/cleanup/error checks.                                                                                                                                                                                                                                                                                                                            | `REVIEW_FOCUS` inside `### Logic hunt list`, after the universal checks.                        |
| senior-tester            | No Ptah-specific replacement. Preserve role/method; its existing config-first behavior is already portable (`senior-tester.template.md:77-102`).                                                                                                                                                                                                                                                                                                                                                                                       | Add `TEST_INFRASTRUCTURE` immediately after `## Method`, before the numbered sequence.          |
| software-architect       | No Ptah-specific replacement. Preserve its evidence-first method (`software-architect.template.md:81-117`).                                                                                                                                                                                                                                                                                                                                                                                                                            | Add `EXISTING_PATTERNS` immediately after `## Method`, before the numbered sequence.            |
| visual-reviewer          | No project-stack replacement. Keep `ptah_browser_*` because it is harness protocol, not analyzed-repository content (`visual-reviewer.template.md:65-77`).                                                                                                                                                                                                                                                                                                                                                                             | Add `REVIEW_FOCUS` after Inputs/build precondition and before the browser loop in Method.       |
| modernization-detector   | No replacement and no LLM section. It must inspect current versions/patterns at execution time (`modernization-detector.template.md:62-79`); wizard-time guidance would be the stale data it is meant to detect.                                                                                                                                                                                                                                                                                                                       | None; baseline confirmed.                                                                       |
| project-manager          | No replacement. Scope and acceptance criteria do not need stack synthesis (`project-manager.template.md:74-96`).                                                                                                                                                                                                                                                                                                                                                                                                                       | None.                                                                                           |
| researcher-expert        | No replacement. It researches the bounded decision and verifies current versions at execution time (`researcher-expert.template.md:62-78`).                                                                                                                                                                                                                                                                                                                                                                                            | None.                                                                                           |
| team-leader              | No replacement. It consumes the completed architecture and code on disk; generated conventions would duplicate the plan (`team-leader.template.md:95-123`).                                                                                                                                                                                                                                                                                                                                                                            | None.                                                                                           |
| technical-content-writer | No replacement. It already checks every claim against source at execution time (`technical-content-writer.template.md:45-73`).                                                                                                                                                                                                                                                                                                                                                                                                         | None.                                                                                           |
| ui-ux-designer           | No replacement. Project token facts come from its skill and live config at execution time (`ui-ux-designer.template.md:48-86`).                                                                                                                                                                                                                                                                                                                                                                                                        | None.                                                                                           |
| video-director           | No replacement for this task. Its Playwright/Remotion/showcase vocabulary is the portable `video-showcase` skill contract, not a wizard analysis claim (`video-director.template.md:36-72`); broad stack deny rules must not catch it.                                                                                                                                                                                                                                                                                                 | None.                                                                                           |

Exact generic fallback text inside markers:

```markdown
<!-- LLM:FRAMEWORK_CONVENTIONS -->

- Follow the framework and language idioms demonstrated by nearby production code and repository configuration.
- Match established dependency setup, validation, error handling, lifecycle, naming, and test conventions before introducing a new pattern.
<!-- /LLM:FRAMEWORK_CONVENTIONS -->

<!-- LLM:ARCHITECTURE_PATTERNS -->

- Keep changes inside the repository's existing module and dependency boundaries.
- Reuse the established component, service, port, repository, state, and integration shapes that fit the assigned work.
<!-- /LLM:ARCHITECTURE_PATTERNS -->
```

Use the same IDs in backend and frontend, with “server-side” or “interface” added to the fallback nouns where helpful.

```markdown
<!-- LLM:BUILD_AND_DEPLOY_SURFACE -->

- Treat existing configuration, scripts, workflow triggers, artifact paths, and migration commands as the source of truth.
- Extend the nearest working automation pattern and verify the exact trigger, target, artifact, rollback, and secret-name contract affected by the change.
<!-- /LLM:BUILD_AND_DEPLOY_SURFACE -->

<!-- LLM:TEST_INFRASTRUCTURE -->

- Discover the runner, canonical commands, suite locations, setup files, fixtures, mocks, and harnesses from repository configuration and neighboring tests.
- Match the established test level and style, and report infrastructure gaps instead of inventing a parallel test setup.
<!-- /LLM:TEST_INFRASTRUCTURE -->

<!-- LLM:EXISTING_PATTERNS -->

- Base the design on comparable implementations already present in the repository.
- Verify boundaries, wiring, contracts, failure paths, ownership, and test seams from source before naming them in the plan.
<!-- /LLM:EXISTING_PATTERNS -->
```

Reviewer fallbacks are role-specific despite sharing the ID:

```markdown
<!-- LLM:REVIEW_FOCUS -->

- Check the changed code against the repository's documented boundaries, naming, dependency, registration, state, error, and test conventions.
- Compare with neighboring implementations and report only differences with a concrete maintenance or correctness cost.
<!-- /LLM:REVIEW_FOCUS -->
```

For code-logic-reviewer, replace “naming/state” with “boundary validation, wiring, cleanup, concurrency, and failure signaling”. For visual-reviewer, use “design tokens, layout primitives, supported viewports, interaction states, focus, contrast, and asset-loading conventions”.

The baseline section map in `context.md:30-37` is therefore correct. The challenge cases above remain `none`: their task-time source/skill investigation is more current than wizard-time synthesis.
