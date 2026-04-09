/**
 * SettingsPanel -- Three-section settings panel for the TUI.
 *
 * TASK_2025_263 Batch 4
 *
 * Sections:
 *   0. API Keys      -- Shows key status per provider, allows entry via ink-text-input
 *   1. Provider       -- Lists available LLM providers, allows selection
 *   2. Model Config   -- Shows current model, allows switching from available models
 *
 * Navigation:
 *   - Tab:   Cycle between sections
 *   - Up/Down: Navigate within a section
 *   - Enter: Confirm selection
 *   - Escape: Handled by parent (switches back to chat)
 *
 * Uses useRpc() for all backend communication and useTuiContext() for transport.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { Spinner } from '../common/Spinner.js';

// ---------------------------------------------------------------------------
// Types for RPC responses
// ---------------------------------------------------------------------------

interface ProviderStatus {
  name: string;
  displayName: string;
  hasApiKey: boolean;
  isDefault: boolean;
}

interface ModelEntry {
  id: string;
  name: string;
  description: string;
  apiName: string;
  isSelected: boolean;
  isRecommended: boolean;
  tier: string | null;
}

// Provider definitions for the API Keys section
const API_KEY_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openrouter', label: 'OpenRouter' },
] as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SectionBoxProps {
  title: string;
  isActive: boolean;
  children: React.ReactNode;
}

function SectionBox({
  title,
  isActive,
  children,
}: SectionBoxProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isActive ? 'cyan' : 'gray'}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={isActive ? 'cyan' : 'white'}>
        {isActive ? '> ' : '  '}
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 0: API Keys
// ---------------------------------------------------------------------------

interface ApiKeysSectionProps {
  isActive: boolean;
}

function ApiKeysSection({ isActive }: ApiKeysSectionProps): React.JSX.Element {
  const { call } = useRpc();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Load provider statuses on mount
  useEffect(() => {
    let cancelled = false;

    async function loadStatuses(): Promise<void> {
      setLoading(true);
      const result = await call<void, { providers: ProviderStatus[] }>(
        'llm:getProviderStatus',
        undefined as unknown as void,
      );
      if (!cancelled && result) {
        setStatuses(result.providers);
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [call]);

  const handleSaveKey = useCallback(
    async (provider: string, apiKey: string): Promise<void> => {
      if (!apiKey.trim()) {
        setEditingProvider(null);
        setInputValue('');
        return;
      }

      setSaving(true);
      const result = await call<
        { provider: string; apiKey: string },
        { success: boolean; error?: string }
      >('llm:setApiKey', { provider, apiKey: apiKey.trim() });

      if (result?.success) {
        // Refresh statuses after saving
        const refreshed = await call<void, { providers: ProviderStatus[] }>(
          'llm:getProviderStatus',
          undefined as unknown as void,
        );
        if (refreshed) {
          setStatuses(refreshed.providers);
        }
      }

      setSaving(false);
      setEditingProvider(null);
      setInputValue('');
    },
    [call],
  );

  useInput(
    (input, key) => {
      // If editing, Enter submits, Escape cancels
      if (editingProvider !== null) {
        if (key.escape) {
          setEditingProvider(null);
          setInputValue('');
        }
        // Enter is handled by TextInput onSubmit
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) =>
          Math.min(API_KEY_PROVIDERS.length - 1, prev + 1),
        );
      }
      if (key.return) {
        const provider = API_KEY_PROVIDERS[selectedIndex];
        if (provider) {
          setEditingProvider(provider.id);
          setInputValue('');
        }
      }

      // 'r' to remove a key
      if (input === 'r' && !key.ctrl && !key.meta) {
        const provider = API_KEY_PROVIDERS[selectedIndex];
        if (provider) {
          void call<{ provider: string }, { success: boolean }>(
            'llm:removeApiKey',
            { provider: provider.id },
          ).then(async () => {
            const refreshed = await call<void, { providers: ProviderStatus[] }>(
              'llm:getProviderStatus',
              undefined as unknown as void,
            );
            if (refreshed) {
              setStatuses(refreshed.providers);
            }
          });
        }
      }
    },
    { isActive: isActive && !saving },
  );

  if (loading) {
    return <Spinner label="Loading API key status..." />;
  }

  return (
    <Box flexDirection="column">
      {API_KEY_PROVIDERS.map((provider, index) => {
        const status = statuses.find((s) => s.name === provider.id);
        const isSelected = index === selectedIndex && isActive;
        const isEditing = editingProvider === provider.id;

        return (
          <Box key={provider.id} flexDirection="column">
            <Box>
              <Text
                bold={isSelected}
                inverse={isSelected && !isEditing}
                color={isSelected ? 'white' : undefined}
                dimColor={!isSelected}
              >
                {isSelected ? '> ' : '  '}
                {provider.label}:{' '}
              </Text>
              {status?.hasApiKey ? (
                <Text color="green">Configured</Text>
              ) : (
                <Text color="red">Not configured</Text>
              )}
              {status?.isDefault && <Text color="cyan"> (default)</Text>}
            </Box>
            {isEditing && (
              <Box marginLeft={4} marginTop={0}>
                {saving ? (
                  <Spinner label="Saving..." />
                ) : (
                  <Box>
                    <Text color="yellow">Key: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={(val) => {
                        void handleSaveKey(provider.id, val);
                      }}
                      placeholder="Paste API key and press Enter"
                      focus={true}
                      mask="*"
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: edit key | R: remove | Up/Down: navigate
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 1: Provider Selection
// ---------------------------------------------------------------------------

interface ProviderSectionProps {
  isActive: boolean;
}

function ProviderSection({
  isActive,
}: ProviderSectionProps): React.JSX.Element {
  const { call } = useRpc();
  const [defaultProvider, setDefaultProvider] = useState<string>('anthropic');
  const [providers] = useState<Array<{ id: string; label: string }>>([
    { id: 'anthropic', label: 'Anthropic (Claude)' },
    { id: 'openrouter', label: 'OpenRouter' },
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDefault(): Promise<void> {
      setLoading(true);
      const result = await call<void, { provider: string }>(
        'llm:getDefaultProvider',
        undefined as unknown as void,
      );
      if (!cancelled && result) {
        setDefaultProvider(result.provider);
        const idx = providers.findIndex((p) => p.id === result.provider);
        if (idx >= 0) {
          setSelectedIndex(idx);
        }
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    void loadDefault();
    return () => {
      cancelled = true;
    };
  }, [call, providers]);

  const handleSelect = useCallback(
    async (providerId: string): Promise<void> => {
      const result = await call<{ provider: string }, { success: boolean }>(
        'llm:setDefaultProvider',
        { provider: providerId },
      );
      if (result?.success) {
        setDefaultProvider(providerId);
      }
    },
    [call],
  );

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(providers.length - 1, prev + 1));
      }
      if (key.return) {
        const provider = providers[selectedIndex];
        if (provider) {
          void handleSelect(provider.id);
        }
      }
    },
    { isActive },
  );

  if (loading) {
    return <Spinner label="Loading provider info..." />;
  }

  return (
    <Box flexDirection="column">
      {providers.map((provider, index) => {
        const isSelected = index === selectedIndex && isActive;
        const isDefault = provider.id === defaultProvider;

        return (
          <Box key={provider.id}>
            <Text
              bold={isSelected || isDefault}
              inverse={isSelected}
              color={isDefault ? 'cyan' : isSelected ? 'white' : undefined}
              dimColor={!isSelected && !isDefault}
            >
              {isSelected ? '> ' : '  '}
              {provider.label}
            </Text>
            {isDefault && <Text color="green"> [active]</Text>}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: set as default | Up/Down: navigate
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Model Configuration
// ---------------------------------------------------------------------------

interface ModelSectionProps {
  isActive: boolean;
}

function ModelSection({ isActive }: ModelSectionProps): React.JSX.Element {
  const { call } = useRpc();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
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
        // Find currently selected model and position cursor there
        const currentIdx = result.models.findIndex((m) => m.isSelected);
        if (currentIdx >= 0) {
          setSelectedIndex(currentIdx);
        }
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
    async (modelId: string): Promise<void> => {
      const result = await call<{ model: string }, { model: string }>(
        'config:model-switch',
        { model: modelId },
      );
      if (result) {
        // Update local state to reflect selection
        setModels((prev) =>
          prev.map((m) => ({ ...m, isSelected: m.id === modelId })),
        );
      }
    },
    [call],
  );

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(models.length - 1, prev + 1));
      }
      if (key.return) {
        const model = models[selectedIndex];
        if (model) {
          void handleSelect(model.id);
        }
      }
    },
    { isActive },
  );

  if (loading) {
    return <Spinner label="Loading models..." />;
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">{error}</Text>
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
      {models.map((model, index) => {
        const isSelected = index === selectedIndex && isActive;
        const isCurrent = model.isSelected;

        return (
          <Box key={model.id}>
            <Text
              bold={isSelected || isCurrent}
              inverse={isSelected}
              color={isCurrent ? 'cyan' : isSelected ? 'white' : undefined}
              dimColor={!isSelected && !isCurrent}
            >
              {isSelected ? '> ' : '  '}
              {model.name || model.id}
            </Text>
            {isCurrent && <Text color="green"> [current]</Text>}
            {model.isRecommended && !isCurrent && (
              <Text color="yellow"> *</Text>
            )}
            {model.description && <Text dimColor> - {model.description}</Text>}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: select model | Up/Down: navigate | * = recommended
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPanel
// ---------------------------------------------------------------------------

const SECTION_TITLES = ['API Keys', 'Provider', 'Model Configuration'] as const;
const SECTION_COUNT = SECTION_TITLES.length;

interface SettingsPanelProps {
  /** When true, a modal overlay is active and keyboard input should be suppressed. */
  modalActive?: boolean;
}

export function SettingsPanel({
  modalActive = false,
}: SettingsPanelProps): React.JSX.Element {
  const [activeSection, setActiveSection] = useState(0);

  useInput(
    (_input, key) => {
      if (key.tab) {
        setActiveSection((prev) => (prev + 1) % SECTION_COUNT);
      }
    },
    { isActive: !modalActive },
  );

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Settings
        </Text>
        <Text dimColor> (Tab to switch sections, Escape to return)</Text>
      </Box>

      <SectionBox title={SECTION_TITLES[0]} isActive={activeSection === 0}>
        <ApiKeysSection isActive={activeSection === 0 && !modalActive} />
      </SectionBox>

      <SectionBox title={SECTION_TITLES[1]} isActive={activeSection === 1}>
        <ProviderSection isActive={activeSection === 1 && !modalActive} />
      </SectionBox>

      <SectionBox title={SECTION_TITLES[2]} isActive={activeSection === 2}>
        <ModelSection isActive={activeSection === 2 && !modalActive} />
      </SectionBox>
    </Box>
  );
}
