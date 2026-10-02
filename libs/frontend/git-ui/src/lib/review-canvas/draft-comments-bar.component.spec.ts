import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AGENT_FEEDBACK_SENDER,
  type AgentFeedbackSendResult,
} from '@ptah-extension/core';
import {
  ReviewCommentDraftStore,
  type ReviewCommentDraftInput,
  type ReviewDraftOwner,
} from '../services/review-comment-draft.store';
import { DraftCommentsBarComponent } from './draft-comments-bar.component';

const SESSION: ReviewDraftOwner = {
  workspaceRoot: '/repo',
  ownerSessionId: 'sess-1',
};
const OTHER: ReviewDraftOwner = { workspaceRoot: '/other' };

function draft(
  overrides: Partial<ReviewCommentDraftInput> = {},
): ReviewCommentDraftInput {
  return {
    path: 'src/app.ts',
    startLine: 41,
    endLine: 41,
    lines: ['const a = 1;'],
    body: 'consider extracting this',
    ...overrides,
  };
}

@Component({
  standalone: true,
  imports: [DraftCommentsBarComponent],
  template: `<ptah-draft-comments-bar [owner]="owner()" />`,
})
class HostComponent {
  readonly owner = signal<ReviewDraftOwner>(SESSION);
}

describe('DraftCommentsBarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let store: ReviewCommentDraftStore;
  let send: jest.Mock<Promise<AgentFeedbackSendResult>>;

  function q(testId: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testId}"]`,
    );
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    send = jest.fn();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: AGENT_FEEDBACK_SENDER, useValue: { send } }],
    });
    store = TestBed.inject(ReviewCommentDraftStore);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('is absent at zero drafts', () => {
    expect(q('draft-comments-bar')).toBeNull();
  });

  it('shows the count and Send to agent once a draft exists', () => {
    store.add(SESSION, draft());
    fixture.detectChanges();
    expect(q('draft-comments-toggle')?.textContent).toContain(
      '1 draft comment',
    );

    store.add(SESSION, draft({ path: 'b.ts' }));
    fixture.detectChanges();
    expect(q('draft-comments-toggle')?.textContent).toContain(
      '2 draft comments',
    );
    expect(q('draft-comments-send')?.textContent?.trim()).toBe('Send to agent');
    expect(q('draft-comments-send')?.className).toContain('btn-primary');
  });

  it("shows only the owner's drafts", () => {
    store.add(OTHER, draft());
    fixture.detectChanges();
    expect(q('draft-comments-bar')).toBeNull();

    fixture.componentInstance.owner.set(OTHER);
    fixture.detectChanges();
    expect(q('draft-comments-bar')).not.toBeNull();
  });

  it('lists the drafts in a popover and removes one', async () => {
    store.add(SESSION, draft());
    store.add(SESSION, draft({ path: 'b.ts', startLine: 2, endLine: 2 }));
    fixture.detectChanges();

    const toggle = q('draft-comments-toggle') as HTMLButtonElement;
    toggle.click();
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = q('draft-comments-list');
    expect(list?.textContent).toContain('src/app.ts L41-L41');
    expect(list?.textContent).toContain('consider extracting this');

    const remove = list?.querySelectorAll<HTMLButtonElement>(
      '[data-testid="draft-comment-remove"]',
    );
    expect(remove?.[1].getAttribute('aria-label')).toBe(
      'Remove draft comment on b.ts L2-L2',
    );
    remove?.[1].click();
    fixture.detectChanges();
    expect(store.draftsFor(SESSION).map((d) => d.path)).toEqual([
      'src/app.ts',
    ]);
  });

  it('sends to the owning session and clears on sent:true', async () => {
    send.mockResolvedValue({ sent: true });
    store.add(SESSION, draft());
    store.add(SESSION, draft({ path: 'b.ts' }));
    fixture.detectChanges();

    (q('draft-comments-send') as HTMLButtonElement).click();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ sessionId: 'sess-1' });
    expect(q('draft-comments-bar')).toBeNull();
    expect(q('draft-comments-status')?.textContent).toContain(
      'Sent 2 comments to the agent.',
    );
  });

  it('keeps the drafts and shows the error on sent:false', async () => {
    send.mockResolvedValue({ sent: false, error: 'No chat tab is open.' });
    store.add(SESSION, draft());
    fixture.detectChanges();

    (q('draft-comments-send') as HTMLButtonElement).click();
    await settle();

    expect(store.draftsFor(SESSION)).toHaveLength(1);
    const error = q('draft-comments-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('No chat tab is open.');
    expect(q('draft-comments-status')?.textContent?.trim()).toBe('');
  });

  it('marks Send busy while in flight and ignores a second press', async () => {
    let resolve!: (r: AgentFeedbackSendResult) => void;
    send.mockReturnValue(new Promise((r) => (resolve = r)));
    store.add(SESSION, draft());
    fixture.detectChanges();

    const button = q('draft-comments-send') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent?.trim()).toBe('Sending…');
    button.click();

    resolve({ sent: true });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops an error when the owner changes', async () => {
    send.mockResolvedValue({ sent: false, error: 'Nope.' });
    store.add(SESSION, draft());
    store.add(OTHER, draft());
    fixture.detectChanges();
    (q('draft-comments-send') as HTMLButtonElement).click();
    await settle();
    expect(q('draft-comments-error')).not.toBeNull();

    fixture.componentInstance.owner.set(OTHER);
    fixture.detectChanges();
    expect(q('draft-comments-error')).toBeNull();
  });
});
