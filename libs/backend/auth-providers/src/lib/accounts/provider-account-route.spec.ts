import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderAccountStoreError, resolveProviderAccountRoute, revalidateProviderAccountRoute,
  withNewProviderAccountDirectory } from './provider-account-route';

describe('canonical provider account routes', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ptah-account-route-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('recognizes aliases and Windows junctions by physical identity', () => {
    const directory = join(root, 'account');
    const alias = join(root, 'alias');
    mkdirSync(directory);
    symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const route = resolveProviderAccountRoute(directory);
    expect(resolveProviderAccountRoute(alias).fingerprint).toBe(route.fingerprint);
    expect(resolveProviderAccountRoute(alias).canonicalPath).toBe(route.canonicalPath);
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.filesystemIdentity)).toBe(true);
  });

  it('preserves case distinctions when the filesystem supports them', () => {
    const lower = join(root, 'account');
    const upper = join(root, 'ACCOUNT');
    mkdirSync(lower);
    if (existsSync(upper)) {
      expect(resolveProviderAccountRoute(upper).fingerprint).toBe(resolveProviderAccountRoute(lower).fingerprint);
    } else {
      mkdirSync(upper);
      expect(resolveProviderAccountRoute(upper).fingerprint).not.toBe(resolveProviderAccountRoute(lower).fingerprint);
      expect(resolveProviderAccountRoute(upper).canonicalPath).not.toBe(resolveProviderAccountRoute(lower).canonicalPath);
    }
  });

  it('refuses directory replacement and alias retargeting', () => {
    const directory = join(root, 'account');
    const alias = join(root, 'alias');
    mkdirSync(directory);
    symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const route = resolveProviderAccountRoute(directory);
    const aliased = resolveProviderAccountRoute(alias);
    renameSync(directory, join(root, 'original'));
    mkdirSync(directory);
    expect(() => revalidateProviderAccountRoute(route)).toThrow(expect.objectContaining({ code: 'route-changed' }));
    expect(() => revalidateProviderAccountRoute(aliased)).toThrow(expect.objectContaining({ code: 'route-changed' }));
  });

  it('fails closed for missing, relative and non-directory routes without raw errors', () => {
    const file = join(root, 'file');
    writeFileSync(file, 'external');
    for (const path of [file, join(root, 'missing'), 'relative']) {
      expect(() => resolveProviderAccountRoute(path)).toThrow(ProviderAccountStoreError);
      try { resolveProviderAccountRoute(path); } catch (error: unknown) {
        expect(error instanceof Error ? error.message : '').not.toContain(root);
      }
    }
  });

  it('rechecks owned identity at commit and preserves a replacement link and its target', () => {
    const directory = join(root, 'new');
    const target = join(root, 'external');
    mkdirSync(target);
    expect(() => withNewProviderAccountDirectory(directory, (_route, validateOwned) => {
      renameSync(directory, join(root, 'owned'));
      symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir');
      validateOwned();
    })).toThrow(expect.objectContaining({ code: 'route-changed' }));
    expect(existsSync(directory)).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(root, 'owned'))).toBe(true);
  });

  it('failed Add removes only its own empty directory', () => {
    const directory = join(root, 'new');
    expect(() => withNewProviderAccountDirectory(directory, () => { throw new Error('commit failed'); })).toThrow('commit failed');
    expect(existsSync(directory)).toBe(false);
  });

  it('failed Add preserves external directories and newly written content', () => {
    const existing = join(root, 'external');
    mkdirSync(existing);
    const commit = jest.fn();
    expect(() => withNewProviderAccountDirectory(existing, commit)).toThrow(ProviderAccountStoreError);
    expect(commit).not.toHaveBeenCalled();
    expect(existsSync(existing)).toBe(true);
    const directory = join(root, 'new');
    expect(() => withNewProviderAccountDirectory(directory, () => {
      writeFileSync(join(directory, 'credentials'), 'external-content');
      throw new Error('commit failed');
    })).toThrow('commit failed');
    expect(readFileSync(join(directory, 'credentials'), 'utf8')).toBe('external-content');
  });

  it('failed Add never deletes a replacement empty directory', () => {
    const directory = join(root, 'new');
    expect(() => withNewProviderAccountDirectory(directory, () => {
      renameSync(directory, join(root, 'owned-original'));
      mkdirSync(directory);
      throw new Error('commit failed');
    })).toThrow('commit failed');
    expect(existsSync(directory)).toBe(true);
    expect(existsSync(join(root, 'owned-original'))).toBe(true);
  });
});
