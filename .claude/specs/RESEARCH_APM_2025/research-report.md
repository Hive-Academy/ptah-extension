# Research Report: Microsoft APM (Agent Package Manager)

**Research Date**: 2026-04-05
**Repository**: https://github.com/microsoft/apm
**Version Analyzed**: 0.8.10 (Python CLI)
**License**: MIT
**Stars**: 1,016 | **Language**: Python | **Created**: 2025-09-18

---

## Executive Summary

APM (Agent Package Manager) is Microsoft's open-source dependency manager for AI agent configurations. It functions like npm/pip/cargo but for AI context: agents, skills, prompts, instructions, hooks, and MCP servers. The tool resolves transitive dependencies, pins commits in a lockfile, and deploys primitives to IDE-native directories (`.github/`, `.claude/`, `.cursor/`, `.opencode/`). For programmatic integration, the key surfaces are: (1) the `apm.yml` manifest, (2) the `apm.lock.yaml` lockfile, (3) the `marketplace.json` index format, and (4) the `plugin.json` package descriptor. All are YAML/JSON and can be parsed without the APM CLI.

---

## 1. apm.yml Manifest Format

### Schema (v0.1, Working Draft)

The manifest is YAML 1.2 with these fields:

```yaml
# REQUIRED
name: my-project # Free-form string identifier
version: 1.0.0 # Semver pattern: ^\d+\.\d+\.\d+

# OPTIONAL METADATA
description: 'Project description'
author: 'Author Name'
license: MIT # SPDX identifier
target: vscode # vscode | agents | claude | codex | opencode | all (auto-detected)
type: skill # Package content type hint

# DEPENDENCIES
dependencies:
  apm:
    # String formats (multiple supported):
    - microsoft/apm-sample-package#v1.0.0 # GitHub shorthand + tag
    - https://gitlab.com/acme/coding-standards.git # HTTPS URL
    - git@gitlab.com:acme/coding-standards.git # SSH URL
    - gitlab.com/acme/repo/prompts/review.prompt.md # FQDN + virtual path
    - ./packages/my-shared-skills # Local path

    # Object format (advanced):
    - git: https://gitlab.com/acme/coding-standards.git
      path: instructions/security # Virtual sub-path within repo
      ref: v2.0 # Tag/branch/commit
      alias: security-rules # Local directory name override

  mcp:
    # Registry reference (simple):
    - io.github.github/github-mcp-server

    # Registry reference with overlays:
    - name: io.github.github/github-mcp-server
      transport: stdio
      env:
        GITHUB_TOKEN: '${MY_TOKEN}'
      tools: ['repos', 'issues']
      headers:
        X-Custom: 'value'
      package: npm

    # Self-defined server (not in registry):
    - name: internal-knowledge-base
      registry: false
      transport: http # stdio | http | sse | streamable-http
      url: 'https://mcp.internal.example.com'
      env:
        API_TOKEN: '${API_TOKEN}'

# DEV DEPENDENCIES (excluded from apm pack --format plugin)
devDependencies:
  apm:
    - owner/test-helpers

# SCRIPTS (executable via apm run)
scripts:
  design-review: 'codex --skip-git-repo-check design-review.prompt.md'
  accessibility: 'codex --skip-git-repo-check accessibility-audit.prompt.md'

# COMPILATION CONFIG
compilation:
  output: 'AGENTS.md'
  chatmode: 'backend-engineer'
  resolve_links: true
  exclude:
    - 'apm_modules/**'
    - 'tmp/**'
```

### Canonical Storage Rules

GitHub is the default registry. The `github.com` host is stripped during canonicalization:

| Input                                                 | Stored As                      |
| ----------------------------------------------------- | ------------------------------ |
| `microsoft/apm-sample-package`                        | `microsoft/apm-sample-package` |
| `https://github.com/microsoft/apm-sample-package.git` | `microsoft/apm-sample-package` |
| `https://gitlab.com/acme/rules.git`                   | `gitlab.com/acme/rules`        |
| `git@bitbucket.org:team/standards.git`                | `bitbucket.org/team/standards` |
| `./packages/my-skills`                                | `./packages/my-skills`         |

### Dependency Type Detection

APM auto-detects package type by contents:

| Contents                | Detected Type      |
| ----------------------- | ------------------ |
| Has `apm.yml`           | APM Package        |
| Has `plugin.json`       | Marketplace Plugin |
| Has `SKILL.md` only     | Claude Skill       |
| Has `hooks/*.json` only | Hook Package       |
| Folder in monorepo      | Virtual Package    |
| Starts with `./` or `/` | Local Path Package |

---

## 2. Installation Flow

### What `apm install` Does (Step by Step)

1. **Parse manifest**: Reads `dependencies.apm` and `dependencies.mcp` from `apm.yml`
2. **Check lockfile**: If `apm.lock.yaml` exists, reuse locked commit SHAs; only new deps trigger resolution
3. **Clone/update repos**: Downloads to `apm_modules/{owner}/{repo}/` using parallel `ThreadPoolExecutor` (default concurrency: 4)
   - For virtual packages: attempts `git sparse-checkout` (git 2.25+), falls back to shallow clone
   - Retry with exponential backoff + jitter on HTTP 429/503
4. **Validate packages**: Checks for `apm.yml`, `plugin.json`, or `SKILL.md`
5. **Resolve transitive deps**: Walks dependency tree recursively; detects circular deps
6. **Verify content hashes**: SHA-256 of file tree (sorted POSIX paths, excluding `.git/`, `__pycache__/`)
7. **Security scan**: Checks for hidden Unicode (tag chars, bidi overrides, zero-width spaces)
8. **Integrate primitives**: Deploys files to target directories based on auto-detection

### Target Auto-Detection and Deployment Locations

APM detects which IDE directories exist and deploys accordingly:

| Target          | Detection           | Deployment Root        |
| --------------- | ------------------- | ---------------------- |
| VS Code/Copilot | `.github/` exists   | `.github/`             |
| Claude Code     | `.claude/` exists   | `.claude/`             |
| Cursor          | `.cursor/` exists   | `.cursor/`             |
| OpenCode        | `.opencode/` exists | `.opencode/`           |
| Codex           | `.codex/` exists    | `.codex/` + `.agents/` |

If no target directory exists, `apm install` still downloads to `apm_modules/` but skips IDE integration.

### Primitive-to-Directory Mapping (Claude Target)

| Primitive Type | Source Location            | Deployed To                      |
| -------------- | -------------------------- | -------------------------------- |
| Instructions   | `.apm/instructions/*.md`   | `.claude/rules/*.md`             |
| Agents         | `.apm/agents/*.agent.md`   | `.claude/agents/*.md`            |
| Prompts        | `.apm/prompts/*.prompt.md` | `.claude/commands/*.md`          |
| Skills         | `.apm/skills/*/SKILL.md`   | `.claude/skills/{name}/SKILL.md` |
| Hooks          | `.apm/hooks/*.json`        | `.claude/settings.json` (merged) |

### Primitive-to-Directory Mapping (VS Code/Copilot Target)

| Primitive Type | Source Location            | Deployed To                              |
| -------------- | -------------------------- | ---------------------------------------- |
| Instructions   | `.apm/instructions/*.md`   | `.github/instructions/*.instructions.md` |
| Agents         | `.apm/agents/*.agent.md`   | `.github/agents/*.agent.md`              |
| Prompts        | `.apm/prompts/*.prompt.md` | `.github/prompts/*.prompt.md`            |
| Skills         | `.apm/skills/*/SKILL.md`   | `.github/skills/{name}/SKILL.md`         |
| Hooks          | `.apm/hooks/*.json`        | `.github/hooks/*.json`                   |

### Directory Structure After Install

```
project/
├── apm.yml                          # Manifest
├── apm.lock.yaml                    # Lockfile (commit to VCS)
├── apm_modules/                     # Downloaded packages (gitignore this)
│   ├── microsoft/
│   │   └── apm-sample-package/
│   │       ├── .apm/
│   │       │   ├── instructions/
│   │       │   ├── prompts/
│   │       │   └── skills/
│   │       └── apm.yml
│   └── github/
│       └── awesome-copilot/
│           └── skills/
│               └── review-and-refactor/
│                   └── SKILL.md
├── .github/                         # Copilot primitives (auto-deployed)
├── .claude/                         # Claude primitives (auto-deployed)
└── .cursor/                         # Cursor primitives (auto-deployed)
```

### Global (User-Scope) Installation

```bash
apm install -g microsoft/apm-sample-package
```

| Scope   | Manifest         | Modules               | Lockfile               | Primitives                  |
| ------- | ---------------- | --------------------- | ---------------------- | --------------------------- |
| Project | `./apm.yml`      | `./apm_modules/`      | `./apm.lock.yaml`      | `./.github/`, `./.claude/`  |
| Global  | `~/.apm/apm.yml` | `~/.apm/apm_modules/` | `~/.apm/apm.lock.yaml` | `~/.copilot/`, `~/.claude/` |

---

## 3. Registry and Sources

### Package Discovery Mechanisms

APM has **no single central registry** for agent packages. Instead it supports multiple discovery channels:

#### A. Direct Git References

Any Git host (GitHub, GitLab, Bitbucket, Azure DevOps, GitHub Enterprise, self-hosted):

```bash
apm install microsoft/apm-sample-package#v1.0.0
apm install https://gitlab.com/acme/standards.git
apm install git@bitbucket.org:team/rules.git
```

#### B. Marketplace Registries (Curated Plugin Indexes)

Marketplaces are GitHub repos containing a `marketplace.json` file:

```bash
apm marketplace add github/awesome-copilot     # Register a marketplace
apm marketplace browse awesome-copilot          # List all plugins
apm search "code review@awesome-copilot"        # Search within marketplace
apm install code-review@awesome-copilot         # Install from marketplace
```

#### C. MCP Server Registry

For MCP servers specifically, APM queries the GitHub MCP Registry:

```bash
apm mcp list                                    # Browse registry
apm mcp search github                           # Search by term
apm mcp show ghcr.io/github/github-mcp-server   # Server details
```

### marketplace.json Format

```json
{
  "name": "Acme Plugins",
  "metadata": {
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "code-review",
      "description": "Automated code review agent",
      "source": { "type": "github", "repo": "acme/code-review-plugin" }
    },
    {
      "name": "style-guide",
      "source": { "type": "url", "url": "https://github.com/acme/style-guide.git" }
    },
    {
      "name": "eslint-rules",
      "source": { "type": "git-subdir", "repo": "acme/monorepo", "subdir": "plugins/eslint-rules" }
    },
    {
      "name": "local-tools",
      "source": "./tools/local-plugin"
    }
  ]
}
```

Source types:

- `github` -- GitHub shorthand (`owner/repo`)
- `url` -- Full HTTPS/SSH Git URL
- `git-subdir` -- Subdirectory within a monorepo
- String -- Relative path within the marketplace repo (resolved via `pluginRoot`)

### Marketplace Caching

- Local cache with 1-hour TTL
- Stale-if-error fallback for offline mode
- Force refresh: `apm marketplace update [name]`

### Marketplace Python Models

```python
@dataclass(frozen=True)
class MarketplaceSource:
    name: str
    owner: str
    repo: str
    host: str = "github.com"
    branch: str = "main"
    path: str = "marketplace.json"

@dataclass(frozen=True)
class MarketplacePlugin:
    name: str
    source: str
    description: str = ""
    version: str = ""
    tags: list = field(default_factory=list)
    source_marketplace: str = ""

@dataclass(frozen=True)
class MarketplaceManifest:
    name: str
    plugins: list[MarketplacePlugin]
    owner_name: str = ""
    description: str = ""
    plugin_root: str = ""
```

---

## 4. Package Format

### APM Package (Full)

A full APM package is a Git repository with `apm.yml` and a `.apm/` directory:

```
my-apm-package/
├── apm.yml                          # Package manifest (required)
├── SKILL.md                         # Optional package-level skill guide
└── .apm/
    ├── agents/
    │   └── security-auditor.agent.md
    ├── instructions/
    │   └── python-standards.instructions.md
    ├── prompts/
    │   └── design-review.prompt.md
    ├── skills/
    │   └── code-analysis/
    │       └── SKILL.md
    ├── hooks/
    │   └── lint-on-save.json
    ├── contexts/
    │   └── project-context.md
    └── chatmodes/
        └── backend-engineer.chatmode.md
```

### Plugin Package

A plugin is a simpler format using `plugin.json` instead of `apm.yml`:

```
my-plugin/
├── plugin.json                      # Plugin manifest (required)
├── agents/
│   └── planner.agent.md
├── skills/
│   └── analysis/
│       └── SKILL.md
├── commands/
│   └── review.md
├── instructions/
│   └── coding-standards.instructions.md
├── hooks.json                       # Merged hooks file
└── .mcp.json                        # Optional MCP server declarations
```

#### plugin.json Schema

```json
{
  "name": "My Plugin", // REQUIRED: Display name
  "id": "my-plugin", // Unique identifier
  "version": "1.0.0", // Semver
  "description": "What this plugin does",
  "author": "Author Name",
  "license": "MIT",
  "repository": "owner/repo",
  "homepage": "https://example.com",
  "tags": ["ai", "coding"],
  "dependencies": ["another-plugin-id"],

  // Custom component paths (override default directories):
  "agents": ["./agents/planner.md", "./agents/coder.md"],
  "skills": ["./skills/analysis", "./skills/review"],
  "commands": "my-commands/",
  "hooks": "hooks.json",

  // MCP servers shipped with plugin:
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"]
    },
    "my-api": {
      "url": "https://api.example.com/mcp"
    }
  }
}
```

Plugin detection priority order:

1. `plugin.json` (root)
2. `.github/plugin/plugin.json`
3. `.claude-plugin/plugin.json`
4. `.cursor-plugin/plugin.json`

### Claude Skill Package (Minimal)

Just a `SKILL.md` file (optionally with resources):

```
my-skill/
├── SKILL.md                         # Required
├── scripts/
│   └── validate.py
├── references/
│   └── style-guide.md
└── examples/
    └── sample.json
```

SKILL.md format:

```markdown
---
name: Skill Name
description: One-line description
---

# Skill Body

Detailed instructions for the AI agent.

## Guidelines

- Guideline 1

## Examples

...
```

### Hook Package

```
my-hooks/
└── hooks/
    └── lint-hooks.json
```

Hook JSON schema:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": { "tool_name": "write_file" },
      "hooks": [{ "type": "command", "command": "./scripts/lint.sh" }]
    }],
    "PreToolUse": [...],
    "Stop": [...],
    "Notification": [...],
    "SubagentStop": [...]
  }
}
```

### Primitive File Formats

**Agent (.agent.md)**:

```markdown
---
description: 'Security auditor specializing in OWASP Top 10'
author: 'Team Security'
version: '1.0.0'
---

# Security Auditor Agent

You are a security expert...
```

**Instruction (.instructions.md)**:

```markdown
---
applyTo: '**/*.py'
description: 'Python coding standards'
---

# Python Standards

- Follow PEP 8
- Use type hints
```

**Prompt (.prompt.md)**:

```markdown
---
description: 'Implement secure authentication'
mode: backend-dev
input: [auth_method, session_duration]
---

Implement ${input:auth_method} with ${input:session_duration} sessions.
```

---

## 5. Lockfile Format (apm.lock.yaml)

### Complete Structure

```yaml
lockfile_version: '1' # Format version (breaking changes bump this)
generated_at: '2026-03-09T14:00:00Z' # UTC ISO 8601 timestamp
apm_version: '0.8.10' # APM version that wrote this file

dependencies: # Array, sorted by depth then repo_url
  - repo_url: https://github.com/acme-corp/security-baseline
    host: github.com # MAY: Git host identifier
    resolved_commit: a1b2c3d4e5f6789012345678901234567890abcd # Full 40-char SHA
    resolved_ref: v2.1.0 # Git ref that resolved to the commit
    version: '2.1.0' # Semver from package manifest
    depth: 1 # 1 = direct, 2+ = transitive
    package_type: apm_package # apm_package | plugin | virtual
    content_hash: 'sha256:e3b0c44...' # SHA-256 of file tree
    deployed_files: # Every file APM installed (POSIX paths)
      - .github/instructions/security.instructions.md
      - .github/agents/security-auditor.agent.md

  - repo_url: https://github.com/acme-corp/common-prompts
    resolved_commit: f6e5d4c3b2a1098765432109876543210fedcba9
    resolved_ref: main
    depth: 2 # Transitive dependency
    resolved_by: https://github.com/acme-corp/security-baseline # Parent package
    package_type: apm_package
    content_hash: 'sha256:d7a8fbb...'
    deployed_files:
      - .github/instructions/common-guidelines.instructions.md

  - repo_url: https://github.com/example-org/monorepo-tools
    virtual_path: packages/linter-config # Sub-path for virtual packages
    is_virtual: true
    resolved_commit: 0123456789abcdef0123456789abcdef01234567
    resolved_ref: v1.0.0
    version: '1.0.0'
    depth: 1
    package_type: virtual
    deployed_files:
      - .github/instructions/linter.instructions.md

  - repo_url: _local/my-shared-skills # Local path packages
    source: 'local'
    local_path: ./packages/my-shared-skills
    depth: 1
    package_type: apm_package
    deployed_files:
      - .github/instructions/shared.instructions.md

mcp_servers: # MAY: MCP server identifiers
  - security-scanner

mcp_configs: # MAY: MCP server configurations
  security-scanner:
    name: security-scanner
    transport: stdio
```

### Key Fields Per Dependency Entry

| Field             | Type     | Required      | Description                                    |
| ----------------- | -------- | ------------- | ---------------------------------------------- |
| `repo_url`        | string   | MUST          | Source URL or `_local/<name>`                  |
| `host`            | string   | MAY           | Git host (e.g., `github.com`)                  |
| `resolved_commit` | string   | MUST (remote) | Full 40-char SHA                               |
| `resolved_ref`    | string   | MUST (remote) | Git ref that resolved to commit                |
| `version`         | string   | MAY           | Semver from manifest                           |
| `virtual_path`    | string   | MAY           | Sub-path for monorepo packages                 |
| `is_virtual`      | boolean  | MAY           | `true` for virtual sub-packages                |
| `depth`           | integer  | MUST          | 1 = direct, 2+ = transitive                    |
| `resolved_by`     | string   | MAY           | Parent repo_url for transitive deps            |
| `package_type`    | string   | MUST          | `apm_package`, `plugin`, `virtual`             |
| `content_hash`    | string   | MAY           | `sha256:<hex>` for verification                |
| `is_dev`          | boolean  | MAY           | `true` if from devDependencies                 |
| `deployed_files`  | string[] | MUST          | Every file APM deployed (POSIX-relative paths) |
| `source`          | string   | MAY           | `"local"` for local path deps                  |
| `local_path`      | string   | MAY           | Filesystem path for local packages             |

### Lockfile Lifecycle

| Event                      | Effect                                             |
| -------------------------- | -------------------------------------------------- |
| `apm install` (first time) | Creates lockfile; resolves all refs to commit SHAs |
| `apm install` (subsequent) | Reads lockfile; reuses locked commits; appends new |
| `apm install --update`     | Re-resolves all refs to latest matching commits    |
| `apm deps update`          | Refreshes specified or all dependencies            |
| `apm pack`                 | Prepends `pack:` section to bundled lockfile copy  |
| `apm uninstall`            | Removes entries and deployed file references       |

### Unique Key

Each dependency is uniquely identified by:

- `repo_url` alone (remote packages)
- `repo_url` + `virtual_path` (virtual packages)
- `local_path` (local packages)

---

## 6. Programmatic Integration Without the CLI

### Strategy Overview

The APM CLI is a Python tool distributed as `apm-cli` on PyPI. However, all its data formats are standard YAML/JSON, making programmatic integration feasible without running the CLI. Here are the integration surfaces:

### A. Parse apm.yml (Manifest)

The manifest is straightforward YAML. To browse available dependencies:

```typescript
// TypeScript pseudocode for parsing apm.yml
interface ApmManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  target?: 'vscode' | 'agents' | 'claude' | 'codex' | 'opencode' | 'all';
  type?: string;
  dependencies?: {
    apm?: (string | ApmDependencyObject)[];
    mcp?: (string | McpDependencyObject)[];
  };
  devDependencies?: {
    apm?: (string | ApmDependencyObject)[];
    mcp?: (string | McpDependencyObject)[];
  };
  scripts?: Record<string, string>;
  compilation?: {
    output?: string;
    chatmode?: string;
    resolve_links?: boolean;
    exclude?: string[];
  };
}

interface ApmDependencyObject {
  git: string; // Required: Git URL
  path?: string; // Virtual sub-path
  ref?: string; // Tag/branch/commit
  alias?: string; // Local directory name
}

interface McpDependencyObject {
  name: string;
  registry?: boolean; // false for self-defined
  transport?: 'stdio' | 'http' | 'sse' | 'streamable-http';
  command?: string; // For stdio transport
  url?: string; // For http/sse transports
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  headers?: Record<string, string>;
  package?: string; // npm, pypi, etc.
  version?: string;
}
```

### B. Parse apm.lock.yaml (Lockfile)

The lockfile gives you the resolved state of all dependencies with exact commit SHAs and the list of deployed files:

```typescript
interface ApmLockfile {
  lockfile_version: string; // Currently "1"
  generated_at: string; // ISO 8601 UTC
  apm_version: string;
  dependencies: ApmLockedDependency[];
  mcp_servers?: string[];
  mcp_configs?: Record<string, McpServerConfig>;
}

interface ApmLockedDependency {
  repo_url: string;
  host?: string;
  resolved_commit: string; // 40-char SHA
  resolved_ref: string;
  version?: string;
  virtual_path?: string;
  is_virtual?: boolean;
  depth: number; // 1 = direct, 2+ = transitive
  resolved_by?: string; // Parent for transitive deps
  package_type: 'apm_package' | 'plugin' | 'virtual';
  content_hash?: string; // sha256:<hex>
  is_dev?: boolean;
  deployed_files: string[]; // POSIX relative paths
  source?: 'local';
  local_path?: string;
}
```

### C. Parse marketplace.json (Registry Index)

To build a package browser, fetch and parse marketplace.json from known marketplace repos:

```typescript
interface MarketplaceJson {
  name: string;
  description?: string;
  metadata?: {
    pluginRoot?: string; // Base directory for bare-name sources
  };
  plugins: MarketplacePluginEntry[];
}

interface MarketplacePluginEntry {
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
  source: string | MarketplaceSource;
}

type MarketplaceSource = { type: 'github'; repo: string } | { type: 'url'; url: string } | { type: 'git-subdir'; repo: string; subdir: string };
```

### D. Parse plugin.json (Package Descriptor)

```typescript
interface PluginJson {
  name: string; // Required
  id?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  tags?: string[];
  dependencies?: string[]; // Plugin IDs

  // Custom component paths:
  agents?: string | string[];
  skills?: string | string[];
  commands?: string | string[];
  hooks?: string | object; // Path or inline hooks object

  // MCP servers:
  mcpServers?: Record<string, McpServerDefinition> | string | string[];
}
```

### E. Download Packages Without CLI

Since APM packages are just Git repos, you can replicate the install flow:

1. **Parse apm.yml** to get dependency list
2. **Resolve Git references** using GitHub API (`GET /repos/{owner}/{repo}/commits/{ref}`)
3. **Download repo archive** via GitHub API (`GET /repos/{owner}/{repo}/tarball/{ref}`)
4. **Detect package type** by checking for `apm.yml` > `plugin.json` > `SKILL.md` > `hooks/*.json`
5. **Read primitives** from `.apm/` directory or plugin root
6. **Apply primitive mapping** to deploy to the correct target directory

For GitHub repos specifically:

```
GET https://api.github.com/repos/{owner}/{repo}/contents/.apm?ref={commit_sha}
GET https://api.github.com/repos/{owner}/{repo}/tarball/{commit_sha}
```

### F. Use apm pack Bundles

The `apm pack` command creates `.tar.gz` bundles that are completely self-contained. These can be consumed without APM:

```bash
tar xzf bundle.tar.gz -C ./project/
```

The bundle contains:

- All deployed files at their correct target paths
- An enriched `apm.lock.yaml` with a `pack:` metadata section
- No `apm_modules/` directory -- just the final deployed files

This is the most straightforward programmatic integration path: have APM create bundles, then consume them by extracting the archive.

---

## 7. Compilation System

APM includes a compiler (`apm compile`) that merges all primitives into `AGENTS.md` files:

```bash
apm compile                         # Auto-detect target
apm compile --target claude         # Generate CLAUDE.md
apm compile --target copilot        # Generate AGENTS.md for .github/
apm compile --target all            # All platforms
apm compile --watch                 # Auto-regenerate on changes
apm compile --single-agents         # One monolithic file
apm compile --validate              # Validate only, no output
```

The compiler:

- Discovers primitives from `.apm/` directories (local + dependencies)
- Resolves markdown links between primitives
- Applies mathematical optimization for token efficiency
- Injects Spec-kit constitution if present
- Generates distributed AGENTS.md files or a single compiled output
- Local primitives always override dependency primitives with the same name

---

## 8. CLI Commands Reference

### Core Commands

| Command                           | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `apm init [-y] [--plugin]`        | Initialize apm.yml (and optionally plugin.json) |
| `apm install [PACKAGES...]`       | Install dependencies from manifest or CLI args  |
| `apm uninstall PACKAGE`           | Remove package and deployed files               |
| `apm prune [--dry-run]`           | Remove orphaned packages                        |
| `apm audit [--ci] [--format]`     | Security scan for hidden Unicode                |
| `apm compile [--target]`          | Generate AGENTS.md from primitives              |
| `apm pack [--format] [--archive]` | Create distributable bundle                     |
| `apm unpack BUNDLE`               | Extract bundle with verification                |
| `apm update [--check]`            | Update APM CLI itself                           |

### Dependency Management

| Command                      | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `apm deps list [-g] [--all]` | List installed packages with primitive counts |
| `apm deps tree`              | Display dependency hierarchy                  |
| `apm deps info PACKAGE`      | Show detailed package metadata                |
| `apm deps update [PACKAGES]` | Re-resolve git refs to latest commits         |
| `apm deps clean [--dry-run]` | Remove entire apm_modules/                    |

### Marketplace

| Command                          | Purpose                           |
| -------------------------------- | --------------------------------- |
| `apm marketplace add OWNER/REPO` | Register marketplace              |
| `apm marketplace list`           | List registered marketplaces      |
| `apm marketplace browse NAME`    | List all plugins in marketplace   |
| `apm marketplace update [NAME]`  | Refresh cached marketplace index  |
| `apm marketplace remove NAME`    | Unregister marketplace            |
| `apm search QUERY@MARKETPLACE`   | Search plugins within marketplace |

### MCP Servers

| Command                | Purpose                               |
| ---------------------- | ------------------------------------- |
| `apm mcp list`         | List servers from GitHub MCP Registry |
| `apm mcp search QUERY` | Search MCP servers                    |
| `apm mcp show SERVER`  | Detailed server info                  |

### Install Flags

| Flag                     | Purpose                                |
| ------------------------ | -------------------------------------- |
| `--runtime TARGET`       | Install for specific runtime           |
| `--exclude TARGET`       | Skip specific runtime                  |
| `--only [apm\|mcp]`      | Install only APM or MCP dependencies   |
| `--target TARGET`        | Override auto-detected target          |
| `--update`               | Force re-resolution of all refs        |
| `--force`                | Overwrite existing files               |
| `--dry-run`              | Preview without changes                |
| `--parallel-downloads N` | Concurrent download threads            |
| `--trust-transitive-mcp` | Trust MCP servers from transitive deps |
| `--dev`                  | Install as dev dependency              |
| `-g / --global`          | User-scope installation                |

---

## 9. Key Python Data Models (for Reference)

### DependencyReference

Core dataclass for representing package references:

```python
@dataclass
class DependencyReference:
    owner: str
    repo: str
    host: str = "github.com"
    ref: Optional[str] = None
    virtual_path: Optional[str] = None
    is_virtual: bool = False
    alias: Optional[str] = None
    is_local: bool = False
    local_path: Optional[str] = None

    @classmethod
    def parse(cls, dep_string: str) -> "DependencyReference":
        """Parse GitHub shorthand, HTTPS, SSH, FQDN, or local path."""
        ...

    @classmethod
    def parse_from_dict(cls, dep_dict: dict) -> "DependencyReference":
        """Parse object-format dependency with git/path/ref/alias fields."""
        ...

    def get_canonical_dependency_string(self) -> str:
        """Returns repo_url (+ virtual_path) without host prefix."""
        ...

    def to_canonical(self) -> str:
        """Docker-style registry convention for apm.yml storage."""
        ...

    def get_install_path(self, base_dir: Path) -> Path:
        """Determine filesystem installation location."""
        ...

    def to_github_url(self) -> str:
        """Convert to full repository URL."""
        ...
```

### Git Reference Types

```python
class GitReferenceType(Enum):
    BRANCH = "branch"
    TAG = "tag"
    COMMIT = "commit"

class VirtualPackageType(Enum):
    FILE = "file"
    COLLECTION = "collection"
    SUBDIRECTORY = "subdirectory"
```

### Package Validation Types

```python
class PackageType(Enum):
    APM_PACKAGE = "apm_package"     # Has apm.yml
    PLUGIN = "plugin"               # Has plugin.json
    SKILL = "skill"                 # Has SKILL.md only
    HOOK = "hook"                   # Has hooks/*.json only
    VIRTUAL = "virtual"             # Monorepo subdirectory
    LOCAL = "local"                 # Local filesystem path

class PackageContentType(Enum):
    # From apm.yml "type" field
    SKILL = "skill"
    AGENT = "agent"
    PROMPT = "prompt"
    INSTRUCTION = "instruction"
    HOOK = "hook"
    # ... additional types
```

---

## 10. Recommendations for Ptah Integration

### Recommended Integration Architecture

Given that Ptah already has its own plugin/template download system (`ContentDownloadService`) and agent generation infrastructure, here is a recommended approach:

#### Tier 1: Lockfile/Manifest Parser (Lowest Effort)

Parse `apm.yml` and `apm.lock.yaml` to display APM package information in the Ptah UI. This enables users to see what APM packages are installed in their workspace without Ptah needing to manage them.

**Implementation**: YAML parser reading the two files; TypeScript interfaces matching the schemas above.

#### Tier 2: Marketplace Browser (Medium Effort)

Fetch and parse `marketplace.json` from known marketplace repos (e.g., `github/awesome-copilot`) to let users browse and discover APM packages from within Ptah.

**Implementation**: HTTP fetch of `marketplace.json` from GitHub raw content; display in webview UI; "Install" button shells out to `apm install`.

#### Tier 3: Direct Package Download (Higher Effort)

Replicate the core install flow in TypeScript:

1. Parse dependency references (string or object format)
2. Resolve Git refs via GitHub API
3. Download archives or use sparse checkout
4. Detect package type (check for apm.yml > plugin.json > SKILL.md)
5. Read primitives from `.apm/` directory
6. Write to target directories (`.claude/`, `.github/`, etc.)
7. Generate/update `apm.lock.yaml`

This would make Ptah a first-class APM consumer without requiring the Python CLI.

#### Tier 4: Bundle Consumer (Simplest Self-Contained Path)

If users pre-run `apm pack --archive`, Ptah can simply extract the `.tar.gz` and read the enriched lockfile. This is the path of least resistance for CI/CD integration.

### Key Files to Parse

| File                | Format   | Purpose                              |
| ------------------- | -------- | ------------------------------------ |
| `apm.yml`           | YAML 1.2 | Package manifest with dependencies   |
| `apm.lock.yaml`     | YAML 1.2 | Resolved dependency state            |
| `marketplace.json`  | JSON     | Plugin marketplace index             |
| `plugin.json`       | JSON     | Plugin package descriptor            |
| `SKILL.md`          | Markdown | Skill definition (frontmatter YAML)  |
| `*.agent.md`        | Markdown | Agent definition (frontmatter YAML)  |
| `*.instructions.md` | Markdown | Instruction rules (frontmatter YAML) |
| `*.prompt.md`       | Markdown | Prompt workflow (frontmatter YAML)   |

### Integration Risks

1. **Schema instability**: The manifest spec is "v0.1, Working Draft" and the lockfile is "v0.1 Working Draft" -- expect breaking changes
2. **No published JSON Schema**: There is no `apm.schema.json` in the repository; the spec exists only in documentation markdown
3. **Python-only tooling**: The entire CLI is Python; no official TypeScript/Node SDK exists
4. **Authentication complexity**: GitHub tokens, SSH keys, enterprise hosts -- replicating APM's auth resolution is non-trivial
5. **Transitive dependency resolution**: Implementing the full resolver with circular dependency detection, sparse checkout, parallel downloads is significant engineering effort

### What Ptah Should NOT Do

- Do not bundle the Python APM CLI inside the VS Code extension (too heavy, Python dependency)
- Do not attempt to replace APM's dependency resolver -- delegate to the CLI when full resolution is needed
- Do not maintain a separate lockfile format -- consume `apm.lock.yaml` as-is

---

## 11. Source File Index

Key files examined in the microsoft/apm repository:

```
README.md                                          # Project overview
pyproject.toml                                     # Python package config (v0.8.10)
packages/apm-guide/apm.yml                         # Sample package manifest

# Documentation
docs/src/content/docs/reference/manifest-schema.md # apm.yml specification
docs/src/content/docs/reference/lockfile-spec.md   # apm.lock.yaml specification
docs/src/content/docs/reference/cli-commands.md    # CLI reference
docs/src/content/docs/reference/primitive-types.md # Primitive type definitions
docs/src/content/docs/introduction/how-it-works.md # Architecture overview
docs/src/content/docs/introduction/key-concepts.md # Core concepts
docs/src/content/docs/guides/dependencies.md       # Dependency guide
docs/src/content/docs/guides/marketplaces.md       # Marketplace guide
docs/src/content/docs/guides/plugins.md            # Plugin guide
docs/src/content/docs/guides/skills.md             # Skills guide
docs/src/content/docs/guides/pack-distribute.md    # Pack/distribute workflow
docs/src/content/docs/integrations/ide-tool-integration.md # IDE integration

# Source code (Python)
src/apm_cli/models/apm_package.py                  # APMPackage + PackageInfo dataclasses
src/apm_cli/models/dependency/types.py             # GitReferenceType, VirtualPackageType enums
src/apm_cli/models/dependency/reference.py         # DependencyReference parser
src/apm_cli/models/plugin.py                       # PluginMetadata + Plugin models
src/apm_cli/marketplace/models.py                  # Marketplace data models
src/apm_cli/commands/install.py                    # Install command (2000+ lines)
src/apm_cli/bundle/unpacker.py                     # Bundle extraction with security
```

---

## 12. Known Marketplaces

| Marketplace Repo                                              | Description                      |
| ------------------------------------------------------------- | -------------------------------- |
| `github/awesome-copilot`                                      | GitHub's curated Copilot plugins |
| (others can be registered by users via `apm marketplace add`) |                                  |

The ecosystem is young (repo created Sep 2025, ~1000 stars as of Apr 2026). The marketplace model is decentralized -- any GitHub repo with a `marketplace.json` can serve as a registry.
