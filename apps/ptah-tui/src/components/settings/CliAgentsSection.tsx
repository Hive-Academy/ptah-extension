/**
 * CliAgentsSection -- CLI agent detection, testing, and model listing for the TUI settings panel.
 *
 * TASK_2025_266 Batch 7
 *
 * Displays all configured CLI agents with their provider, status,
 * and provides actions to test connectivity and list available models.
 *
 * Navigation:
 *   - Up/Down: Navigate agent list
 *   - Enter or T: Test connection for selected agent
 *   - M: Toggle model list display for selected agent
 *
 * Uses useRpc() for backend communication (ptahCli:list, ptahCli:testConnection,
 * ptahCli:listModels).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';
import { useTheme } from '../../hooks/use-theme.js';

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

export function CliAgentsSection({
  isActive,
}: CliAgentsSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [agents, setAgents] = useState<CliAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [testingAgent, setTestingAgent] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestResultEntry>
  >({});
  const [modelsShown, setModelsShown] = useState<Record<string, ModelEntry[]>>(
    {},
  );

  // Load agents on mount
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
      // Toggle off if already shown
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

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(agents.length - 1, prev + 1));
      }

      // Enter or 't' to test connection
      if (key.return || (input === 't' && !key.ctrl && !key.meta)) {
        const agent = agents[selectedIndex];
        if (agent) {
          void handleTestConnection(agent.id);
        }
      }

      // 'm' to toggle model list
      if (input === 'm' && !key.ctrl && !key.meta) {
        const agent = agents[selectedIndex];
        if (agent) {
          void handleListModels(agent.id);
        }
      }
    },
    { isActive: isActive && testingAgent === null && loadingModels === null },
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

  /**
   * Map the agent status string to a display label and color.
   */
  function getStatusDisplay(agent: CliAgent): { label: string; color: string } {
    if (agent.status === 'available' && agent.hasApiKey) {
      return { label: 'connected', color: theme.status.success };
    }
    if (agent.status === 'error') {
      return { label: 'disconnected', color: theme.status.error };
    }
    if (!agent.hasApiKey || agent.status === 'unconfigured') {
      return { label: 'not installed', color: theme.ui.dimmed };
    }
    if (agent.status === 'initializing') {
      return { label: 'initializing', color: theme.status.warning };
    }
    return { label: agent.status ?? 'unknown', color: theme.ui.dimmed };
  }

  return (
    <Box flexDirection="column">
      {agents.map((agent, index) => {
        const isSelected = index === selectedIndex && isActive;
        const isTesting = testingAgent === agent.id;
        const isLoadingModelsForAgent = loadingModels === agent.id;
        const testResult = testResults[agent.id];
        const models = modelsShown[agent.id];
        const statusDisplay = getStatusDisplay(agent);

        return (
          <Box key={agent.id} flexDirection="column">
            <Box>
              <Text
                bold={isSelected}
                inverse={isSelected}
                dimColor={!isSelected}
              >
                {isSelected ? '> ' : '  '}
                {agent.name}
              </Text>
              {agent.providerName && (
                <Text color={theme.ui.dimmed}> {agent.providerName}</Text>
              )}
              <Text> </Text>
              <Text color={statusDisplay.color}>[{statusDisplay.label}]</Text>
              {isTesting && (
                <Box marginLeft={1}>
                  <Spinner label="Testing..." />
                </Box>
              )}
            </Box>

            {/* Inline test result */}
            {testResult && !isTesting && (
              <Box marginLeft={4}>
                {testResult.success ? (
                  <Text color={theme.status.success}>
                    Connected
                    {testResult.latencyMs !== undefined
                      ? ` (${testResult.latencyMs}ms)`
                      : ''}
                  </Text>
                ) : (
                  <Text color={theme.status.error}>
                    Failed: {testResult.error ?? 'Unknown error'}
                  </Text>
                )}
              </Box>
            )}

            {/* Model list loading */}
            {isLoadingModelsForAgent && (
              <Box marginLeft={4}>
                <Spinner label="Loading models..." />
              </Box>
            )}

            {/* Inline model list */}
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

      <Box marginTop={1}>
        <Text dimColor italic>
          Enter/T: test connection | M: list models | Up/Down: navigate
        </Text>
      </Box>
    </Box>
  );
}
