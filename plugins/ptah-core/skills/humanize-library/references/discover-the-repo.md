# Discover the Repo

Two things must be learned from the repo in front of you before any code moves: **what the rules
are**, and **what proves you did not break them**. Nothing in this file is repo-specific — it is a
procedure for extracting both from an unfamiliar codebase.

## Table of contents
- [Part A — The contract card](#part-a--the-contract-card)
- [Part B — The verification gate](#part-b--the-verification-gate)
- [Part C — Where extracted code is allowed to live](#part-c--where-extracted-code-is-allowed-to-live)

---

## Part A — The contract card

Read sources in this order. Later sources describe intent; earlier ones describe what is
*enforced*. **When they disagree, enforcement wins** — and the disagreement itself is a finding
worth reporting.

### A1. Enforced rules (machine-checked — these are real)

| Look at | What it tells you |
| --- | --- |
| ESLint / Biome / Ruff / Clippy config | Banned patterns, import boundaries, naming rules. Custom or unusual rules are the team's hard-won lessons — read them closely. |
| Import/dependency boundary plugins | Which unit may import which. Violating this breaks the build, not just style. |
| `tsconfig` `paths` / workspace globs / module map | The real module graph and the aliases extracted code must use. |
| Manifest tags & metadata (`project.json` tags, package `keywords`, Cargo features) | Layering intent expressed as data. |
| CI workflow files | The commands that must pass. **This is the most reliable source in the repo** — it is the definition of "done". |
| Pre-commit / husky hooks | Rules enforced before code lands. |
| Existing tests that assert *structure* | Contract tests, architecture tests, DI smoke tests, "public API" snapshot tests. These are tripwires — find them, because they will catch your refactor. |

### A2. Written rules (intent — verify each before trusting it)

`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `.cursorrules`, ADRs / `docs/decisions/`,
and any local instruction file in the target folder or a parent.

For each rule you find, spend one command proving whether it holds. A rule the codebase itself
violates in a dozen files is dead — say so in the audit rather than enforcing it unilaterally, and
let the user decide whether to enforce it or delete it.

### A3. Observed convention (imitation — the weakest but most common signal)

When a question is not covered by A1 or A2, read three sibling files that already solve the same
problem and match them. Consistency with neighbours beats personal preference every time.
Look specifically at: how dependencies are injected/wired, how errors are handled and typed, how
files are named, how tests are named and located, how modules expose their public surface.

### The card

Write it down before planning. Keep it short — this is a working note, not a document:

```
CONTRACT CARD — <target>
Unit type / manifest:  <e.g. TS library, project.json, tags scope:x type:y>
Public entry point:    <file — the symbols here are frozen unless dependents move too>
Enforced (A1):
  - <rule>  ← <the lint rule / CI step / test that enforces it>
Written but unenforced (A2):
  - <rule>  ← <source>   [holds? / violated in N files]
Observed convention (A3):
  - <pattern>  ← <example files>
Structural tripwires:
  - <test files that will fail if I move things>
```

---

## Part B — The verification gate

A gate is not a command you believe in. It is a command you **ran once and watched touch this
target**. Do this before batch 1, and never assume the commands from another project.

### B1. Find the candidate commands

Read the manifest's scripts/targets and the CI workflow. The CI workflow is authoritative — if CI
runs it, it is the gate. Common shapes:

| Ecosystem | Typecheck | Lint | Test |
| --- | --- | --- | --- |
| npm/yarn/pnpm | `tsc --noEmit`, `npm run typecheck` | `eslint .`, `npm run lint` | `jest`, `vitest`, `npm test` |
| Nx / Turbo / monorepo runner | `nx run <proj>:typecheck`, `turbo run typecheck --filter=<proj>` | `nx lint <proj>` | `nx test <proj>` |
| Python | `mypy <pkg>`, `pyright` | `ruff check`, `flake8` | `pytest <path>` |
| Rust | `cargo check -p <crate>` | `cargo clippy -p <crate>` | `cargo test -p <crate>` |
| Go | `go build ./...` | `golangci-lint run ./...` | `go test ./...` |
| JVM / .NET | `gradle compileJava`, `dotnet build` | `gradle check`, `dotnet format --verify` | `gradle test`, `dotnet test` |

### B2. Prove the command actually covers the target

The dangerous failure is not a command that errors — you notice that. It is a command that
**exits 0 without ever reading your code**. Verify with at least one of:

- Ask the runner to enumerate what it will run and confirm the target is in the list
  (e.g. list projects that have the target; print the resolved file set; run with `--listTests`,
  `--dry-run`, `-v`, or the runner's equivalent).
- Compare the target's manifest against a healthy sibling's. A missing target/script in one unit
  and present in its neighbours is the tell.
- **The decisive check:** temporarily introduce an obvious error (a bogus type, an unused import,
  a failing assertion), run the gate, confirm it goes red, then revert. If it stays green, the gate
  does not cover this target. Do this once, in a scratch edit you immediately undo — never commit it.

Also check: does the build actually check types? Many bundlers (esbuild, swc, babel) **strip** types
without verifying them, so a green build proves nothing about type safety.

### B3. If there is no gate

Repairing it is **batch 0**, and it is a real prerequisite, not housekeeping.

- Missing target/script → add it, copied from a healthy sibling unit rather than invented.
- Adding it surfaces pre-existing errors → that is a finding. Report each to the user. Do not fold
  silent fixes into a "behavior-preserving" refactor.
- Cannot be repaired (no runner, no config, out of scope) → say so explicitly and get the user to
  choose: repair it, accept a weaker gate, or stop. Do not proceed silently on a broken gate.

### B4. Write down the per-batch gate

Different batches need different breadth:

- **Touching only internals** → the target's own typecheck + lint + test.
- **Touching the public entry point, or moving an exported symbol** → add the direct dependents.
- **Touching wiring/registration/DI, or anything outside the unit** → add the whole-repo gate and
  any structural tripwire tests found in A1.

State the exact command per batch in the plan. "Run the tests" is not a gate.

---

## Part C — Where extracted code is allowed to live

Every refactor eventually asks: *this is shared — where does it go?* Answer with the repo's own
rules, in this order.

1. **Is there an enforced boundary system?** (import-boundary lint rules, tags, layer configs,
   visibility markers, module exports allowlists.) If yes, the destination is decided by it. A move
   that trips the boundary linter means the *destination* is wrong, not the rule.

2. **Otherwise, derive the layering from the dependency graph.** Ask what already imports what. A
   safe destination is one that all intended consumers may already import, and that itself imports
   nothing new. The generic ordering almost every codebase converges on:

   ```
   feature / app   →  can import everything below
   data-access     →  util, types
   ui              →  ui, util, types
   util            →  util, types
   types / model   →  imports nothing
   ```

   Pure types are always the safest destination because nothing can create a cycle through them.

3. **Match the closest precedent.** Find code of the same kind already shared in this repo and put
   yours beside it. If a shared home already exists and is being ignored by copy-paste, that home
   is the answer.

4. **When in doubt, keep it local.** A private helper next to its only consumer is better than a
   premature shared module in the wrong layer. Promote on the *third* real duplication with the
   same reason to change.

**Watch for one-way bridges.** Many repos have exactly one module allowed to cross an otherwise
hard boundary (client↔server, app↔platform, product↔infrastructure). Find it in step A1 and route
cross-boundary shared code through it — never open a second crossing.

---

## Git safety (applies to every step)

Commit each green batch. Stage explicit paths — never `git add -A`. Never
`reset` / `checkout --` / `restore` / `stash` / `clean` / `revert` work you did not create; assume
another session shares this working tree. Check for uncommitted changes in the target *and in its
dependents* before starting: refactoring on top of someone else's in-flight edit is a merge hazard,
and their dirty public entry point will make your gate lie to you.
