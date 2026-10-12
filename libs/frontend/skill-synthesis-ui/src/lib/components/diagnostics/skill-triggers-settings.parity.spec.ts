/**
 * TASK_2026_586 - the Settings triggers card sends the SAME `setTriggers`
 * payloads as the deleted diagnostics accordion, measured at the RPC edge.
 *
 * The oracle is the base accordion's `onTriggerChange`
 * (`git show c4ab013f3:libs/frontend/skill-synthesis-ui/src/lib/components/
 * diagnostics/skill-diagnostics-accordion.component.ts`, lines 244-305),
 * transcribed into `CASES` below. The component under test runs for real, down
 * through the real `SkillDiagnosticsStateService` and the real
 * `SkillDiagnosticsRpcService`; only `ClaudeRpcService.call` is stubbed, so the
 * assertion is on the exact `skillSynthesis:setTriggers` params the backend
 * receives. The backend half (those payloads persist unchanged) is
 * `skills-synthesis-rpc.activity-feed.integration.spec.ts` in rpc-handlers.
 */
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  SkillDiagnosticsResult,
  SkillTriggersDto,
} from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SkillTriggersSettingsComponent } from './skill-triggers-settings.component';

const ALL_ON: SkillTriggersDto = {
  idleMs: 600_000,
  bootScan: true,
  subagentStop: { enabled: true },
  turnComplete: { enabled: true },
  postToolUse: { enabled: true, minEditCount: 3 },
  maxAnalyzesPerHour: 6,
};

type ControlType = 'checkbox' | 'number';

type Action =
  | { readonly type: 'checkbox'; readonly checked: boolean }
  | { readonly type: 'number'; readonly value: number };

interface ParityCase {
  readonly name: string;
  readonly key: string;
  readonly action: Action;
  /** Triggers the snapshot reported before the user acted. */
  readonly initial: SkillTriggersDto;
  /** Exactly what the base accordion passed to `state.setTriggers`. */
  readonly expected: Partial<SkillTriggersDto>;
}

/** Base accordion `onTriggerChange`, one row per control behaviour. */
const CASES: readonly ParityCase[] = [
  {
    name: 'idleMs on applies 600000',
    key: 'idleMs',
    action: { type: 'checkbox', checked: true },
    initial: { ...ALL_ON, idleMs: 0 },
    expected: { idleMs: 600_000 },
  },
  {
    name: 'idleMs off writes 0',
    key: 'idleMs',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { idleMs: 0 },
  },
  {
    name: 'idleMs typed value as-is',
    key: 'idleMs',
    action: { type: 'number', value: 120_000 },
    initial: ALL_ON,
    expected: { idleMs: 120_000 },
  },
  {
    name: 'bootScan off',
    key: 'bootScan',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { bootScan: false },
  },
  {
    name: 'subagentStop off nests the DTO',
    key: 'subagentStop',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { subagentStop: { enabled: false } },
  },
  {
    name: 'turnComplete off nests the DTO',
    key: 'turnComplete',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { turnComplete: { enabled: false } },
  },
  {
    name: 'postToolUse off keeps the current minEditCount',
    key: 'postToolUse',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { postToolUse: { enabled: false, minEditCount: 3 } },
  },
  {
    name: 'postToolUse on with no current value defaults minEditCount to 1',
    key: 'postToolUse',
    action: { type: 'checkbox', checked: true },
    initial: { idleMs: 600_000, bootScan: true },
    expected: { postToolUse: { enabled: true, minEditCount: 1 } },
  },
  {
    name: 'postToolUseMinEditCount keeps the current enabled flag',
    key: 'postToolUseMinEditCount',
    action: { type: 'number', value: 7 },
    initial: ALL_ON,
    expected: { postToolUse: { enabled: true, minEditCount: 7 } },
  },
  {
    name: 'postToolUseMinEditCount with no current value defaults enabled to false',
    key: 'postToolUseMinEditCount',
    action: { type: 'number', value: 5 },
    initial: { idleMs: 600_000, bootScan: true },
    // The numeric input only renders when it has a value; with no
    // `postToolUse` the control shows 0, so typing still emits the payload.
    expected: { postToolUse: { enabled: false, minEditCount: 5 } },
  },
  {
    name: 'maxAnalyzesPerHour on applies 60',
    key: 'maxAnalyzesPerHour',
    action: { type: 'checkbox', checked: true },
    initial: { ...ALL_ON, maxAnalyzesPerHour: 0 },
    expected: { maxAnalyzesPerHour: 60 },
  },
  {
    name: 'maxAnalyzesPerHour off writes 0',
    key: 'maxAnalyzesPerHour',
    action: { type: 'checkbox', checked: false },
    initial: ALL_ON,
    expected: { maxAnalyzesPerHour: 0 },
  },
  {
    name: 'maxAnalyzesPerHour typed value as-is',
    key: 'maxAnalyzesPerHour',
    action: { type: 'number', value: 100 },
    initial: ALL_ON,
    expected: { maxAnalyzesPerHour: 100 },
  },
];

function snapshotFor(triggers: SkillTriggersDto): SkillDiagnosticsResult {
  return {
    lastAnalyzeRunAt: null,
    lastCuratorPassAt: null,
    totalCandidates: 0,
    totalPromoted: 0,
    totalRejected: 0,
    totalInvocations: 0,
    activeSkills: 0,
    totalMerged: 0,
    totalRetired: 0,
    totalDormant: 0,
    eligibilityHistogram: {
      prefilterTooThin: 0,
      prefilterRejected: 0,
      accepted: 0,
    },
    recentEvents: [],
    triggers,
  };
}

interface RpcCall {
  readonly method: string;
  readonly params: unknown;
}

function setup(initial: SkillTriggersDto): {
  fixture: ComponentFixture<SkillTriggersSettingsComponent>;
  calls: RpcCall[];
  flush: () => Promise<void>;
} {
  const calls: RpcCall[] = [];
  const call = jest.fn(async (method: string, params: unknown) => {
    calls.push({ method, params });
    const data =
      method === 'skillSynthesis:setTriggers'
        ? {
            triggers: {
              ...initial,
              ...(params as { triggers: Partial<SkillTriggersDto> }).triggers,
            },
          }
        : snapshotFor(initial);
    return { isSuccess: () => true, data, error: undefined };
  });
  TestBed.configureTestingModule({
    imports: [SkillTriggersSettingsComponent],
    providers: [
      { provide: ClaudeRpcService, useValue: { call } },
      {
        provide: AppStateManager,
        useValue: {
          workspaceInfo: signal({ name: 'w', path: '/ws', type: 'workspace' }),
        },
      },
      { provide: TabManagerService, useValue: { activeTab: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(SkillTriggersSettingsComponent);
  fixture.detectChanges();
  const flush = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };
  return { fixture, calls, flush };
}

async function loadSnapshot(
  fixture: ComponentFixture<SkillTriggersSettingsComponent>,
  flush: () => Promise<void>,
): Promise<void> {
  // The tab shell refreshes the shared state on mount; do the same here so the
  // card shows the snapshot's triggers, then forget that call.
  await TestBed.inject(SkillDiagnosticsStateService).refresh();
  fixture.detectChanges();
  await flush();
}

function control(
  fixture: ComponentFixture<unknown>,
  key: string,
  type: ControlType,
): HTMLInputElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
    `[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="${key}"] input[type="${type}"]`,
  );
}

function act(
  fixture: ComponentFixture<unknown>,
  key: string,
  action: Action,
): void {
  const input = control(fixture, key, action.type);
  expect(input).toBeTruthy();
  if (!input) return;
  if (action.type === 'checkbox') input.checked = action.checked;
  else input.value = String(action.value);
  input.dispatchEvent(new Event('change'));
}

describe('Settings triggers card: setTriggers payload parity with the base accordion', () => {
  it('covers all seven controls', () => {
    const keys = new Set(CASES.map((c) => c.key));
    expect([...keys].sort()).toEqual(
      [
        'bootScan',
        'idleMs',
        'maxAnalyzesPerHour',
        'postToolUse',
        'postToolUseMinEditCount',
        'subagentStop',
        'turnComplete',
      ].sort(),
    );
  });

  it.each(CASES)('$name', async ({ key, action, initial, expected }) => {
    const { fixture, calls, flush } = setup(initial);
    await loadSnapshot(fixture, flush);
    calls.length = 0;

    act(fixture, key, action);
    await flush();

    const writes = calls.filter(
      (c) => c.method === 'skillSynthesis:setTriggers',
    );
    expect(writes).toEqual([
      { method: 'skillSynthesis:setTriggers', params: { triggers: expected } },
    ]);
    // Like the accordion, a successful write is followed by one snapshot refresh.
    expect(calls.map((c) => c.method)).toEqual([
      'skillSynthesis:setTriggers',
      'skillSynthesis:diagnostics',
    ]);
  });

  it('ticking the min-edit-count checkbox sends nothing (the accordion ignored it too)', async () => {
    const { fixture, calls, flush } = setup(ALL_ON);
    await loadSnapshot(fixture, flush);
    calls.length = 0;

    act(fixture, 'postToolUseMinEditCount', {
      type: 'checkbox',
      checked: false,
    });
    await flush();

    expect(calls).toEqual([]);
  });

  it('a rejected write shows the error and does not refresh', async () => {
    const { fixture, calls, flush } = setup(ALL_ON);
    await loadSnapshot(fixture, flush);
    // Replace the stub so the next setTriggers fails like an INVALID_PARAMS.
    const rpc = TestBed.inject(ClaudeRpcService) as unknown as {
      call: jest.Mock;
    };
    rpc.call.mockImplementationOnce(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return {
        isSuccess: () => false,
        data: undefined,
        error: 'idleMs must be 0 or >= 5000',
      };
    });
    calls.length = 0;

    act(fixture, 'idleMs', { type: 'number', value: 1000 });
    await flush();

    expect(calls).toEqual([
      {
        method: 'skillSynthesis:setTriggers',
        params: { triggers: { idleMs: 1000 } },
      },
    ]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-test="triggers-error"]',
      )?.textContent,
    ).toContain('idleMs must be 0 or >= 5000');
  });
});
