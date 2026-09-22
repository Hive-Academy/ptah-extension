# Batch B Report — TASK_2026_523_c3df

Settings keys registration, settings DTO chain extension, and `SkillEnhancerService` timeout read, optional `ProviderAuthResolver` injection, and `resolveLaneModel` reuse.

## Files changed

### `libs/backend/platform-core`

- `file-settings-keys.ts`:
  - Added `'skillSynthesis.judgeProvider'` and `'skillSynthesis.enhanceTimeoutMs'` to `FILE_BASED_SETTINGS_KEYS`.
  - Added `'skillSynthesis.judgeProvider': ''` and `'skillSynthesis.enhanceTimeoutMs': 120000` to `FILE_BASED_SETTINGS_DEFAULTS`.
- `file-settings-keys.spec.ts`:
  - Added unit test assertions verifying both keys exist in `FILE_BASED_SETTINGS_KEYS` and their default values in `FILE_BASED_SETTINGS_DEFAULTS`.

### `libs/backend/skill-synthesis`

- `src/lib/types.ts`:
  - Extended `SkillSynthesisSettings` interface with optional `judgeProvider?: string;` and `enhanceTimeoutMs?: number;`.
- `src/lib/skill-synthesis.service.ts`:
  - Added defaults `judgeProvider: ''` and `enhanceTimeoutMs: 120000` to `SETTINGS_DEFAULTS`.
  - Extended `readSettings()` to read and clamp `skillSynthesis.enhanceTimeoutMs` between `15_000` and `600_000` ms (defaulting to `120_000`), and return `judgeProvider`.
- `src/lib/skill-enhancer.service.ts`:
  - Removed hardcoded constant `ENHANCE_TIMEOUT_MS = 30_000`.
  - Injected `@inject(PROVIDER_AUTH_RESOLVER_TOKEN, { isOptional: true }) private readonly authResolver: ILaneAuthResolver | null = null` optionally and last in the constructor.
  - In `generateCandidate()`:
    - Read `skillSynthesis.enhanceTimeoutMs` from workspace configuration **passing no `defaultValue`**, clamped to `[15_000, 600_000]` ms (fallback `120_000` ms), and wired to `AbortController` timeout.
    - Reused `resolveLaneModel` to resolve the judge model with `id: 'judge'`, `provider: judgeProvider`, `model: judgeModel === 'inherit' ? '' : judgeModel`, and `defaultTier: 'haiku'`.
    - When `judgeProvider` is non-empty, called `this.authResolver.resolve(judgeProvider, 'lane')`, handling any failure fail-soft with a warning and returning `skipReason: 'provider-unreachable'`, and passed `auth: authOverride` to `internalQuery.execute()`.
- `src/lib/skill-enhancer.service.spec.ts`:
  - Updated `makeSettings()` default payload to include `judgeProvider: ''` and `enhanceTimeoutMs: 120000`.
  - Updated `makeHarness` to optionally accept `authResolver` and pass it to `SkillEnhancerService`.
  - Added unit tests for:
    - Pinned `judgeProvider` with `judgeModel: 'inherit'` resolving model to `'haiku'` and passing resolved `auth` override.
    - Pinned `judgeProvider` with explicit model preserving explicit model and passing resolved `auth` override.
    - `authResolver.resolve` throwing resulting in `skipReason: 'provider-unreachable'` without executing candidate query or judge.
    - Unset/empty `judgeProvider` bypassing `authResolver` and leaving `auth` undefined (preserving pre-existing behavior).
    - Workspace read of `skillSynthesis.enhanceTimeoutMs` with no `defaultValue` passed.
    - Timeout defaulting to 120,000 ms when unset or invalid.

### `libs/backend/rpc-handlers`

- `src/lib/handlers/skills-synthesis-rpc.schema.ts`:
  - Added constants `ENHANCE_TIMEOUT_MIN_MS = 15_000`, `ENHANCE_TIMEOUT_MAX_MS = 600_000`, `ENHANCE_TIMEOUT_DEFAULT_MS = 120_000`.
  - Added `EnhanceTimeoutSettingSchema` (with read-time coercion, fallback to default, and clamping).
  - Added `judgeProvider: z.string()` and `enhanceTimeoutMs: EnhanceTimeoutSettingSchema` to `SkillSynthesisSettingsSchema`.
  - Added bounds validation `[15_000, 600_000]` integer for `enhanceTimeoutMs` and string check for `judgeProvider` in `UpdateSkillSynthesisSettingsParamsSchema`.
- `src/lib/handlers/skills-synthesis-rpc.handlers.ts`:
  - Typed setting entry iteration to cleanly handle numeric and string updates to `workspaceProvider.setConfiguration()`.
- `src/lib/handlers/skills-synthesis-rpc.schema.spec.ts`:
  - Added test cases for read transformations/clamping and write parameter bounds validation for both keys.

No frontend files (`libs/frontend/`), git commits, or Batch A/C files were touched.

## Key registration

Both keys are registered in both tables in `libs/backend/platform-core/src/file-settings-keys.ts`:

### 1. `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:238-239`)

```ts
  'skillSynthesis.minJudgeScore',
  'skillSynthesis.judgeModel',
  'skillSynthesis.judgeProvider',
  'skillSynthesis.enhanceTimeoutMs',
  'skillSynthesis.maxPinnedSkills',
```

### 2. `FILE_BASED_SETTINGS_DEFAULTS` (`file-settings-keys.ts:526-529`)

```ts
  'skillSynthesis.judgeModel': 'inherit',
  'skillSynthesis.judgeProvider': '',
  'skillSynthesis.enhanceTimeoutMs': ENHANCE_TIMEOUT_DEFAULT_MS,
  'skillSynthesis.maxPinnedSkills': 10,
```

## Model resolution

Model resolution in `SkillEnhancerService.generateCandidate` cites `skill-enhancer.service.ts:800-814`:

```ts
const judgeProvider = (settings.judgeProvider ?? '').trim();
const judgeModel = settings.judgeModel;
const model = resolveLaneModel(
  {
    id: 'judge',
    provider: judgeProvider,
    model: judgeModel === 'inherit' ? '' : judgeModel,
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs,
    maxInputChars: 0,
    maxPasses: 1,
  },
  'inherit',
  this.workspaceProvider,
);

let authOverride: LaneAuthOverride | undefined;
if (judgeProvider && this.authResolver) {
  try {
    const resolvedAuth = await this.authResolver.resolve(judgeProvider, 'lane');
    authOverride = resolvedAuth ?? undefined;
  } catch (error: unknown) {
    this.logger.warn('[skill-enhancer] provider auth resolution failed; provider unreachable', {
      slug,
      provider: judgeProvider || '(active)',
      error: error instanceof Error ? error.message : String(error),
    });
    return PROVIDER_UNREACHABLE;
  }
}
```

### Resolution Rules:

1. **Explicit `judgeModel` wins verbatim**: if `judgeModel` is set to any explicit model id (e.g. `'deepseek-reasoner'`), `resolveLaneModel` uses that model directly.
2. **Ambient fallback when `judgeProvider` is empty**: `resolveLaneModel` falls back to `resolveJudgeModel('inherit', this.workspaceProvider)`, preserving byte-identical ambient provider and model resolution. `authOverride` is not requested, matching pre-existing behavior.
3. **Bare tier alias under pinned provider**: When `judgeProvider` is non-empty and `judgeModel` is `'inherit'`, `resolveLaneModel` returns the bare tier alias `'haiku'`.
4. **Auth resolution fail-soft**: When `judgeProvider` is non-empty, `authResolver.resolve(judgeProvider, 'lane')` resolves credentials. If the resolver throws, `SkillEnhancerService` catches the error, logs a warning, and returns `{ changed: false, skipReason: 'provider-unreachable' }` without executing queries or writes.

## Verification

### 1. Typecheck

```powershell
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis
```

Output:

```text
 NX   Running target typecheck for 3 projects:

- @ptah-extension/platform-core
- @ptah-extension/rpc-handlers
- @ptah-extension/skill-synthesis

√  nx run @ptah-extension/platform-core:typecheck
√  nx run @ptah-extension/skill-synthesis:typecheck
√  nx run @ptah-extension/rpc-handlers:typecheck

 NX   Successfully ran target typecheck for 3 projects
```

### 2. Unit Tests

- **`@ptah-extension/platform-core`**:

```powershell
npx nx test @ptah-extension/platform-core
```

Output:

```text
Test Suites: 43 passed, 43 total
Tests:       812 passed, 812 total
Snapshots:   0 total
Time:        10.428 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/platform-core
```

- **`@ptah-extension/rpc-handlers` (skills synthesis schema spec)**:

```powershell
npx nx test @ptah-extension/rpc-handlers --testFile="skills-synthesis-rpc.schema.spec.ts"
```

Output:

```text
PASS rpc-handlers libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts (11.025 s)
Test Suites: 1 passed, 1 total
Tests:       216 passed, 216 total
Snapshots:   0 total
Time:        11.233 s

 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

- **`@ptah-extension/skill-synthesis` (skill enhancer spec)**:

```powershell
npx nx test @ptah-extension/skill-synthesis --testFile="skill-enhancer.service.spec.ts"
```

Output:

```text
PASS skill-synthesis libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts (8.13 s)
Test Suites: 1 passed, 1 total
Tests:       84 passed, 84 total
Snapshots:   0 total
Time:        8.416 s

 NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

- **`@ptah-extension/skill-synthesis` (full suite)**:

```powershell
npx nx test @ptah-extension/skill-synthesis
```

Output:

```text
Test Suites: 1 skipped, 81 passed, 81 of 82 total
Tests:       1 skipped, 1587 passed, 1588 total
Snapshots:   0 total
Time:        34.417 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

### 3. Lint

- **`@ptah-extension/platform-core`**:

```powershell
npx nx lint @ptah-extension/platform-core
```

Output:

```text
✖ 9 problems (0 errors, 9 warnings)
 NX   Successfully ran target lint for project @ptah-extension/platform-core
```

- **`@ptah-extension/rpc-handlers`**:

```powershell
npx nx lint @ptah-extension/rpc-handlers
```

Output:

```text
✖ 40 problems (0 errors, 40 warnings)
 NX   Successfully ran target lint for project @ptah-extension/rpc-handlers
```

- **`@ptah-extension/skill-synthesis`**:

```powershell
npx nx lint @ptah-extension/skill-synthesis
```

Output:

```text
✖ 37 problems (0 errors, 37 warnings)
 NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
```

## Deviations

1. `libs/shared/src/lib/types/rpc.types.ts` was intentionally left untouched: Batch A owns this file. `skills-synthesis-rpc.schema.ts` and `skills-synthesis-rpc.handlers.ts` structurally decouple using local Zod schemas and TypeScript inference so no edits were made to `rpc.types.ts`.
2. `SkillEnhancerService.generateCandidate` timeout read: Called `this.workspaceProvider.getConfiguration<number>('ptah', 'skillSynthesis.enhanceTimeoutMs')` passing no `defaultValue` argument. Because `FileSettingsManager.get(key, defaultValue)` prioritizes caller defaults over registered store defaults, omitting the default parameter guarantees file-settings and registered store defaults are respected.

## Not done

- Frontend surfaces (`libs/frontend/`) are owned by Batch C and Batch D and were not modified.
- `auth-rpc.handlers.ts`, `effective-route.ts`, and `config:` handlers are owned by Batch A and were not modified.
- No git staging, commits, or branch operations were performed.

## Clarifications Needed

None.

---

## Round 2

Resolution of Defect 1: Centralizing ownership of timeout bounds and default in `libs/backend/platform-core`.

### 1. Root Cause & Architecture Fix

Previously, `skillSynthesis.enhanceTimeoutMs` boundaries (`15_000` min, `600_000` max) and default (`120_000`) were duplicated across three places (`skills-synthesis-rpc.schema.ts`, `skill-enhancer.service.ts`, and `file-settings-keys.ts`). Because `rpc-handlers` depends on `skill-synthesis`, and both depend on `platform-core`, moving the single definition into `platform-core` establishes a single authoritative owner without violating Nx architectural module boundaries.

### 2. Single Owner & Changes Applied

1. **`libs/backend/platform-core/src/file-settings-keys.ts`**:
   - Declared and exported the authoritative constants:
     ```ts
     export const ENHANCE_TIMEOUT_MIN_MS = 15_000;
     export const ENHANCE_TIMEOUT_MAX_MS = 600_000;
     export const ENHANCE_TIMEOUT_DEFAULT_MS = 120_000;
     ```
   - Used `ENHANCE_TIMEOUT_DEFAULT_MS` in `FILE_BASED_SETTINGS_DEFAULTS`:
     ```ts
     'skillSynthesis.judgeModel': 'inherit',
     'skillSynthesis.judgeProvider': '',
     'skillSynthesis.enhanceTimeoutMs': ENHANCE_TIMEOUT_DEFAULT_MS,
     'skillSynthesis.maxPinnedSkills': 10,
     ```
2. **`libs/backend/platform-core/src/index.ts`**:
   - Re-exported `ENHANCE_TIMEOUT_DEFAULT_MS`, `ENHANCE_TIMEOUT_MAX_MS`, and `ENHANCE_TIMEOUT_MIN_MS` in the platform-core public barrel.
3. **`libs/backend/platform-core/src/file-settings-keys.spec.ts`**:
   - Extended unit test suite to pin that `FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.enhanceTimeoutMs']` strictly equals `ENHANCE_TIMEOUT_DEFAULT_MS`, that `ENHANCE_TIMEOUT_DEFAULT_MS === 120_000`, `ENHANCE_TIMEOUT_MIN_MS === 15_000`, `ENHANCE_TIMEOUT_MAX_MS === 600_000`, and `ENHANCE_TIMEOUT_MIN_MS <= ENHANCE_TIMEOUT_DEFAULT_MS <= ENHANCE_TIMEOUT_MAX_MS`. Any future drift or inversion between the registered default and the constant will fail this test.
4. **`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`**:
   - Imported `ENHANCE_TIMEOUT_DEFAULT_MS`, `ENHANCE_TIMEOUT_MAX_MS`, `ENHANCE_TIMEOUT_MIN_MS` from `@ptah-extension/platform-core` and re-exported them for schema consumers.
5. **`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`**:
   - Imported `ENHANCE_TIMEOUT_DEFAULT_MS`, `ENHANCE_TIMEOUT_MAX_MS`, `ENHANCE_TIMEOUT_MIN_MS` from `@ptah-extension/platform-core`.
   - Updated `generateCandidate()` timeout calculation to remove all numeric literals:
     ```ts
     const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(Math.max(rawTimeout, ENHANCE_TIMEOUT_MIN_MS), ENHANCE_TIMEOUT_MAX_MS) : ENHANCE_TIMEOUT_DEFAULT_MS;
     ```
6. **`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`**:
   - Imported `ENHANCE_TIMEOUT_DEFAULT_MS`, `ENHANCE_TIMEOUT_MAX_MS`, `ENHANCE_TIMEOUT_MIN_MS` from `@ptah-extension/platform-core` and eliminated hardcoded literals in `SETTINGS_DEFAULTS` and `readSettings()`.
7. **`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts`**:
   - Imported `ENHANCE_TIMEOUT_DEFAULT_MS` and updated `makeSettings` and fallback unit test to reference the constant.

### 3. Fresh Verification Output (`NX_DAEMON=false`)

#### Typecheck

```powershell
$env:NX_DAEMON="false"; npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis
```

Output:

```text
 NX   Running target typecheck for 3 projects:

- @ptah-extension/platform-core
- @ptah-extension/rpc-handlers
- @ptah-extension/skill-synthesis

√  nx run @ptah-extension/platform-core:typecheck
√  nx run @ptah-extension/skill-synthesis:typecheck
√  nx run @ptah-extension/rpc-handlers:typecheck

 NX   Successfully ran target typecheck for 3 projects
```

#### Unit Tests

- **`@ptah-extension/platform-core`**:

```powershell
$env:NX_DAEMON="false"; npx nx test @ptah-extension/platform-core
```

Output:

```text
PASS platform-core libs/backend/platform-core/src/file-settings-keys.spec.ts
Test Suites: 43 passed, 43 total
Tests:       4 todo, 812 passed, 816 total
Snapshots:   0 total
Time:        10.806 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/platform-core
```

- **`@ptah-extension/rpc-handlers` (schema spec)**:

```powershell
$env:NX_DAEMON="false"; npx nx test @ptah-extension/rpc-handlers --testFile="skills-synthesis-rpc.schema.spec.ts"
```

Output:

```text
PASS rpc-handlers libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts
Test Suites: 1 passed, 1 total
Tests:       216 passed, 216 total
Snapshots:   0 total
Time:        2.691 s, estimated 4 s

 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

- **`@ptah-extension/skill-synthesis` (skill-enhancer spec)**:

```powershell
$env:NX_DAEMON="false"; npx nx test @ptah-extension/skill-synthesis --testFile="skill-enhancer.service.spec.ts"
```

Output:

```text
PASS skill-synthesis libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts (9.24 s)
Test Suites: 1 passed, 1 total
Tests:       84 passed, 84 total
Snapshots:   0 total
Time:        9.521 s, estimated 16 s

 NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

- **`@ptah-extension/skill-synthesis` (full test suite)**:

```powershell
$env:NX_DAEMON="false"; npx nx test @ptah-extension/skill-synthesis
```

Output:

```text
Test Suites: 1 skipped, 81 passed, 81 of 82 total
Tests:       1 skipped, 1587 passed, 1588 total
Snapshots:   0 total
Time:        27.925 s, estimated 30 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

#### Lint

```powershell
$env:NX_DAEMON="false"; npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis
```

Output:

```text
 NX   Running target lint for 3 projects:

- @ptah-extension/platform-core
- @ptah-extension/rpc-handlers
- @ptah-extension/skill-synthesis

√  nx run @ptah-extension/platform-core:lint
√  nx run @ptah-extension/skill-synthesis:lint
√  nx run @ptah-extension/rpc-handlers:lint

 NX   Successfully ran target lint for 3 projects
```

All targets passed cleanly with 0 errors. No git commands were executed.
