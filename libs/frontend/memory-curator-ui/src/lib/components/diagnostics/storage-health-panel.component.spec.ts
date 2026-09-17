import { TestBed } from '@angular/core/testing';
import type { MemoryStorageHealthDto } from '@ptah-extension/shared';

import {
  StorageHealthPanelComponent,
  formatBytes,
} from './storage-health-panel.component';

const NOW = 1_758_000_000_000;

function makeStorage(
  overrides: Partial<MemoryStorageHealthDto> = {},
): MemoryStorageHealthDto {
  return {
    dbBytes: 2_097_152,
    reclaimableBytes: 4_096,
    autoVacuumIncremental: true,
    observations: {
      pendingRows: 12,
      pendingBytes: 2_048,
      oldestPendingAt: NOW - 90_000,
      stuckEligibleRows: 3,
      processedRows: 4_500,
      processedBytesEstimate: 1_500_000,
      measuredAt: NOW - 3_600_000,
      quarantineLedgerRows: 7,
    },
    retention: {
      enabled: true,
      processedDays: 14,
      stuckDays: 30,
      lastRun: {
        startedAt: NOW - 7_200_000,
        finishedAt: NOW - 7_100_000,
        durationMs: 100_000,
        processedPurged: 120,
        stuckQuarantined: 4,
        ledgerPruned: 2,
        freedBytes: 512_000,
        pagesReclaimed: 64,
        memoriesArchived: 8,
        memoriesDeleted: 3,
        memoriesEvicted: 2,
        outcome: 'completed',
        reason: null,
        error: null,
        backlogRemaining: false,
      },
      lastCompletedAt: NOW - 7_100_000,
      nextDueAt: NOW + 1_800_000,
      lastSkippedAt: null,
      lastSkipReason: null,
    },
    memoryLifecycle: {
      enabled: true,
      archiveAfterDays: 30,
      deleteAfterDays: 60,
      maxPerWorkspace: 25_000,
      lastNote: null,
      preview: null,
    },
    ...overrides,
  };
}

function render(storage: MemoryStorageHealthDto | null): HTMLElement {
  const fixture = TestBed.createComponent(StorageHealthPanelComponent);
  fixture.componentRef.setInput('storage', storage);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function normalizedText(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('StorageHealthPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StorageHealthPanelComponent],
    }).compileComponents();
  });

  it('renders the null state when no storage data is supplied', () => {
    const root = render(null);
    expect(root.querySelector('[data-testid="storage-empty"]')).not.toBeNull();
    expect(root.textContent ?? '').toContain('No storage data yet.');
  });

  it('marks the section with aria-label "Storage and retention"', () => {
    const root = render(makeStorage());
    expect(
      root.querySelector('section[aria-label="Storage and retention"]'),
    ).not.toBeNull();
  });

  it('renders "—" for null fields', () => {
    const root = render(
      makeStorage({
        dbBytes: null,
        reclaimableBytes: null,
        observations: {
          pendingRows: null,
          pendingBytes: null,
          oldestPendingAt: null,
          stuckEligibleRows: null,
          processedRows: null,
          processedBytesEstimate: null,
          measuredAt: null,
          quarantineLedgerRows: null,
        },
      }),
    );
    expect(root.textContent ?? '').toContain('—');
    expect(
      root.querySelector('[data-testid="storage-db-size"]')?.textContent ?? '',
    ).toContain('—');
    expect(
      root.querySelector('[data-testid="storage-pending-bytes"]')
        ?.textContent ?? '',
    ).toContain('—');
  });

  it('renders a partial run with its badge text and reason', () => {
    const storage = makeStorage();
    const run = storage.retention.lastRun;
    if (!run) throw new Error('fixture must carry a lastRun');
    const root = render(
      makeStorage({
        retention: {
          ...storage.retention,
          lastRun: {
            ...run,
            outcome: 'partial',
            reason: 'row purge failed mid-batch',
          },
        },
      }),
    );

    const badge = root.querySelector('[data-testid="storage-run-badge"]');
    expect(badge?.textContent?.trim()).toBe('partial');
    expect(badge?.className).toContain('badge-warning');
    const detail = root.querySelector('[data-testid="storage-run-detail"]');
    expect(detail?.textContent ?? '').toContain('Reason');
    expect(detail?.textContent ?? '').toContain('row purge failed mid-batch');
  });

  it('renders a failed run with its badge text and error', () => {
    const storage = makeStorage();
    const run = storage.retention.lastRun;
    if (!run) throw new Error('fixture must carry a lastRun');
    const root = render(
      makeStorage({
        retention: {
          ...storage.retention,
          lastRun: {
            ...run,
            outcome: 'failed',
            reason: null,
            error: 'SQLITE_BUSY: database is locked',
          },
        },
      }),
    );

    const badge = root.querySelector('[data-testid="storage-run-badge"]');
    expect(badge?.textContent?.trim()).toBe('failed');
    expect(badge?.className).toContain('badge-error');
    const detail = root.querySelector('[data-testid="storage-run-detail"]');
    expect(detail?.textContent ?? '').toContain('Error');
    expect(detail?.textContent ?? '').toContain(
      'SQLITE_BUSY: database is locked',
    );
  });

  it('renders the completed-run badge, run counts and relative times', () => {
    const root = render(makeStorage());

    const badge = root.querySelector('[data-testid="storage-run-badge"]');
    expect(badge?.textContent?.trim()).toBe('completed');
    expect(badge?.className).toContain('badge-success');
    expect(root.textContent ?? '').toContain('2 h ago');
    expect(root.textContent ?? '').toContain('in 30 min');
    expect(root.textContent ?? '').toContain('120');
    expect(root.textContent ?? '').toContain('64');
    expect(root.textContent ?? '').toContain('as of last retention run');
    expect(root.textContent ?? '').toContain('estimate');
    expect(
      normalizedText(root.querySelector('ptah-native-card:nth-of-type(5)')),
    ).toContain('Memories archived 8 · deleted 3 · evicted 2');
  });

  it('renders lifecycle settings with the populated next-run preview', () => {
    const root = render(
      makeStorage({
        memoryLifecycle: {
          enabled: true,
          archiveAfterDays: 30,
          deleteAfterDays: 60,
          maxPerWorkspace: 25_000,
          lastNote: null,
          preview: {
            measuredAt: NOW,
            forRunAt: NOW + 3_600_000,
            archiveEligible: 1_234,
            deleteEligible: 56,
            overCap: 7,
          },
        },
      }),
    );

    expect(
      normalizedText(
        root.querySelector('[data-testid="storage-memory-lifecycle"]'),
      ),
    ).toBe(
      'archive after 30 d · delete after 60 d · cap 25,000 next run: 1,234 to archive · 56 to delete · up to 7 over cap',
    );
  });

  it('renders the first-run lifecycle preview note when preview is null', () => {
    const root = render(makeStorage());

    expect(
      normalizedText(
        root.querySelector('[data-testid="storage-memory-lifecycle"]'),
      ),
    ).toBe(
      'archive after 30 d · delete after 60 d · cap 25,000 preview after the first run',
    );
  });

  it('renders the disabled lifecycle note in text', () => {
    const storage = makeStorage();
    const root = render(
      makeStorage({
        memoryLifecycle: {
          ...storage.memoryLifecycle,
          enabled: false,
          lastNote: 'disabled',
        },
      }),
    );

    expect(
      normalizedText(
        root.querySelector('[data-testid="storage-memory-lifecycle"]'),
      ),
    ).toBe(
      'archive after 30 d · delete after 60 d · cap 25,000 off (preview only)',
    );
  });

  it('renders the vec-unavailable lifecycle note in text', () => {
    const storage = makeStorage();
    const root = render(
      makeStorage({
        memoryLifecycle: {
          ...storage.memoryLifecycle,
          lastNote: 'vec-unavailable',
          preview: {
            measuredAt: NOW,
            forRunAt: NOW + 3_600_000,
            archiveEligible: 1_234,
            deleteEligible: 56,
            overCap: 7,
          },
        },
      }),
    );

    expect(
      normalizedText(
        root.querySelector('[data-testid="storage-memory-lifecycle"]'),
      ),
    ).toBe(
      'archive after 30 d · delete after 60 d · cap 25,000 deletes paused: vector extension unavailable',
    );
  });

  it('omits the Memories row when no retention run is recorded', () => {
    const storage = makeStorage();
    const root = render(
      makeStorage({
        retention: {
          ...storage.retention,
          lastRun: null,
        },
      }),
    );

    const labels = Array.from(root.querySelectorAll('dt')).map((element) =>
      normalizedText(element),
    );
    expect(labels).not.toContain('Memories');
  });

  it('renders last skip time and reason when a skip is recorded', () => {
    const root = render(
      makeStorage({
        retention: {
          enabled: true,
          processedDays: 14,
          stuckDays: 30,
          lastRun: null,
          lastCompletedAt: null,
          nextDueAt: null,
          lastSkippedAt: NOW - 600_000,
          lastSkipReason: 'another retention run is in progress',
        },
      }),
    );

    expect(root.textContent ?? '').toContain('10 min ago');
    expect(root.textContent ?? '').toContain(
      'another retention run is in progress',
    );
    // nextDueAt null → the never-ran wording, not a timestamp.
    expect(
      root.querySelector('[data-testid="storage-next-due"]')?.textContent ?? '',
    ).toContain('at the next idle hourly check');
  });

  it('renders a past nextDueAt (backlog remaining) as the hourly-check wording, not a past time', () => {
    const root = render(
      makeStorage({
        retention: {
          enabled: true,
          processedDays: 14,
          stuckDays: 30,
          lastRun: {
            startedAt: NOW - 720_000,
            finishedAt: NOW - 600_000,
            durationMs: 120_000,
            processedPurged: 50_000,
            stuckQuarantined: 0,
            ledgerPruned: 0,
            freedBytes: 134_217_728,
            pagesReclaimed: 32_768,
            memoriesArchived: 200,
            memoriesDeleted: 100,
            memoriesEvicted: 50,
            outcome: 'partial',
            reason: 'row budget reached',
            error: null,
            backlogRemaining: true,
          },
          lastCompletedAt: NOW - 600_000,
          // Backlog → the backend sets nextDueAt to the run's finish time,
          // which is already in the past.
          nextDueAt: NOW - 720_000,
          lastSkippedAt: null,
          lastSkipReason: null,
        },
      }),
    );

    const nextDue = root.querySelector('[data-testid="storage-next-due"]');
    expect(nextDue?.textContent ?? '').toContain(
      'at the next idle hourly check',
    );
    expect(nextDue?.textContent ?? '').not.toContain('ago');

    // A future nextDueAt still renders the "in …" form.
    const futureRoot = render(
      makeStorage({
        retention: {
          enabled: true,
          processedDays: 14,
          stuckDays: 30,
          lastRun: null,
          lastCompletedAt: NOW - 3_600_000,
          nextDueAt: NOW + 1_800_000,
          lastSkippedAt: null,
          lastSkipReason: null,
        },
      }),
    );
    expect(
      futureRoot.querySelector('[data-testid="storage-next-due"]')
        ?.textContent ?? '',
    ).toContain('in 30 min');
  });

  it('formats bytes across scales via the pure formatter', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1374389535)).toBe('1.28 GB');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('renders formatted byte values for db size and pending size', () => {
    const root = render(makeStorage({ dbBytes: 1374389535 }));
    expect(
      root.querySelector('[data-testid="storage-db-size"]')?.textContent ?? '',
    ).toContain('1.28 GB');
    expect(
      root.querySelector('[data-testid="storage-pending-bytes"]')
        ?.textContent ?? '',
    ).toContain('2 KB');
  });

  it('renders "—" for pending size and lists readErrors when the backlog is too large to measure', () => {
    const root = render(
      makeStorage({
        observations: {
          pendingRows: 6_204,
          pendingBytes: null,
          oldestPendingAt: NOW - 259_200_000,
          stuckEligibleRows: 61,
          processedRows: 4_500,
          processedBytesEstimate: 1_500_000,
          measuredAt: NOW - 3_600_000,
          quarantineLedgerRows: 7,
        },
        readErrors: ['pendingBytes: not measured above 5000 pending rows'],
      }),
    );

    expect(
      root.querySelector('[data-testid="storage-pending-bytes"]')
        ?.textContent ?? '',
    ).toContain('—');
    const errors = root.querySelector('[data-testid="storage-read-errors"]');
    expect(errors).not.toBeNull();
    expect(errors?.textContent ?? '').toContain(
      'pendingBytes: not measured above 5000 pending rows',
    );
    // The muted list also carries the other pending fields that DID read.
    expect(root.textContent ?? '').toContain('6,204');
    expect(root.textContent ?? '').toContain('3 days ago');
  });
});
