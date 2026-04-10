/**
 * BehaviorSection -- Autopilot and effort level configuration for the TUI settings panel.
 *
 * TASK_2025_266 Batch 6
 *
 * Two configuration groups:
 *   1. Autopilot -- Enable/disable and permission level selection (ask, auto-edit, yolo, plan)
 *   2. Effort Level -- Reasoning effort (low, medium, high, max)
 *
 * Navigation:
 *   - Up/Down: Navigate options within the active group
 *   - Enter: Toggle/select the highlighted option
 *   - Tab: Switch between Autopilot and Effort groups
 *
 * Uses useRpc() for backend communication (config:autopilot-get/toggle, config:effort-get/set).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';
import { useTheme } from '../../hooks/use-theme.js';

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

  // Autopilot state
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState('ask');

  // Effort state
  const [effort, setEffort] = useState<string>('medium');

  // Navigation state
  const [focusGroup, setFocusGroup] = useState<FocusGroup>('autopilot');
  // Index 0 = toggle row; indices 1..4 = permission levels
  const [autopilotIndex, setAutopilotIndex] = useState(0);
  const [effortIndex, setEffortIndex] = useState(0);

  // Load initial state
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
          // +1 because index 0 is the toggle row
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

  // Total navigable items in autopilot group: 1 (toggle) + permission levels
  const autopilotItemCount = 1 + PERMISSION_LEVELS.length;

  useInput(
    (_input, key) => {
      // Tab switches focus group
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
            // Toggle autopilot on/off
            void handleAutopilotToggle();
          } else {
            // Select permission level
            const level = PERMISSION_LEVELS[autopilotIndex - 1];
            if (level) {
              void handlePermissionChange(level.id);
            }
          }
        }
      } else {
        // Effort group
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
      {/* Autopilot group */}
      <Box flexDirection="column" marginBottom={1}>
        <Text
          bold
          color={isAutopilotFocused ? theme.ui.accent : undefined}
          underline
        >
          Autopilot
        </Text>

        {/* Toggle row */}
        <Box>
          <Text
            bold={isAutopilotFocused && autopilotIndex === 0}
            inverse={isAutopilotFocused && autopilotIndex === 0}
            dimColor={!isAutopilotFocused && autopilotIndex !== 0}
          >
            {isAutopilotFocused && autopilotIndex === 0 ? '> ' : '  '}
            Enabled:{' '}
          </Text>
          {autopilotEnabled ? (
            <Text bold color={theme.status.success}>
              [ON]
            </Text>
          ) : (
            <Text dimColor>[OFF]</Text>
          )}
        </Box>

        {/* Permission levels */}
        {PERMISSION_LEVELS.map((level, index) => {
          const itemIndex = index + 1;
          const isSelected = isAutopilotFocused && autopilotIndex === itemIndex;
          const isCurrentLevel = level.id === permissionLevel;

          return (
            <Box key={level.id}>
              <Text
                bold={isSelected || isCurrentLevel}
                inverse={isSelected}
                color={isCurrentLevel ? theme.ui.accent : undefined}
                dimColor={!isSelected && !isCurrentLevel}
              >
                {isSelected ? '> ' : '  '}
                {level.label}
              </Text>
              {isCurrentLevel && (
                <Text color={theme.status.success}> [active]</Text>
              )}
              <Text dimColor> - {level.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Effort level group */}
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
            <Box key={level.id}>
              <Text
                bold={isSelected || isCurrentLevel}
                inverse={isSelected}
                color={isCurrentLevel ? theme.ui.accent : undefined}
                dimColor={!isSelected && !isCurrentLevel}
              >
                {isSelected ? '> ' : '  '}
                {level.label}
              </Text>
              {isCurrentLevel && (
                <Text color={theme.status.success}> [active]</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: toggle/select | Up/Down: navigate | Tab: switch group
        </Text>
      </Box>
    </Box>
  );
}
