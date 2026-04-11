/**
 * ModelSelector -- Modal model/provider selector (Ctrl+M).
 *
 * Self-contained modal that manages its own RPC calls for provider/model
 * discovery, provider switching, and model selection. Pushes a focus scope
 * on mount so background useInput handlers are suspended.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTuiContext } from '../../context/TuiContext.js';
import { useTheme } from '../../hooks/use-theme.js';
import { usePushFocus } from '../../hooks/use-focus-manager.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Panel, Spinner } from '../atoms/index.js';
import { ListItem, SectionHeader } from '../molecules/index.js';

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
  const isActive = usePushFocus('model-selector');

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');
  const [activeProviderIndex, setActiveProviderIndex] = useState(0);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);

  const fetchModels = useCallback(async (): Promise<void> => {
    setModelsLoading(true);
    try {
      const response = await transport.call<void, ModelsListResult>(
        'config:models-list',
        undefined as unknown as void,
      );

      if (response.success && response.data?.models) {
        setModels(response.data.models);
      } else {
        setModels([]);
      }
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [transport]);

  useEffect(() => {
    let cancelled = false;

    const fetchInitialData = async (): Promise<void> => {
      setLoading(true);
      try {
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

        if (providerStatusRes.success && providerStatusRes.data?.providers) {
          setProviders(providerStatusRes.data.providers);
        }

        if (defaultProviderRes.success && defaultProviderRes.data?.provider) {
          const defaultId = defaultProviderRes.data.provider;
          setCurrentProvider(defaultId);

          if (providerStatusRes.success && providerStatusRes.data?.providers) {
            const idx = providerStatusRes.data.providers.findIndex(
              (p) => p.name === defaultId,
            );
            if (idx >= 0) {
              setActiveProviderIndex(idx);
            }
          }
        }

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

  const selectModel = useCallback(
    async (index: number): Promise<void> => {
      const model = models[index];
      if (!model) return;
      try {
        const response = await transport.call<
          { model: string },
          { model: string }
        >('config:model-switch', { model: model.id });

        if (response.success) {
          setModels((prev) =>
            prev.map((m) => ({ ...m, isSelected: m.id === model.id })),
          );
          onDismiss();
        }
      } catch {
        // Gracefully handle errors
      }
    },
    [transport, onDismiss, models],
  );

  // Nav hook owns up/down + enter + escape for the model list.
  const initialModelIndex = Math.max(
    0,
    models.findIndex((m) => m.isSelected),
  );
  const { activeIndex } = useKeyboardNav({
    itemCount: models.length,
    isActive,
    initialIndex: initialModelIndex,
    wrap: true,
    onSelect: (i) => {
      void selectModel(i);
    },
    onEscape: onDismiss,
  });

  // Tab cycling lives outside useKeyboardNav.
  useInput(
    (_input, key) => {
      if (key.tab && providers.length > 0) {
        const nextIndex = (activeProviderIndex + 1) % providers.length;
        setActiveProviderIndex(nextIndex);
        const nextProvider = providers[nextIndex];
        if (nextProvider) {
          void switchProvider(nextProvider.name);
        }
      }
    },
    { isActive },
  );

  if (loading) {
    return (
      <Panel title="Model Selector" isActive>
        <Box paddingX={1}>
          <Spinner label="Loading providers and models..." />
        </Box>
      </Panel>
    );
  }

  const activeProvider = providers[activeProviderIndex];

  return (
    <Panel title="Model Selector" isActive padding={1}>
      <Box flexDirection="column">
        <SectionHeader
          title={activeProvider?.displayName ?? currentProvider}
          subtitle={
            activeProvider && !activeProvider.hasApiKey
              ? 'No API key configured for this provider'
              : undefined
          }
        />

        {providers.length > 1 && (
          <Box marginBottom={1} gap={2}>
            {providers.map((provider, index) => {
              const isActiveTab = index === activeProviderIndex;
              return (
                <Box key={provider.name} gap={1}>
                  <Text
                    bold={isActiveTab}
                    color={isActiveTab ? theme.ui.accent : theme.ui.dimmed}
                    inverse={isActiveTab}
                  >
                    {' '}
                    {provider.displayName}{' '}
                  </Text>
                  <Badge variant={provider.hasApiKey ? 'success' : 'error'}>
                    {provider.hasApiKey ? '✓' : '✗'}
                  </Badge>
                </Box>
              );
            })}
          </Box>
        )}

        <Box flexDirection="column">
          {modelsLoading ? (
            <Spinner label="Loading models..." />
          ) : models.length === 0 ? (
            <Text color={theme.ui.dimmed}>
              No models available. Check your API key configuration.
            </Text>
          ) : (
            models.map((model, index) => (
              <ListItem
                key={model.id}
                label={model.name || model.id}
                description={model.description || undefined}
                isSelected={index === activeIndex}
                isCurrent={model.isSelected}
                badge={
                  model.isRecommended && !model.isSelected ? (
                    <Badge variant="warning">★</Badge>
                  ) : undefined
                }
              />
            ))
          )}
        </Box>

        <Box marginTop={1} gap={2}>
          <KeyHint keys="Tab" label="switch provider" />
          <KeyHint keys="↑↓" label="navigate" />
          <KeyHint keys="Enter" label="select" />
          <KeyHint keys="Esc" label="close" />
        </Box>
      </Box>
    </Panel>
  );
}
