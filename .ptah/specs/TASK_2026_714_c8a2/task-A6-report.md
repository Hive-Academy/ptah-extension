# Task A6 report - TASK_2026_714_c8a2

Lane: kimi code (ptah-cli). The original lane report was overwritten by mistake during the
review; the coordinator restored this summary from the lane's completion report. The review is in
`code-logic-review-A6.md` (APPROVE, 0 blocking, 2 moderate).

## Changes

- `libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.ts`: the source fallback
  resolved `@openai/codex-sdk/package.json`. It now resolves `@openai/codex/package.json` (the
  direct CLI package) and walks up to the `node_modules` root as before. All other binary routes,
  the platform package triples (win32/darwin/linux, x64/arm64) and Windows `.exe` handling are
  unchanged. A missing binary still returns `undefined`.
- `libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.spec.ts`: a host-platform
  independent case covers the CLI-root fallback, and a source scan asserts that the resolver no
  longer contains `@openai/codex-sdk`.

The lane confirmed the CLI and platform package names and the installed win32/x64 binary path in
`node_modules` (read only).

## Not changed (D31)

Package manifests, the lockfile, bundler externals and Windows patching keep
`@openai/codex-sdk` until the user authorizes the dependency removal.

## Nx project

`@ptah-extension/agent-sdk`.

## Risk

`@openai/codex` is not declared directly in any manifest. It is installed only as a dependency of
`@openai/codex-sdk`. The later dependency removal must add `@openai/codex` as a direct dependency
and keep it in the Electron externals and unpack list.
