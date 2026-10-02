import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SkillTriggersDto } from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from '../../services/skill-diagnostics-rpc.service';
import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SkillTriggersSettingsComponent } from './skill-triggers-settings.component';

interface StubState {
  triggers: ReturnType<typeof signal<SkillTriggersDto>>;
  error: ReturnType<typeof signal<string | null>>;
  setTriggers: jest.Mock<Promise<void>, [Partial<SkillTriggersDto>]>;
  refresh: jest.Mock<Promise<void>, []>;
  startPolling: jest.Mock<void, []>;
  stopPolling: jest.Mock<void, []>;
}

const BASE_TRIGGERS: SkillTriggersDto = {
  sessionEnd: true,
  idleMs: 600_000,
  bootScan: true,
};

function makeStub(triggers: SkillTriggersDto = BASE_TRIGGERS): StubState {
  return {
    triggers: signal<SkillTriggersDto>(triggers),
    error: signal<string | null>(null),
    setTriggers: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
  };
}

function mountWithStub(
  stub: StubState,
): ComponentFixture<SkillTriggersSettingsComponent> {
  TestBed.configureTestingModule({
    imports: [SkillTriggersSettingsComponent],
    providers: [{ provide: SkillDiagnosticsStateService, useValue: stub }],
  });
  const fixture = TestBed.createComponent(SkillTriggersSettingsComponent);
  fixture.detectChanges();
  return fixture;
}

function control(
  fixture: ComponentFixture<unknown>,
  key: string,
  type: 'checkbox' | 'number',
): HTMLInputElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
    `[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="${key}"] input[type="${type}"]`,
  );
}

function toggle(
  fixture: ComponentFixture<unknown>,
  key: string,
  checked: boolean,
): void {
  const input = control(fixture, key, 'checkbox');
  expect(input).toBeTruthy();
  if (!input) return;
  input.checked = checked;
  input.dispatchEvent(new Event('change'));
}

function typeNumber(
  fixture: ComponentFixture<unknown>,
  key: string,
  value: string,
): void {
  const input = control(fixture, key, 'number');
  expect(input).toBeTruthy();
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('change'));
}

describe('SkillTriggersSettingsComponent', () => {
  it('renders the Triggers card with all eight controls and the immediate-save note', () => {
    const fixture = mountWithStub(makeStub());
    const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector('[data-test="panel-triggers"]');
    expect(panel?.querySelector('h2')?.textContent?.trim()).toBe('Triggers');
    expect(panel?.textContent).toContain('Changes here save immediately.');
    const keys = Array.from(
      panel?.querySelectorAll('ptah-skill-trigger-toggle') ?? [],
    ).map((el) => el.getAttribute('key'));
    expect(keys).toEqual([
      'sessionEnd',
      'idleMs',
      'bootScan',
      'subagentStop',
      'turnComplete',
      'postToolUse',
      'postToolUseMinEditCount',
      'maxAnalyzesPerHour',
    ]);
  });

  it('does not start polling or refresh on its own', () => {
    const stub = makeStub();
    const fixture = mountWithStub(stub);
    fixture.destroy();
    expect(stub.startPolling).not.toHaveBeenCalled();
    expect(stub.stopPolling).not.toHaveBeenCalled();
    expect(stub.refresh).not.toHaveBeenCalled();
  });

  it('sessionEnd writes the flat flag', () => {
    const stub = makeStub();
    const fixture = mountWithStub(stub);
    toggle(fixture, 'sessionEnd', false);
    expect(stub.setTriggers).toHaveBeenCalledWith({ sessionEnd: false });
  });

  it('idleMs: switching on applies 600000, off writes 0, a typed value is sent as-is', () => {
    const stub = makeStub({ ...BASE_TRIGGERS, idleMs: 0 });
    const fixture = mountWithStub(stub);
    expect(control(fixture, 'idleMs', 'checkbox')?.checked).toBe(false);

    toggle(fixture, 'idleMs', true);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({ idleMs: 600_000 });
    toggle(fixture, 'idleMs', false);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({ idleMs: 0 });
    typeNumber(fixture, 'idleMs', '120000');
    expect(stub.setTriggers).toHaveBeenLastCalledWith({ idleMs: 120_000 });
  });

  it('bootScan writes the flat flag', () => {
    const stub = makeStub();
    const fixture = mountWithStub(stub);
    toggle(fixture, 'bootScan', false);
    expect(stub.setTriggers).toHaveBeenCalledWith({ bootScan: false });
  });

  it('subagentStop persists the nested DTO', () => {
    const stub = makeStub({
      ...BASE_TRIGGERS,
      subagentStop: { enabled: false },
    });
    const fixture = mountWithStub(stub);
    toggle(fixture, 'subagentStop', true);
    expect(stub.setTriggers).toHaveBeenCalledWith({
      subagentStop: { enabled: true },
    });
  });

  it('turnComplete persists the nested DTO', () => {
    const stub = makeStub({
      ...BASE_TRIGGERS,
      turnComplete: { enabled: false },
    });
    const fixture = mountWithStub(stub);
    toggle(fixture, 'turnComplete', true);
    expect(stub.setTriggers).toHaveBeenCalledWith({
      turnComplete: { enabled: true },
    });
  });

  it('postToolUse keeps the current minEditCount, defaulting to 1', () => {
    const stub = makeStub({
      ...BASE_TRIGGERS,
      postToolUse: { enabled: false, minEditCount: 4 },
    });
    const fixture = mountWithStub(stub);
    toggle(fixture, 'postToolUse', true);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({
      postToolUse: { enabled: true, minEditCount: 4 },
    });

    stub.triggers.set(BASE_TRIGGERS);
    fixture.detectChanges();
    toggle(fixture, 'postToolUse', true);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({
      postToolUse: { enabled: true, minEditCount: 1 },
    });
  });

  it('postToolUseMinEditCount persists the nested DTO with bounds 1-20', () => {
    const stub = makeStub({
      ...BASE_TRIGGERS,
      postToolUse: { enabled: true, minEditCount: 1 },
    });
    const fixture = mountWithStub(stub);
    const input = control(fixture, 'postToolUseMinEditCount', 'number');
    expect(input?.getAttribute('min')).toBe('1');
    expect(input?.getAttribute('max')).toBe('20');

    typeNumber(fixture, 'postToolUseMinEditCount', '5');
    expect(stub.setTriggers).toHaveBeenCalledWith({
      postToolUse: { enabled: true, minEditCount: 5 },
    });
  });

  it('maxAnalyzesPerHour: bounds 0-1000, on applies 60, off writes 0, typed value sent', () => {
    const stub = makeStub({ ...BASE_TRIGGERS, maxAnalyzesPerHour: 60 });
    const fixture = mountWithStub(stub);
    const input = control(fixture, 'maxAnalyzesPerHour', 'number');
    expect(input?.getAttribute('min')).toBe('0');
    expect(input?.getAttribute('max')).toBe('1000');

    typeNumber(fixture, 'maxAnalyzesPerHour', '120');
    expect(stub.setTriggers).toHaveBeenLastCalledWith({
      maxAnalyzesPerHour: 120,
    });
    toggle(fixture, 'maxAnalyzesPerHour', false);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({
      maxAnalyzesPerHour: 0,
    });
    toggle(fixture, 'maxAnalyzesPerHour', true);
    expect(stub.setTriggers).toHaveBeenLastCalledWith({
      maxAnalyzesPerHour: 60,
    });
  });

  it('shows the state error as an alert', () => {
    const stub = makeStub();
    stub.error.set('write failed');
    const fixture = mountWithStub(stub);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent,
    ).toContain('write failed');
  });
});

describe('SkillTriggersSettingsComponent with the real state service', () => {
  let diagnostics: jest.Mock;
  let setTriggers: jest.Mock;

  function mountReal(): ComponentFixture<SkillTriggersSettingsComponent> {
    TestBed.configureTestingModule({
      imports: [SkillTriggersSettingsComponent],
      providers: [
        SkillDiagnosticsStateService,
        {
          provide: SkillDiagnosticsRpcService,
          useValue: {
            diagnostics,
            setTriggers,
            analyzeNow: jest.fn(),
            getTriggers: jest.fn(),
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeTab: signal(null) },
        },
      ],
    });
    const fixture = TestBed.createComponent(SkillTriggersSettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    // The snapshot never resolves: Settings is open before diagnostics answer.
    diagnostics = jest.fn(() => new Promise(() => undefined));
    setTriggers = jest.fn();
  });

  it('renders the default triggers before the diagnostics snapshot resolves', () => {
    const fixture = mountReal();
    expect(diagnostics).not.toHaveBeenCalled();
    expect(control(fixture, 'sessionEnd', 'checkbox')?.checked).toBe(true);
    expect(control(fixture, 'idleMs', 'checkbox')?.checked).toBe(true);
    expect(control(fixture, 'idleMs', 'number')?.value).toBe('600000');
    expect(control(fixture, 'bootScan', 'checkbox')?.checked).toBe(true);
    expect(control(fixture, 'turnComplete', 'checkbox')?.checked).toBe(true);
    expect(control(fixture, 'subagentStop', 'checkbox')?.checked).toBe(false);
    expect(control(fixture, 'postToolUse', 'checkbox')?.checked).toBe(false);
    expect(control(fixture, 'maxAnalyzesPerHour', 'checkbox')?.checked).toBe(
      false,
    );
  });

  it('shows the setTriggers failure text', async () => {
    setTriggers.mockRejectedValueOnce(new Error('config write denied'));
    const fixture = mountReal();

    toggle(fixture, 'bootScan', false);
    // Let the rejected RPC settle through setTriggers' catch.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(setTriggers).toHaveBeenCalledWith({ bootScan: false });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent,
    ).toContain('config write denied');
  });
});
