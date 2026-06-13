import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  MemoryDiagnosticsResult,
  MemoryForgetResult,
  MemoryListResult,
  MemoryPinResult,
  MemorySearchResult,
  MemoryStatsResult,
  MemoryWire,
} from '@ptah-extension/shared';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useTuiContext } from '../../context/TuiContext.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

interface MemoryPanelProps {
  isActive: boolean;
  degraded: boolean;
  reason?: string;
}

type MemoryMode = 'list' | 'search' | 'diagnostics';

const MEMORY_EVENTS = [
  MESSAGE_TYPES.MEMORY_EXTRACTED,
  MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED,
  MESSAGE_TYPES.MEMORY_CORPUS_CHANGED,
] as const;

function StatCluster({
  stats,
}: {
  stats: MemoryStatsResult | null;
}): React.JSX.Element {
  const theme = useTheme();
  if (!stats) {
    return <Text dimColor>Loading stats…</Text>;
  }
  return (
    <Box>
      <Box marginRight={2}>
        <Text color={theme.ui.accent} bold>
          {stats.core}
        </Text>
        <Text dimColor> core</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.ui.accent} bold>
          {stats.recall}
        </Text>
        <Text dimColor> recall</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.ui.accent} bold>
          {stats.archival}
        </Text>
        <Text dimColor> archival</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.ui.muted} bold>
          {stats.codeIndex}
        </Text>
        <Text dimColor> code</Text>
      </Box>
    </Box>
  );
}

export function MemoryPanel({
  isActive,
  degraded,
  reason,
}: MemoryPanelProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();
  const { pushAdapter } = useTuiContext();

  const [mode, setMode] = useState<MemoryMode>('list');
  const [stats, setStats] = useState<MemoryStatsResult | null>(null);
  const [memories, setMemories] = useState<readonly MemoryWire[]>([]);
  const [hits, setHits] = useState<MemorySearchResult['hits']>([]);
  const [diagnostics, setDiagnostics] =
    useState<MemoryDiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editingQuery, setEditingQuery] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, MemoryStatsResult>(
      'memory:stats',
      {},
    );
    if (result) setStats(result);
  }, [call]);

  const loadList = useCallback(async (): Promise<void> => {
    const result = await call<{ limit: number }, MemoryListResult>(
      'memory:list',
      { limit: 50 },
    );
    setMemories(result?.memories ?? []);
  }, [call]);

  const runSearch = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) {
        setHits([]);
        return;
      }
      const result = await call<
        { query: string; topK: number },
        MemorySearchResult
      >('memory:search', { query: text.trim(), topK: 20 });
      setHits(result?.hits ?? []);
    },
    [call],
  );

  const loadDiagnostics = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, MemoryDiagnosticsResult>(
      'memory:diagnostics',
      {},
    );
    if (result) setDiagnostics(result);
  }, [call]);

  useEffect(() => {
    if (degraded) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadList()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [degraded, loadStats, loadList]);

  useEffect(() => {
    if (degraded) return;
    const refresh = (): void => {
      void loadStats();
      void loadList();
    };
    for (const event of MEMORY_EVENTS) {
      pushAdapter.on(event, refresh);
    }
    return () => {
      for (const event of MEMORY_EVENTS) {
        pushAdapter.off(event, refresh);
      }
    };
  }, [degraded, pushAdapter, loadStats, loadList]);

  const navActive = isActive && !degraded && mode === 'list' && !editingQuery;

  const { activeIndex } = useKeyboardNav({
    itemCount: memories.length,
    isActive: navActive,
  });

  const togglePin = useCallback(
    async (memory: MemoryWire): Promise<void> => {
      const method = memory.pinned ? 'memory:unpin' : 'memory:pin';
      await call<{ id: string }, MemoryPinResult>(method, { id: memory.id });
      await loadList();
    },
    [call, loadList],
  );

  const forget = useCallback(
    async (memory: MemoryWire): Promise<void> => {
      await call<{ id: string }, MemoryForgetResult>('memory:forget', {
        id: memory.id,
      });
      await loadList();
    },
    [call, loadList],
  );

  useInput(
    (input, key) => {
      if (degraded) return;
      if (editingQuery) {
        if (key.escape) setEditingQuery(false);
        return;
      }
      if (key.ctrl || key.meta) return;

      if (input === '/') {
        setMode('search');
        setEditingQuery(true);
        return;
      }
      if (input === 'l') {
        setMode('list');
        return;
      }
      if (input === 'd') {
        setMode('diagnostics');
        void loadDiagnostics();
        return;
      }
      if (mode === 'list') {
        const memory = memories[activeIndex];
        if (!memory) return;
        if (input === 'p') void togglePin(memory);
        if (input === 'f') void forget(memory);
      }
    },
    { isActive: isActive && !degraded },
  );

  if (degraded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>
          Memory subsystem degraded{reason ? ` — ${reason}` : ''}.
        </Text>
        <Text dimColor>Chat remains available; memory features are paused.</Text>
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Loading memory…" />;
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <StatCluster stats={stats} />
      </Box>

      {mode === 'list' ? (
        <Box flexDirection="column">
          {memories.length === 0 ? (
            <Text dimColor>No memories curated yet.</Text>
          ) : (
            memories.slice(0, 12).map((memory, index) => (
              <ListItem
                key={memory.id}
                label={memory.subject ?? memory.content.slice(0, 48)}
                description={`${memory.tier} · ${memory.kind}`}
                isSelected={index === activeIndex && isActive}
                badge={
                  memory.pinned ? (
                    <Badge variant="accent">pinned</Badge>
                  ) : undefined
                }
              />
            ))
          )}
        </Box>
      ) : null}

      {mode === 'search' ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.status.warning}>Search: </Text>
            <TextInput
              value={query}
              onChange={setQuery}
              onSubmit={(val) => {
                setEditingQuery(false);
                void runSearch(val);
              }}
              placeholder="query and press Enter"
              focus={editingQuery}
            />
          </Box>
          {hits.length === 0 ? (
            <Text dimColor>No results.</Text>
          ) : (
            hits.slice(0, 12).map((hit) => (
              <ListItem
                key={hit.chunk.id}
                label={hit.memory.subject ?? hit.chunk.text.slice(0, 48)}
                description={`score ${hit.score.toFixed(3)}`}
              />
            ))
          )}
        </Box>
      ) : null}

      {mode === 'diagnostics' ? (
        <Box flexDirection="column">
          {diagnostics ? (
            <Box flexDirection="column">
              <Text>
                DB coherent:{' '}
                <Text
                  color={
                    diagnostics.dbHealth.coherent
                      ? theme.status.success
                      : theme.status.warning
                  }
                >
                  {diagnostics.dbHealth.coherent ? 'yes' : 'no'}
                </Text>
              </Text>
              <Text dimColor>
                memories {diagnostics.dbHealth.memories} · chunks{' '}
                {diagnostics.dbHealth.memory_chunks} · code{' '}
                {diagnostics.dbHealth.code_symbols}
              </Text>
              {diagnostics.dbHealth.mismatches.length > 0 ? (
                <Text color={theme.status.warning}>
                  mismatches: {diagnostics.dbHealth.mismatches.join(', ')}
                </Text>
              ) : null}
              <Box marginTop={1} flexDirection="column">
                {diagnostics.recentEvents.slice(0, 6).map((event, index) => (
                  <Text key={`${event.kind}-${event.timestamp}-${index}`} dimColor>
                    {event.kind}
                    {event.error ? ` (error: ${event.error})` : ''}
                  </Text>
                ))}
              </Box>
            </Box>
          ) : (
            <Spinner label="Loading diagnostics…" />
          )}
        </Box>
      ) : null}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="L" label="list" />
        <KeyHint keys="/" label="search" />
        <KeyHint keys="D" label="diagnostics" />
        {mode === 'list' ? <KeyHint keys="↑↓" label="navigate" /> : null}
        {mode === 'list' ? <KeyHint keys="P" label="pin" /> : null}
        {mode === 'list' ? <KeyHint keys="F" label="forget" /> : null}
      </Box>
    </Box>
  );
}

export default MemoryPanel;
