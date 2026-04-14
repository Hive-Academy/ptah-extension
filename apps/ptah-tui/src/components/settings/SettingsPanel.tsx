/**
 * SettingsPanel -- Seven-section settings panel for the TUI.
 *
 * Sections:
 *   0. Authentication -- Full provider selection + auth config
 *   1. Model Config   -- Shows current model, allows switching
 *   2. License        -- View license status, enter/clear key
 *   3. Behavior       -- Autopilot toggle and effort level configuration
 *   4. Web Search     -- Web search API key management and testing
 *   5. Plugins        -- Plugin list with enable/disable toggle
 *   6. CLI Agents     -- CLI agent detection, testing, and model listing
 *
 * Navigation: Tab to cycle sections, arrows within a section.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Panel, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import { AuthSection } from './AuthSection.js';
import { LicenseSection } from './LicenseSection.js';
import { BehaviorSection } from './BehaviorSection.js';
import { WebSearchSection } from './WebSearchSection.js';
import { PluginsSection } from './PluginsSection.js';
import { CliAgentsSection } from './CliAgentsSection.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  name: string;
  description: string;
  apiName: string;
  isSelected: boolean;
  isRecommended: boolean;
  tier: string | null;
}

// ---------------------------------------------------------------------------
// Section 1: Model Configuration
// ---------------------------------------------------------------------------

interface ModelSectionProps {
  isActive: boolean;
}

function ModelSection({ isActive }: ModelSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadModels(): Promise<void> {
      setLoading(true);
      setError(null);
      const result = await call<void, { models: ModelEntry[] }>(
        'config:models-list',
        undefined as unknown as void,
      );

      if (cancelled) return;

      if (result && result.models.length > 0) {
        setModels(result.models);
      } else {
        setError('No models available. Check your API key configuration.');
      }
      setLoading(false);
    }

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleSelect = useCallback(
    async (index: number): Promise<void> => {
      const model = models[index];
      if (!model) return;
      const result = await call<{ model: string }, { model: string }>(
        'config:model-switch',
        { model: model.id },
      );
      if (result) {
        setModels((prev) =>
          prev.map((m) => ({ ...m, isSelected: m.id === model.id })),
        );
      }
    },
    [call, models],
  );

  const initialIndex = Math.max(
    0,
    models.findIndex((m) => m.isSelected),
  );

  const { activeIndex } = useKeyboardNav({
    itemCount: models.length,
    isActive,
    initialIndex,
    onSelect: (i) => {
      void handleSelect(i);
    },
  });

  if (loading) {
    return <Spinner label="Loading models..." />;
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>{error}</Text>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No models available.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {models.map((model, index) => (
        <ListItem
          key={model.id}
          label={model.name || model.id}
          description={model.description || undefined}
          isSelected={index === activeIndex && isActive}
          isCurrent={model.isSelected}
          badge={
            model.isRecommended && !model.isSelected ? (
              <Badge variant="warning">★</Badge>
            ) : undefined
          }
        />
      ))}
      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="select" />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPanel
// ---------------------------------------------------------------------------

const SECTION_TITLES = [
  'Authentication',
  'Model Configuration',
  'License',
  'Behavior',
  'Web Search',
  'Plugins',
  'CLI Agents',
] as const;
const SECTION_COUNT = SECTION_TITLES.length;

interface SettingsPanelProps {
  modalActive?: boolean;
}

export function SettingsPanel({
  modalActive = false,
}: SettingsPanelProps): React.JSX.Element {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState(0);

  useInput(
    (_input, key) => {
      if (key.tab) {
        setActiveSection((prev) => (prev + 1) % SECTION_COUNT);
      }
    },
    { isActive: !modalActive },
  );

  const renderActiveSection = (): React.JSX.Element => {
    switch (activeSection) {
      case 0:
        return <AuthSection isActive={!modalActive} />;
      case 1:
        return <ModelSection isActive={!modalActive} />;
      case 2:
        return <LicenseSection isActive={!modalActive} />;
      case 3:
        return <BehaviorSection isActive={!modalActive} />;
      case 4:
        return <WebSearchSection isActive={!modalActive} />;
      case 5:
        return <PluginsSection isActive={!modalActive} />;
      case 6:
        return <CliAgentsSection isActive={!modalActive} />;
      default:
        return <Box />;
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold color={theme.ui.accent}>
          Settings
        </Text>
        <KeyHint keys="Tab" label="switch section" />
        <KeyHint keys="Esc" label="return" />
      </Box>

      <Box marginBottom={1} gap={1}>
        {SECTION_TITLES.map((title, i) => (
          <Text
            key={title}
            bold={i === activeSection}
            color={i === activeSection ? theme.ui.accent : theme.ui.dimmed}
          >
            {i === activeSection ? `[ ${title} ]` : title}
          </Text>
        ))}
      </Box>

      <Panel
        title={SECTION_TITLES[activeSection]}
        isActive
        padding={1}
        flexGrow={1}
      >
        {renderActiveSection()}
      </Panel>
    </Box>
  );
}
