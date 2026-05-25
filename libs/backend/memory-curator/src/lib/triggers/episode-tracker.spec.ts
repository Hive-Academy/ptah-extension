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
});
