import { TestBed } from '@angular/core/testing';

import { MemoryStateService } from '../services/memory-state.service';

import { MemoryCuratorTabComponent } from './memory-curator-tab.component';

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
      providers: [{ provide: MemoryStateService, useValue: stateMock }],
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
});
