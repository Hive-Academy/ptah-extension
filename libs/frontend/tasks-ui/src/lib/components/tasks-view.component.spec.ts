import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type ExcludedTaskFolder,
  type TaskStatus,
  type TaskSpecSummary,
  type TasksBoardResult,
} from '@ptah-extension/shared';
import { TasksViewComponent } from './tasks-view.component';

/**
 * `tasks:board` payload. The named exclusion list rides alongside the count —
 * modelled here as an optional field so the store's defensive read is exercised
 * by the same helper that feeds the happy path.
 */
type BoardPayload = TasksBoardResult & {
  excluded?: readonly ExcludedTaskFolder[];
};

function board(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>> = {},
  meta: Partial<Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>> & {
    excluded?: readonly ExcludedTaskFolder[];
  } = {},
): BoardPayload {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? meta.excluded?.length ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
    ...(meta.excluded ? { excluded: meta.excluded } : {}),
  };
}

/**
 * The exact twelve folders invisible to the board in the workspace that
 * prompted this drawer, with a spread of typed reasons across the shared union.
 */
const TWELVE_EXCLUDED: readonly ExcludedTaskFolder[] = [
  { folderName: 'TASK_2026_155', reason: 'no_carrier' },
  { folderName: 'TASK_2026_160', reason: 'no_carrier' },
  { folderName: 'TASK_2026_161', reason: 'no_frontmatter' },
  { folderName: 'TASK_2026_164', reason: 'no_carrier' },
  { folderName: 'TASK_2026_165', reason: 'yaml_unparseable' },
  { folderName: 'TASK_2026_166', reason: 'no_carrier' },
  { folderName: 'TASK_2026_167', reason: 'invalid_status' },
  { folderName: 'TASK_2026_168', reason: 'no_carrier' },
  { folderName: 'TASK_2026_169', reason: 'missing_title' },
  { folderName: 'TASK_2026_170', reason: 'unreadable' },
  { folderName: 'TASK_VOICE_PROVIDERS', reason: 'no_carrier' },
  { folderName: 'TASK_WORKSPACE_SCOPING_REVIEW', reason: 'no_carrier' },
];

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });

describe('TasksViewComponent', () => {
  let rpcCall: jest.Mock;

  function setup(payload: BoardPayload = board({}, { specsDirExists: false })) {
    rpcCall = jest.fn().mockResolvedValue(ok(payload));
    TestBed.configureTestingModule({
      imports: [TasksViewComponent],
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
  }

  async function render(payload?: BoardPayload) {
    setup(payload);
    const fixture = TestBed.createComponent(TasksViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('loads the board on creation', async () => {
    await render();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('shows the empty-state create CTA when there are no tasks', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Create your first task');
  });

  it('renders the header actions', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('New Task');
    expect(text).toContain('Reindex');
    expect(text).toContain('Registry');
  });

  describe('exclusions drawer', () => {
    async function openDrawer(payload: BoardPayload) {
      const fixture = await render(payload);
      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLButtonElement>(
        '[data-testid="tasks-excluded-trigger"]',
      );
      expect(trigger).not.toBeNull();
      trigger?.click();
      fixture.detectChanges();
      return fixture;
    }

    it('lists all twelve excluded folders by name with a typed reason', async () => {
      const fixture = await openDrawer(
        board({}, { excluded: TWELVE_EXCLUDED }),
      );
      const host = fixture.nativeElement as HTMLElement;

      const rows = Array.from(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      );
      expect(rows).toHaveLength(12);

      const names = rows.map(
        (row) =>
          row
            .querySelector('[data-testid="tasks-excluded-name"]')
            ?.textContent?.trim() ?? '',
      );
      expect(names).toEqual(TWELVE_EXCLUDED.map((f) => f.folderName));

      // Every row must carry a non-empty explanation of WHY it was skipped —
      // a name with no reason is only marginally better than a bare count.
      rows.forEach((row, index) => {
        const reason =
          row
            .querySelector('[data-testid="tasks-excluded-reason"]')
            ?.textContent?.trim() ?? '';
        expect(reason.length).toBeGreaterThan(0);
        // The raw typed token is rendered alongside the sentence.
        expect(row.textContent).toContain(TWELVE_EXCLUDED[index].reason);
      });
    });

    it('keeps the drawer closed until the trigger is used', async () => {
      const fixture = await render(board({}, { excluded: TWELVE_EXCLUDED }));
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      ).toHaveLength(0);
    });

    it('says so out loud when the host reports a count but no names', async () => {
      const fixture = await openDrawer(board({}, { excludedCount: 12 }));
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      ).toHaveLength(0);
      expect(
        host.querySelector('[data-testid="tasks-excluded-unnamed"]')
          ?.textContent,
      ).toContain('did not name them');
    });

    it('drops malformed exclusion entries instead of rendering them', async () => {
      const malformed = [
        { folderName: 'TASK_2026_155', reason: 'no_carrier' },
        { folderName: '', reason: 'no_carrier' },
        { folderName: 'TASK_2026_160', reason: 'not_a_real_reason' },
        null,
        'TASK_2026_161',
      ] as unknown as readonly ExcludedTaskFolder[];

      const fixture = await openDrawer(
        board({}, { excludedCount: 5, excluded: malformed }),
      );
      const host = fixture.nativeElement as HTMLElement;

      const rows = host.querySelectorAll('[data-testid="tasks-excluded-row"]');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('TASK_2026_155');
    });

    it('shows no trigger at all when nothing was excluded', async () => {
      const fixture = await render(board());
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelector('[data-testid="tasks-excluded-trigger"]'),
      ).toBeNull();
    });
  });
});
