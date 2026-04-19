/**
 * CliAgentsSection -- CLI agent detection, testing, and model listing.
 *
 * Displays all configured CLI agents with their provider, status, and
 * provides actions to test connectivity and list available models.
 *
 * Navigation:
 *   - Up/Down: Navigate agent list
 *   - Enter or T: Test connection for selected agent
 *   - M: Toggle model list display for selected agent
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { BadgeVariant } from '../atoms/index.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface CliAgent {
  id: string;
  name: string;
  providerName?: string;
  status?: string;
  enabled?: boolean;
  hasApiKey?: boolean;
}

interface RpcCliAgent {
  id: string;
  name: string;
  providerName: string;
  providerId: string;
  hasApiKey: boolean;
  status: string;
  enabled: boolean;
  modelCount: number;
}

interface TestResultEntry {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

interface ModelEntry {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CliAgentsSectionProps {
  isActive: boolean;
}

function getStatusBadge(agent: CliAgent): {
  label: string;
  variant: BadgeVariant;
} {
  if (agent.status === 'available' && agent.hasApiKey) {
    return { label: 'connected', variant: 'success' };
  }
  if (agent.status === 'error') {
    return { label: 'disconnected', variant: 'error' };
  }
  if (!agent.hasApiKey || agent.status === 'unconfigured') {
    return { label: 'not installed', variant: 'ghost' };
  }
  if (agent.status === 'initializing') {
    return { label: 'initializing', variant: 'warning' };
  }
  return { label: agent.status ?? 'unknown', variant: 'ghost' };
}

export function CliAgentsSection({
  isActive,
}: CliAgentsSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [agents, setAgents] = useState<CliAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingAgent, setTestingAgent] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestResultEntry>
  >({});
  const [modelsShown, setModelsShown] = useState<Record<string, ModelEntry[]>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      const result = await call<
        Record<string, never>,
        { agents: RpcCliAgent[] }
      >('ptahCli:list', {} as Record<string, never>);

      if (cancelled) return;

      if (result) {
        setAgents(
          result.agents.map((a) => ({
            id: a.id,
            name: a.name,
            providerName: a.providerName,
            status: a.status,
            enabled: a.enabled,
            hasApiKey: a.hasApiKey,
          })),
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleTestConnection = useCallback(
    async (agentId: string): Promise<void> => {
      setTestingAgent(agentId);

      const result = await call<
        { id: string },
        { success: boolean; latencyMs?: number; error?: string }
      >('ptahCli:testConnection', { id: agentId });

      setTestResults((prev) => ({
        ...prev,
        [agentId]: result
          ? {
              success: result.success,
              latencyMs: result.latencyMs,
              error: result.error,
            }
          : { success: false, error: 'No response' },
      }));

      setTestingAgent(null);
    },
    [call],
  );

  const handleListModels = useCallback(
    async (agentId: string): Promise<void> => {
      if (modelsShown[agentId]) {
        setModelsShown((prev) => {
          const next = { ...prev };
          delete next[agentId];
          return next;
        });
        return;
      }

      setLoadingModels(agentId);

      const result = await call<
        { id: string },
        { models: ModelEntry[]; isStatic: boolean; error?: string }
      >('ptahCli:listModels', { id: agentId });

      if (result) {
        setModelsShown((prev) => ({
          ...prev,
          [agentId]: result.models,
        }));
      }

      setLoadingModels(null);
    },
    [call, modelsShown],
  );

  const navActive = isActive && testingAgent === null && loadingModels === null;

  const { activeIndex } = useKeyboardNav({
    itemCount: agents.length,
    isActive: navActive,
    onSelect: (i) => {
      const agent = agents[i];
      if (agent) {
        void handleTestConnection(agent.id);
      }
    },
  });

  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (input === 't') {
        const agent = agents[activeIndex];
        if (agent) {
          void handleTestConnection(agent.id);
        }
      }
      if (input === 'm') {
        const agent = agents[activeIndex];
        if (agent) {
          void handleListModels(agent.id);
        }
      }
    },
    { isActive: navActive },
  );

  if (loading) {
    return <Spinner label="Loading CLI agents..." />;
  }

  if (agents.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No CLI agents configured.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {agents.map((agent, index) => {
        const isSelected = index === activeIndex && isActive;
        const isTesting = testingAgent === agent.id;
        const isLoadingModelsForAgent = loadingModels === agent.id;
        const testResult = testResults[agent.id];
        const models = modelsShown[agent.id];
        const statusBadge = getStatusBadge(agent);

        return (
          <Box key={agent.id} flexDirection="column">
            <ListItem
              label={agent.name}
              description={agent.providerName}
              isSelected={isSelected}
              badge={
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              }
              trailing={isTesting ? <Spinner label="Testing..." /> : undefined}
            />

            {testResult && !isTesting && (
              <Box marginLeft={4}>
                {testResult.success ? (
                  <Text color={theme.status.success}>
                    ✓ Connected
                    {testResult.latencyMs !== undefined
                      ? ` (${testResult.latencyMs}ms)`
                      : ''}
                  </Text>
                ) : (
                  <Text color={theme.status.error}>
                    ✗ Failed: {testResult.error ?? 'Unknown error'}
                  </Text>
                )}
              </Box>
            )}

            {isLoadingModelsForAgent && (
              <Box marginLeft={4}>
                <Spinner label="Loading models..." />
              </Box>
            )}

            {models && models.length > 0 && (
              <Box flexDirection="column" marginLeft={4}>
                <Text dimColor underline>
                  Models:
                </Text>
                {models.map((model) => (
                  <Box key={model.id}>
                    <Text dimColor> - {model.name || model.id}</Text>
                    {model.description && (
                      <Text color={theme.ui.dimmed}>
                        {' '}
                        ({model.description})
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {models && models.length === 0 && (
              <Box marginLeft={4}>
                <Text dimColor>No models available.</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter/T" label="test" />
        <KeyHint keys="M" label="list models" />
      </Box>
    </Box>
  );
}
