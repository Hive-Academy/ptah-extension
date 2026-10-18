import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, posix, relative, resolve, sep } from 'path';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import type { IHarnessCliDetector } from '../sources/harness-source.port';
import { ClaudeTarget } from './claude-target';
import { createRivalTargets } from './rival-targets';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'nx.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();
const PLUGINS_ROOT = join(
  REPO_ROOT,
  'apps',
  'ptah-extension-vscode',
  'assets',
  'plugins',
);
const GUARDED_PLUGINS = listDirs(PLUGINS_ROOT);

interface SkillDir {
  plugin: string;
  slug: string;
  dir: string;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) =>
    statSync(join(dir, name)).isDirectory(),
  );
}

function skillDirs(): SkillDir[] {
  return GUARDED_PLUGINS.flatMap((plugin) => {
    const skillsRoot = join(PLUGINS_ROOT, plugin, 'skills');
    return listDirs(skillsRoot)
      .filter((slug) => existsSync(join(skillsRoot, slug, 'SKILL.md')))
      .map((slug) => ({ plugin, slug, dir: join(skillsRoot, slug) }));
  });
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith('.md') ? [full] : [];
  });
}

function relativeLinks(markdown: string): string[] {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '');
  const links: string[] = [];
  for (const match of withoutFences.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
      continue;
    }
    links.push(target.split('#')[0]);
  }
  return links;
}

function declaredRequires(skillMd: string): string[] {
  const section = skillMd.match(
    /^## Requires\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m,
  );
  if (section === null) return [];
  return [...section[1].matchAll(/^\s*-\s+`([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

interface CrossSkillLink {
  from: SkillDir;
  file: string;
  link: string;
  siblingSlug: string;
  siblingDir: string | null;
  fileInSibling: string;
}

/**
 * Links are written against the flat installed layout, where every shipped
 * skill sits at <skills dir>/<slug> regardless of which plugin ships it.
 * A sibling slug therefore resolves first against the linking skill's own
 * plugin, then against every other guarded plugin.
 */
function shippedSkillDir(plugin: string, slug: string): string | null {
  for (const candidate of [
    plugin,
    ...GUARDED_PLUGINS.filter((other) => other !== plugin),
  ]) {
    const dir = join(PLUGINS_ROOT, candidate, 'skills', slug);
    if (existsSync(join(dir, 'SKILL.md'))) return dir;
  }
  return null;
}

function crossSkillLinks(): CrossSkillLink[] {
  return skillDirs().flatMap((skill) =>
    markdownFiles(skill.dir).flatMap((file) =>
      relativeLinks(readFileSync(file, 'utf8'))
        .filter((link) =>
          toPosix(
            relative(skill.dir, resolve(dirname(file), link)),
          ).startsWith('..'),
        )
        .map((link) => {
          const flatRel = toPosix(
            relative(
              join(PLUGINS_ROOT, skill.plugin, 'skills'),
              resolve(dirname(file), link),
            ),
          );
          const [siblingSlug, ...rest] = flatRel.split('/');
          return {
            from: skill,
            file,
            link,
            siblingSlug,
            siblingDir: shippedSkillDir(skill.plugin, siblingSlug),
            fileInSibling: rest.join('/'),
          };
        }),
    ),
  );
}

describe('skills that link a sibling skill declare it', () => {
  it('finds the cross-skill links the workflow skills rely on', () => {
    const fromSlugs = new Set(crossSkillLinks().map((l) => l.from.slug));
    expect(fromSlugs.has('orchestration')).toBe(true);
    expect(fromSlugs.has('tribunal')).toBe(true);
    expect(fromSlugs.has('dotnet-solution-initializer')).toBe(true);
    expect(fromSlugs.has('saas-workspace-initializer')).toBe(true);
  });

  it('every cross-skill link lands on an existing file in a shipped sibling skill', () => {
    const offenders = crossSkillLinks()
      .filter(
        ({ siblingDir, fileInSibling }) =>
          siblingDir === null || !existsSync(join(siblingDir, fileInSibling)),
      )
      .map(
        ({ file, link }) => `${toPosix(relative(REPO_ROOT, file))} → ${link}`,
      );
    expect(offenders).toEqual([]);
  });

  it('every linked sibling is listed under the linking skill’s ## Requires', () => {
    const offenders = crossSkillLinks()
      .filter(({ from, siblingSlug }) => {
        const requires = declaredRequires(
          readFileSync(join(from.dir, 'SKILL.md'), 'utf8'),
        );
        return !requires.includes(siblingSlug);
      })
      .map(
        ({ file, link }) => `${toPosix(relative(REPO_ROOT, file))} → ${link}`,
      );
    expect(offenders).toEqual([]);
  });

  it('every ## Requires entry names a sibling skill shipped by a guarded plugin', () => {
    const offenders = skillDirs().flatMap((skill) =>
      declaredRequires(readFileSync(join(skill.dir, 'SKILL.md'), 'utf8'))
        .filter(
          (slug) => shippedSkillDir(skill.plugin, slug) === null,
        )
        .map((slug) => `${skill.plugin}/${skill.slug} requires ${slug}`),
    );
    expect(offenders).toEqual([]);
  });

  it('orchestration and tribunal both declare agent-lanes', () => {
    const core = join(PLUGINS_ROOT, 'ptah-core', 'skills');
    for (const slug of ['orchestration', 'tribunal']) {
      expect(
        declaredRequires(readFileSync(join(core, slug, 'SKILL.md'), 'utf8')),
      ).toContain('agent-lanes');
    }
  });
});

describe('every harness target installs skills as flat siblings', () => {
  const detector: IHarnessCliDetector = {
    isInstalled: () => Promise.resolve(true),
  };
  const store = new ManagedManifestStore();
  const targets = [
    new ClaudeTarget(store),
    ...createRivalTargets({
      manifestStore: store,
      detector,
      homeDir: join(tmpdir(), 'skill-sibling-links-home'),
    }),
  ].filter((target) => target.facets.skills === 'supported');

  const desired: HarnessDesiredState = {
    skills: [
      {
        slug: 'agent-lanes',
        sourceDir: '/src/agent-lanes',
        contentHash: 'h-lanes',
      },
      {
        slug: 'tribunal',
        sourceDir: '/src/tribunal',
        contentHash: 'h-tribunal',
      },
    ],
    commands: [],
    agents: [],
    mcp: [],
    collisions: [],
    sources: 'ok',
    sourceRoots: [],
  };

  it('covers more than one target', () => {
    expect(targets.length).toBeGreaterThan(1);
  });

  it.each(targets.map((target) => [target.id, target] as const))(
    '%s puts each skill at <skills dir>/<slug>',
    (_id, target) => {
      const keys = [...target.preflightKeys(desired).entries()];
      const lanes = keys.find(([, hash]) => hash === 'h-lanes')?.[0];
      const tribunal = keys.find(([, hash]) => hash === 'h-tribunal')?.[0];
      expect(lanes).toBeDefined();
      expect(tribunal).toBeDefined();
      expect(posix.basename(lanes as string)).toBe('agent-lanes');
      expect(posix.basename(tribunal as string)).toBe('tribunal');
      expect(posix.dirname(lanes as string)).toBe(
        posix.dirname(tribunal as string),
      );
    },
  );
});
