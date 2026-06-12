import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import {
  useThothStatus,
  type ThothStatusObservable,
  type ThothPushAdapter,
  type ThothBadge,
  type ThothBadgeTone,
} from '../../hooks/use-thoth-status.js';
import { KeyHint } from '../atoms/KeyHint.js';
import { MemoryPanel } from './MemoryPanel.js';
import { SkillsPanel } from './SkillsPanel.js';
import { SchedulesPanel } from './SchedulesPanel.js';
import { GatewayPanel } from './GatewayPanel.js';

export type ThothTabId = 'memory' | 'skills' | 'cron' | 'gateway';

interface ThothTabDef {
  readonly id: ThothTabId;
  readonly label: string;
}

const TABS: readonly ThothTabDef[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: 'Schedules' },
  { id: 'gateway', label: 'Gateway' },
];

export interface ThothPanelProps {
  lifecycle: ThothStatusObservable;
  pushAdapter: ThothPushAdapter;
  isActive: boolean;
}

function toneColor(tone: ThothBadgeTone, theme: ReturnType<typeof useTheme>): string {
  switch (tone) {
    case 'success':
      return theme.status.success;
    case 'warning':
      return theme.status.warning;
    case 'error':
      return theme.status.error;
    case 'info':
    default:
      return theme.status.info;
  }
}

function StatusDot({ badge }: { badge: ThothBadge }): React.JSX.Element {
  const theme = useTheme();
  const color = toneColor(badge.tone, theme);
  return (
    <Box marginRight={2}>
      <Text color={color}>{badge.dot} </Text>
      <Text color={color}>{badge.text}</Text>
      {badge.reason ? <Text dimColor> ({badge.reason})</Text> : null}
    </Box>
  );
}

export function ThothPanel({
  lifecycle,
  pushAdapter,
  isActive,
}: ThothPanelProps): React.JSX.Element {
  const theme = useTheme();
  const status = useThothStatus(lifecycle, pushAdapter);
  const [activeTab, setActiveTab] = useState<ThothTabId>('memory');

  const cycle = useCallback((direction: 1 | -1) => {
    setActiveTab((current) => {
      const index = TABS.findIndex((t) => t.id === current);
      const next = (index + direction + TABS.length) % TABS.length;
      return TABS[next].id;
    });
  }, []);

  useInput(
    (_input, key) => {
      if (key.tab) {
        cycle(key.shift ? -1 : 1);
      }
    },
    { isActive },
  );

  const activating = status.status === 'activating' || status.status === 'idle';
  const activeBadge = status.badges[activeTab];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1}>
        {TABS.map((tab, index) => {
          const selected = tab.id === activeTab;
          return (
            <Box key={tab.id} marginRight={2}>
              <Text
                color={selected ? theme.ui.accent : theme.ui.dimmed}
                bold={selected}
                underline={selected}
              >
                {selected ? '> ' : '  '}
                {tab.label}
              </Text>
              {index < TABS.length - 1 ? (
                <Text color={theme.ui.border}> │</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box marginBottom={1} flexWrap="wrap">
        {(Object.keys(status.badges) as Array<keyof typeof status.badges>).map(
          (key) => (
            <StatusDot key={key} badge={status.badges[key]} />
          ),
        )}
      </Box>

      {status.status === 'failed' && status.error ? (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>
            Thoth activation failed — {status.error}. Chat remains available.
          </Text>
        </Box>
      ) : null}

      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.ui.border}
        paddingX={1}
      >
        {activating ? (
          <Text color={theme.status.info}>Activating Thoth subsystems…</Text>
        ) : (
          <ThothTabBody tab={activeTab} badge={activeBadge} isActive={isActive} />
        )}
      </Box>

      <Box marginTop={1}>
        <KeyHint keys="Tab" label="next tab" />
        <KeyHint keys="Shift+Tab" label="prev tab" separator />
        <KeyHint keys="Esc" label="back to chat" separator />
      </Box>
    </Box>
  );
}

interface ThothTabBodyProps {
  tab: ThothTabId;
  badge: ThothBadge | undefined;
  isActive: boolean;
}

function ThothTabBody({
  tab,
  badge,
  isActive,
}: ThothTabBodyProps): React.JSX.Element {
  const degraded = badge
    ? badge.tone === 'warning' || badge.tone === 'error'
    : false;
  const reason = badge?.reason;

  switch (tab) {
    case 'memory':
      return (
        <MemoryPanel isActive={isActive} degraded={degraded} reason={reason} />
      );
    case 'skills':
      return (
        <SkillsPanel isActive={isActive} degraded={degraded} reason={reason} />
      );
    case 'cron':
      return (
        <SchedulesPanel
          isActive={isActive}
          degraded={degraded}
          reason={reason}
        />
      );
    case 'gateway':
    default:
      return (
        <GatewayPanel isActive={isActive} degraded={degraded} reason={reason} />
      );
  }
}

export default ThothPanel;
