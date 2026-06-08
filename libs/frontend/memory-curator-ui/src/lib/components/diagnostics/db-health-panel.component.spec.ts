import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { MemoryDbHealthDto } from '@ptah-extension/shared';

import { DbHealthPanelComponent } from './db-health-panel.component';
import { VecEmbedderRecoveryService } from '../../services/vec-embedder-recovery.service';

interface RecoveryStub {
  vecDiagnostic: ReturnType<typeof signal<unknown>>;
  embedderStatus: ReturnType<typeof signal<unknown>>;
  vecBusy: ReturnType<typeof signal<boolean>>;
  embedderBusy: ReturnType<typeof signal<boolean>>;
  vecAvailable: ReturnType<typeof signal<boolean>>;
  embedderReady: ReturnType<typeof signal<boolean>>;
  embedderDownloading: ReturnType<typeof signal<boolean>>;
  lastToast: ReturnType<typeof signal<unknown>>;
  prime: jest.Mock;
  retryVec: jest.Mock;
  retryEmbedder: jest.Mock;
  openBindingFolder: jest.Mock;
  copyDiagnostic: jest.Mock;
  dismissToast: jest.Mock;
}

function makeRecoveryStub(): RecoveryStub {
  return {
    vecDiagnostic: signal<unknown>(null),
    embedderStatus: signal<unknown>(null),
    vecBusy: signal<boolean>(false),
    embedderBusy: signal<boolean>(false),
    vecAvailable: signal<boolean>(false),
    embedderReady: signal<boolean>(false),
    embedderDownloading: signal<boolean>(false),
    lastToast: signal<unknown>(null),
    prime: jest.fn().mockResolvedValue(undefined),
    retryVec: jest.fn().mockResolvedValue(null),
    retryEmbedder: jest.fn().mockResolvedValue(null),
    openBindingFolder: jest.fn().mockResolvedValue(null),
    copyDiagnostic: jest.fn().mockResolvedValue(true),
    dismissToast: jest.fn(),
  };
}

describe('DbHealthPanelComponent', () => {
  let recovery: RecoveryStub;

  beforeEach(async () => {
    recovery = makeRecoveryStub();
    await TestBed.configureTestingModule({
      imports: [DbHealthPanelComponent],
      providers: [{ provide: VecEmbedderRecoveryService, useValue: recovery }],
    }).compileComponents();
  });

  const baseHealth: MemoryDbHealthDto = {
    memories: 100,
    memory_chunks: 614,
    memory_chunks_vec: 614,
    memory_chunks_fts: 614,
    code_symbols: 50,
    code_symbols_vec: 50,
    coherent: true,
    mismatches: [],
  };

  it('renders placeholder when no health data is supplied', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'No DB health data yet.',
    );
  });

  it('renders DB Health table with all coherent rows', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.componentRef.setInput('health', baseHealth);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('DB Health');
    expect(root.textContent ?? '').toContain('614 / 614');
    expect(
      root.querySelectorAll('[data-testid="health-mismatch"]'),
    ).toHaveLength(0);
    expect(root.textContent ?? '').toContain('true');
  });

  it('renders ✗ MISMATCH glyph when counts disagree', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.componentRef.setInput('health', {
      ...baseHealth,
      memory_chunks: 614,
      memory_chunks_vec: 613,
      coherent: false,
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const mismatch = root.querySelectorAll('[data-testid="health-mismatch"]');
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch[0].textContent ?? '').toContain('✗ MISMATCH');
    expect(root.textContent ?? '').toContain('false');
  });

  it('renders vec panel offline badge by default and surfaces a retry button', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector('[data-testid="vec-badge"]');
    expect(badge?.textContent?.trim()).toBe('offline');
    expect(root.querySelector('[data-testid="vec-retry-btn"]')).not.toBeNull();
  });

  it('calls retryVec when the vec retry button is clicked', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="vec-retry-btn"]',
    ) as HTMLButtonElement;
    button.click();
    expect(recovery.retryVec).toHaveBeenCalledTimes(1);
  });

  it('renders embedder downloading progress when downloading is true', () => {
    recovery.embedderDownloading.set(true);
    recovery.embedderStatus.set({
      ready: false,
      downloading: true,
      progress: 0.42,
    });
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="embedder-progress"]'),
    ).not.toBeNull();
    expect(root.textContent ?? '').toContain('42%');
  });

  it('renders toast when lastToast is set and dismisses it on click', () => {
    recovery.lastToast.set({ id: 1, kind: 'warn', message: 'vec offline.' });
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const toast = root.querySelector('[data-testid="recovery-toast"]');
    expect(toast?.textContent ?? '').toContain('vec offline.');
    (toast?.querySelector('button') as HTMLButtonElement).click();
    expect(recovery.dismissToast).toHaveBeenCalledTimes(1);
  });

  it('disables the open-folder button when no attempted path is known', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="vec-open-folder-btn"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables the open-folder button when a vec diagnostic with attemptedPath is present', () => {
    recovery.vecDiagnostic.set({
      ok: false,
      reason: 'load-failed',
      electronVersion: '40.0.0',
      processArch: 'x64',
      processPlatform: 'win32',
      attemptedPath: 'C:/path/to/vec0.dll',
    });
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="vec-open-folder-btn"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
