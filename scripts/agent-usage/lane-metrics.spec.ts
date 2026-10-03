import { renderLaneCompletionContract } from '../../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract';
import {
  formatLaneRow,
  hasLaneContractMarker,
  isoInstant,
  isPtahCodexLane,
  LANE_CONTRACT_MARKER,
  largerToolOutput,
  requestStats,
  sortLanesByStart,
  type LaneMetrics,
} from './lane-metrics';
import { rolloutStartInstant } from './codex-rollout.reader';

describe('lane contract marker', () => {
  // `buildTaskPrompt` appends this block to every lane prompt; if its wording
  // changes, M must change with it or every lane disappears from `--lanes`.
  it.each([
    [{}],
    [{ taskFolder: '/tf' }],
    [{ deliverables: ['/tf/a.md', '/tf/b.md'] }],
  ])('is present in every rendering of the contract (%j)', (input) => {
    const contract = renderLaneCompletionContract(input);
    expect(contract).toContain(LANE_CONTRACT_MARKER);
    expect(hasLaneContractMarker(['task text', `task\n\n${contract}`])).toBe(
      true,
    );
  });

  it('is absent from an ordinary prompt', () => {
    expect(hasLaneContractMarker(['## Before you start', 'exit'])).toBe(false);
    expect(hasLaneContractMarker([])).toBe(false);
  });

  it('counts only at a line start, not quoted inline', () => {
    expect(hasLaneContractMarker(['see the "## Before you exit" block'])).toBe(
      false,
    );
    expect(hasLaneContractMarker(['## Before you exit\nx'])).toBe(true);
  });
});

describe('sortLanesByStart (UTC across sources)', () => {
  const base: LaneMetrics = {
    vendor: 'codex',
    id: '',
    startedAt: null,
    isPtahLane: true,
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
  };

  it('orders a Codex local-time lane and an OpenCode UTC lane by instant across a date boundary', () => {
    // 23:30 UTC on 2 Oct, written by Codex as a LOCAL file-name timestamp.
    const codexInstant = Date.UTC(2026, 9, 2, 23, 30, 0);
    const local = new Date(codexInstant);
    const pad = (n: number) => String(n).padStart(2, '0');
    const codexId = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}-${pad(local.getMinutes())}-${pad(local.getSeconds())}`;
    const codex: LaneMetrics = {
      ...base,
      id: codexId,
      startedAt: rolloutStartInstant(codexId),
    };
    // 40 minutes later, 3 Oct in UTC (OpenCode stores epoch ms).
    const opencode: LaneMetrics = {
      ...base,
      vendor: 'opencode',
      id: 'ses_x',
      startedAt: isoInstant(Date.UTC(2026, 9, 3, 0, 10, 0)),
    };
    const unknown: LaneMetrics = { ...base, vendor: 'claude', id: 'n' };

    expect(codex.startedAt).toBe(new Date(codexInstant).toISOString());
    expect(
      sortLanesByStart([unknown, opencode, codex]).map((l) => l.vendor),
    ).toEqual(['codex', 'opencode', 'claude']);
  });

  it('gives null for an invalid instant', () => {
    expect(isoInstant(Number.NaN)).toBeNull();
    expect(isoInstant(9e15)).toBeNull();
  });
});

describe('isPtahCodexLane (R1.2)', () => {
  const lane = {
    originator: 'codex_sdk_ts',
    source: 'exec',
    hasLaneMarker: true,
  };

  it('needs originator, source and marker together', () => {
    expect(isPtahCodexLane(lane)).toBe(true);
    expect(isPtahCodexLane({ ...lane, originator: 'codex_cli_rs' })).toBe(
      false,
    );
    expect(isPtahCodexLane({ ...lane, source: 'cli' })).toBe(false);
    expect(isPtahCodexLane({ ...lane, hasLaneMarker: false })).toBe(false);
    expect(isPtahCodexLane({ ...lane, originator: null })).toBe(false);
  });
});

describe('requestStats', () => {
  it('takes first, peak and total in arrival order and skips empty samples', () => {
    expect(requestStats([0, 10, 30, 20, -1])).toEqual({
      requests: 3,
      firstInput: 10,
      peakInput: 30,
      totalInput: 60,
    });
  });

  it('is all zero for no requests', () => {
    expect(requestStats([])).toEqual({
      requests: 0,
      firstInput: 0,
      peakInput: 0,
      totalInput: 0,
    });
  });
});

describe('largerToolOutput', () => {
  it('keeps the first of equal outputs and replaces on a larger one', () => {
    const a = { tool: 'a', chars: 5 };
    expect(largerToolOutput(null, a)).toBe(a);
    expect(largerToolOutput(a, { tool: 'b', chars: 5 })).toBe(a);
    expect(largerToolOutput(a, { tool: 'c', chars: 6 }).tool).toBe('c');
  });
});

describe('formatLaneRow', () => {
  it('prints every --lanes column', () => {
    const lane: LaneMetrics = {
      vendor: 'codex',
      id: '2026-10-03T13-26-45',
      startedAt: null,
      isPtahLane: true,
      model: 'gpt-6-astra',
      effort: 'medium',
      requests: 74,
      firstInput: 27464,
      peakInput: 183759,
      totalInput: 9586716,
      cached: 9389952,
      output: 35764,
      largestToolOutput: { tool: 'exec', chars: 41000 },
      compactions: 0,
    };
    const row = formatLaneRow(lane);
    for (const part of [
      'gpt-6-astra',
      'medium',
      '27464',
      '183759',
      '9.59M',
      '98%',
      '35764',
      '74',
      '41000(exec)',
    ]) {
      expect(row).toContain(part);
    }
  });
});
