import {
  buildCuratorWindows,
  compressToolNoise,
  planCuratorWindows,
  splitTranscriptRecords,
  CURATOR_MAX_WINDOWS,
  CURATOR_WINDOW_MAX_CHARS,
  type CuratorWindow,
} from './transcript-windows';

const SEP = '\n\n';

/** A record shaped like `SdkTranscriptReaderAdapter.read` output. */
function record(index: number, size: number): string {
  return `USER: turn ${index} ${'x'.repeat(size)}`;
}

function transcriptOf(sizes: readonly number[]): string {
  return sizes.map((size, i) => record(i, size)).join(SEP);
}

function allIndices(windows: readonly CuratorWindow[]): number[] {
  return windows.flatMap((w) => [...w.recordIndices]);
}

describe('compressToolNoise', () => {
  const bashCall = `[tool_use Bash] ${JSON.stringify({
    command: `git log ${'-'.repeat(200)} --oneline`,
    description: 'read the log',
  })}`;

  const toolResult = [
    '[tool_result] first line of a very long build log',
    '',
    'a blank line in the middle, which is exactly the bulk worth removing',
    'y'.repeat(3000),
  ].join('\n');

  const corpus = [
    'ASSISTANT: I will read the log.',
    bashCall,
    toolResult,
    '',
    'USER: thanks',
  ].join('\n');

  it('never lengthens its input', () => {
    expect(compressToolNoise(corpus).length).toBeLessThanOrEqual(corpus.length);
    expect(compressToolNoise('USER: plain text').length).toBeLessThanOrEqual(
      'USER: plain text'.length,
    );
  });

  it('is idempotent', () => {
    const once = compressToolNoise(corpus);
    expect(compressToolNoise(once)).toBe(once);
  });

  it('truncates a tool_result body to 600 characters on one line', () => {
    const out = compressToolNoise(corpus);
    const line = out
      .split('\n')
      .find((l) => l.startsWith('[tool_result]')) as string;
    expect(line).toBeDefined();
    expect(line.length).toBe('[tool_result] '.length + 600);
    expect(line.endsWith('…')).toBe(true);
  });

  it('truncates a Bash command to 80 characters and drops the JSON wrapper', () => {
    const out = compressToolNoise(corpus);
    const line = out
      .split('\n')
      .find((l) => l.startsWith('[tool_use Bash]')) as string;
    expect(line.length).toBe('[tool_use Bash] '.length + 80);
    expect(line).toContain('git log');
    expect(line).not.toContain('description');
  });

  it('keeps the error label on a failed tool result', () => {
    const out = compressToolNoise('[tool_result error] boom\nstack line');
    expect(out).toBe('[tool_result error] boom stack line');
  });

  it('leaves a non-Bash tool_use line alone', () => {
    const line = '[tool_use Read] {"file_path":"a.ts"}';
    expect(compressToolNoise(line)).toBe(line);
  });

  it('stops a tool_result body at the next record header', () => {
    const input = ['[tool_result] one', 'two', '', 'USER: next turn'].join(
      '\n',
    );
    expect(compressToolNoise(input)).toBe(
      ['[tool_result] one two', '', 'USER: next turn'].join('\n'),
    );
  });
});

describe('splitTranscriptRecords', () => {
  it('splits on the record separator and never inside a record', () => {
    const records = splitTranscriptRecords(transcriptOf([10, 20, 30]));
    expect(records).toHaveLength(3);
    expect(records[1].text).toBe(record(1, 20));
  });

  it('skips blank records but keeps the surviving indices honest', () => {
    const records = splitTranscriptRecords(`USER: a${SEP}${SEP}USER: b`);
    expect(records.map((r) => r.index)).toEqual([0, 2]);
  });
});

describe('buildCuratorWindows', () => {
  const options = { maxChars: 2_000, maxWindows: 8 };

  /** Deliberately includes one record far larger than a whole window. */
  const oversizedCorpus = splitTranscriptRecords(
    transcriptOf([400, 400, 6_000, 400, 400]),
  );

  it('never produces a window longer than maxChars', () => {
    const windows = buildCuratorWindows(oversizedCorpus, options);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.text.length).toBeLessThanOrEqual(options.maxChars);
    }
  });

  it('character-truncates an over-large record instead of dropping it', () => {
    const windows = buildCuratorWindows(oversizedCorpus, options);
    expect(allIndices(windows)).toContain(2);
    const carrier = windows.find((w) =>
      w.recordIndices.includes(2),
    ) as CuratorWindow;
    expect(carrier.text).toContain('turn 2');
    expect(carrier.text).toContain('…');
  });

  it('serves every record exactly once, in strictly ascending order', () => {
    const windows = buildCuratorWindows(oversizedCorpus, options);
    const indices = allIndices(windows);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('respects maxWindows exactly and reports what it omitted', () => {
    const records = splitTranscriptRecords(
      transcriptOf(Array.from({ length: 40 }, () => 900)),
    );
    const windows = buildCuratorWindows(records, {
      maxChars: 2_000,
      maxWindows: 3,
    });

    expect(windows).toHaveLength(3);
    expect(windows[2].windowCount).toBe(3);
    expect(windows[2].text).toContain('omitted by the memory curator');
    expect(windows[2].text).toContain('window 3 of 3');
    expect(windows[2].text.length).toBeLessThanOrEqual(2_000);
    expect(allIndices(windows).length).toBeLessThan(records.length);
  });

  it('says nothing about omission when nothing was omitted', () => {
    const windows = buildCuratorWindows(oversizedCorpus, options);
    for (const w of windows) {
      expect(w.text).not.toContain('omitted by the memory curator');
    }
  });

  it('is deterministic', () => {
    const a = buildCuratorWindows(oversizedCorpus, options);
    const b = buildCuratorWindows(oversizedCorpus, options);
    expect(a).toEqual(b);
  });

  it('returns no windows for no records', () => {
    expect(buildCuratorWindows([], options)).toEqual([]);
  });
});

describe('planCuratorWindows', () => {
  it('produces exactly one window, byte for byte, when the transcript fits', () => {
    const transcript = `USER: hello${SEP}ASSISTANT: hi`;
    const plan = planCuratorWindows(transcript);

    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].text).toBe(transcript);
    expect(plan.windows[0].windowCount).toBe(1);
    expect(plan.clamped).toBeNull();
  });

  it('splits a transcript past one window into several, and does not clamp', () => {
    const transcript = transcriptOf(Array.from({ length: 12 }, () => 20_000));
    const plan = planCuratorWindows(transcript);

    expect(plan.windows.length).toBeGreaterThan(1);
    expect(plan.windows.length).toBeLessThanOrEqual(CURATOR_MAX_WINDOWS);
    for (const w of plan.windows) {
      expect(w.text.length).toBeLessThanOrEqual(CURATOR_WINDOW_MAX_CHARS);
    }
    expect(plan.clamped).toBeNull();
  });

  it('falls back to the last-resort clamp above the chunked budget', () => {
    const transcript = transcriptOf(Array.from({ length: 60 }, () => 20_000));
    const plan = planCuratorWindows(transcript);

    expect(plan.windows).toHaveLength(CURATOR_MAX_WINDOWS);
    expect(plan.clamped?.clamped).toBe(true);
    expect(plan.clamped?.droppedChars).toBeGreaterThan(0);
    for (const w of plan.windows) {
      expect(w.text.length).toBeLessThanOrEqual(CURATOR_WINDOW_MAX_CHARS);
    }
  });

  it('is deterministic', () => {
    const transcript = transcriptOf(Array.from({ length: 12 }, () => 20_000));
    expect(planCuratorWindows(transcript)).toEqual(
      planCuratorWindows(transcript),
    );
  });
});
