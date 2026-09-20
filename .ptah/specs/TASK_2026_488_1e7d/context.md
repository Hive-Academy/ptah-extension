# Context — the file was never missing

The bug report framed the cause as one of three candidates: a renamed WASM file
in a newer `web-tree-sitter`, an incomplete/pruned install, or a target that
assumes a hoisting layout this workspace doesn't produce. The real cause is
close to the third but sharper than any of the three: **`scripts/copy-wasm.js`
never had a node_modules problem with the package — it had a node_modules
problem with itself.**

## What's actually on disk

This task worktree, `D:\projects\ptah-extension\.claude-worktrees\task-488-wasm`,
has **no `node_modules` directory of its own**. That's true of every worktree
under `.claude-worktrees` (checked `task-489-flakes`, `task-487-reaper`,
`task-484-process-and-clone` — none has one). The primary checkout at
`D:\projects\ptah-extension\node_modules` is the only install on this machine,
and it is complete: `web-tree-sitter@0.26.9` ships `web-tree-sitter.wasm` at
its package root exactly as the script expects, and
`@vscode/tree-sitter-wasm@0.3.1` ships every grammar file the script names
under `wasm/`. Nothing is renamed, nothing is pruned.

Builds still succeed from a worktree because `npx`, `nx`, `esbuild`, and every
`require()` a bundled module performs resolve through Node's normal directory
walk-up: starting in the worktree and climbing parent directories until a
`node_modules` is found. Since `.claude-worktrees` sits *inside* the primary
checkout, that walk-up reaches `D:\projects\ptah-extension\node_modules` and
everything resolves — except `scripts/copy-wasm.js`, which computed
`path.resolve(__dirname, '..')` as "workspace root" and joined a literal
`node_modules/web-tree-sitter/web-tree-sitter.wasm` onto it. That join is a
plain filesystem path, not a module resolution — it never walks up, so it
looked for (and didn't find) a `node_modules` colocated with the worktree
itself.

## Why this isn't (a) or (b) from the task brief

- **Not a stale/renamed path.** `web-tree-sitter@0.26.9`'s package root really
  does contain `web-tree-sitter.wasm`, and `@vscode/tree-sitter-wasm@0.3.1`'s
  `wasm/` directory really does contain every grammar file the script names.
  Confirmed by listing both package directories directly.
- **Not a broken install.** The primary checkout's `node_modules` is intact —
  every affected build step (esbuild bundling `@ptah-extension/workspace-intelligence`
  and friends, which depend on these same two packages) succeeds today.

## Why it matters beyond this machine

Every `.claude-worktrees/*` worktree in this repository has no `node_modules`
of its own — this is the established, repeated pattern (checked four other
worktrees, all the same). So this was never a one-off local glitch: `copy-wasm`
has been broken for **every** ptah-cli / ptah-extension-vscode / ptah-electron
build run from any worktree-based workflow, on any machine, since the script
started hard-coding a workspace-root-relative path. Running the build from the
primary checkout directly would have masked it, which is likely why it went
unnoticed.

## The fix

`scripts/copy-wasm.js` now resolves each WASM file through
`require.resolve(specifier, { paths: [__dirname] })` instead of joining a
literal path — the same resolution mechanism every other module load in this
build already depends on, so it walks up from the worktree to whichever
`node_modules` actually holds the package. `web-tree-sitter` declares an
`exports` map, so the specifier has to be the package's own declared subpath
(`web-tree-sitter/web-tree-sitter.wasm`) rather than "resolve the package
directory and join a filename" — resolving `package.json` directly and joining
a directory throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because `package.json` is not
a declared export. `@vscode/tree-sitter-wasm` has no `exports` map, so its
grammar files resolve without restriction the same way.

See `implementation-report.md` for verification evidence and the three
follow-up questions the fix itself raises.
