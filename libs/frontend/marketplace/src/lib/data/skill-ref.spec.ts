/**
 * TASK_2026_533 Task 3.2 — the `:skillRef` codec, and the R6 router probe.
 *
 * R6: an external plugin id (`external:<owner>/<repo>/<plugin>`) inside
 * `:skillRef` relies on the router percent-encoding `/`. The probe below runs a
 * real router over the planned `skills` subtree (implementation plan D1) and
 * pins three things: a ref built from commands matches ONE segment, the bound
 * input equals the ref byte for byte, and the serialized URL parses back to the
 * same ref (the webview's `MemoryPlatformLocation` stores that string).
 */

import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  RouterOutlet,
  provideRouter,
  withComponentInputBinding,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  decodeSkillRef,
  encodeSkillRef,
  type MarketplaceSkillKind,
  type SkillRef,
} from './skill-ref';

const ALL_KINDS = [
  'ptah-plugin',
  'community-skill',
  'marketplace-plugin',
] as const satisfies readonly MarketplaceSkillKind[];

const EXTERNAL_ID = 'external:anthropics/claude-plugins/code-review';

describe('encodeSkillRef / decodeSkillRef — round trip', () => {
  const ids = [
    'ptah-core',
    'frontend-design',
    EXTERNAL_ID,
    'external:o/r/p:with:colons',
    'name with spaces',
    'percent%2Fliteral',
    'a?b#c',
  ];

  for (const kind of ALL_KINDS) {
    for (const id of ids) {
      it(`round-trips ${kind} + ${JSON.stringify(id)}`, () => {
        const ref: SkillRef = { kind, id };
        expect(decodeSkillRef(encodeSkillRef(ref))).toEqual(ref);
      });
    }
  }
});

describe('encodeSkillRef', () => {
  it('keeps colons and slashes of an external id in the tail', () => {
    expect(
      encodeSkillRef({ kind: 'marketplace-plugin', id: EXTERNAL_ID }),
    ).toBe(`marketplace-plugin:${EXTERNAL_ID}`);
  });
});

describe('decodeSkillRef — splits at the FIRST colon', () => {
  it('returns the whole external id as the tail', () => {
    expect(decodeSkillRef(`marketplace-plugin:${EXTERNAL_ID}`)).toEqual({
      kind: 'marketplace-plugin',
      id: EXTERNAL_ID,
    });
  });
});

describe('decodeSkillRef — malformed input is null', () => {
  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['no separator', 'ptah-core'],
    ['a bare static source path', 'ptah-plugins'],
    ['a source path with a colon', 'ptah-plugins:ptah-core'],
    ['empty id', 'community-skill:'],
    ['empty kind', ':ptah-core'],
    ['unknown kind', 'external:o/r/p'],
    ['an Object.prototype member as kind', 'toString:x'],
  ])('%s → null', (_label, raw) => {
    expect(decodeSkillRef(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R6 probe — real router, the planned `skills` subtree
// ---------------------------------------------------------------------------

@Component({
  selector: 'ptah-r6-skills-list',
  imports: [RouterOutlet],
  template: `<section data-testid="skills-list"><router-outlet /></section>`,
})
class SkillsListStubComponent {}

@Component({
  selector: 'ptah-r6-skill-detail',
  template: `<p data-testid="skill-detail">{{ skillRef() }}</p>`,
})
class SkillDetailStubComponent {
  public readonly skillRef = input.required<string>();
}

@Component({
  selector: 'ptah-r6-source',
  template: `<p data-testid="skill-source">source</p>`,
})
class SkillSourceStubComponent {}

@Component({
  selector: 'ptah-r6-elsewhere',
  template: `<p data-testid="elsewhere">elsewhere</p>`,
})
class ElsewhereStubComponent {}

/** Mirrors implementation plan D1: static sources beside `''` → `:skillRef`. */
const PROBE_ROUTES: Routes = [
  {
    path: 'marketplace',
    children: [
      { path: 'overview', component: ElsewhereStubComponent },
      {
        path: 'skills',
        children: [
          { path: 'ptah-plugins', component: SkillSourceStubComponent },
          { path: 'community', component: SkillSourceStubComponent },
          { path: 'marketplaces', component: SkillSourceStubComponent },
          {
            path: '',
            component: SkillsListStubComponent,
            children: [
              { path: ':skillRef', component: SkillDetailStubComponent },
            ],
          },
        ],
      },
    ],
  },
];

describe('R6 probe — `:skillRef` with `/` and `:` survives the router', () => {
  const ref = encodeSkillRef({ kind: 'marketplace-plugin', id: EXTERNAL_ID });

  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(PROBE_ROUTES, withComponentInputBinding())],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  function renderedDetail(): string | null {
    const el = harness.fixture.nativeElement as HTMLElement;
    return (
      el.querySelector('[data-testid="skill-detail"]')?.textContent ?? null
    );
  }

  /** The path segments of the ACTIVE route chain, root to leaf. */
  function activeSegmentPaths(): string[] {
    const paths: string[] = [];
    let snapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
      paths.push(...snapshot.url.map((segment) => segment.path));
    }
    return paths;
  }

  it('matches ONE segment and binds the exact ref when navigated by commands', async () => {
    const ok = await router.navigate(['/marketplace', 'skills', ref]);
    harness.detectChanges();

    expect(ok).toBe(true);
    expect(activeSegmentPaths()).toEqual(['marketplace', 'skills', ref]);
    expect(renderedDetail()).toBe(ref);
    expect(decodeSkillRef(renderedDetail())).toEqual({
      kind: 'marketplace-plugin',
      id: EXTERNAL_ID,
    });
  });

  it('percent-encodes the slashes in the serialized URL', async () => {
    await router.navigate(['/marketplace', 'skills', ref]);

    expect(router.url).toBe(
      '/marketplace/skills/marketplace-plugin:external:anthropics%2Fclaude-plugins%2Fcode-review',
    );
    const parsed = router.parseUrl(router.url);
    expect(
      parsed.root.children['primary']?.segments.map((s) => s.path),
    ).toEqual(['marketplace', 'skills', ref]);
  });

  it('parses the serialized URL back to the same ref (string navigation)', async () => {
    await router.navigate(['/marketplace', 'skills', ref]);
    const serialized = router.url;
    await router.navigateByUrl('/marketplace/overview');
    harness.detectChanges();
    expect(renderedDetail()).toBeNull();

    const ok = await router.navigateByUrl(serialized);
    harness.detectChanges();

    expect(ok).toBe(true);
    expect(activeSegmentPaths()).toEqual(['marketplace', 'skills', ref]);
    expect(renderedDetail()).toBe(ref);
  });

  it('does not confuse a static source path with a ref', async () => {
    await router.navigate(['/marketplace', 'skills', 'ptah-plugins']);
    harness.detectChanges();
    const el = harness.fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="skill-source"]')).not.toBeNull();
    expect(renderedDetail()).toBeNull();

    await router.navigate([
      '/marketplace',
      'skills',
      encodeSkillRef({ kind: 'ptah-plugin', id: 'ptah-core' }),
    ]);
    harness.detectChanges();

    expect(el.querySelector('[data-testid="skill-source"]')).toBeNull();
    expect(renderedDetail()).toBe('ptah-plugin:ptah-core');
  });
});
