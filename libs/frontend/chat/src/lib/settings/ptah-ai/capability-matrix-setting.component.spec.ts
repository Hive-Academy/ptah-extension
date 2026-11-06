import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import type { AgentGetCapabilityMatrixResult } from '@ptah-extension/shared';
import { CapabilityMatrixSettingComponent } from './capability-matrix-setting.component';

const UNKNOWN = { kind: 'unknown' as const };

function view(): AgentGetCapabilityMatrixResult {
  return {
    profiles: [
      {
        family: 'z-ai',
        model: 'glm-5',
        cells: {
          plan: UNKNOWN,
          implement: {
            kind: 'value',
            score: 55,
            source: 'local',
            sourceRef: null,
            asOf: '2026-11-01',
            stale: false,
            sampleCount: 2,
          },
          review: UNKNOWN,
          research: UNKNOWN,
          tests: UNKNOWN,
          docs: UNKNOWN,
        },
      },
    ],
  };
}

describe('CapabilityMatrixSettingComponent', () => {
  let fixture: ComponentFixture<CapabilityMatrixSettingComponent>;
  let call: jest.Mock;

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';
  const row = (kind: string): string =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(`[data-testid="matrix-row-z-ai-glm-5-${kind}"]`)
      ?.textContent ?? '';

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    call = jest.fn();
    TestBed.configureTestingModule({
      imports: [CapabilityMatrixSettingComponent],
      providers: [{ provide: ClaudeRpcService, useValue: { call } }],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('renders an unknown cell as unrated and a local sample count as a number', async () => {
    call.mockResolvedValue(rpcSuccess(view()));
    fixture = TestBed.createComponent(CapabilityMatrixSettingComponent);
    fixture.detectChanges();
    await settle();

    expect(call).toHaveBeenCalledWith(
      'agent:getCapabilityMatrix',
      {},
      { timeout: 5_000 },
    );
    expect(row('plan')).toContain('unrated');
    expect(row('plan')).not.toContain('50');
    expect(row('implement')).toContain('55');
    expect(row('implement')).toContain('local');
    expect(row('implement')).toContain('2');
    expect(row('implement')).not.toContain('unrated');
    expect(text()).not.toContain('50');
  });

  it('shows retry when the read fails', async () => {
    call.mockResolvedValue(rpcError('unavailable'));
    fixture = TestBed.createComponent(CapabilityMatrixSettingComponent);
    fixture.detectChanges();
    await settle();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="capability-matrix-error"]',
      ),
    ).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="capability-matrix-table"]',
      ),
    ).toBeNull();
  });
});
