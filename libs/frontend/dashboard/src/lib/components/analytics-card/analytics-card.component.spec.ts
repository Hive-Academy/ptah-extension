import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService, ModelStateService } from '@ptah-extension/core';
import { AnalyticsCardComponent } from './analytics-card.component';
import { FakeRpc } from '../../services/dashboard-rpc.testing';

describe('AnalyticsCardComponent', () => {
  let fixture: ComponentFixture<AnalyticsCardComponent>;
  let rpc: FakeRpc;

  beforeEach(() => {
    rpc = new FakeRpc();
    TestBed.configureTestingModule({
      imports: [AnalyticsCardComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: { workspaceInfo: signal({ path: '/ws/a' }) } },
        { provide: ModelStateService, useValue: { availableModels: signal([]) } },
      ],
    });
    fixture = TestBed.createComponent(AnalyticsCardComponent);
    fixture.detectChanges();
  });

  it('shows one Usage view without loading session cards', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h3')?.textContent?.trim()).toBe('Usage');
    expect(element.querySelector('[data-testid="usage-dashboard"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="analytics-tabs"]')).toBeNull();
    expect(element.textContent).not.toContain('Session Analytics');
    expect(rpc.of('session:list')).toHaveLength(0);
    expect(rpc.of('session:stats-batch')).toHaveLength(0);
  });
});
