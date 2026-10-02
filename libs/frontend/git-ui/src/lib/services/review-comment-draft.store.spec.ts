import { TestBed } from '@angular/core/testing';
import {
  AGENT_FEEDBACK_SENDER,
  type AgentFeedbackSendResult,
  type IAgentFeedbackSender,
} from '@ptah-extension/core';
import {
  formatReviewCommentMessage,
  ReviewCommentDraftStore,
  reviewDraftOwnerKey,
  type ReviewCommentDraftInput,
  type ReviewDraftOwner,
} from './review-comment-draft.store';

const WORKSPACE: ReviewDraftOwner = { workspaceRoot: '/repo' };
const SESSION: ReviewDraftOwner = {
  workspaceRoot: '/repo',
  ownerSessionId: 'sess-1',
};

function draft(
  overrides: Partial<ReviewCommentDraftInput> = {},
): ReviewCommentDraftInput {
  return {
    path: 'src/app.ts',
    startLine: 41,
    endLine: 42,
    lines: ['const a = 1;', 'const b = 2;'],
    body: 'consider extracting this',
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(sender: IAgentFeedbackSender | null): ReviewCommentDraftStore {
  TestBed.configureTestingModule({
    providers: sender ? [{ provide: AGENT_FEEDBACK_SENDER, useValue: sender }] : [],
  });
  return TestBed.inject(ReviewCommentDraftStore);
}

describe('ReviewCommentDraftStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('keys and drafts', () => {
    it('keys by ownerSessionId, falling back to workspaceRoot', () => {
      expect(reviewDraftOwnerKey(SESSION)).toBe('session:sess-1');
      expect(reviewDraftOwnerKey(WORKSPACE)).toBe('workspace:/repo');
    });

    it('keeps drafts of different owners apart', () => {
      const store = setup(null);
      store.add(SESSION, draft());
      store.add(WORKSPACE, draft({ path: 'b.ts' }));

      expect(store.draftsFor(SESSION).map((d) => d.path)).toEqual([
        'src/app.ts',
      ]);
      expect(store.draftsFor(WORKSPACE).map((d) => d.path)).toEqual(['b.ts']);
    });

    it('adds drafts in order with unique ids and removes by id', () => {
      const store = setup(null);
      const first = store.add(WORKSPACE, draft());
      const second = store.add(WORKSPACE, draft({ startLine: 1, endLine: 1, lines: ['x'] }));

      expect(first?.id).not.toBe(second?.id);
      expect(store.draftsFor(WORKSPACE)).toEqual([first, second]);

      store.remove(WORKSPACE, first?.id ?? '');
      expect(store.draftsFor(WORKSPACE)).toEqual([second]);
    });

    it.each([
      ['an empty path', { path: '  ' }],
      ['a zero start line', { startLine: 0, endLine: 1, lines: ['a', 'b'] }],
      ['an inverted range', { startLine: 5, endLine: 4, lines: [] }],
      ['a fractional line', { startLine: 1.5, endLine: 2, lines: ['a'] }],
      ['lines not matching the range', { lines: ['only one'] }],
    ])('refuses %s', (_label, overrides) => {
      const store = setup(null);
      expect(store.add(WORKSPACE, draft(overrides))).toBeNull();
      expect(store.draftsFor(WORKSPACE)).toEqual([]);
    });

    it('copies the quoted lines so a caller cannot mutate a draft', () => {
      const store = setup(null);
      const lines = ['a'];
      store.add(WORKSPACE, draft({ startLine: 3, endLine: 3, lines }));
      lines[0] = 'changed';
      expect(store.draftsFor(WORKSPACE)[0].lines).toEqual(['a']);
    });

    it('survives a new consumer injecting the store (canvas reopened)', () => {
      const store = setup(null);
      store.add(SESSION, draft());
      expect(TestBed.inject(ReviewCommentDraftStore).draftsFor(SESSION)).toHaveLength(1);
    });
  });

  describe('formatReviewCommentMessage', () => {
    it('writes path, Lstart-Lend, fenced lines and the comment per draft', () => {
      const message = formatReviewCommentMessage([
        { id: 'a', ...draft() },
        {
          id: 'b',
          ...draft({
            path: 'lib/x.ts',
            startLine: 7,
            endLine: 7,
            lines: ['return y;'],
            body: '  ',
          }),
        },
      ]);

      expect(message).toBe(
        [
          'Review comments on your changes (2):',
          'src/app.ts L41-L42\n```\nconst a = 1;\nconst b = 2;\n```\nconsider extracting this',
          'lib/x.ts L7-L7\n```\nreturn y;\n```',
        ].join('\n\n'),
      );
    });

    it('uses a fence longer than any backtick run in the quote', () => {
      const message = formatReviewCommentMessage([
        {
          id: 'a',
          ...draft({ startLine: 1, endLine: 1, lines: ['```ts'], body: '' }),
        },
      ]);
      expect(message).toContain('\n````\n```ts\n````');
    });
  });

  describe('send', () => {
    it('sends one message to the owning session and clears on sent:true', async () => {
      const send = jest.fn().mockResolvedValue({ sent: true });
      const store = setup({ send });
      store.add(SESSION, draft());
      store.add(SESSION, draft({ path: 'b.ts' }));

      await expect(store.send(SESSION)).resolves.toEqual({ sent: true });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toEqual({ sessionId: 'sess-1' });
      expect(send.mock.calls[0][1]).toContain('src/app.ts L41-L42');
      expect(send.mock.calls[0][1]).toContain('b.ts L41-L42');
      expect(store.draftsFor(SESSION)).toEqual([]);
    });

    it("targets 'active' when there is no owning session", async () => {
      const send = jest.fn().mockResolvedValue({ sent: true });
      const store = setup({ send });
      store.add(WORKSPACE, draft());

      await store.send(WORKSPACE);
      expect(send.mock.calls[0][0]).toBe('active');
    });

    it('keeps every draft and returns the error on sent:false', async () => {
      const send = jest
        .fn()
        .mockResolvedValue({ sent: false, error: 'No chat tab is open.' });
      const store = setup({ send });
      store.add(SESSION, draft());

      await expect(store.send(SESSION)).resolves.toEqual({
        sent: false,
        error: 'No chat tab is open.',
      });
      expect(store.draftsFor(SESSION)).toHaveLength(1);
    });

    it('keeps drafts with a generic error when sent:false has no message', async () => {
      const store = setup({ send: jest.fn().mockResolvedValue({ sent: false }) });
      store.add(SESSION, draft());

      const result = await store.send(SESSION);
      expect(result.sent).toBe(false);
      expect(result.error).toMatch(/drafts are kept/);
      expect(store.draftsFor(SESSION)).toHaveLength(1);
    });

    it('keeps drafts when the sender throws', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = setup({ send: jest.fn().mockRejectedValue(new Error('boom')) });
      store.add(SESSION, draft());

      const result = await store.send(SESSION);
      expect(result.sent).toBe(false);
      expect(result.error).not.toContain('boom');
      expect(store.draftsFor(SESSION)).toHaveLength(1);
      expect(store.isSending(SESSION)).toBe(false);
      spy.mockRestore();
    });

    it('reports unavailable without a provider and keeps drafts', async () => {
      const store = setup(null);
      store.add(SESSION, draft());

      const result = await store.send(SESSION);
      expect(result.sent).toBe(false);
      expect(result.error).toMatch(/not available/);
      expect(store.draftsFor(SESSION)).toHaveLength(1);
    });

    it('does not call the sender when there is nothing to send', async () => {
      const send = jest.fn();
      const store = setup({ send });

      const result = await store.send(SESSION);
      expect(result.sent).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('joins a send already in flight and tracks isSending', async () => {
      const pending = deferred<AgentFeedbackSendResult>();
      const send = jest.fn().mockReturnValue(pending.promise);
      const store = setup({ send });
      store.add(SESSION, draft());

      const first = store.send(SESSION);
      const second = store.send(SESSION);
      expect(second).toBe(first);
      expect(store.isSending(SESSION)).toBe(true);
      expect(store.isSending(WORKSPACE)).toBe(false);

      pending.resolve({ sent: true });
      await first;
      expect(send).toHaveBeenCalledTimes(1);
      expect(store.isSending(SESSION)).toBe(false);
    });

    it('clears only the drafts it sent; one added mid-send survives', async () => {
      const pending = deferred<AgentFeedbackSendResult>();
      const store = setup({ send: jest.fn().mockReturnValue(pending.promise) });
      store.add(SESSION, draft());

      const run = store.send(SESSION);
      const late = store.add(SESSION, draft({ path: 'late.ts' }));
      pending.resolve({ sent: true });
      await run;

      expect(store.draftsFor(SESSION)).toEqual([late]);
    });

    it('a draft removed mid-send stays removed after a failure', async () => {
      const pending = deferred<AgentFeedbackSendResult>();
      const store = setup({ send: jest.fn().mockReturnValue(pending.promise) });
      const added = store.add(SESSION, draft());

      const run = store.send(SESSION);
      store.remove(SESSION, added?.id ?? '');
      pending.resolve({ sent: false, error: 'x' });
      await run;

      expect(store.draftsFor(SESSION)).toEqual([]);
    });

    it('a call made after a draft was added mid-send sends that draft once the first send lands', async () => {
      const firstSend = deferred<AgentFeedbackSendResult>();
      const send = jest
        .fn()
        .mockReturnValueOnce(firstSend.promise)
        .mockResolvedValueOnce({ sent: true });
      const store = setup({ send });
      store.add(SESSION, draft());

      const first = store.send(SESSION);
      store.add(SESSION, draft({ path: 'late.ts' }));
      const second = store.send(SESSION);
      expect(second).not.toBe(first);

      firstSend.resolve({ sent: true });
      await expect(first).resolves.toEqual({ sent: true });
      await expect(second).resolves.toEqual({ sent: true });

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][1]).toContain('late.ts');
      expect(send.mock.calls[1][1]).not.toContain('src/app.ts');
      expect(store.draftsFor(SESSION)).toEqual([]);
    });

    it('a call made after a draft was added mid-send reports the failure when the first send fails', async () => {
      const firstSend = deferred<AgentFeedbackSendResult>();
      const send = jest.fn().mockReturnValueOnce(firstSend.promise);
      const store = setup({ send });
      store.add(SESSION, draft());

      store.send(SESSION);
      store.add(SESSION, draft({ path: 'late.ts' }));
      const second = store.send(SESSION);

      firstSend.resolve({ sent: false, error: 'offline' });
      await expect(second).resolves.toEqual({ sent: false, error: 'offline' });
      expect(send).toHaveBeenCalledTimes(1);
      expect(store.draftsFor(SESSION)).toHaveLength(2);
    });
  });
});
