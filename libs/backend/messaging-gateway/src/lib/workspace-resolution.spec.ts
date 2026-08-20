import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  normalizeWorkspacePath,
  isAllowlistedWorkspaceRoot,
  resolveEffectiveWorkspaceRoot,
  workspaceRootDigest,
} from './workspace-resolution';

const onWindows = process.platform === 'win32' ? it : it.skip;

function makeWorkspace(args: {
  folders?: string[];
  activeRoot?: string;
}): IWorkspaceProvider {
  return {
    getWorkspaceFolders: () => args.folders ?? [],
    getWorkspaceRoot: () => args.activeRoot,
  } as unknown as IWorkspaceProvider;
}

const ROOT = path.resolve('/ws/alpha');
const OTHER = path.resolve('/ws/beta');

describe('normalizeWorkspacePath', () => {
  it('strips trailing slashes', () => {
    expect(normalizeWorkspacePath(`${ROOT}///`)).toBe(
      normalizeWorkspacePath(ROOT),
    );
  });

  it('is case-insensitive', () => {
    expect(normalizeWorkspacePath(ROOT.toUpperCase())).toBe(
      normalizeWorkspacePath(ROOT.toLowerCase()),
    );
  });

  it('is idempotent', () => {
    const once = normalizeWorkspacePath(ROOT);
    expect(normalizeWorkspacePath(once)).toBe(once);
  });

  it('produces forward slashes only', () => {
    expect(normalizeWorkspacePath(ROOT)).not.toContain('\\');
  });

  onWindows('unifies backslash and forward-slash forms', () => {
    expect(normalizeWorkspacePath('D:\\Projects\\App\\')).toBe(
      normalizeWorkspacePath('d:/projects/app'),
    );
  });

  onWindows('resolves redundant segments', () => {
    expect(normalizeWorkspacePath('D:\\Projects\\x\\..\\App')).toBe(
      normalizeWorkspacePath('D:/Projects/App'),
    );
  });
});

describe('isAllowlistedWorkspaceRoot', () => {
  it('accepts an exact root regardless of case, separators, trailing slash', () => {
    expect(isAllowlistedWorkspaceRoot(`${ROOT}/`, [ROOT])).toBe(true);
    expect(isAllowlistedWorkspaceRoot(ROOT.toUpperCase(), [ROOT])).toBe(true);
  });

  it('rejects a SUBPATH of an allowlisted root', () => {
    expect(
      isAllowlistedWorkspaceRoot(path.join(ROOT, 'nested'), [ROOT]),
    ).toBe(false);
  });

  it('rejects a PARENT of an allowlisted root', () => {
    expect(
      isAllowlistedWorkspaceRoot(path.dirname(ROOT), [ROOT]),
    ).toBe(false);
  });

  it('rejects a non-member root', () => {
    expect(isAllowlistedWorkspaceRoot(OTHER, [ROOT])).toBe(false);
  });

  it('rejects everything against an empty allowlist', () => {
    expect(isAllowlistedWorkspaceRoot(ROOT, [])).toBe(false);
  });

  it('rejects dot-dot traversal that resolves outside the set', () => {
    expect(
      isAllowlistedWorkspaceRoot(path.join(ROOT, '..', 'beta'), [ROOT]),
    ).toBe(false);
  });

  it('accepts dot-dot traversal that resolves back INTO the set', () => {
    expect(
      isAllowlistedWorkspaceRoot(
        path.join(ROOT, 'nested', '..'),
        [ROOT],
      ),
    ).toBe(true);
  });
});

describe('workspaceRootDigest', () => {
  it('is a #-prefixed 16-hex-char digest', () => {
    expect(workspaceRootDigest(ROOT)).toMatch(/^#[0-9a-f]{16}$/);
  });

  it('is stable across normalization variants of the same path', () => {
    expect(workspaceRootDigest(`${ROOT}/`)).toBe(workspaceRootDigest(ROOT));
    expect(workspaceRootDigest(ROOT.toUpperCase())).toBe(
      workspaceRootDigest(ROOT),
    );
  });

  it('differs for different paths', () => {
    expect(workspaceRootDigest(ROOT)).not.toBe(workspaceRootDigest(OTHER));
  });
});

describe('resolveEffectiveWorkspaceRoot', () => {
  it('prefers an allowlisted conversation root over binding and active', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: ROOT,
      bindingRoot: OTHER,
      workspace: makeWorkspace({ folders: [ROOT, OTHER], activeRoot: OTHER }),
    });

    expect(result).toEqual({ ok: true, root: ROOT, source: 'conversation' });
  });

  it('accepts a conversation root that normalizes into the allowlist', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: `${ROOT.toUpperCase()}/`,
      bindingRoot: null,
      workspace: makeWorkspace({ folders: [ROOT] }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('conversation');
      expect(result.root).toBe(`${ROOT.toUpperCase()}/`);
    }
  });

  it('fails CLOSED when the conversation root left the allowlist — no binding fallback', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: ROOT,
      bindingRoot: OTHER,
      workspace: makeWorkspace({ folders: [OTHER], activeRoot: OTHER }),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'conversation-root-revoked',
    });
  });

  it('fails CLOSED on a subpath conversation root', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: path.join(ROOT, 'nested'),
      bindingRoot: null,
      workspace: makeWorkspace({ folders: [ROOT], activeRoot: ROOT }),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'conversation-root-revoked',
    });
  });

  it('falls back to the binding root when the conversation root is NULL', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: null,
      bindingRoot: OTHER,
      workspace: makeWorkspace({ folders: [ROOT], activeRoot: ROOT }),
    });

    expect(result).toEqual({ ok: true, root: OTHER, source: 'binding' });
  });

  it('falls back to the binding root when the conversation root is undefined (parent channel)', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: undefined,
      bindingRoot: OTHER,
      workspace: makeWorkspace({ folders: [ROOT] }),
    });

    expect(result).toEqual({ ok: true, root: OTHER, source: 'binding' });
  });

  it('falls back to the active workspace when conversation and binding are NULL', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: null,
      bindingRoot: null,
      workspace: makeWorkspace({ folders: [ROOT], activeRoot: ROOT }),
    });

    expect(result).toEqual({ ok: true, root: ROOT, source: 'active' });
  });

  it('reports no-workspace-open when nothing resolves', () => {
    const result = resolveEffectiveWorkspaceRoot({
      conversationRoot: null,
      bindingRoot: null,
      workspace: makeWorkspace({}),
    });

    expect(result).toEqual({ ok: false, reason: 'no-workspace-open' });
  });
});
