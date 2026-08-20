import { EpisodeTracker } from './episode-tracker';

describe('EpisodeTracker', () => {
  it('reports an empty snapshot for an unknown session', () => {
    const t = new EpisodeTracker();
    const snap = t.snapshot('s1');
    expect(snap.isEmpty).toBe(true);
    expect(snap.turnCount).toBe(0);
    expect(t.buildTranscript('s1')).toBe('');
  });

  it('counts turns and buffers assistant messages', () => {
    const t = new EpisodeTracker();
    expect(t.recordTurn('s1', 'first turn')).toBe(1);
    expect(t.recordTurn('s1', 'second turn')).toBe(2);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(2);
    expect(snap.assistantMessages).toEqual(['first turn', 'second turn']);
    expect(t.buildTranscript('s1')).toContain('first turn');
  });

  it('caps buffered assistant messages', () => {
    const t = new EpisodeTracker();
    for (let i = 0; i < 40; i++) t.recordTurn('s1', `m${i}`);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(40);
    expect(snap.assistantMessages.length).toBeLessThanOrEqual(15);
    expect(snap.assistantMessages.at(-1)).toBe('m39');
  });

  it('detects error→recovery as critical learning with salience boost', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'tests failed');
    expect(t.recordToolSuccess('s1', 'Edit')).toBe(false);
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(true);
    const snap = t.snapshot('s1');
    expect(snap.hasCriticalLearning).toBe(true);
    expect(snap.recoveredTools).toContain('Bash');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.2);
    expect(t.buildTranscript('s1')).toContain('Recovered after failure');
  });

  it('boosts committed work and combines with critical learning', () => {
    const t = new EpisodeTracker();
    t.recordCommit('s1');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.1);
    t.recordFailure('s1', 'Bash', 'x');
    t.recordToolSuccess('s1', 'Bash');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.3);
  });

  it('reset clears a single session; clear wipes all', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'a');
    t.recordTurn('s2', 'b');
    t.reset('s1');
    expect(t.snapshot('s1').isEmpty).toBe(true);
    expect(t.snapshot('s2').isEmpty).toBe(false);
    t.clear();
    expect(t.snapshot('s2').isEmpty).toBe(true);
  });

  it('caps buffered failures at MAX_FAILURES, dropping the oldest', () => {
    const t = new EpisodeTracker();
    for (let i = 0; i < 40; i++) t.recordFailure('s1', `Tool${i}`, `err${i}`);
    const snap = t.snapshot('s1');
    expect(snap.failures.length).toBe(30);
    expect(snap.failures.at(-1)).toEqual(
      expect.objectContaining({ tool: 'Tool39', error: 'err39' }),
    );
    expect(snap.failures[0]).toEqual(
      expect.objectContaining({ tool: 'Tool10' }),
    );
  });

  it('truncates a long assistant message to MAX_MESSAGE_CHARS', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'x'.repeat(5000));
    const snap = t.snapshot('s1');
    expect(snap.assistantMessages[0].length).toBe(2000);
  });

  it('truncates a long failure error to MAX_MESSAGE_CHARS', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'e'.repeat(5000));
    const snap = t.snapshot('s1');
    expect(snap.failures[0].error.length).toBe(2000);
  });

  it('ignores blank assistant messages but still advances the turn count', () => {
    const t = new EpisodeTracker();
    expect(t.recordTurn('s1', '   ')).toBe(1);
    expect(t.recordTurn('s1', null)).toBe(2);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(2);
    expect(snap.assistantMessages).toEqual([]);
  });

  it('recovery only fires for a tool that previously failed', () => {
    const t = new EpisodeTracker();
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(true);
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    expect(t.snapshot('s1').recoveredTools).toEqual(['Bash']);
  });

  it('hasCriticalLearning requires both a failure and a recovery', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.snapshot('s1').hasCriticalLearning).toBe(false);
    t.recordToolSuccess('s1', 'Bash');
    expect(t.snapshot('s1').hasCriticalLearning).toBe(true);
  });

  it('buildTranscript renders each populated section', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'summarised the work');
    t.recordFailure('s1', 'Bash', 'npm test failed');
    t.recordToolSuccess('s1', 'Bash');
    t.recordCommit('s1');
    const transcript = t.buildTranscript('s1');
    expect(transcript).toContain('# Session episode — 1 assistant turn(s)');
    expect(transcript).toContain('## Assistant turn summaries');
    expect(transcript).toContain('- summarised the work');
    expect(transcript).toContain('## Tool failures encountered');
    expect(transcript).toContain('- Bash: npm test failed');
    expect(transcript).toContain('## Recovered after failure: Bash');
    expect(transcript).toContain('## Commits in this episode: 1');
  });

  it('buildTranscript omits sections with no content', () => {
    const t = new EpisodeTracker();
    t.recordCommit('s1');
    const transcript = t.buildTranscript('s1');
    expect(transcript).toContain('Commits in this episode: 1');
    expect(transcript).not.toContain('## Assistant turn summaries');
    expect(transcript).not.toContain('## Tool failures encountered');
    expect(transcript).not.toContain('## Recovered after failure');
  });

  it('isEmpty transitions: empty → false on any signal → empty after reset', () => {
    const t = new EpisodeTracker();
    expect(t.snapshot('s1').isEmpty).toBe(true);
    t.recordCommit('s1');
    expect(t.snapshot('s1').isEmpty).toBe(false);
    t.reset('s1');
    expect(t.snapshot('s1').isEmpty).toBe(true);
  });

  it('a lone tool failure makes the episode non-empty', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.snapshot('s1').isEmpty).toBe(false);
  });

  it('a bare recovery with no prior failure leaves the episode empty', () => {
    const t = new EpisodeTracker();
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    expect(t.snapshot('s1').isEmpty).toBe(true);
  });

  /**
   * TASK_2026_296 item 6, Part B. A residual hook path buffers an episode
   * under the tabId; when the SDK resolves the canonical UUID the buffer has to
   * move with the rest of the session's state, or the episode is curated under
   * an id whose transcript cannot be read.
   *
   * Real UUID v4 strings on both sides: a tabId IS one.
   */
  describe('rekey (TASK_2026_296)', () => {
    const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
    const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';

    it('moves the buffer to the new id and leaves nothing behind', () => {
      const t = new EpisodeTracker();
      t.recordTurn(TAB_ID, 'did the work');
      t.recordCommit(TAB_ID);

      expect(t.rekey(TAB_ID, REAL_ID)).toBe(true);

      const moved = t.snapshot(REAL_ID);
      expect(moved.turnCount).toBe(1);
      expect(moved.commits).toBe(1);
      expect(moved.assistantMessages).toEqual(['did the work']);
      expect(t.snapshot(TAB_ID).isEmpty).toBe(true);
    });

    it('refuses to overwrite a buffer already held under the destination', () => {
      // R4 — never clobber. The destination buffer is the live one; the stale
      // tabId buffer is discarded rather than replacing it.
      const t = new EpisodeTracker();
      t.recordTurn(TAB_ID, 'stale');
      t.recordTurn(REAL_ID, 'live');
      t.recordTurn(REAL_ID, 'live again');

      expect(t.rekey(TAB_ID, REAL_ID)).toBe(false);

      expect(t.snapshot(REAL_ID).turnCount).toBe(2);
      expect(t.snapshot(REAL_ID).assistantMessages).toEqual([
        'live',
        'live again',
      ]);
      // The discarded buffer is gone, not left dangling under the old key.
      expect(t.snapshot(TAB_ID).isEmpty).toBe(true);
    });

    it('is inert when there is nothing under the source id', () => {
      // Paired-isolation sibling: an unrelated buffer must survive untouched.
      const t = new EpisodeTracker();
      t.recordTurn(REAL_ID, 'untouched');

      expect(t.rekey(TAB_ID, REAL_ID)).toBe(false);

      expect(t.snapshot(REAL_ID).assistantMessages).toEqual(['untouched']);
    });
  });
});
