import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisGetCandidateResult,
  SkillSynthesisListCandidatesResult,
  SkillSynthesisPromoteResult,
  SkillSynthesisRejectResult,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import { mapPromoteOutcome } from './promote-outcome.js';
import type { PromoteOutcome } from './promote-outcome.js';

export { mapPromoteOutcome };
export type { PromoteOutcome, PromoteOutcomeKind } from './promote-outcome.js';

interface SkillsPanelProps {
  isActive: boolean;
  degraded: boolean;
  reason?: string;
}

type StatusFilter = 'candidate' | 'promoted' | 'rejected' | 'all';

const STATUS_FILTERS: readonly StatusFilter[] = [
  'candidate',
  'promoted',
  'rejected',
  'all',
];

const DOT_SUCCESS = '●';
const DOT_WARNING = '○';

function OutcomeLine({ outcome }: { outcome: PromoteOutcome }): React.JSX.Element {
  const theme = useTheme();
  const color =
    outcome.kind === 'success'
      ? theme.status.success
      : outcome.kind === 'warning'
        ? theme.status.warning
        : theme.status.error;
  const dot = outcome.kind === 'success' ? DOT_SUCCESS : DOT_WARNING;
  return (
    <Box>
      <Text color={color}>{dot} </Text>
      <Text color={color}>{outcome.text}</Text>
      {outcome.reason ? <Text dimColor> — {outcome.reason}</Text> : null}
    </Box>
  );
}

export function SkillsPanel({
  isActive,
  degraded,
  reason,
}: SkillsPanelProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [filter, setFilter] = useState<StatusFilter>('candidate');
  const [candidates, setCandidates] = useState<
    SkillSynthesisCandidateSummary[]
  >([]);
  const [stats, setStats] = useState<SkillSynthesisStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<PromoteOutcome | null>(null);
  const [detail, setDetail] =
    useState<SkillSynthesisGetCandidateResult['candidate']>(null);
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, SkillSynthesisStatsResult>(
      'skillSynthesis:stats',
      {},
    );
    if (result) setStats(result);
  }, [call]);

  const loadCandidates = useCallback(
    async (status: StatusFilter): Promise<void> => {
      const result = await call<
        { status: StatusFilter; limit: number },
        SkillSynthesisListCandidatesResult
      >('skillSynthesis:listCandidates', { status, limit: 100 });
      setCandidates(result?.candidates ?? []);
    },
    [call],
  );

  useEffect(() => {
    if (degraded) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadCandidates(filter)]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [degraded, filter, loadStats, loadCandidates]);

  const navActive = isActive && !degraded && !busy && detail === null;

  const { activeIndex } = useKeyboardNav({
    itemCount: candidates.length,
    isActive: navActive,
  });

  const promote = useCallback(
    async (candidate: SkillSynthesisCandidateSummary): Promise<void> => {
      setBusy(true);
      setOutcome(null);
      const result = await call<{ id: string }, SkillSynthesisPromoteResult>(
        'skillSynthesis:promote',
        { id: candidate.id },
      );
      setOutcome(mapPromoteOutcome(result));
      await Promise.all([loadStats(), loadCandidates(filter)]);
      setBusy(false);
    },
    [call, filter, loadStats, loadCandidates],
  );

  const reject = useCallback(
    async (candidate: SkillSynthesisCandidateSummary): Promise<void> => {
      setBusy(true);
      await call<{ id: string }, SkillSynthesisRejectResult>(
        'skillSynthesis:reject',
        { id: candidate.id },
      );
      await Promise.all([loadStats(), loadCandidates(filter)]);
      setBusy(false);
    },
    [call, filter, loadStats, loadCandidates],
  );

  const openDetail = useCallback(
    async (candidate: SkillSynthesisCandidateSummary): Promise<void> => {
      const result = await call<
        { id: string },
        SkillSynthesisGetCandidateResult
      >('skillSynthesis:getCandidate', { id: candidate.id });
      setDetail(result?.candidate ?? null);
    },
    [call],
  );

  const cycleFilter = useCallback(() => {
    setFilter((current) => {
      const index = STATUS_FILTERS.indexOf(current);
      return STATUS_FILTERS[(index + 1) % STATUS_FILTERS.length];
    });
    setOutcome(null);
  }, []);

  useInput(
    (input, key) => {
      if (degraded || busy) return;
      if (detail !== null) {
        if (key.escape || input === 'q') setDetail(null);
        return;
      }
      if (key.ctrl || key.meta) return;

      if (input === 's') {
        cycleFilter();
        return;
      }
      const candidate = candidates[activeIndex];
      if (!candidate) return;
      if (key.return || input === 'v') {
        void openDetail(candidate);
        return;
      }
      if (input === 'p') void promote(candidate);
      if (input === 'r') void reject(candidate);
    },
    { isActive: isActive && !degraded && !busy },
  );

  if (degraded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>
          Skills subsystem degraded{reason ? ` — ${reason}` : ''}.
        </Text>
        <Text dimColor>Chat remains available; skill features are paused.</Text>
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Loading skills…" />;
  }

  if (detail) {
    return (
      <Box flexDirection="column">
        <Text color={theme.ui.accent} bold>
          {detail.name}
        </Text>
        <Text dimColor>{detail.description}</Text>
        <Box marginTop={1}>
          <Text dimColor>status: {detail.status}</Text>
        </Box>
        {detail.body ? (
          <Box marginTop={1} flexDirection="column">
            {detail.body
              .split('\n')
              .slice(0, 16)
              .map((line, index) => (
                <Text key={index}>{line}</Text>
              ))}
          </Box>
        ) : (
          <Text dimColor>No body available.</Text>
        )}
        <Box marginTop={1}>
          <KeyHint keys="Esc" label="back" />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {stats ? (
          <Box>
            <Box marginRight={2}>
              <Text color={theme.ui.accent} bold>
                {stats.totalCandidates}
              </Text>
              <Text dimColor> candidates</Text>
            </Box>
            <Box marginRight={2}>
              <Text color={theme.status.success} bold>
                {stats.totalPromoted}
              </Text>
              <Text dimColor> promoted</Text>
            </Box>
            <Box marginRight={2}>
              <Text color={theme.status.warning} bold>
                {stats.totalRejected}
              </Text>
              <Text dimColor> rejected</Text>
            </Box>
            <Box marginRight={2}>
              <Text color={theme.ui.muted} bold>
                {stats.activeSkills}
              </Text>
              <Text dimColor> active</Text>
            </Box>
          </Box>
        ) : (
          <Text dimColor>Loading stats…</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>filter: </Text>
        <Badge variant="outline">{filter}</Badge>
      </Box>

      {candidates.length === 0 ? (
        <Text dimColor>No candidates for this filter.</Text>
      ) : (
        candidates.slice(0, 12).map((candidate, index) => (
          <ListItem
            key={candidate.id}
            label={candidate.name}
            description={`${candidate.successCount}✓ / ${candidate.failureCount}✗`}
            isSelected={index === activeIndex && isActive}
            badge={
              candidate.status === 'promoted' ? (
                <Badge variant="success">promoted</Badge>
              ) : candidate.status === 'rejected' ? (
                <Badge variant="warning">rejected</Badge>
              ) : undefined
            }
          />
        ))
      )}

      {busy ? (
        <Box marginTop={1}>
          <Spinner label="Working…" />
        </Box>
      ) : outcome ? (
        <Box marginTop={1}>
          <OutcomeLine outcome={outcome} />
        </Box>
      ) : null}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="view" />
        <KeyHint keys="P" label="promote" />
        <KeyHint keys="R" label="reject" />
        <KeyHint keys="S" label="filter" />
      </Box>
    </Box>
  );
}

export default SkillsPanel;
