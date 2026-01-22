# Git Standards Reference

This reference documents the commitlint rules, commit message format, and pre-commit hook handling for the orchestration workflow.

**CRITICAL**: All commits MUST follow these rules to pass pre-commit hooks.

---

## Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Format Rules

| Component | Rule |
|-----------|------|
| Type | Required, lowercase, from allowed list |
| Scope | Required, lowercase, from allowed list |
| Subject | Required, lowercase, 3-72 chars, no period, imperative mood |
| Header | Max 100 characters total (type + scope + subject) |
| Body | Optional, max 100 chars per line |
| Footer | Optional, max 100 chars per line |

---

## Allowed Types

| Type | Description | When to Use |
|------|-------------|-------------|
| `feat` | New feature | Adding new functionality |
| `fix` | Bug fix | Fixing broken behavior |
| `docs` | Documentation | README, comments, CLAUDE.md changes |
| `style` | Code style | Formatting, whitespace (no logic change) |
| `refactor` | Code restructuring | Improving code without changing behavior |
| `perf` | Performance | Optimizations, speed improvements |
| `test` | Testing | Adding/updating test files |
| `build` | Build system | Webpack, esbuild, dependency changes |
| `ci` | CI configuration | GitHub Actions, pipeline changes |
| `chore` | Maintenance | Tooling, config (no src/test changes) |
| `revert` | Revert commit | Undoing previous commit |

---

## Allowed Scopes (Project-Specific)

| Scope | Description | Example Files |
|-------|-------------|---------------|
| `webview` | Frontend SPA changes | libs/frontend/*, apps/*-webview/* |
| `vscode` | VS Code extension | apps/*-vscode/*, libs/backend/* |
| `deps` | Dependency updates | package.json, package-lock.json |
| `release` | Release-related | CHANGELOG, version bumps |
| `ci` | CI/CD changes | .github/workflows/* |
| `docs` | Documentation | *.md files, comments |
| `hooks` | Git hooks | .husky/*, commitlint.config.js |
| `scripts` | Script changes | scripts/*, package.json scripts |

---

## Commit Rules (Enforced by Commitlint)

### Subject Rules

| Rule | Requirement | Example |
|------|-------------|---------|
| Case | Lowercase only | "add feature" not "Add feature" |
| Length | 3-72 characters | Short but descriptive |
| Ending | No period | "add feature" not "add feature." |
| Mood | Imperative | "add" not "added" or "adding" |

### What NOT to Do

- Sentence-case: "Add new feature"
- Start-case: "Add New Feature"
- UPPER-CASE: "ADD NEW FEATURE"
- Past tense: "added new feature"
- Present participle: "adding new feature"

---

## Valid Examples

```bash
feat(webview): add semantic search for chat messages
fix(vscode): resolve webview communication timeout issue
docs(docs): update component usage examples
refactor(hooks): simplify pre-commit validation
chore(deps): update @angular/core to v20.1.2
perf(webview): optimize message list rendering
test(vscode): add unit tests for rpc handlers
build(deps): upgrade esbuild to v0.20.0
ci(ci): add parallel test execution
style(webview): format chat component files
```

---

## Invalid Examples

| Example | Issue |
|---------|-------|
| `Feature: Add search` | Wrong type format, wrong case |
| `feat: Add search` | Missing scope |
| `feat(search): Add search` | Invalid scope, wrong case |
| `feat(webview): Add search.` | Period at end, uppercase |
| `feat(webview): Add Search` | Uppercase in subject |
| `feat(WEBVIEW): add search` | Uppercase scope |
| `Feat(webview): add search` | Uppercase type |
| `feat(webview): a` | Subject too short (< 3 chars) |

---

## Branch Operations

### New Task Branch

```bash
git checkout -b {{BRANCH_PREFIX}}TASK_2025_XXX
git push -u origin {{BRANCH_PREFIX}}TASK_2025_XXX
```

### Continue Existing Task

```bash
git checkout {{BRANCH_PREFIX}}TASK_2025_XXX
git pull origin {{BRANCH_PREFIX}}TASK_2025_XXX --rebase
```

### Commit Changes

```bash
git add [specific files]
git commit -m "type(scope): description"
```

### Create PR

```bash
gh pr create --title "type(scope): description" --body "..."
```

---

## Pre-commit Checks

All commits automatically run these checks in order:

| Check | Tool | Purpose |
|-------|------|---------|
| 1 | lint-staged | Format & lint staged files only |
| 2 | typecheck:affected | Type-check changed libraries |
| 3 | commitlint | Validate commit message format |

### Check Execution

```
git commit triggered
     |
     v
+------------------+
|  lint-staged     | -> Runs prettier, eslint on staged files
+--------+---------+
         | Pass
         v
+------------------+
|  typecheck       | -> Type-checks affected libraries
+--------+---------+
         | Pass
         v
+------------------+
|  commitlint      | -> Validates commit message format
+--------+---------+
         | Pass
         v
    Commit succeeds
```

---

## Hook Failure Protocol

**CRITICAL**: When a commit hook fails, ALWAYS stop and present this choice:

```markdown
---
Pre-commit hook failed: [specific error message]
---

Please choose how to proceed:

1. **Fix Issue** - I'll fix the issue if it's related to current work
   (Use for: lint errors, type errors, commit message format issues in current changes)

2. **Bypass Hook** - Commit with --no-verify flag
   (Use for: Unrelated errors in other files, blocking issues outside current scope)

3. **Stop & Report** - Mark as blocker and escalate
   (Use for: Critical infrastructure issues, complex errors requiring investigation)

Which option would you like? (1/2/3)
---
```

### Option Actions

| Choice | Command/Action |
|--------|----------------|
| Option 1 | Fix the issue, run `{{PACKAGE_MANAGER}} run lint:fix` if needed, retry commit |
| Option 2 | `git commit --no-verify -m "message"` |
| Option 3 | Mark task BLOCKED, document error in tasks.md |

### Agent Behavior Rules

- NEVER automatically bypass hooks with `--no-verify`
- NEVER automatically fix issues without user consent
- NEVER proceed with alternative approaches without user decision
- ALWAYS present the 3 options and wait for user choice
- ALWAYS document the chosen option if option 2 or 3 is selected

### Documentation When Bypassing

When user chooses option 2, add note to tasks.md:

```markdown
**Hook Bypass Note**: Batch N committed with --no-verify due to [reason].
Unrelated issue in [file/library] requires separate fix.
```

---

## Example Scenarios

### Scenario 1: Lint Error in Current File

```
Error: ESLint found issues in chat.component.ts

User chooses: Option 1 (Fix Issue)

Action:
1. Run: {{PACKAGE_MANAGER}} run lint:fix
2. Verify fix resolved the issue
3. Stage fixed files: git add chat.component.ts
4. Retry commit
```

### Scenario 2: Type Error in Unrelated Library

```
Error: Type error in libs/analytics/src/metrics.ts (not in current task scope)

User chooses: Option 2 (Bypass Hook)

Action:
1. Execute: git commit --no-verify -m "feat(webview): add chat feature"
2. Document in tasks.md: "Bypassed hook - type error in analytics lib"
```

### Scenario 3: Complex Build Failure

```
Error: Build failed with multiple dependency resolution errors

User chooses: Option 3 (Stop & Report)

Action:
1. Mark current task status: BLOCKED
2. Create detailed error report in tasks.md
3. Escalate to user for investigation
```

---

## Destructive Commands Warning

**NEVER run these commands** without explicit user request:

| Command | Risk |
|---------|------|
| `git reset --hard` | Loses uncommitted changes |
| `git push --force` | Overwrites remote history |
| `git rebase --hard` | Can lose commits |
| `git clean -f` | Deletes untracked files |
| `git branch -D` | Force deletes branch |
| `git checkout .` | Discards all changes |
| `git restore .` | Discards all changes |

---

## Integration with Other References

- **team-leader-modes.md**: MODE 2 creates commits following these standards
- **checkpoints.md**: Hook failure protocol is a checkpoint type
- **task-tracking.md**: Document hook bypasses in tasks.md
- **SKILL.md**: Git operations guidance in workflow completion phase
