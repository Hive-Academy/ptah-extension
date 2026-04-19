/**
 * AgentMonitor -- Real-time agent process status display in the sidebar.
 *
 * Subscribes to backend push events to track CLI agent processes:
 *   - agent-monitor:spawned -- New agent started (streaming spinner)
 *   - agent-monitor:output  -- Agent produced output (updates last output line)
 *   - agent-monitor:exited  -- Agent finished (checkmark) or failed (X)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';

import { useTuiContext } from '../../context/TuiContext.js';
import { StatusBadge } from '../atoms/index.js';
import type { ExecutionStatus } from '../atoms/index.js';

interface AgentProcess {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  lastOutput?: string;
}

interface AgentSpawnedPayload {
  agentId?: string;
  cli?: string;
  task?: string;
}

interface AgentOutputPayload {
  agentId?: string;
  stdoutDelta?: string;
  stderrDelta?: string;
}

interface AgentExitedPayload {
  agentId?: string;
  status?: string;
  exitCode?: number;
}

function deriveAgentName(payload: AgentSpawnedPayload): string {
  const cli = payload.cli ?? 'agent';
  const task = payload.task;
  if (task && task.length > 30) {
    return `${cli}: ${task.slice(0, 27)}...`;
  }
  return task ? `${cli}: ${task}` : cli;
}

function extractLastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return '';
  return last.length > 40 ? `${last.slice(0, 37)}...` : last;
}

function mapStatus(status: AgentProcess['status']): ExecutionStatus {
  if (status === 'running') return 'streaming';
  if (status === 'error') return 'error';
  return 'complete';
}

export function AgentMonitor(): React.JSX.Element {
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
            <StatusBadge status={mapStatus(agent.status)} />
            <Text>{agent.name}</Text>
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
