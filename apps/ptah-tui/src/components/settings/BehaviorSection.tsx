/**
 * BehaviorSection -- Autopilot and effort level configuration.
 *
 * Two configuration groups:
 *   1. Autopilot -- Enable/disable + permission level (ask, auto-edit, yolo, plan)
 *   2. Effort Level -- Reasoning effort (low, medium, high, max)
 *
 * Navigation: Up/Down within group, Enter to toggle/select, Tab to switch groups.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface AutopilotState {
  enabled: boolean;
  permissionLevel: string;
}

interface EffortState {
  effort: string | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERMISSION_LEVELS = [
  { id: 'ask', label: 'Ask', description: 'Prompt before every action' },
  {
    id: 'auto-edit',
    label: 'Auto-Edit',
    description: 'Auto-approve file edits',
  },
  { id: 'yolo', label: 'YOLO', description: 'Skip all permission prompts' },
  { id: 'plan', label: 'Plan', description: 'Plan-only mode (no edits)' },
] as const;

const EFFORT_LEVELS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
] as const;

type FocusGroup = 'autopilot' | 'effort';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BehaviorSectionProps {
  isActive: boolean;
}

export function BehaviorSection({
  isActive,
}: BehaviorSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();

  const [loading, setLoading] = useState(true);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState('ask');
  const [effort, setEffort] = useState<string>('medium');

  const [focusGroup, setFocusGroup] = useState<FocusGroup>('autopilot');
  // Index 0 = toggle row; indices 1..4 = permission levels
  const [autopilotIndex, setAutopilotIndex] = useState(0);
  const [effortIndex, setEffortIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadState(): Promise<void> {
      setLoading(true);

      const [autopilotResult, effortResult] = await Promise.all([
        call<void, AutopilotState>(
          'config:autopilot-get',
          undefined as unknown as void,
        ),
        call<Record<string, never>, EffortState>(
          'config:effort-get',
          {} as Record<string, never>,
        ),
      ]);

      if (cancelled) return;

      if (autopilotResult) {
        setAutopilotEnabled(autopilotResult.enabled);
        setPermissionLevel(autopilotResult.permissionLevel);
        const idx = PERMISSION_LEVELS.findIndex(
          (p) => p.id === autopilotResult.permissionLevel,
        );
        if (idx >= 0) {
          setAutopilotIndex(idx + 1);
        }
      }

      if (effortResult) {
        const currentEffort = effortResult.effort ?? 'medium';
        setEffort(currentEffort);
        const idx = EFFORT_LEVELS.findIndex((e) => e.id === currentEffort);
        if (idx >= 0) {
          setEffortIndex(idx);
        }
      }

      setLoading(false);
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleAutopilotToggle = useCallback(async (): Promise<void> => {
    const newEnabled = !autopilotEnabled;
    const result = await call<
      { enabled: boolean; permissionLevel: string },
      { enabled: boolean; permissionLevel: string }
    >('config:autopilot-toggle', {
      enabled: newEnabled,
      permissionLevel,
    });

    if (result) {
      setAutopilotEnabled(result.enabled);
      setPermissionLevel(result.permissionLevel);
    }
  }, [call, autopilotEnabled, permissionLevel]);

  const handlePermissionChange = useCallback(
    async (level: string): Promise<void> => {
      const result = await call<
        { enabled: boolean; permissionLevel: string },
        { enabled: boolean; permissionLevel: string }
      >('config:autopilot-toggle', {
        enabled: true,
        permissionLevel: level,
      });

      if (result) {
        setAutopilotEnabled(result.enabled);
        setPermissionLevel(result.permissionLevel);
      }
    },
    [call],
  );

  const handleEffortChange = useCallback(
    async (level: string): Promise<void> => {
      const result = await call<{ effort: string }, { effort: string }>(
        'config:effort-set',
        { effort: level },
      );

      if (result) {
        setEffort(result.effort);
      }
    },
    [call],
  );

  const autopilotItemCount = 1 + PERMISSION_LEVELS.length;

  useInput(
    (_input, key) => {
      if (key.tab) {
        setFocusGroup((prev) =>
          prev === 'autopilot' ? 'effort' : 'autopilot',
        );
        return;
      }

      if (focusGroup === 'autopilot') {
        if (key.upArrow) {
          setAutopilotIndex((prev) => Math.max(0, prev - 1));
        }
        if (key.downArrow) {
          setAutopilotIndex((prev) =>
            Math.min(autopilotItemCount - 1, prev + 1),
          );
        }
        if (key.return) {
          if (autopilotIndex === 0) {
            void handleAutopilotToggle();
          } else {
            const level = PERMISSION_LEVELS[autopilotIndex - 1];
            if (level) {
              void handlePermissionChange(level.id);
            }
          }
        }
      } else {
        if (key.upArrow) {
          setEffortIndex((prev) => Math.max(0, prev - 1));
        }
        if (key.downArrow) {
          setEffortIndex((prev) =>
            Math.min(EFFORT_LEVELS.length - 1, prev + 1),
          );
        }
        if (key.return) {
          const level = EFFORT_LEVELS[effortIndex];
          if (level) {
            void handleEffortChange(level.id);
          }
        }
      }
    },
    { isActive },
  );

  if (loading) {
    return <Spinner label="Loading behavior settings..." />;
  }

  const isAutopilotFocused = focusGroup === 'autopilot' && isActive;
  const isEffortFocused = focusGroup === 'effort' && isActive;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text
          bold
          color={isAutopilotFocused ? theme.ui.accent : undefined}
          underline
        >
          Autopilot
        </Text>

        <Box gap={1}>
          <Text
            bold={isAutopilotFocused && autopilotIndex === 0}
            inverse={isAutopilotFocused && autopilotIndex === 0}
          >
            {isAutopilotFocused && autopilotIndex === 0 ? '> ' : '  '}
            Enabled:
          </Text>
          <Badge variant={autopilotEnabled ? 'success' : 'ghost'}>
            {autopilotEnabled ? 'ON' : 'OFF'}
          </Badge>
        </Box>

        {PERMISSION_LEVELS.map((level, index) => {
          const itemIndex = index + 1;
          const isSelected = isAutopilotFocused && autopilotIndex === itemIndex;
          const isCurrentLevel = level.id === permissionLevel;

          return (
            <ListItem
              key={level.id}
              label={level.label}
              description={level.description}
              isSelected={isSelected}
              isCurrent={isCurrentLevel}
            />
          );
        })}
      </Box>

      <Box flexDirection="column">
        <Text
          bold
          color={isEffortFocused ? theme.ui.accent : undefined}
          underline
        >
          Effort Level
        </Text>

        {EFFORT_LEVELS.map((level, index) => {
          const isSelected = isEffortFocused && effortIndex === index;
          const isCurrentLevel = level.id === effort;

          return (
            <ListItem
              key={level.id}
              label={level.label}
              isSelected={isSelected}
              isCurrent={isCurrentLevel}
            />
          );
        })}
      </Box>

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="toggle/select" />
        <KeyHint keys="Tab" label="switch group" />
      </Box>
    </Box>
  );
}
