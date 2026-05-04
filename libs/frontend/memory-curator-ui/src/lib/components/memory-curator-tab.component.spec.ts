import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { VSCodeService } from '@ptah-extension/core';

import { MemoryStateService } from '../services/memory-state.service';

import { MemoryCuratorTabComponent } from './memory-curator-tab.component';

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
  } as unknown as Partial<VSCodeService>;
}

/**
 * Smoke tests for {@link MemoryCuratorTabComponent}. Stubs the entire
 * {@link MemoryStateService} surface so no real RPC traffic is generated.
 */
describe('MemoryCuratorTabComponent', () => {
  let stateMock: jest.Mocked<MemoryStateService>;

  beforeEach(async () => {
    const baseState = {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;

    stateMock = baseState;

    await TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMock },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
      ],
    }).compileComponents();
  });

  it('renders the tab and triggers refresh + loadStats on init', () => {
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    expect(stateMock.refresh).toHaveBeenCalled();
    expect(stateMock.loadStats).toHaveBeenCalled();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.placeholder ?? '').toContain('Search memory');
    expect(root.textContent ?? '').toContain('Rebuild index');
  });

  it('schedules a debounced search when the input changes', () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        'input[type="search"]',
      ) as HTMLInputElement;
      expect(input).not.toBeNull();

      input.value = 'auth flow';
      input.dispatchEvent(new Event('input'));
      expect(stateMock.search).not.toHaveBeenCalled();

      jest.advanceTimersByTime(400);
      expect(stateMock.search).toHaveBeenCalledWith('auth flow');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows desktop-only placeholder when not on Electron and skips RPC init', async () => {
    TestBed.resetTestingModule();
    const stateMockNonElectron = {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;

    await TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMockNonElectron },
        { provide: VSCodeService, useValue: vscodeServiceStub(false) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ptah desktop app');

    // Verify no RPC traffic was issued in the non-Electron branch.
    expect(stateMockNonElectron.refresh).not.toHaveBeenCalled();
    expect(stateMockNonElectron.loadStats).not.toHaveBeenCalled();

    // Search box must not render in placeholder mode.
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="search"]',
    );
    expect(input).toBeNull();
  });
});
