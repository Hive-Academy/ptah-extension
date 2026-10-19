import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';
import { SkillSynthesisStateService } from './skill-synthesis-state.service';

describe('SkillSynthesisStateService - file settings switches', () => {
  function setup(skills = true, telemetry = true) {
    const values = new Map<string, boolean>([
      ['skillSynthesis.enabled', skills],
      ['skills.telemetry.enabled', telemetry],
    ]);
    const call = jest.fn(async (method: string, params: { key: string; value?: boolean }) => {
      if (method === 'settings:set') values.set(params.key, params.value!);
      return {
        isSuccess: () => true,
        data: method === 'settings:get'
          ? { success: true, value: values.get(params.key) }
          : { success: true },
      };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SkillSynthesisRpcService, useValue: {} },
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    return { svc: TestBed.inject(SkillSynthesisStateService), call, values };
  }

  it('loads pause and telemetry independently', async () => {
    const { svc, call } = setup(false, true);
    expect(svc.skillsEnabled()).toBeNull();
    expect(svc.telemetryEnabled()).toBeNull();
    await svc.refreshSkillsEnabled();
    await svc.refreshTelemetryEnabled();
    expect(call).toHaveBeenCalledWith('settings:get', { key: 'skillSynthesis.enabled' });
    expect(call).toHaveBeenCalledWith('settings:get', { key: 'skills.telemetry.enabled' });
    expect(svc.skillsPaused()).toBe(true);
    expect(svc.telemetryEnabledCommitted()).toBe(true);
  });

  it.each([
    ['skillSynthesis.enabled', 'setSkillsEnabled', 'skillsEnabledCommitted'],
    ['skills.telemetry.enabled', 'setTelemetryEnabled', 'telemetryEnabledCommitted'],
  ] as const)('writes %s then commits its readBack', async (key, setter, committed) => {
    const { svc, call, values } = setup();
    await svc[setter](false);
    expect(call.mock.calls.map(([method, payload]) => [method, payload.key])).toEqual([
      ['settings:set', key], ['settings:get', key],
    ]);
    expect(svc[committed]()).toBe(false);
    expect(values.get(key)).toBe(false);
  });

  it('pausing Skills leaves telemetry enabled and untouched', async () => {
    const { svc, call, values } = setup();
    await svc.refreshTelemetryEnabled();
    call.mockClear();
    await svc.setSkillsEnabled(false);
    expect(svc.skillsPaused()).toBe(true);
    expect(svc.telemetryEnabledCommitted()).toBe(true);
    expect(values.get('skills.telemetry.enabled')).toBe(true);
    expect(call.mock.calls.every(([, payload]) => payload.key === 'skillSynthesis.enabled')).toBe(true);
  });

  it('uses the host readBack even when it differs from the requested value', async () => {
    const { svc, call } = setup(true, true);
    call.mockImplementationOnce(async () => ({
      isSuccess: () => true, data: { success: true },
    }));
    await svc.setSkillsEnabled(false);
    expect(svc.skillsEnabledCommitted()).toBe(true);
    expect(svc.skillsPaused()).toBe(false);
  });

  it('rolls back a failed telemetry write and re-reads the host', async () => {
    const { svc, call } = setup();
    await svc.refreshTelemetryEnabled();
    call.mockImplementationOnce(async () => ({
      isSuccess: () => true, data: { success: false },
    }));
    await svc.setTelemetryEnabled(false);
    expect(svc.telemetryEnabled()).toBe(true);
    expect(svc.telemetryError()).toBe('Could not change the telemetry switch. It shows the saved setting.');
    expect(call).toHaveBeenLastCalledWith('settings:get', { key: 'skills.telemetry.enabled' });
  });

  it('marks Skills paused after a PAUSED refusal', async () => {
    const { svc } = setup();
    await svc.refreshSkillsEnabled();
    svc.markSkillsPaused();
    expect(svc.skillsPaused()).toBe(true);
  });
});

describe('SkillSynthesisStateService - orchestration specs', () => {
  function setup() {
    const listSpecs = jest.fn().mockResolvedValue([
      { status: 'harvested' },
      { status: 'completed' },
    ]);
    const harvestSpecs = jest.fn().mockResolvedValue({});
    const clearStaleSpecs = jest.fn().mockResolvedValue({ cleared: 1 });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SkillSynthesisRpcService,
          useValue: { listSpecs, harvestSpecs, clearStaleSpecs },
        },
        { provide: ClaudeRpcService, useValue: {} },
      ],
    });
    return {
      svc: TestBed.inject(SkillSynthesisStateService),
      listSpecs,
      harvestSpecs,
      clearStaleSpecs,
    };
  }

  it('loads specs and counts harvested entries', async () => {
    const { svc, listSpecs } = setup();
    await svc.refreshSpecs();
    expect(listSpecs).toHaveBeenCalledTimes(1);
    expect(svc.specs()).toHaveLength(2);
    expect(svc.staleSpecCount()).toBe(1);
    expect(svc.specsLoading()).toBe(false);
  });

  it('harvests and refreshes the spec list', async () => {
    const { svc, listSpecs, harvestSpecs } = setup();
    await svc.harvestSpecs();
    expect(harvestSpecs).toHaveBeenCalledTimes(1);
    expect(listSpecs).toHaveBeenCalledTimes(1);
    expect(svc.specs()).toHaveLength(2);
  });

  it('archives stale specs and refreshes the spec list', async () => {
    const { svc, listSpecs, clearStaleSpecs } = setup();
    await expect(svc.clearStaleSpecs({ mode: 'archive' })).resolves.toBe(1);
    expect(clearStaleSpecs).toHaveBeenCalledWith({ mode: 'archive' });
    expect(listSpecs).toHaveBeenCalledTimes(1);
  });
});
