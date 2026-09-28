/**
 * Specs for the per-build resolver context (TASK_2026_559 Batch 32b): root
 * manifest discovery, the "Bounds" limits (each disclosed as a gap, and
 * enforced on the bytes physically read), identity-checked reading, JSONC
 * tsconfig reading with `extends` semantics, declared packages by
 * specification, and the generation check around every read.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MANIFEST_LIMITS,
  NODE_MANIFEST_FILE_SYSTEM,
  type ManifestFileSystem,
  type ManifestHandle,
  type ManifestStat,
} from './manifest-reader';
import {
  buildResolverContext,
  parseJsonc,
  type ResolverContextOptions,
} from './resolver-context';
import { mapRootTsconfigs } from './tsconfig-mapping';

const ROOT = 'R:/ws';

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;
}

/**
 * An in-memory file system: `files` by absolute path (inode = position),
 * `links` mapping a path to its real path, `readdirError` failing the root
 * listing. `physicalBytes()` is every byte handed out by a handle read.
 */
function memoryFileSystem(
  files: Record<string, string | Uint8Array>,
  options: { links?: Record<string, string>; readdirError?: string } = {},
) {
  const paths = Object.keys(files);
  let physical = 0;
  const statOf = (filePath: string): ManifestStat => {
    const content = files[filePath];
    if (content === undefined) throw codeError('ENOENT');
    return {
      size: bytesOf(content).length,
      dev: 1,
      ino: paths.indexOf(filePath) + 1,
      isFile: () => true,
    };
  };
  const handleOf = (filePath: string): ManifestHandle => {
    const bytes = bytesOf(files[filePath] ?? '');
    return {
      stat: async () => statOf(filePath),
      read: async (buffer, offset, length, position) => {
        const chunk = bytes.subarray(position, position + length);
        buffer.set(chunk, offset);
        physical += chunk.length;
        return { bytesRead: chunk.length };
      },
      close: async () => undefined,
    };
  };
  const fileSystem = {
    readdir: jest.fn(async (dir: string) => {
      if (options.readdirError !== undefined) {
        throw codeError(options.readdirError);
      }
      return paths
        .filter((filePath) => filePath.startsWith(`${dir}/`))
        .map((filePath) => filePath.slice(dir.length + 1))
        .filter((name) => !name.includes('/'));
    }),
    realpath: jest.fn(async (filePath: string) => {
      const linked = options.links?.[filePath];
      if (linked !== undefined) return linked;
      if (filePath !== ROOT && files[filePath] === undefined) {
        throw codeError('ENOENT');
      }
      return filePath;
    }),
    stat: jest.fn(async (filePath: string) => statOf(filePath)),
    open: jest.fn(async (filePath: string) => handleOf(filePath)),
    physicalBytes: () => physical,
    handleOf,
  };
  return fileSystem satisfies ManifestFileSystem;
}

function build(
  fileSystem: ManifestFileSystem,
  overrides: Partial<ResolverContextOptions> = {},
) {
  return buildResolverContext({
    root: ROOT,
    knownFiles: [],
    isCurrent: () => true,
    fileSystem,
    ...overrides,
  });
}

describe('buildResolverContext — tsconfig reading', () => {
  it('reads paths and baseUrl from JSONC (comments, trailing commas)', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.base.json`]: [
        '{',
        '  // line comment with "quotes"',
        '  "compilerOptions": {',
        '    /* block */ "baseUrl": ".",',
        '    "paths": {',
        '      "@app/*": ["libs/app/src/*",],',
        '      "url": ["https://example.test/*/x"],',
        '    },',
        '  },',
        '}',
      ].join('\n'),
    });

    const ctx = await build(fileSystem);

    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.baseUrls).toEqual([ROOT]);
    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@app/*', targets: ['libs/app/src/*'], baseDir: ROOT },
      { pattern: 'url', targets: ['https://example.test/*/x'], baseDir: ROOT },
    ]);
    expect(ctx?.manifestsRead).toBe(1);
  });

  it('resolves tsconfig paths from its baseUrl', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.json`]:
        '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@x": ["x"] } } }',
    });

    const ctx = await build(fileSystem);

    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@x', targets: ['x'], baseDir: `${ROOT}/src` },
    ]);
    expect(ctx?.baseUrls).toEqual([`${ROOT}/src`]);
  });

  it('accepts an extends of a root config it read, and flags any other', async () => {
    const readBase = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.json`]: '{ "extends": "./tsconfig.base.json" }',
        [`${ROOT}/tsconfig.base.json`]: '{}',
      }),
    );
    expect(readBase?.gaps).toEqual([]);

    const packageBase = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.json`]: '{ "extends": "@tsconfig/node20/tsconfig" }',
      }),
    );
    expect(packageBase?.gaps).toEqual(['extends-not-read']);
  });

  it.each([
    ['invalid JSON', '{ "compilerOptions": '],
    [
      'a non-array paths entry',
      '{ "compilerOptions": { "paths": { "a": "b" } } }',
    ],
    ['a non-string baseUrl', '{ "compilerOptions": { "baseUrl": 1 } }'],
    ['a non-object document', '[1, 2]'],
  ])('flags %s as unparseable', async (_label, content) => {
    const ctx = await build(
      memoryFileSystem({ [`${ROOT}/tsconfig.json`]: content }),
    );
    expect(ctx?.gaps).toEqual(['manifest-unparseable']);
  });

  it('indexes the known files by folded path for the case rule', async () => {
    const ctx = await build(memoryFileSystem({}), {
      knownFiles: [`${ROOT}/a.ts`, `${ROOT}/A.ts`, `${ROOT}/b.ts`],
    });
    expect(ctx?.filesByFoldedPath.get(`${ROOT.toLowerCase()}/a.ts`)).toEqual([
      `${ROOT}/a.ts`,
      `${ROOT}/A.ts`,
    ]);
    expect(ctx?.filesByFoldedPath.get(`${ROOT.toLowerCase()}/b.ts`)).toEqual([
      `${ROOT}/b.ts`,
    ]);
  });
});

// R32B-01: effective options with `extends` semantics, not a pooled union.
describe('buildResolverContext — tsconfig extends semantics (R32B-01)', () => {
  it('applies the child paths over the inherited baseUrl', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.base.json`]:
          '{ "compilerOptions": { "baseUrl": "./src" } }',
        [`${ROOT}/tsconfig.json`]:
          '{ "extends": "./tsconfig.base", "compilerOptions": { "paths": { "@x": ["x"] } } }',
      }),
    );

    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.baseUrls).toEqual([`${ROOT}/src`]);
    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@x', targets: ['x'], baseDir: `${ROOT}/src` },
    ]);
  });

  it('lets a child that overrides paths replace the parent mapping', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.base.json`]:
          '{ "compilerOptions": { "baseUrl": ".", "paths": { "@x": ["old.ts"], "@y": ["y.ts"] } } }',
        [`${ROOT}/tsconfig.json`]:
          '{ "extends": "./tsconfig.base.json", "compilerOptions": { "paths": { "@x": ["new.ts"] } } }',
      }),
    );

    expect(ctx?.gaps).toEqual([]);
    // `paths` is replaced whole, as TypeScript does: `@y` is gone too.
    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@x', targets: ['new.ts'], baseDir: ROOT },
    ]);
  });

  it('applies an extends list in order, the later entry winning', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.a.json`]:
          '{ "compilerOptions": { "paths": { "@x": ["a.ts"] } } }',
        [`${ROOT}/tsconfig.b.json`]:
          '{ "compilerOptions": { "paths": { "@x": ["b.ts"] } } }',
        [`${ROOT}/tsconfig.json`]:
          '{ "extends": ["./tsconfig.a.json", "./tsconfig.b.json"] }',
      }),
    );
    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@x', targets: ['b.ts'], baseDir: ROOT },
    ]);
  });

  // User Decision 28 (review r1 R33-10): two independent configs that
  // declare `paths` never have a target picked across them.
  it.each([
    [
      'the same key mapped differently',
      '{ "@x": ["app.ts"], "@a": ["a.ts"] }',
      '{ "@x": ["lib.ts"], "@b": ["b.ts"] }',
    ],
    [
      'a wildcard against an exact key',
      '{ "@*": ["old/*"] }',
      '{ "@x": ["new.ts"] }',
    ],
    [
      'overlapping wildcards',
      '{ "@a/*": ["one/*"] }',
      '{ "@a/b/*": ["two/*"] }',
    ],
    ['identical mappings', '{ "@x": ["x.ts"] }', '{ "@x": ["x.ts"] }'],
  ])(
    'discloses independent configs that both declare paths (%s), using none',
    async (_label, appPaths, libPaths) => {
      const ctx = await build(
        memoryFileSystem({
          [`${ROOT}/tsconfig.app.json`]: `{ "compilerOptions": { "paths": ${appPaths} } }`,
          [`${ROOT}/tsconfig.lib.json`]: `{ "compilerOptions": { "paths": ${libPaths} } }`,
        }),
      );

      expect(ctx?.gaps).toEqual(['conflicting-configs']);
      expect(ctx?.tsconfigPaths).toEqual([]);
    },
  );

  it('keeps full resolution for one extends chain shared by several top configs', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.base.json`]:
          '{ "compilerOptions": { "paths": { "@*": ["libs/*"] } } }',
        [`${ROOT}/tsconfig.app.json`]: '{ "extends": "./tsconfig.base.json" }',
        [`${ROOT}/tsconfig.spec.json`]: '{ "extends": "./tsconfig.base.json" }',
      }),
    );

    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.tsconfigPaths).toEqual([
      { pattern: '@*', targets: ['libs/*'], baseDir: ROOT },
    ]);
  });

  // Review r1 R33-08: a shared or repeated parent is evaluated once.
  it('evaluates each config once in a repeated-parent extends graph', async () => {
    const count = 15;
    const files: Record<string, string> = {
      [`${ROOT}/tsconfig.c0.json`]:
        '{ "compilerOptions": { "paths": { "@x": ["x.ts"] } } }',
    };
    for (let i = 1; i < count; i++) {
      const parent = `./tsconfig.c${i - 1}.json`;
      files[`${ROOT}/tsconfig.c${i}.json`] = JSON.stringify({
        extends: [parent, parent],
      });
    }
    // Counts reads of `compilerOptions`: one per evaluation of a config.
    let evaluations = 0;

    const mapped = mapRootTsconfigs(
      Array.from({ length: count }, (_, i) => {
        const name = `tsconfig.c${i}.json`;
        const config = JSON.parse(files[`${ROOT}/${name}`]) as Record<
          string,
          unknown
        >;
        return {
          name,
          get config(): Record<string, unknown> {
            return new Proxy(config, {
              get(target, key, receiver) {
                if (key === 'compilerOptions') evaluations++;
                return Reflect.get(target, key, receiver);
              },
            });
          },
        };
      }),
      ROOT,
    );

    expect(mapped.gaps).toEqual([]);
    expect(mapped.paths.map((rule) => rule.pattern)).toEqual(['@x']);
    expect(evaluations).toBeLessThanOrEqual(count);
  });

  it('discloses independent configs with different baseUrls', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.app.json`]:
          '{ "compilerOptions": { "baseUrl": "./app" } }',
        [`${ROOT}/tsconfig.lib.json`]:
          '{ "compilerOptions": { "baseUrl": "./lib" } }',
      }),
    );
    expect(ctx?.gaps).toEqual(['conflicting-configs']);
    expect(ctx?.baseUrls).toEqual([]);
  });

  it('uses the one config that declares paths beside configs that map nothing', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.base.json`]:
          '{ "compilerOptions": { "paths": { "@x": ["x.ts"], "@t": ["t.ts"] } } }',
        // An Nx-style root solution config: references only, maps nothing.
        [`${ROOT}/tsconfig.json`]: '{ "files": [], "references": [] }',
      }),
    );
    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.tsconfigPaths.map((rule) => rule.pattern)).toEqual([
      '@x',
      '@t',
    ]);
  });

  it('discloses an extends cycle', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.a.json`]: '{ "extends": "./tsconfig.b.json" }',
        [`${ROOT}/tsconfig.b.json`]: '{ "extends": "./tsconfig.a.json" }',
      }),
    );
    expect(ctx?.gaps).toContain('manifest-unparseable');
  });
});

describe('buildResolverContext — package.json', () => {
  it('flags declared workspace packages (package.json and pnpm)', async () => {
    const npm = await build(
      memoryFileSystem({
        [`${ROOT}/package.json`]: '{ "workspaces": ["packages/*"] }',
      }),
    );
    expect(npm?.gaps).toEqual(['workspace-packages']);

    const pnpm = await build(
      memoryFileSystem({ [`${ROOT}/pnpm-workspace.yaml`]: 'packages: []' }),
    );
    expect(pnpm?.gaps).toEqual(['workspace-packages']);

    const plain = await build(
      memoryFileSystem({ [`${ROOT}/package.json`]: '{ "name": "x" }' }),
    );
    expect(plain?.gaps).toEqual([]);
  });

  it('collects registry packages as external', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/package.json`]: JSON.stringify({
          dependencies: { lodash: '^4', aliased: 'npm:lodash@4' },
          devDependencies: { '@scope/tool': '1' },
          peerDependencies: { react: '*' },
          optionalDependencies: { fsevents: '*' },
          scripts: { build: 'x' },
        }),
      }),
    );
    expect([...(ctx?.externalPackages ?? [])].sort()).toEqual(
      ['@scope/tool', 'aliased', 'fsevents', 'lodash', 'react'].sort(),
    );
    expect(ctx?.localPackages.size).toBe(0);
  });

  // R32B-02: a local specification is not proof of externality.
  it('keeps local package specifications internal, with their directory', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/package.json`]: JSON.stringify({
          dependencies: {
            local: 'file:./packages/local',
            linked: 'link:../outside',
            shared: 'workspace:*',
            plain: './vendor/plain',
          },
          devDependencies: { local: '^1.0.0' },
        }),
      }),
    );

    expect(Object.fromEntries(ctx?.localPackages ?? [])).toEqual({
      local: `${ROOT}/packages/local`,
      linked: undefined, // outside the root
      shared: undefined,
      plain: `${ROOT}/vendor/plain`,
    });
    // Declared local anywhere: never external, even if also versioned.
    expect(ctx?.externalPackages.has('local')).toBe(false);
  });
});

describe('buildResolverContext — bounds (limits disclosed)', () => {
  it('an absent root is complete; an unreadable one is not', async () => {
    const absent = await build(
      memoryFileSystem({}, { readdirError: 'ENOENT' }),
    );
    expect(absent?.gaps).toEqual([]);

    const denied = await build(
      memoryFileSystem({}, { readdirError: 'EACCES' }),
    );
    expect(denied?.gaps).toEqual(['root-unreadable']);
  });

  it(`reads at most ${MANIFEST_LIMITS.maxFiles} manifests`, async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 70; i++) {
      files[`${ROOT}/tsconfig.${String(i).padStart(2, '0')}.json`] = '{}';
    }
    const fileSystem = memoryFileSystem(files);

    const ctx = await build(fileSystem);

    expect(ctx?.manifestsRead).toBe(MANIFEST_LIMITS.maxFiles);
    expect(ctx?.gaps).toEqual(['too-many-manifests']);
  });

  it('does not open a manifest over 256 KiB', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.json`]: `{}${' '.repeat(MANIFEST_LIMITS.maxFileBytes)}`,
    });

    const ctx = await build(fileSystem);

    expect(ctx?.gaps).toEqual(['manifest-too-large']);
    expect(ctx?.manifestsRead).toBe(0);
    expect(fileSystem.open).not.toHaveBeenCalled();
  });

  it('stops reading at 2 MiB in total', async () => {
    const files: Record<string, string> = {};
    const size = 250 * 1024;
    for (let i = 0; i < 10; i++) {
      files[`${ROOT}/tsconfig.${i}.json`] = `{}${' '.repeat(size - 2)}`;
    }
    const fileSystem = memoryFileSystem(files);

    const ctx = await build(fileSystem);

    // 8 x 250 KiB = 2000 KiB fits; the ninth would pass 2048 KiB.
    expect(ctx?.manifestsRead).toBe(8);
    expect(ctx?.gaps).toEqual(['manifests-over-total']);
    expect(fileSystem.physicalBytes()).toBe(8 * size);
  });

  // R32B-04: rejected content is charged too; the physical reads stay bounded.
  it('charges rejected (NUL) manifests to the 2 MiB budget', async () => {
    const files: Record<string, Uint8Array> = {};
    const size = 250 * 1024;
    for (let i = 0; i < 12; i++) {
      files[`${ROOT}/tsconfig.${String(i).padStart(2, '0')}.json`] =
        new Uint8Array(size); // all NUL bytes
    }
    const fileSystem = memoryFileSystem(files);

    const ctx = await build(fileSystem);

    expect(fileSystem.physicalBytes()).toBeLessThanOrEqual(
      MANIFEST_LIMITS.maxTotalBytes,
    );
    expect(ctx?.gaps).toEqual(['manifest-not-text', 'manifests-over-total']);
    expect(ctx?.manifestsRead).toBe(0);
  });

  // Review r1 R33-07: bytes a handle returned before a read error are charged.
  it('charges partial reads that end in a read error to the 2 MiB budget', async () => {
    const files: Record<string, Uint8Array> = {};
    const size = 250 * 1024;
    for (let i = 0; i < 12; i++) {
      files[`${ROOT}/tsconfig.${String(i).padStart(2, '0')}.json`] =
        new Uint8Array(size).fill(0x20);
    }
    const fileSystem = memoryFileSystem(files);
    let served = 0;
    let opened = 0;
    fileSystem.open.mockImplementation(async (filePath: string) => {
      opened++;
      let reads = 0;
      return {
        ...fileSystem.handleOf(filePath),
        read: async (buffer: Uint8Array, offset: number, length: number) => {
          reads++;
          if (reads > 1) throw codeError('EIO');
          const chunk = Math.min(length, size);
          buffer.fill(0x20, offset, offset + chunk);
          served += chunk;
          return { bytesRead: chunk };
        },
      };
    });

    const ctx = await build(fileSystem);

    expect(served).toBeLessThanOrEqual(MANIFEST_LIMITS.maxTotalBytes);
    expect(opened).toBe(8);
    expect(ctx?.gaps).toEqual(['manifest-unreadable', 'manifests-over-total']);
  });

  it('charges a manifest whose close fails after it was read', async () => {
    const files: Record<string, string> = {};
    const size = 250 * 1024;
    for (let i = 0; i < 12; i++) {
      files[`${ROOT}/tsconfig.${String(i).padStart(2, '0')}.json`] =
        '{}'.padEnd(size, ' ');
    }
    const fileSystem = memoryFileSystem(files);
    fileSystem.open.mockImplementation(async (filePath: string) => ({
      ...fileSystem.handleOf(filePath),
      close: async () => {
        throw codeError('EIO');
      },
    }));

    const ctx = await build(fileSystem);

    expect(fileSystem.physicalBytes()).toBeLessThanOrEqual(
      MANIFEST_LIMITS.maxTotalBytes,
    );
    expect(fileSystem.open).toHaveBeenCalledTimes(8);
    expect(ctx?.gaps).toEqual(['manifest-unreadable', 'manifests-over-total']);
    expect(ctx?.manifestsRead).toBe(0);
  });

  it('bounds the read of a manifest that grew after its stat', async () => {
    const fileSystem = memoryFileSystem({ [`${ROOT}/tsconfig.json`]: '{}' });
    let served = 0;
    fileSystem.open.mockImplementation(async (filePath: string) => ({
      ...fileSystem.handleOf(filePath),
      // An endless file: every read fills whatever was asked.
      read: async (buffer: Uint8Array, offset: number, length: number) => {
        buffer.fill(0x20, offset, offset + length);
        served += length;
        return { bytesRead: length };
      },
    }));

    const ctx = await build(fileSystem);

    expect(served).toBe(MANIFEST_LIMITS.maxFileBytes + 1);
    expect(ctx?.gaps).toEqual(['manifest-too-large']);
    expect(ctx?.manifestsRead).toBe(0);
  });

  it('does not read a manifest whose real path leaves the root', async () => {
    const fileSystem = memoryFileSystem(
      {
        [`${ROOT}/tsconfig.json`]: '{}',
        'R:/elsewhere/tsconfig.json': '{}',
      },
      { links: { [`${ROOT}/tsconfig.json`]: 'R:/elsewhere/tsconfig.json' } },
    );

    const ctx = await build(fileSystem);

    expect(ctx?.gaps).toEqual(['manifest-outside-root']);
    expect(fileSystem.open).not.toHaveBeenCalled();
  });

  it.each([
    ['a NUL byte', new Uint8Array([0x7b, 0x00, 0x7d])],
    ['invalid UTF-8', new Uint8Array([0x7b, 0xff, 0x7d])],
  ])('reads text only (%s is not)', async (_label, bytes) => {
    const ctx = await build(
      memoryFileSystem({ [`${ROOT}/tsconfig.json`]: bytes }),
    );
    expect(ctx?.gaps).toEqual(['manifest-not-text']);
    expect(ctx?.manifestsRead).toBe(0);
  });

  it('keeps a UTF-8 BOM out of the parsed text', async () => {
    const ctx = await build(
      memoryFileSystem({
        [`${ROOT}/tsconfig.json`]:
          '\uFEFF{ "compilerOptions": { "baseUrl": "." } }',
      }),
    );
    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.baseUrls).toEqual([ROOT]);
  });
});

// R32B-03: containment is checked on the object actually opened.
describe('buildResolverContext — manifest identity (R32B-03)', () => {
  const OUTSIDE = 'R:/outside/tsconfig.json';
  const OUTSIDE_CONFIG =
    '{ "compilerOptions": { "paths": { "@outside": ["x"] } } }';

  it('rejects a file swapped between the lookup and the open', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.json`]: '{}',
      [OUTSIDE]: OUTSIDE_CONFIG,
    });
    // The root is replaced by a link to an outside directory after the
    // stat: the open reaches the outside file.
    fileSystem.open.mockImplementation(async () =>
      fileSystem.handleOf(OUTSIDE),
    );

    const ctx = await build(fileSystem);

    expect(ctx?.gaps).toEqual(['manifest-changed']);
    expect(ctx?.tsconfigPaths).toEqual([]);
    expect(ctx?.manifestsRead).toBe(0);
  });

  it('rejects a path that resolves outside the root after the open', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.json`]: OUTSIDE_CONFIG,
    });
    // Same file identity, but an ancestor link now leads outside.
    let lookups = 0;
    fileSystem.realpath.mockImplementation(async (filePath: string) =>
      filePath === `${ROOT}/tsconfig.json` && ++lookups > 1
        ? OUTSIDE
        : filePath,
    );

    const ctx = await build(fileSystem);

    expect(ctx?.gaps).toEqual(['manifest-changed']);
    expect(ctx?.tsconfigPaths).toEqual([]);
  });

  // The reviewer's probe on a real file system: after the stat, the root
  // directory is renamed and replaced by a junction (a directory symlink off
  // Windows) to an outside directory holding a different tsconfig.json.
  it('rejects a real junction swap between the lookup and the open', async () => {
    const base = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-32b-swap-')),
    );
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(outside, 'tsconfig.json'), OUTSIDE_CONFIG);
    let swapped = false;
    const swapping: ManifestFileSystem = {
      ...NODE_MANIFEST_FILE_SYSTEM,
      stat: async (filePath) => {
        const looked = await NODE_MANIFEST_FILE_SYSTEM.stat(filePath);
        if (!swapped && filePath.endsWith('tsconfig.json')) {
          swapped = true;
          fs.renameSync(root, path.join(base, 'moved'));
          fs.symlinkSync(outside, root, 'junction');
        }
        return looked;
      },
    };
    try {
      const ctx = await buildResolverContext({
        root,
        knownFiles: [],
        isCurrent: () => true,
        fileSystem: swapping,
      });

      expect(swapped).toBe(true);
      expect(ctx?.gaps).toEqual(['manifest-changed']);
      expect(ctx?.tsconfigPaths).toEqual([]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('reads a stable manifest (control)', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.json`]: OUTSIDE_CONFIG,
    });
    const ctx = await build(fileSystem);
    expect(ctx?.gaps).toEqual([]);
    expect(ctx?.tsconfigPaths.map((rule) => rule.pattern)).toEqual([
      '@outside',
    ]);
  });
});

describe('buildResolverContext — generation checks and yielding', () => {
  it('stops reading once the build is superseded', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.a.json`]: '{}',
      [`${ROOT}/tsconfig.b.json`]: '{}',
      [`${ROOT}/tsconfig.c.json`]: '{}',
    });
    let current = true;
    fileSystem.open.mockImplementationOnce(async (filePath: string) => {
      current = false; // superseded while the first manifest is opened
      return fileSystem.handleOf(filePath);
    });

    const ctx = await build(fileSystem, { isCurrent: () => current });

    expect(ctx).toBeUndefined();
    expect(fileSystem.open).toHaveBeenCalledTimes(1);
    expect(fileSystem.physicalBytes()).toBe(0);
  });

  // R32B-06: a build superseded during the lookup opens nothing.
  it('opens nothing once the build is superseded during the stat', async () => {
    const fileSystem = memoryFileSystem({ [`${ROOT}/tsconfig.json`]: '{}' });
    let current = true;
    fileSystem.stat.mockImplementationOnce(async () => {
      current = false;
      return { size: 2, dev: 1, ino: 1, isFile: () => true };
    });

    const ctx = await build(fileSystem, { isCurrent: () => current });

    expect(ctx).toBeUndefined();
    expect(fileSystem.open).not.toHaveBeenCalled();
    expect(fileSystem.physicalBytes()).toBe(0);
  });

  it('yields before every manifest read', async () => {
    const order: string[] = [];
    const fileSystem = memoryFileSystem({
      [`${ROOT}/tsconfig.a.json`]: '{}',
      [`${ROOT}/tsconfig.b.json`]: '{}',
    });
    fileSystem.open.mockImplementation(async (filePath: string) => {
      order.push('read');
      return fileSystem.handleOf(filePath);
    });

    await build(fileSystem, {
      yieldBetweenReads: async () => {
        order.push('yield');
      },
    });

    expect(order).toEqual(['yield', 'read', 'yield', 'read']);
  });
});

describe('parseJsonc', () => {
  it.each([
    ['{ "a": "x // not a comment" }', { a: 'x // not a comment' }],
    ['{ "a": "/* kept */" }', { a: '/* kept */' }],
    ['{ "a": "q\\"," , }', { a: 'q",' }],
    ['[1, 2, /* c */ ]', [1, 2]],
  ])('%s', (text, expected) => {
    expect(parseJsonc(text)).toEqual(expected);
  });

  it('is undefined for an unterminated comment or invalid JSON', () => {
    expect(parseJsonc('{ /* open ')).toBeUndefined();
    expect(parseJsonc('{ a: 1 }')).toBeUndefined();
  });
});
