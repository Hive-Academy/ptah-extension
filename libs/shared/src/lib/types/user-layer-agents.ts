/**
 * The workspace key under which a workspace's agent clones live.
 *
 * `~/.ptah/user/{skills,commands}` are per-MACHINE stores of per-machine
 * content: a skill a user installed once is the same skill in every project.
 * Agents are not. The setup wizard tailors each one to a project's stack and
 * architecture, and it names the result after the ROLE — `backend-developer`,
 * `frontend-developer` — so two projects produce two different files under one
 * name. A flat `~/.ptah/user/agents` gave them one destination, and the
 * reconcile pass's fast-forward flipped it back and forth on every activation,
 * rewriting `.codex/agents` and `.github/agents` in whichever workspace ran
 * last (TASK_2026_365).
 *
 * ## Why this lives in `shared`
 *
 * `agent-generation` WRITES the directory (`UserLayerMirrorService`) and
 * `harness-sync` READS it (`HarnessManifestBuilder.buildAgents`), and neither
 * lib may import the other — the reconciler is a leaf and the mirror is
 * upstream of it. `shared` is the one place both may depend on, which is the
 * same reason the origin-sidecar schema sits beside this file.
 *
 * ## Why the hash is hand-rolled
 *
 * `libs/shared` is imported by `libs/frontend/**`, so a `node:crypto` import in
 * this barrel reaches the webview bundle. FNV-1a over two 32-bit lanes gives 64
 * bits of key in pure TypeScript, which is far past what a few dozen workspaces
 * per machine need and costs the frontend nothing.
 */

/** The directory under `~/.ptah/user` that holds every workspace's agent clones. */
export const USER_LAYER_AGENTS_DIR_NAME = 'agents';

/** Hex digits of hash appended to the readable label. */
const HASH_HEX_LENGTH = 16;

/** Longest readable prefix kept from the workspace's own folder name. */
const LABEL_MAX_LENGTH = 32;

/** The label used when a root's folder name survives sanitization as nothing. */
const FALLBACK_LABEL = 'ws';

/**
 * The host platform, or `''` where there is no `process` to ask.
 *
 * Read off `globalThis` rather than directly for the reason in this file's
 * header: the frontend imports this barrel, and a bare `process.platform` in a
 * default parameter both throws in a browser and fails to compile in the
 * webview, whose tsconfig carries no `node` types. `''` is never `'win32'`, so
 * the browser answer is the case-sensitive one — which is the safe direction,
 * because it can only ever keep two roots apart.
 */
function currentPlatform(): string {
  const host = globalThis as { process?: { platform?: string } };
  return host.process?.platform ?? '';
}

/**
 * Canonicalize a workspace root into the exact string the key is derived from.
 *
 * Separators and a trailing separator normalize on every platform — neither
 * collapse can invent a match between two real directories. **Case folding
 * can**, so it is applied on `win32` only: on ext4 `/a/App` and `/a/app` are two
 * workspaces, and folding them together would recreate the collision this key
 * exists to remove. Same rule, same reason, as
 * `harness-sync`'s `codexProjectTrusted`.
 */
function canonicalizeRoot(workspaceRoot: string, platform: string): string {
  const slashed = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * FNV-1a, 64 bits, as two interleaved 32-bit lanes.
 *
 * `Math.imul` keeps each lane a true 32-bit multiply, which a plain `*` does
 * not once the product passes 2^53. The two lanes use different primes so they
 * cannot degenerate into one 32-bit hash printed twice.
 */
function fnv1a64Hex(value: string): string {
  let high = 0x811c9dc5;
  let low = 0xcbf29ce4;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + index), 0x01000021) >>> 0;
  }
  return (
    high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')
  ).slice(0, HASH_HEX_LENGTH);
}

/** The readable half: the workspace's own folder name, reduced to a safe slug. */
function labelFor(canonicalRoot: string): string {
  const lastSegment = canonicalRoot.slice(canonicalRoot.lastIndexOf('/') + 1);
  const slug = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, LABEL_MAX_LENGTH);
  return slug === '' ? FALLBACK_LABEL : slug;
}

/**
 * The directory name holding one workspace's agent clones, as
 * `<folder-name>-<hash>`.
 *
 * The label is there so a human reading `~/.ptah/user/agents` can tell which
 * project a directory belongs to. The hash is what makes it correct: two
 * checkouts of the same repository under different paths are two workspaces and
 * must not share a directory, and the label alone cannot tell them apart.
 *
 * Accepts any spelling of the root — `D:\proj`, `D:/proj/` and `d:\PROJ` all
 * answer the same on Windows — so a caller that has not run the path through
 * `resolveHarnessWorkspaceRoot` still lands in the right directory.
 */
export function userLayerAgentDirName(
  workspaceRoot: string,
  platform: string = currentPlatform(),
): string {
  const canonical = canonicalizeRoot(workspaceRoot, platform);
  return `${labelFor(canonical)}-${fnv1a64Hex(canonical)}`;
}
