# Implementation Plan - TASK_2025_204: Skills.sh Browser Integration

## Codebase Investigation Summary

### Libraries & Patterns Discovered

- **RPC Handler Pattern (Tier 3)**: `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` - Injectable class with `register()` method, uses `@inject(TOKENS.LOGGER)` and `@inject(TOKENS.RPC_HANDLER)`, registers methods via `this.rpcHandler.registerMethod<TParams, TResult>(name, handler)`
- **RPC Type Registry**: `libs/shared/src/lib/types/rpc.types.ts` - All RPC methods typed in `RpcMethodRegistry` interface with `params` + `result` types, plus runtime array `RPC_METHOD_NAMES`
- **DI Registration**: `apps/ptah-extension-vscode/src/di/container.ts:309` - Tier 3 handlers registered as singletons, resolved in `RpcMethodRegistrationService` factory
- **RPC Orchestrator**: `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` - Constructor accepts all handler instances, `registerAll()` calls `.register()` on each
- **Frontend RPC Pattern**: `libs/frontend/chat/src/lib/components/molecules/setup-plugins/plugin-browser-modal.component.ts` - Uses `ClaudeRpcService.call(method, params, options)`, returns `result.isSuccess()`, `result.data`, `result.error`
- **Settings Tab Layout**: `libs/frontend/chat/src/lib/settings/settings.component.ts:101` - 5-tab layout, Skills tab key is `'ptah-skills'`, currently shows Ptah plugins (premium-gated) with plugin browser modal
- **Handler Export Barrel**: `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts` - Exports Tier 3 handlers locally

### Skills.sh CLI Investigation

The skills ecosystem uses the `skills` npm package (formerly `add-skill`) from `vercel-labs/skills`:

- **Install**: `npx skills add owner/repo` or `npx skills add owner/repo --skill specific-skill`
- **Search**: `npx skills search <query>` - returns top matches with name, description, install count
- **List installed**: `npx skills list` (or check `.claude/skills/` directory)
- **Global install**: `npx skills add owner/repo -g`
- **No REST API**: skills.sh is a web directory; the CLI is the primary interface
- **Scope**: project-level skills go to `.claude/skills/`, global to `~/.claude/skills/`

### Key Design Decision: CLI Execution

Since `skills.sh` has no public REST API, the backend must shell out to `npx skills` commands. This requires `child_process` access, confirming Tier 3 (VS Code-specific) handler placement.

---

## Data Models (Shared Library)

Add to `libs/shared/src/lib/types/rpc.types.ts`:

```typescript
// ---- Skills.sh Types (TASK_2025_204) ----

/** A skill entry from skills.sh search results */
export interface SkillShEntry {
  /** Repository source, e.g. "vercel-labs/skills" */
  source: string;
  /** Skill identifier within the repo, e.g. "find-skills" */
  skillId: string;
  /** Human-readable display name */
  name: string;
  /** Short description of what the skill does */
  description: string;
  /** Number of installs (from skills.sh directory) */
  installs: number;
  /** Whether this skill is currently installed locally */
  isInstalled: boolean;
}

/** An installed skill detected on disk */
export interface InstalledSkill {
  /** Display name from SKILL.md frontmatter */
  name: string;
  /** Repository source (owner/repo) or "local" */
  source: string;
  /** Absolute path to the skill directory */
  path: string;
  /** Installation scope */
  scope: 'project' | 'global';
}

/** Result of workspace skill detection */
export interface SkillDetectionResult {
  /** Frameworks detected in the workspace */
  frameworks: string[];
  /** Languages detected */
  languages: string[];
  /** Build tools/runners detected */
  tools: string[];
  /** Recommended skills from skills.sh based on detection */
  recommendedSkills: SkillShEntry[];
}
```

---

## Backend RPC Handlers

### New File: `apps/ptah-extension-vscode/src/services/rpc/handlers/skills-sh-rpc.handlers.ts`

**Pattern**: Follows `AgentRpcHandlers` pattern exactly (Tier 3 handler).

```typescript
@injectable()
export class SkillsShRpcHandlers {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler) {}

  register(): void {
    this.registerSearch();
    this.registerListInstalled();
    this.registerInstall();
    this.registerUninstall();
    this.registerGetPopular();
    this.registerDetectRecommended();
  }
  // ... handler methods below
}
```

### RPC Method Specifications

#### 1. `skillsSh:search`

- **Purpose**: Search skills.sh directory for skills matching a query
- **Input**: `{ query: string }`
- **Output**: `{ skills: SkillShEntry[] }`
- **CLI Command**: `npx skills search "<query>" --json` (if `--json` supported), otherwise parse stdout
- **Parsing Strategy**: Run `npx skills search "<query>"` and parse the text output. The CLI returns results with name, description, install count. Parse each result line-by-line using regex patterns.
- **Fallback**: If CLI not installed or fails, return empty array with `error` field
- **Error Handling**: Catch spawn errors (ENOENT if npx not found), timeout after 15s, return `{ skills: [], error: string }`

#### 2. `skillsSh:listInstalled`

- **Purpose**: List all installed skills (both project-level and global)
- **Input**: `void`
- **Output**: `{ skills: InstalledSkill[] }`
- **Implementation**: Scan filesystem directly (no CLI needed):
  1. Project skills: Read `{workspaceRoot}/.claude/skills/` directory
  2. Global skills: Read `~/.claude/skills/` directory
  3. For each skill directory, read `SKILL.md` frontmatter for `name` and `description`
  4. Determine `source` from directory structure (owner/repo pattern) or mark as "local"
- **Error Handling**: If directories don't exist, return empty arrays

#### 3. `skillsSh:install`

- **Purpose**: Install a skill from skills.sh
- **Input**: `{ source: string; skillId?: string; scope: 'project' | 'global' }`
- **Output**: `{ success: boolean; error?: string }`
- **CLI Command**:
  - Full repo: `npx skills add <source>` (project) or `npx skills add <source> -g` (global)
  - Specific skill: `npx skills add <source> --skill <skillId>`
- **Working Directory**: Workspace root (for project-scope installs)
- **Error Handling**: Parse stderr for error messages, timeout 30s, handle ENOENT (npx not found)
- **Security**: Validate `source` matches `owner/repo` pattern (no shell injection)

#### 4. `skillsSh:uninstall`

- **Purpose**: Remove an installed skill
- **Input**: `{ path: string; scope: 'project' | 'global' }`
- **Output**: `{ success: boolean; error?: string }`
- **Implementation**: Delete the skill directory from disk using `fs.rm(path, { recursive: true })`
- **Security**: Validate `path` is within `.claude/skills/` (project or global) - reject any path outside these directories
- **Error Handling**: Check directory exists before deletion

#### 5. `skillsSh:getPopular`

- **Purpose**: Get popular/trending skills for the browse experience
- **Input**: `void`
- **Output**: `{ skills: SkillShEntry[] }`
- **Implementation**: Two-tier strategy:
  1. **Try live**: Run `npx skills search "" --json` or `npx skills trending` to fetch popular skills
  2. **Fallback**: Return curated embedded JSON with ~20 popular skills (hardcoded, updated periodically)
- **Curated Fallback Data** (embedded in handler): Include well-known skills from repos like `vercel-labs/skills`, `anthropics/skills`, etc. with static install counts
- **Cache**: Cache results in memory for 10 minutes to avoid repeated CLI calls

#### 6. `skillsSh:detectRecommended`

- **Purpose**: Detect workspace technologies and recommend relevant skills
- **Input**: `void`
- **Output**: `SkillDetectionResult`
- **Implementation**:
  1. Read workspace root for tech markers: `package.json` (detect frameworks/tools), `Cargo.toml`, `go.mod`, `requirements.txt`, `Gemfile`, `pom.xml`, etc.
  2. Parse `package.json` dependencies for framework detection (react, angular, vue, next, express, nestjs, etc.)
  3. Check for config files: `tailwind.config.*`, `tsconfig.json`, `.eslintrc.*`, `docker-compose.yml`, etc.
  4. Map detected technologies to recommended skill keywords
  5. For each keyword, check curated fallback data for matching skills
- **Error Handling**: Return empty detection if workspace scanning fails

### CLI Execution Utility

Create a private helper method in the handler class:

```typescript
private async runSkillsCli(args: string[], cwd: string, timeout = 15000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['skills', ...args], {
      cwd,
      shell: true, // Required on Windows for npx
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      timeout,
    });
    // Collect stdout/stderr, resolve on close
  });
}
```

**Evidence for shell pattern**: `cli-adapter.utils.ts` `needsShellExecution()` pattern (documented in project memory) - Windows requires `shell: true` for npm-installed CLIs.

---

## Frontend Components

### Component 1: `SkillShBrowserComponent`

**Location**: `libs/frontend/chat/src/lib/components/molecules/setup-plugins/skill-sh-browser.component.ts`

**Pattern**: Follows `PluginBrowserModalComponent` (same directory) - signal-based state, `ClaudeRpcService` for backend calls, DaisyUI styling, `ChangeDetectionStrategy.OnPush`.

**Purpose**: Combined inline view (not modal) showing installed skills + search/browse + install/uninstall.

**State Signals**:

```typescript
readonly searchQuery = signal('');
readonly searchResults = signal<SkillShEntry[]>([]);
readonly installedSkills = signal<InstalledSkill[]>([]);
readonly popularSkills = signal<SkillShEntry[]>([]);
readonly recommendations = signal<SkillDetectionResult | null>(null);
readonly isSearching = signal(false);
readonly isLoadingInstalled = signal(false);
readonly isLoadingPopular = signal(false);
readonly installingSkillId = signal<string | null>(null); // tracks which skill is being installed
readonly error = signal<string | null>(null);
readonly activeView = signal<'browse' | 'installed'>('browse');
```

**Template Structure**:

```
<div class="space-y-3">
  <!-- View Toggle: Browse | Installed (N) -->
  <div class="tabs tabs-boxed tabs-xs">...</div>

  <!-- Browse View -->
  @if (activeView() === 'browse') {
    <!-- Search Input -->
    <input class="input input-bordered input-sm w-full" .../>

    <!-- Recommendations Section (if no search query) -->
    @if (!searchQuery() && recommendations()) {
      <div class="text-xs text-base-content/60 mb-1">Recommended for your project</div>
      <!-- Skill cards grid -->
    }

    <!-- Popular Skills (if no search query) -->
    @if (!searchQuery()) {
      <div class="text-xs text-base-content/60 mb-1">Popular Skills</div>
      <!-- Skill cards grid -->
    }

    <!-- Search Results (if search query) -->
    @if (searchQuery()) {
      <!-- Skill cards grid -->
    }
  }

  <!-- Installed View -->
  @if (activeView() === 'installed') {
    <!-- Project Skills -->
    <!-- Global Skills -->
    <!-- Empty state if none -->
  }
</div>
```

**Skill Card Layout** (reusable `@for` block, not a separate component):

```html
<div class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30">
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-1.5">
      <span class="text-xs font-medium">{{ skill.name }}</span>
      <span class="badge badge-xs badge-ghost">{{ skill.installs }} installs</span>
    </div>
    <span class="text-[11px] text-base-content/60 line-clamp-2">{{ skill.description }}</span>
    <span class="text-[10px] text-base-content/40 font-mono">{{ skill.source }}</span>
  </div>
  <!-- Install/Uninstall button -->
  @if (skill.isInstalled) {
  <button class="btn btn-ghost btn-xs text-error" (click)="uninstallSkill(skill)">Remove</button>
  } @else {
  <button class="btn btn-primary btn-xs" [disabled]="installingSkillId() === skill.skillId" (click)="installSkill(skill)">
    @if (installingSkillId() === skill.skillId) {
    <span class="loading loading-spinner loading-xs"></span>
    } @else { Install }
  </button>
  }
</div>
```

**Methods**:

- `ngOnInit()`: Load installed skills + popular skills + recommendations in parallel
- `onSearchInput(event)`: Debounced (300ms) search via `skillsSh:search` RPC
- `installSkill(skill, scope)`: Call `skillsSh:install`, refresh installed list on success
- `uninstallSkill(skill)`: Call `skillsSh:uninstall`, refresh installed list on success
- `loadInstalled()`: Call `skillsSh:listInstalled`
- `loadPopular()`: Call `skillsSh:getPopular`
- `loadRecommendations()`: Call `skillsSh:detectRecommended`

### Component 2: Settings Tab Integration

**File**: `libs/frontend/chat/src/lib/settings/settings.component.html`

**Change**: Replace the current Skills tab content (lines 232-281) to include both the existing Ptah plugins section AND the new skills.sh browser below it.

**Updated Tab 4 content**:

```html
@if (activeSettingsTab() === 'ptah-skills') {
<!-- Section 1: Ptah Plugins (Premium-only, existing) -->
@if (isPremium()) {
<div class="border border-base-300 rounded-md bg-base-200/50">
  <div class="p-3">
    <!-- existing Ptah Skills header + plugin-status-widget -->
  </div>
</div>
<ptah-plugin-browser-modal ... />
} @else {
<!-- existing upsell block for non-premium -->
}

<!-- Section 2: Community Skills (skills.sh) - Available to ALL users -->
<div class="border border-base-300 rounded-md bg-base-200/50">
  <div class="p-3">
    <div class="flex items-center gap-1.5 mb-2">
      <lucide-angular [img]="DownloadIcon" class="w-4 h-4 text-secondary" />
      <h2 class="text-xs font-medium uppercase tracking-wide">Community Skills</h2>
      <span class="badge badge-secondary badge-xs ml-auto">Open</span>
    </div>
    <p class="text-xs text-base-content/70 mb-3">Browse and install community skills from skills.sh — the open agent skills ecosystem.</p>
    <ptah-skill-sh-browser />
  </div>
</div>
}
```

**Key decision**: Skills.sh section is NOT premium-gated (per user requirement). It appears below the Ptah plugins section for all users.

### Settings Component Changes

**File**: `libs/frontend/chat/src/lib/settings/settings.component.ts`

- Add import: `SkillShBrowserComponent`
- Add import: `Download` icon from `lucide-angular`
- Add to `imports` array: `SkillShBrowserComponent`
- Add icon reference: `readonly DownloadIcon = Download;`
- Remove Lock icon from Skills tab header (no longer premium-only since community skills are free)

---

## RPC Type Registry Updates

### File: `libs/shared/src/lib/types/rpc.types.ts`

#### 1. Add types at top (near other domain type sections)

Add the `SkillShEntry`, `InstalledSkill`, and `SkillDetectionResult` interfaces as defined in the Data Models section above.

#### 2. Add to `RpcMethodRegistry` interface

```typescript
// ---- Skills.sh Methods (TASK_2025_204) ----
'skillsSh:search': {
  params: { query: string };
  result: { skills: SkillShEntry[]; error?: string };
};
'skillsSh:listInstalled': {
  params: void;
  result: { skills: InstalledSkill[] };
};
'skillsSh:install': {
  params: { source: string; skillId?: string; scope: 'project' | 'global' };
  result: { success: boolean; error?: string };
};
'skillsSh:uninstall': {
  params: { path: string; scope: 'project' | 'global' };
  result: { success: boolean; error?: string };
};
'skillsSh:getPopular': {
  params: void;
  result: { skills: SkillShEntry[] };
};
'skillsSh:detectRecommended': {
  params: void;
  result: SkillDetectionResult;
};
```

#### 3. Add to `RPC_METHOD_NAMES` array

```typescript
// Skills.sh Methods (TASK_2025_204)
'skillsSh:search',
'skillsSh:listInstalled',
'skillsSh:install',
'skillsSh:uninstall',
'skillsSh:getPopular',
'skillsSh:detectRecommended',
```

---

## Curated Popular Skills Fallback Data

Embed in the handler class as a constant (updated periodically with releases):

```typescript
const CURATED_POPULAR_SKILLS: SkillShEntry[] = [
  { source: 'vercel-labs/skills', skillId: 'find-skills', name: 'Find Skills', description: 'Search and install skills from the skills.sh directory', installs: 50000, isInstalled: false },
  { source: 'vercel-labs/skills', skillId: 'next-app-router', name: 'Next.js App Router', description: 'Best practices for Next.js App Router development', installs: 35000, isInstalled: false },
  { source: 'vercel-labs/skills', skillId: 'react-best-practices', name: 'React Best Practices', description: 'Modern React patterns with hooks and server components', installs: 28000, isInstalled: false },
  { source: 'anthropics/skills', skillId: 'testing', name: 'Testing', description: 'Write comprehensive tests with best practices', installs: 22000, isInstalled: false },
  { source: 'anthropics/skills', skillId: 'code-review', name: 'Code Review', description: 'Thorough code review with actionable feedback', installs: 20000, isInstalled: false },
  // ... ~15 more entries covering TypeScript, Python, Rust, Go, Docker, etc.
];
```

The developer implementing this should visit `skills.sh` and populate with the actual top ~20 skills at implementation time.

---

## DI & Registration Wiring

### File: `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts`

Add export:

```typescript
export { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
```

### File: `apps/ptah-extension-vscode/src/di/container.ts`

1. Add import: `SkillsShRpcHandlers`
2. Add singleton registration: `container.registerSingleton(SkillsShRpcHandlers);`
3. Add to `RpcMethodRegistrationService` factory: `c.resolve(SkillsShRpcHandlers)`

### File: `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`

1. Add import: `SkillsShRpcHandlers` (from `./handlers`)
2. Add constructor parameter: `private readonly skillsShHandlers: SkillsShRpcHandlers`
3. Add to `registerAll()`: `this.skillsShHandlers.register();`

---

## Files Affected Summary

### CREATE (4 files)

| File                                                                                          | Purpose                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/skills-sh-rpc.handlers.ts`              | Backend RPC handlers for skills.sh CLI operations |
| `libs/frontend/chat/src/lib/components/molecules/setup-plugins/skill-sh-browser.component.ts` | Frontend skills browser component                 |

### MODIFY (6 files)

| File                                                                             | Change                                                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/rpc.types.ts`                                         | Add SkillShEntry, InstalledSkill, SkillDetectionResult types + RPC method registry entries + RPC_METHOD_NAMES entries |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts`                  | Export SkillsShRpcHandlers                                                                                            |
| `apps/ptah-extension-vscode/src/di/container.ts`                                 | Register SkillsShRpcHandlers singleton + wire into RpcMethodRegistrationService                                       |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` | Add SkillsShRpcHandlers parameter + call register()                                                                   |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                      | Import SkillShBrowserComponent, add Download icon                                                                     |
| `libs/frontend/chat/src/lib/settings/settings.component.html`                    | Restructure Skills tab: Ptah plugins at top (premium) + Community Skills below (all users)                            |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both backend-developer AND frontend-developer (can be sequential by one fullstack developer)

**Rationale**:

- Backend: Node.js child_process spawning, filesystem scanning, SKILL.md frontmatter parsing
- Frontend: Angular component with signals, DaisyUI styling, RPC integration

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours

**Breakdown**:

- Shared types (rpc.types.ts): 30 min
- Backend handler (skills-sh-rpc.handlers.ts): 3-4 hours (CLI integration, parsing, filesystem scanning, fallback data)
- DI wiring (container.ts, registration service, index.ts): 30 min
- Frontend component (skill-sh-browser.component.ts): 2-3 hours (browse/installed views, search, install/uninstall UI)
- Settings integration (settings.component.ts/html): 30 min
- Testing: 1-2 hours

### Critical Implementation Notes

1. **Windows CLI spawning**: Use `shell: true` for `npx` commands on Windows. Set `FORCE_COLOR: '0'`, `NO_COLOR: '1'` env vars to prevent ANSI escape codes in output.
2. **CLI output parsing**: The `npx skills search` output format may change between versions. Implement defensive parsing with try/catch. If JSON mode (`--json`) is available, prefer it.
3. **SKILL.md frontmatter**: Use simple regex to parse YAML frontmatter (`---\nname: ...\ndescription: ...\n---`). Do not add a YAML parsing dependency.
4. **Security - path validation**: The `skillsSh:uninstall` handler MUST validate that the provided `path` is within `.claude/skills/` (either project or global). Reject paths containing `..` or pointing outside these directories.
5. **Security - source validation**: The `skillsSh:install` handler MUST validate `source` matches `^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$` pattern to prevent shell injection.
6. **Debounce search**: Frontend should debounce search input by 300ms to avoid excessive CLI invocations.
7. **Cache popular skills**: Cache `getPopular` results for 10 minutes in the handler instance (simple `Map` with timestamp).

### Architecture Delivery Checklist

- [x] All components specified with codebase evidence
- [x] All patterns verified from existing handlers (AgentRpcHandlers, PluginBrowserModalComponent)
- [x] All imports/decorators verified as existing (@injectable, @inject, TOKENS.LOGGER, TOKENS.RPC_HANDLER)
- [x] Quality requirements defined (security validation, error handling, caching)
- [x] Integration points documented (DI container, RPC registration service, settings component)
- [x] Files affected list complete (2 create, 6 modify)
- [x] Developer type recommended (fullstack)
- [x] Complexity assessed (MEDIUM, 6-10 hours)
- [x] Premium gating clarified: skills.sh = all users, Ptah plugins = premium-only
