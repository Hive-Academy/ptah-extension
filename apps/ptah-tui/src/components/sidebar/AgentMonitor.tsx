/**
 * AgentMonitor -- Real-time agent process status display in the sidebar.
 *
 * TASK_2025_263 Batch 4
 *
 * Subscribes to backend push events to track CLI agent processes:
 *   - agent-monitor:spawned -- New agent started (green spinner)
 *   - agent-monitor:output  -- Agent produced output (updates last output line)
 *   - agent-monitor:exited  -- Agent finished (checkmark) or failed (X)
 *
 * Shows each agent with a color-coded status indicator and name.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

import { useTuiContext } from '../../context/TuiContext.js';
import { Spinner } from '../common/Spinner.js';

interface AgentProcess {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  lastOutput?: string;
}

/** Payload shape for agent-monitor:spawned push events. */
interface AgentSpawnedPayload {
  agentId?: string;
  cli?: string;
  task?: string;
}

/** Payload shape for agent-monitor:output push events. */
interface AgentOutputPayload {
  agentId?: string;
  stdoutDelta?: string;
  stderrDelta?: string;
}

/** Payload shape for agent-monitor:exited push events. */
interface AgentExitedPayload {
  agentId?: string;
  status?: string;
  exitCode?: number;
}

/**
 * Derive a short display name from agent info.
 * Uses CLI type and truncated task description.
 */
function deriveAgentName(payload: AgentSpawnedPayload): string {
  const cli = payload.cli ?? 'agent';
  const task = payload.task;
  if (task && task.length > 30) {
    return `${cli}: ${task.slice(0, 27)}...`;
  }
  return task ? `${cli}: ${task}` : cli;
}

/**
 * Extract the last meaningful line from output delta text.
 */
function extractLastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return '';
  // Truncate long lines for sidebar display
  return last.length > 40 ? `${last.slice(0, 37)}...` : last;
}

export function AgentMonitor(): React.JSX.Element {
  const theme = useTheme();
  const { pushAdapter } = useTuiContext();
  const [agents, setAgents] = useState<AgentProcess[]>([]);

  const handleSpawned = useCallback((payload: unknown): void => {
    const data = payload as AgentSpawnedPayload;
    if (!data.agentId) return;

    const newAgent: AgentProcess = {
      id: data.agentId,
      name: deriveAgentName(data),
      status: 'running',
    };

    setAgents((prev) => {
      // Avoid duplicates
      if (prev.some((a) => a.id === data.agentId)) return prev;
      return [...prev, newAgent];
    });
  }, []);

  const handleOutput = useCallback((payload: unknown): void => {
    const data = payload as AgentOutputPayload;
    if (!data.agentId) return;

    const outputText = data.stdoutDelta ?? data.stderrDelta ?? '';
    if (outputText.length === 0) return;

    const lastLine = extractLastLine(outputText);
    if (lastLine.length === 0) return;

    setAgents((prev) =>
      prev.map((agent) =>
        agent.id === data.agentId ? { ...agent, lastOutput: lastLine } : agent,
      ),
    );
  }, []);

  const handleExited = useCallback((payload: unknown): void => {
    const data = payload as AgentExitedPayload;
    if (!data.agentId) return;

    const isError =
      data.status === 'failed' ||
      data.status === 'timeout' ||
      (data.exitCode !== undefined && data.exitCode !== 0);

    const agentId = data.agentId;

    setAgents((prev) =>
      prev.map((agent) =>
        agent.id === agentId
          ? { ...agent, status: isError ? 'error' : 'completed' }
          : agent,
      ),
    );

    // Auto-cleanup: remove completed/errored agents after 30 seconds
    // to prevent unbounded growth of the agent list (WARNING-1 fix).
    setTimeout(() => {
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
    }, 30_000);
  }, []);

  useEffect(() => {
    pushAdapter.on('agent-monitor:spawned', handleSpawned);
    pushAdapter.on('agent-monitor:output', handleOutput);
    pushAdapter.on('agent-monitor:exited', handleExited);

    return () => {
      pushAdapter.off('agent-monitor:spawned', handleSpawned);
      pushAdapter.off('agent-monitor:output', handleOutput);
      pushAdapter.off('agent-monitor:exited', handleExited);
    };
  }, [pushAdapter, handleSpawned, handleOutput, handleExited]);

  if (agents.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No active agents</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {agents.map((agent) => (
        <Box key={agent.id} flexDirection="column">
          <Box gap={1}>
            {agent.status === 'running' && <Spinner />}
            {agent.status === 'completed' && (
              <Text color={theme.status.success} bold>
                {'✓'}
              </Text>
            )}
            {agent.status === 'error' && (
              <Text color={theme.status.error} bold>
                {'✗'}
              </Text>
            )}
            <Text
              color={
                agent.status === 'running'
                  ? theme.status.success
                  : agent.status === 'error'
                    ? theme.status.error
                    : theme.status.success
              }
            >
              {agent.name}
            </Text>
          </Box>
          {agent.lastOutput && agent.status === 'running' && (
            <Box paddingLeft={3}>
              <Text dimColor wrap="truncate">
                {agent.lastOutput}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
