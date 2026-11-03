import { TestBed } from '@angular/core/testing';
import { RevisionHistoryComponent } from './revision-history.component';

describe('RevisionHistoryComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers Restore only for an older revision', () => {
    TestBed.configureTestingModule({ imports: [RevisionHistoryComponent] });
    const fixture = TestBed.createComponent(RevisionHistoryComponent);
    fixture.componentRef.setInput('revisions', [
      {
        id: 'first',
        sessionId: 'session',
        ordinal: 1,
        updatedAt: '2026-10-29T09:00:00.000Z',
        isConfigComplete: false,
        config: {},
      },
      {
        id: 'second',
        sessionId: 'session',
        ordinal: 2,
        updatedAt: '2026-10-29T09:04:00.000Z',
        isConfigComplete: true,
        config: {},
      },
    ]);
    fixture.componentRef.setInput('currentRevisionId', 'second');
    const restore = jest.fn();
    fixture.componentInstance.restore.subscribe(restore);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      'li',
    ) as NodeListOf<HTMLLIElement>;
    expect(rows[0].querySelector('button')?.textContent?.trim()).toBe(
      'Restore',
    );
    expect(rows[1].querySelector('button')).toBeNull();
    rows[0].querySelector('button')?.click();
    expect(restore).toHaveBeenCalledWith('first');
  });
});
