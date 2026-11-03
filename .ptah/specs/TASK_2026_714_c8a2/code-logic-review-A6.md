# Code Logic Review A6 - TASK_2026_714_c8a2

Verdict: APPROVE (0 blocking, 0 serious, 2 moderate)

## Resolution
- Only change in logic: step 3 now `require.resolve("@openai/codex/package.json")` (codex-native-binary-path.ts:147). `@openai/codex` package.json sits at node_modules/@openai/codex/, so the `..,..,..` walk (:148) still lands on node_modules root, same depth as before. Order unchanged: asar.unpacked, platform pkg, CLI root, npm globals, detectedCliPath.
- Triples/packages for win32/darwin/linux x64/arm64 unchanged (getTargetTriple, CODEX_PLATFORM_PACKAGES). `.exe` on win32 unchanged (binaryName). Missing binary still returns undefined; caller error text not touched. Explicit override/settings paths are outside this file, unaffected.
- Step 2 (platform package direct resolve) already preceded the SDK walk, so removing the SDK anchor lowers fallback risk only.

## Dependency declaration (moderate)
- `@openai/codex` is NOT declared in package.json:129, apps/ptah-electron/package.json:16 or apps/ptah-cli/package.json:56; only `@openai/codex-sdk ^0.165.0`. package-lock.json:11558 shows codex-sdk depends on `@openai/codex 0.165.0`, and node_modules has codex, codex-sdk, codex-win32-x64 hoisted. Resolution therefore works only while codex-sdk stays installed (D31 keeps it). Follow-up when the SDK dependency is dropped: declare `@openai/codex` (and keep it in electron externals/asarUnpack) or step 2/3 break in packaged builds. apps/ptah-electron/project.json:41 externals list only codex-sdk.

## Spec (moderate/minor)
- Source-scan test (spec:70-77) reads file by `path.join(__dirname, ...)` with `readFileSync(..., "utf8")` - string-typed, strict-safe; works under ts-jest CJS. Robust enough; fragile only to comments naming the SDK (none now; `@openai/codex-<platform>` does not match). `toContain` on the exact quote style couples to prettier quotes; acceptable.
- Spec computes triple/package per host platform, so only the current OS/arch is exercised; other platform branches untested (pre-existing).
- Stale doc wording remains at codex-native-binary-path.ts:~58 ("Codex SDK binary packages"), cosmetic.
