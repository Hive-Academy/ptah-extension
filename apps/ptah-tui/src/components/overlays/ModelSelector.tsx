/**
 * ModelSelector -- Modal model/provider selector (Ctrl+M).
 *
 * TASK_2025_266 Batch 5
 *
 * Self-contained modal that manages its own RPC calls for:
 *   - Fetching the current provider (llm:getDefaultProvider)
 *   - Fetching models for the active provider (config:models-list)
 *   - Fetching provider API key status (llm:getProviderStatus)
 *   - Switching providers (llm:setDefaultProvider)
 *   - Switching models (config:model-switch)
 *
 * Pushed onto the modal stack in App.tsx and rendered inside ModalOverlay.
 *
 * Keyboard:
 *   Tab     - Cycle between providers
 *   Up/Down - Navigate models
 *   Enter   - Select model
 *   Escape  - Dismiss
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTuiContext } from '../../context/TuiContext.js';
import { useTheme } from '../../hooks/use-theme.js';
import { Spinner } from '../common/Spinner.js';

// ---------------------------------------------------------------------------
// Types for RPC responses (matching SettingsPanel patterns)
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

interface GetProviderStatusResult {
  providers: ProviderStatus[];
}

interface GetDefaultProviderResult {
  provider: string;
}

interface ModelsListResult {
  models: ModelEntry[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  onDismiss: () => void;
}

export function ModelSelector({
  onDismiss,
}: ModelSelectorProps): React.JSX.Element {
  const theme = useTheme();
  const { transport } = useTuiContext();

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');
  const [activeProviderIndex, setActiveProviderIndex] = useState(0);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);

  /**
   * Fetch models for the currently active provider.
   */
  const fetchModels = useCallback(async (): Promise<void> => {
    setModelsLoading(true);
    try {
      const response = await transport.call<void, ModelsListResult>(
        'config:models-list',
        undefined as unknown as void,
      );

      if (response.success && response.data?.models) {
        setModels(response.data.models);
        // Position cursor on the currently selected model
        const currentIdx = response.data.models.findIndex((m) => m.isSelected);
        setSelectedModelIndex(currentIdx >= 0 ? currentIdx : 0);
      } else {
        setModels([]);
        setSelectedModelIndex(0);
      }
    } catch {
      setModels([]);
      setSelectedModelIndex(0);
    } finally {
      setModelsLoading(false);
    }
  }, [transport]);

  // Initial data fetch on mount
  useEffect(() => {
    let cancelled = false;

    const fetchInitialData = async (): Promise<void> => {
      setLoading(true);
      try {
        // Fetch provider status and default provider in parallel
        const [providerStatusRes, defaultProviderRes] = await Promise.all([
          transport.call<void, GetProviderStatusResult>(
            'llm:getProviderStatus',
            undefined as unknown as void,
          ),
          transport.call<void, GetDefaultProviderResult>(
            'llm:getDefaultProvider',
            undefined as unknown as void,
          ),
        ]);

        if (cancelled) return;

        // Process providers
        if (providerStatusRes.success && providerStatusRes.data?.providers) {
          setProviders(providerStatusRes.data.providers);
        }

        // Process default provider
        if (defaultProviderRes.success && defaultProviderRes.data?.provider) {
          const defaultId = defaultProviderRes.data.provider;
          setCurrentProvider(defaultId);

          // Set active tab to the default provider
          if (providerStatusRes.success && providerStatusRes.data?.providers) {
            const idx = providerStatusRes.data.providers.findIndex(
              (p) => p.name === defaultId,
            );
            if (idx >= 0) {
              setActiveProviderIndex(idx);
            }
          }
        }

        // Fetch models for the current provider
        await fetchModels();
      } catch {
        // Gracefully handle errors
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchInitialData();

    return () => {
      cancelled = true;
    };
  }, [transport, fetchModels]);

  /**
   * Switch to a different provider and refetch models.
   */
  const switchProvider = useCallback(
    async (providerId: string): Promise<void> => {
      try {
        const response = await transport.call<
          { provider: string },
          { success: boolean }
        >('llm:setDefaultProvider', { provider: providerId });

        if (response.success) {
          setCurrentProvider(providerId);
          await fetchModels();
        }
      } catch {
        // Gracefully handle errors
      }
    },
    [transport, fetchModels],
  );

  /**
   * Select a model.
   */
  const selectModel = useCallback(
    async (modelId: string): Promise<void> => {
      try {
        const response = await transport.call<
          { model: string },
          { model: string }
        >('config:model-switch', { model: modelId });

        if (response.success) {
          // Update local state to reflect selection
          setModels((prev) =>
            prev.map((m) => ({ ...m, isSelected: m.id === modelId })),
          );
          onDismiss();
        }
      } catch {
        // Gracefully handle errors
      }
    },
    [transport, onDismiss],
  );

  // Keyboard navigation
  useInput((_input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }

    // Tab cycles providers
    if (key.tab && providers.length > 0) {
      const nextIndex = (activeProviderIndex + 1) % providers.length;
      setActiveProviderIndex(nextIndex);
      const nextProvider = providers[nextIndex];
      if (nextProvider) {
        void switchProvider(nextProvider.name);
      }
      return;
    }

    // Up/Down navigate models
    if (key.upArrow) {
      setSelectedModelIndex((prev) =>
        models.length === 0 ? 0 : (prev - 1 + models.length) % models.length,
      );
    }

    if (key.downArrow) {
      setSelectedModelIndex((prev) =>
        models.length === 0 ? 0 : (prev + 1) % models.length,
      );
    }

    // Enter selects model
    if (key.return) {
      const model = models[selectedModelIndex];
      if (model) {
        void selectModel(model.id);
      }
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={theme.ui.brand}>
          Model Selector
        </Text>
        <Box marginTop={1}>
          <Spinner label="Loading providers and models..." />
        </Box>
      </Box>
    );
  }

  // Determine the active provider for display
  const activeProvider = providers[activeProviderIndex];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.ui.brand}>
        Model Selector
      </Text>

      {/* Current provider indicator */}
      <Box marginTop={1} gap={1}>
        <Text dimColor>Provider:</Text>
        <Text bold color={theme.ui.accent}>
          {activeProvider?.displayName ?? currentProvider}
        </Text>
        {activeProvider && !activeProvider.hasApiKey && (
          <Text color={theme.status.error}>(no API key)</Text>
        )}
      </Box>

      {/* Provider tabs */}
      {providers.length > 1 && (
        <Box marginTop={1} gap={2}>
          {providers.map((provider, index) => {
            const isActive = index === activeProviderIndex;
            return (
              <Box key={provider.name} gap={0}>
                <Text
                  bold={isActive}
                  color={isActive ? theme.ui.accent : theme.ui.dimmed}
                  inverse={isActive}
                >
                  {' '}
                  {provider.displayName}{' '}
                </Text>
                {provider.hasApiKey ? (
                  <Text color={theme.status.success}>{'\u2713'}</Text>
                ) : (
                  <Text color={theme.status.error}>{'\u2717'}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Model list */}
      <Box flexDirection="column" marginTop={1}>
        {modelsLoading ? (
          <Spinner label="Loading models..." />
        ) : models.length === 0 ? (
          <Text color={theme.ui.dimmed}>
            No models available. Check your API key configuration.
          </Text>
        ) : (
          models.map((model, index) => {
            const isSelected = index === selectedModelIndex;
            const isCurrent = model.isSelected;

            return (
              <Box key={model.id} gap={1}>
                <Text
                  bold={isSelected || isCurrent}
                  inverse={isSelected}
                  color={isCurrent && !isSelected ? theme.ui.accent : undefined}
                >
                  {model.name || model.id}
                </Text>
                {isCurrent && (
                  <Text color={theme.status.success}>[current]</Text>
                )}
                {model.isRecommended && !isCurrent && (
                  <Text color={theme.status.warning}>*</Text>
                )}
                {model.description && <Text dimColor>{model.description}</Text>}
              </Box>
            );
          })
        )}
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          Tab: switch provider | Up/Down: navigate | Enter: select | Escape:
          close
          {' | * = recommended'}
        </Text>
      </Box>
    </Box>
  );
}
