import { laneMarkerSummary, parseArgs } from './agent-usage-report';
import type { LaneMetrics } from './agent-usage/lane-metrics';

describe('agent-usage-report parseArgs', () => {
  it('keeps the positional [days] [top] of the former .mjs', () => {
    expect(parseArgs([])).toMatchObject({
      days: 7,
      top: 15,
      lanes: false,
      date: null,
    });
    expect(parseArgs(['3', '5'])).toMatchObject({ days: 3, top: 5 });
  });

  it('reads the mode flags and the date', () => {
    expect(
      parseArgs([
        '--lanes',
        '--all',
        '--resumed',
        '--opencode-config',
        '--date=2026-10-03',
      ]),
    ).toMatchObject({
      lanes: true,
      all: true,
      resumed: true,
      opencodeConfig: true,
      date: '2026-10-03',
    });
  });

  it('rejects an unknown flag, a bad date and a non-positive number', () => {
    expect(() => parseArgs(['--lane'])).toThrow('unknown flag --lane');
    expect(() => parseArgs(['--date=10/03/2026'])).toThrow('YYYY-MM-DD');
    expect(() => parseArgs(['0'])).toThrow('days must be a positive number');
  });
});

describe('laneMarkerSummary', () => {
  const lane = (
    vendor: LaneMetrics['vendor'],
    startedAt: string | null,
    isPtahLane = true,
  ): LaneMetrics => ({
    vendor,
    id: 'x',
    startedAt,
    isPtahLane,
    model: '',
    effort: '',
    requests: 1,
    firstInput: 1,
    peakInput: 1,
    totalInput: 1,
    cached: 0,
    output: 0,
    largestToolOutput: null,
    compactions: 0,
  });

  it('prints each vendor lane count with the first date the marker is seen', () => {
    const lines = laneMarkerSummary([
      lane('opencode', '2026-09-25T08:00:00.000Z'),
      lane('opencode', '2026-09-21T23:00:00.000Z'),
      lane('opencode', '2026-09-20T10:00:00.000Z', false),
      lane('codex', null),
    ]);
    expect(lines[0]).toMatch(/codex\s+Ptah lanes=1\s+marker first seen=-/);
    expect(lines[1]).toMatch(
      /opencode\s+Ptah lanes=2\s+marker first seen=2026-09-21/,
    );
    expect(lines[2]).toMatch(/claude\s+Ptah lanes=0/);
  });
});
