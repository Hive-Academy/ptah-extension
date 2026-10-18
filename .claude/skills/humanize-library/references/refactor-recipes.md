# Refactor Recipes

Concrete, behavior-preserving moves. Each lists the smell, the move, and the safety steps. Pick the
recipe matching the smell from the audit; chain them across batches.

Recipes are language- and framework-neutral. Where a recipe says "collaborator", "module" or
"entry point", use whatever this repo calls it — read three neighbouring files and match them.

## Table of contents
- [Recipe 0: Repair the verification gate](#recipe-0-repair-the-verification-gate)
- [Recipe 1: Characterize before you touch](#recipe-1-characterize-before-you-touch)
- [Recipe 2: Lift the types out first](#recipe-2-lift-the-types-out-first)
- [Recipe 3: Extract the private primitives](#recipe-3-extract-the-private-primitives)
- [Recipe 4: Split a god module](#recipe-4-split-a-god-module)
- [Recipe 5: Break up a long function](#recipe-5-break-up-a-long-function)
- [Recipe 6: Collapse in-file duplication](#recipe-6-collapse-in-file-duplication)
- [Recipe 7: Unify diverged copies (two-step)](#recipe-7-unify-diverged-copies-two-step)
- [Recipe 8: Hoist shared code](#recipe-8-hoist-shared-code)
- [Recipe 9: Rename for intent](#recipe-9-rename-for-intent)
- [Recipe 10: Modernize to the contract](#recipe-10-modernize-to-the-contract)
- [Safety checklist](#safety-checklist-every-recipe)

---

## Recipe 0: Repair the verification gate
**Smell:** not a code smell. The target has no typecheck/lint/test coverage, or has a command that
exits 0 without reading it. Discovered in
[discover-the-repo.md](discover-the-repo.md) Part B.

**Move:** copy the missing script/target verbatim from a healthy sibling unit rather than inventing
one. Then re-run the B2 proof (introduce an obvious error, watch it go red, revert).

**Safety:** zero source change. If enabling the gate surfaces pre-existing errors, **each one is a
finding to report** — do not fold silent fixes into a refactor that claims to preserve behavior.
This is always batch 0 when it applies; everything after it assumes it landed.

---

## Recipe 1: Characterize before you touch
**Smell:** a file you intend to move has no direct test, or is only exercised through callers that
mock it out.

**Move:** write tests against **current observable behavior** — inputs → outputs, side-effect order,
error paths, the edge cases the code visibly handles. Pin behavior you suspect is wrong too; this is
a net, not a judgement. Land it and go green as its **own commit** before any extraction.

**Safety:** no production edits in this recipe. If a test you write fails against current code, you
found a bug — report it, mark the test to match reality, do not fix it here.

---

## Recipe 2: Lift the types out first
**Smell:** a large file opens with a block of exported interfaces/types/enums standing in front of
the implementation, and the public entry point re-exports them from that implementation path.

**Move:** move the declarations verbatim into a sibling types module. The implementation imports
them. The public entry point re-exports **the same names** from the new path.

**Safety:** pure move — every exported name, field and doc comment identical. Do this early: it is
near-zero risk and it shrinks the diff of every later batch on the same file, which is what makes
those batches reviewable.

---

## Recipe 3: Extract the private primitives
**Smell:** a class hides a layer of general-purpose helpers — path/string/IO utilities, a
hand-rolled lock or cache, retry logic — that nothing else can reuse or unit-test.

**Move:** lift them into a sibling module as free functions or a small focused type. Most already
take explicit arguments and hold no instance state; those move unchanged. Give them their own
tests — often the first direct coverage this logic has ever had.

**Safety:** change one thing at a time. Do **not** simultaneously reroute these helpers through a
different abstraction (a port, a provider, an injected client) — that is Recipe 10, a separate
batch. Mixing extraction and re-plumbing makes the diff unreviewable.

---

## Recipe 4: Split a god module
**Smell:** one file with multiple unrelated responsibilities; disjoint method clusters; a long
dependency list; regions that never reference each other.

**Move:**
1. Identify cohesive clusters — methods that share private helpers or state. Each cluster becomes
   its own collaborator, named for its one job.
2. Create them beside the original, wired the way this repo wires things (constructor injection,
   module registration, plain imports, whatever the neighbours do).
3. The original **keeps every public method consumers call and delegates**. It becomes a facade.
   Public names and signatures do not change.
4. Move private helpers next to the logic that uses them.

**Safety:** the facade is the contract. Confirm dependents before splitting, and keep the entry
point exporting the same symbols. If the type is imported as a concrete class rather than through
an abstraction, its class name is also part of the contract — do not rename it here.

Run Recipes 2 and 3 first. A split diff is only reviewable once the types and primitives are gone.

---

## Recipe 5: Break up a long function
**Smell:** a function past ~60 lines, or nesting depth > 3.

**Move:** guard clauses and early returns to flatten nesting, then extract a named step per distinct
phase so the parent reads as a sequence of intentions (`validate` → `normalize` → `persist` →
`emit`). Each extracted step stays at one level of abstraction.

**Safety:** pure extraction — same inputs, same outputs, **same side-effect order**. Never reorder
observable side effects (writes, events, logs, emitted messages). If a step's side effect must
happen at the call site to preserve ordering, pass a callback rather than moving it.

---

## Recipe 6: Collapse in-file duplication
**Smell:** the same block appears 3+ times with the same reason to change; or N structurally
symmetric method pairs (`doXForA` / `doXForB`) where every change must be made twice.

**Move:** for repeated blocks, extract one helper and parameterize only what actually varies. For
symmetric pairs, define the small interface the pair differs by, implement it once per variant, and
write each operation once against the interface.

**Safety:** read **both** bodies of every pair before merging. Where a pair has genuinely diverged
beyond the parameterized shape, leave it and note it — a wrong abstraction is worse than repetition.
This recipe surfaces latent bugs more than any other; report what you find, do not fix it inline.

---

## Recipe 7: Unify diverged copies (two-step)
**Smell:** the same logic exists in two places and they **no longer behave identically**. Same
inputs, different outputs. This is a shipped defect, not just duplication.

**Move — and the two steps must be separate batches:**

**Step A (behavior-preserving).** Extract one implementation that reproduces *both* behaviors
exactly, selected by explicit options named for what they do (`emitStartEvent`,
`advanceIndexOnStart`). Each call site passes the options matching what it does today, byte for
byte. Both copies are deleted. Pin both behaviors in a table-driven test. Nothing observable changed.

**Step B (NOT behavior-preserving — stop here).** The fork is now visible as two flags in one file.
Present both behaviors to the user side by side with the consumer evidence, and ask which is
canonical. Only after sign-off: delete the losing branch and its flag, and pin the survivor.

**Safety:** never do A and B in one batch. Step A is safe and can land immediately; step B changes
what users see and is gated on a person, not on a green suite.

---

## Recipe 8: Hoist shared code
**Smell:** identical logic copy-pasted across sibling modules/packages.

**Move:**
1. Confirm true duplication — same reason to change, not coincidental similarity.
2. Choose the destination using [discover-the-repo.md](discover-the-repo.md) Part C: enforced
   boundary rules first, then the dependency graph, then the closest precedent. **If a shared home
   already exists and is being ignored by copy-paste, that home is the answer.**
3. Place the canonical copy there and export it.
4. Replace each copy with an import. Delete the originals — no re-export shims.
5. Verify the import is legal for *every* consumer, not just the one you started from.

**Safety:** boundary violations usually surface as lint errors — run lint after the move, not at the
end. A destination that trips the boundary linter is the wrong destination; do not weaken the rule
to make the move work. Beware hoisting something that drags a heavy or environment-specific
dependency into a consumer that cannot carry it (a server-only package into a browser bundle, a
native module into a portable core).

---

## Recipe 9: Rename for intent
**Smell:** names describe type or mechanism (`arr`, `data2`, `handle`, `process`).

**Move:** rename through the language server so every reference updates
(`ptah.ide.actions.rename(file, line, col, newName)`, an IDE rename, or `ptah_lsp_references` /
grep to find every use first). Check dependents before renaming anything exported.

**Safety:** renames are behavior-preserving by definition — but an exported rename changes the
public API. Either rename internals only and keep the exported name, or update every dependent in
the same batch. Watch for references that a language server cannot see: string literals, dynamic
lookups, serialized names, DI tokens, docs.

---

## Recipe 10: Modernize to the contract
**Smell:** legacy patterns encountered while refactoring — an old API style the repo has moved off,
a rule from the contract card the file predates.

**Move:** convert to the contract equivalent **only in files you are already touching for a
structural reason**. Do not open unrelated files to modernize; that is a different task with a
different diff.

Build the conversion table yourself from the contract card — never carry one over from another
project. One row per rule:

| Legacy (what you found) | Contract replacement | Evidence it is the rule |
| --- | --- | --- |
| `<pattern in this file>` | `<pattern the repo uses now>` | `<lint rule / CI step / doc line / 3 sibling files>` |

If you cannot fill the evidence column, it is your taste, not the contract. Leave it alone.

**Safety:** some conversions are not behavior-preserving — swapping a synchronous call for an
asynchronous one changes call-site semantics; routing I/O through an abstraction can change error
types or ordering. Flag every such conversion as a behavior change and give it its own batch.
Conversions that touch wiring/registration ripple outside the unit: land them alone, on a quiet
tree, with the widened gate.

---

## Safety checklist (every recipe)

- Public entry point exports the same symbols — or every dependent is updated in the same batch.
- No reordering of observable side effects.
- Nothing that changes observable behavior is inside a batch labelled behavior-preserving.
- Bugs found are written down for the user, never silently fixed.
- Generated code is not touched — the generator is.
- This batch's gate is green before commit, at the breadth Part B assigns it.
- Commit with a clear message. Stage explicit paths only.
