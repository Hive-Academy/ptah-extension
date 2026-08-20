/**
 * HarnessHealthBadgeComponent specs.
 *
 * Coverage:
 *   - Overall state derivation: ok / degraded / error / unknown each pick their
 *     own tone, and severity is taken from the SHARED reducer rather than
 *     recomputed here.
 *   - The distinction the whole panel exists for: `unsupported` renders as grey
 *     information, `missing` renders as a red count. Confusing the two is what
 *     made the old sync unreadable.
 *   - Undetected targets are greyed and never raise the badge (E17).
 *   - `sources` states get their own explanation instead of six empty rows
 *     (E2 / E3).
 *   - The panel's Reconcile button issues `harness:reconcile` and the refreshed
 *     counts land.
 *
 * The store is exercised for real against a mocked `ClaudeRpcService`, so these
 * assert what a user would see for a given backend report rather than that a
 * stub returned what the test handed it.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { summarizeHarnessHealth } from '@ptah-extension/shared';
import { HarnessHealthBadgeComponent } from './harness-health-badge.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

function makeTarget(
  target: HarnessTargetId,
  over: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 8,
    ...over,
  };
}

function makeHealth(over: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: 'D:/repo',
    generatedAt: '2026-08-18T10:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    targets: [makeTarget('claude')],
    collisions: [],
    ...over,
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('HarnessHealthBadgeComponent', () => {
  let fixture: ComponentFixture<HarnessHealthBadgeComponent>;
  let host: HTMLElement;
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(fail(`No responder for ${method}`));
      }
      return Promise.resolve(factory());
    }),
  };

  const badge = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="harness-health-badge"]',
    );

  const testId = (id: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  /** Mount the badge with a given report already answered by `harness:health`. */
  const render = async (health: HarnessHealth | null): Promise<void> => {
    setResponder('harness:health', () =>
      ok({ health, summary: summarizeHarnessHealth(health), cached: true }),
    );
    fixture = TestBed.createComponent(HarnessHealthBadgeComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Open the drill-in panel by clicking the badge. */
  const openPanel = async (): Promise<void> => {
    badge()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    TestBed.configureTestingModule({
      imports: [HarnessHealthBadgeComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('load', () => {
    it('reads harness health on mount, from the cache', async () => {
      await render(makeHealth());

      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('harness:health');
      expect(calls[0]?.params).toEqual({});
    });
  });

  describe('overall state', () => {
    it('is green and counts targets when everything is in sync', async () => {
      await render(
        makeHealth({ targets: [makeTarget('claude'), makeTarget('cursor')] }),
      );

      expect(badge()?.className).toContain('text-success');
      expect(badge()?.textContent).toContain(
        'Harness in sync across 2 targets',
      );
    });

    it('is amber when a detected target is missing entries', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('claude', {
              found: 3,
              missing: ['.claude/skills/orchestration'],
            }),
          ],
        }),
      );

      expect(badge()?.className).toContain('text-warning');
      expect(badge()?.className).not.toContain('text-success');
      expect(badge()?.textContent).toContain('1 missing');
    });

    it('is red when the filesystem refused a write', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('claude', {
              writeFailed: [
                { relPath: '.claude/skills/a/SKILL.md', reason: 'EBUSY' },
              ],
            }),
          ],
        }),
      );

      expect(badge()?.className).toContain('text-error');
      expect(badge()?.textContent).toContain('could not be written');
    });

    it('is amber, not red, while sources are still downloading', async () => {
      await render(makeHealth({ sources: 'pending-download' }));

      expect(badge()?.className).toContain('text-warning');
    });

    it('is amber, not red, on a cold run with no sources on disk', async () => {
      // `sources-missing` heals itself on the next online activation, so it is
      // "not whole yet" rather than a failure a human must act on.
      await render(makeHealth({ sources: 'sources-missing' }));

      expect(badge()?.className).toContain('text-warning');
      expect(badge()?.className).not.toContain('text-error');
    });

    it('is neutral grey when no pass has run for this workspace', async () => {
      await render(null);

      expect(badge()?.className).toContain('text-base-content-muted');
      expect(badge()?.textContent).toContain(
        'No harness reconcile has run yet',
      );
    });

    it('stays green when an uninstalled target reports gaps', async () => {
      // E17: a Cursor nobody installed must not sit permanently amber, or the
      // badge trains users to ignore it.
      await render(
        makeHealth({
          targets: [
            makeTarget('claude'),
            makeTarget('cursor', {
              detected: false,
              expected: 0,
              found: 0,
              missing: ['.cursor/skills/orchestration'],
            }),
          ],
        }),
      );

      expect(badge()?.className).toContain('text-success');
      expect(badge()?.textContent).toContain('1 target');
    });

    it('does not escalate on collisions alone', async () => {
      // A shadowed slug is a source-authoring problem; reconciling cannot fix
      // it, so an amber badge here would offer a button guaranteed not to help.
      await render(
        makeHealth({
          collisions: [
            {
              slug: 'run-tests',
              shadowedSource: 'D:/plugins/b/skills/run-tests',
              reason: 'duplicate-slug',
            },
          ],
        }),
      );

      expect(badge()?.className).toContain('text-success');
    });
  });

  describe('per-target detail', () => {
    it('distinguishes unsupported facets from missing entries', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('codex', {
              // Codex carries skills but has no project-command directory.
              facets: {
                skills: 'supported',
                commands: 'unsupported',
                agents: 'supported',
                mcp: 'supported',
              },
              expected: 3,
              found: 2,
              missing: ['.agents/skills/orchestration'],
            }),
          ],
        }),
      );
      await openPanel();

      const skills = testId('harness-facet-codex-skills');
      const commands = testId('harness-facet-codex-commands');
      const missing = testId('harness-target-missing');

      // Supported + detected → green tick.
      expect(skills?.className).toContain('text-success');
      // Unsupported → grey, informational, and says so rather than implying a gap.
      expect(commands?.className).toContain('text-base-content-muted');
      expect(commands?.className).not.toContain('text-error');
      expect(commands?.getAttribute('title')).toContain(
        'cannot carry commands',
      );
      // Missing → a red, actionable count. Never conflated with the above.
      expect(missing?.className).toContain('text-error');
      expect(missing?.textContent).toContain('1 missing');
    });

    it('greys an undetected target and labels it not installed', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('antigravity', {
              detected: false,
              expected: 0,
              found: 0,
            }),
          ],
        }),
      );
      await openPanel();

      expect(testId('harness-target-absent')?.textContent).toContain(
        'Not installed',
      );
      // Supported-but-absent must not claim a green tick for files nobody wrote.
      expect(testId('harness-facet-antigravity-skills')?.className).toContain(
        'text-base-content-muted',
      );
    });

    it('lists write failures with their reason', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('claude', {
              writeFailed: [
                { relPath: '.claude/skills/a/SKILL.md', reason: 'EBUSY' },
              ],
            }),
          ],
        }),
      );
      await openPanel();

      const failures = testId('harness-target-write-failed');
      expect(failures?.textContent).toContain('.claude/skills/a/SKILL.md');
      expect(failures?.textContent).toContain('EBUSY');
    });

    it('explains an overwritten local edit instead of just counting it', async () => {
      // E10: the source wins, and the user needs to know where to edit instead.
      await render(
        makeHealth({
          targets: [
            makeTarget('claude', {
              overwrittenLocalEdit: ['.claude/skills/a/SKILL.md'],
            }),
          ],
        }),
      );
      await openPanel();

      expect(testId('harness-target-overwritten')?.textContent).toContain(
        'user layer',
      );
    });

    it('explains why every row is empty when the sources are', async () => {
      await render(makeHealth({ sources: 'sources-missing' }));
      await openPanel();

      expect(testId('harness-sources-note')?.textContent).toContain(
        'No skill sources on disk yet',
      );
    });

    it('names collisions as unreconcilable', async () => {
      await render(
        makeHealth({
          collisions: [
            {
              slug: 'run-tests',
              shadowedSource: 'D:/plugins/b/skills/run-tests',
              reason: 'case-collision',
            },
          ],
        }),
      );
      await openPanel();

      expect(testId('harness-collisions')?.textContent).toContain(
        'reconciling cannot',
      );
    });

    it('renders an empty state before any pass has run', async () => {
      await render(null);
      await openPanel();

      expect(testId('harness-empty')?.textContent).toContain(
        'No harness pass has run',
      );
    });
  });

  describe('reconcile', () => {
    it('runs a full pass and shows the refreshed counts', async () => {
      await render(
        makeHealth({
          targets: [
            makeTarget('claude', {
              found: 3,
              missing: ['.claude/skills/orchestration'],
            }),
          ],
        }),
      );
      await openPanel();
      expect(badge()?.className).toContain('text-warning');

      const healed = makeHealth();
      setResponder('harness:reconcile', () =>
        ok({ health: healed, summary: summarizeHarnessHealth(healed) }),
      );

      testId('harness-reconcile')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(calls.map((c) => c.method)).toEqual([
        'harness:health',
        'harness:reconcile',
      ]);
      expect(calls[1]?.params).toEqual({ mode: 'full' });
      expect(badge()?.className).toContain('text-success');
      expect(testId('harness-target-missing')).toBeNull();
    });

    it('surfaces a reconcile failure inside the panel', async () => {
      await render(makeHealth());
      await openPanel();
      setResponder('harness:reconcile', () =>
        fail('another host holds the lock'),
      );

      testId('harness-reconcile')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.textContent).toContain('another host holds the lock');
    });

    it('the panel refresh asks for a fresh pass, not the cache', async () => {
      await render(makeHealth());
      await openPanel();

      testId('harness-refresh')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(calls[1]?.method).toBe('harness:health');
      expect(calls[1]?.params).toEqual({ refresh: true });
    });
  });
});
