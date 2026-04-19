/**
 * AuthSection -- Unified provider selection + authentication configuration.
 *
 * TASK_2025_266 UI Enhancements
 *
 * Mirrors the Angular settings "Providers" tab with full parity:
 *   - All providers from auth:getAuthStatus (not hardcoded to 2)
 *   - Claude: API Key authentication
 *   - GitHub Copilot: OAuth login / logout
 *   - OpenAI Codex: CLI auth status + login
 *   - Local providers (Ollama, LM Studio): no key needed
 *   - Standard API providers (OpenRouter, Moonshot, Z.AI): API key input
 *   - Save & Test Connection
 *
 * Two sub-modes:
 *   BROWSE  -- Up/Down navigate provider list, Enter to configure
 *   CONFIG  -- Auth form for the selected provider, Escape to return
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { BadgeVariant } from '../atoms/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  helpUrl: string;
  keyPrefix: string;
  keyPlaceholder: string;
  maskedKeyDisplay: string;
  authType?: 'apiKey' | 'oauth' | 'none';
  isLocal?: boolean;
}

interface AuthStatus {
  hasApiKey: boolean;
  hasOpenRouterKey: boolean;
  hasAnyProviderKey?: boolean;
  authMethod: string;
  anthropicProviderId: string;
  availableProviders: ProviderInfo[];
  copilotAuthenticated?: boolean;
  copilotUsername?: string;
  codexAuthenticated?: boolean;
  codexTokenStale?: boolean;
  claudeCliInstalled?: boolean;
}

type SaveParams = Record<string, unknown>;

interface StatusMsg {
  type: 'success' | 'error' | 'info';
  text: string;
}

// The Claude tile is always the first entry and is not from the registry.
const CLAUDE_TILE_ID = 'claude';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerIcon(id: string): string {
  switch (id) {
    case 'claude':
      return '⊛';
    case 'github-copilot':
      return '⎇';
    case 'openai-codex':
      return '⌥';
    case 'ollama':
    case 'lm-studio':
      return '⊡';
    default:
      return '◈';
  }
}

function keyStatusLabel(tileId: string, auth: AuthStatus): string {
  if (tileId === CLAUDE_TILE_ID) {
    if (auth.authMethod === 'claudeCli') {
      return auth.claudeCliInstalled ? 'CLI detected' : 'CLI not found';
    }
    return auth.hasApiKey ? 'Configured' : 'Not configured';
  }
  if (tileId === 'github-copilot') {
    if (auth.copilotAuthenticated) {
      return auth.copilotUsername ? `@${auth.copilotUsername}` : 'Connected';
    }
    return 'Not connected';
  }
  if (tileId === 'openai-codex') {
    if (auth.codexTokenStale) return 'Token expired';
    if (auth.codexAuthenticated) return 'CLI auth';
    return 'Not configured';
  }
  const provider = auth.availableProviders.find((p) => p.id === tileId);
  if (provider?.authType === 'none') return 'No key needed';
  // For standard API providers: check if this is the active provider with a key
  const isActive =
    auth.anthropicProviderId === tileId && (auth.hasAnyProviderKey ?? false);
  return isActive ? 'Configured' : 'Not configured';
}

function keyStatusVariant(tileId: string, auth: AuthStatus): BadgeVariant {
  const label = keyStatusLabel(tileId, auth);
  if (label === 'Not configured' || label === 'Not connected') return 'error';
  if (label === 'Token expired' || label === 'CLI not found') return 'warning';
  return 'success';
}

// ---------------------------------------------------------------------------
// Browse view (provider list)
// ---------------------------------------------------------------------------

interface BrowseViewProps {
  tiles: string[];
  selectedIndex: number;
  auth: AuthStatus;
  isActive: boolean;
}

function BrowseView({
  tiles,
  selectedIndex,
  auth,
  isActive,
}: BrowseViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {tiles.map((tileId, index) => {
        const isSelected = index === selectedIndex && isActive;
        const name =
          tileId === CLAUDE_TILE_ID
            ? 'Claude'
            : (auth.availableProviders.find((p) => p.id === tileId)?.name ??
              tileId);
        const statusLabel = keyStatusLabel(tileId, auth);
        const variant = keyStatusVariant(tileId, auth);

        return (
          <ListItem
            key={tileId}
            label={`${providerIcon(tileId)} ${name}`}
            isSelected={isSelected}
            badge={<Badge variant={variant}>{statusLabel}</Badge>}
          />
        );
      })}
      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="Enter" label="configure" />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config form: Claude
// ---------------------------------------------------------------------------

interface ClaudeConfigProps {
  auth: AuthStatus;
  editingKey: boolean;
  keyInput: string;
  saving: boolean;
  statusMsg: StatusMsg | null;
  isActive: boolean;
  onKeyChange: (val: string) => void;
  onKeySubmit: (val: string) => void;
}

function ClaudeConfig({
  auth,
  editingKey,
  keyInput,
  saving,
  statusMsg,
  isActive,
  onKeyChange,
  onKeySubmit,
}: ClaudeConfigProps): React.JSX.Element {
  const theme = useTheme();

  const hasKey = auth.hasApiKey;

  return (
    <Box flexDirection="column" gap={1}>
      {/* Header */}
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⊛ Claude
        </Text>
      </Box>

      {/* Method label */}
      <Box gap={1}>
        <Text dimColor>Method:</Text>
        <Text color={theme.ui.brand} bold inverse={isActive}>
          {' '}
          API Key{' '}
        </Text>
      </Box>

      {/* Key field */}
      {saving ? (
        <Spinner label="Saving & testing..." />
      ) : editingKey ? (
        <Box gap={1}>
          <Text color={theme.status.warning}>Key: </Text>
          <TextInput
            value={keyInput}
            onChange={onKeyChange}
            onSubmit={onKeySubmit}
            placeholder="Paste API key..."
            focus={true}
            mask="*"
          />
        </Box>
      ) : hasKey ? (
        <Box gap={1}>
          <Text dimColor>Key: </Text>
          <Text color={theme.ui.dimmed} dimColor>
            sk-ant-api03-••••••••
          </Text>
          <Text color={theme.status.success}> ✓</Text>
          <Text dimColor> (Enter: replace)</Text>
        </Box>
      ) : (
        <Box gap={1}>
          <Text dimColor>Key: </Text>
          <Text color={theme.status.error}>Not configured</Text>
          <Text dimColor> (Enter: add)</Text>
        </Box>
      )}

      {/* Actions */}
      {!editingKey && !saving && (
        <Box gap={2} marginTop={1}>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text color={hasKey ? theme.status.success : theme.ui.dimmed}>
              S: Save & Test
            </Text>
          </Box>
          {hasKey && (
            <Box
              borderStyle="round"
              borderColor={theme.ui.borderSubtle}
              paddingX={1}
            >
              <Text color={theme.ui.muted}>Enter: replace key</Text>
            </Box>
          )}
          {!hasKey && (
            <Box
              borderStyle="round"
              borderColor={theme.ui.borderSubtle}
              paddingX={1}
            >
              <Text color={theme.ui.accent}>Enter: add key</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Status message */}
      {statusMsg && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.type === 'success'
                ? theme.status.success
                : statusMsg.type === 'error'
                  ? theme.status.error
                  : theme.status.info
            }
          >
            {statusMsg.type === 'success'
              ? '✓ '
              : statusMsg.type === 'error'
                ? '✗ '
                : '○ '}
            {statusMsg.text}
          </Text>
        </Box>
      )}

      {!editingKey && !saving && (
        <Box marginTop={1}>
          <Text dimColor italic>
            Enter: edit key | S: save & test | Esc: back
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config form: GitHub Copilot
// ---------------------------------------------------------------------------

interface CopilotConfigProps {
  auth: AuthStatus;
  saving: boolean;
  loggingIn: boolean;
  statusMsg: StatusMsg | null;
  onLogin: () => void;
  onLogout: () => void;
}

function CopilotConfig({
  auth,
  saving,
  loggingIn,
  statusMsg,
}: CopilotConfigProps): React.JSX.Element {
  const theme = useTheme();
  const isConnected = auth.copilotAuthenticated ?? false;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⎇ GitHub Copilot
        </Text>
      </Box>

      {saving || loggingIn ? (
        <Spinner
          label={loggingIn ? 'Signing in via GitHub...' : 'Processing...'}
        />
      ) : isConnected ? (
        <Box gap={1}>
          <Text color={theme.status.success}>✓ Connected</Text>
          {auth.copilotUsername && (
            <Text color={theme.ui.muted}>as @{auth.copilotUsername}</Text>
          )}
        </Box>
      ) : (
        <Text color={theme.status.error}>✗ Not connected</Text>
      )}

      {!saving && !loggingIn && (
        <Box marginTop={1}>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text
              color={isConnected ? theme.status.error : theme.status.success}
            >
              {isConnected ? 'Enter: disconnect' : 'Enter: sign in with GitHub'}
            </Text>
          </Box>
        </Box>
      )}

      {statusMsg && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {statusMsg.type === 'success' ? '✓ ' : '✗ '}
            {statusMsg.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: {isConnected ? 'disconnect' : 'sign in'} | Esc: back
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config form: Codex
// ---------------------------------------------------------------------------

interface CodexConfigProps {
  auth: AuthStatus;
  saving: boolean;
  statusMsg: StatusMsg | null;
  onLogin: () => void;
}

function CodexConfig({
  auth,
  saving,
  statusMsg,
}: CodexConfigProps): React.JSX.Element {
  const theme = useTheme();
  const isAuth = auth.codexAuthenticated ?? false;
  const isStale = auth.codexTokenStale ?? false;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⌥ OpenAI Codex
        </Text>
      </Box>

      {saving ? (
        <Spinner label="Opening terminal..." />
      ) : isStale ? (
        <Box gap={1}>
          <Text color={theme.status.warning}>⚠ Token expired</Text>
          <Text dimColor>— re-authentication required</Text>
        </Box>
      ) : isAuth ? (
        <Box gap={1}>
          <Text color={theme.status.success}>✓ Authenticated</Text>
          <Text dimColor>via ~/.codex/auth.json</Text>
        </Box>
      ) : (
        <Text color={theme.ui.dimmed}>
          Authenticated via <Text bold>~/.codex/auth.json</Text>
        </Text>
      )}

      {!saving && (
        <Box marginTop={1}>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text color={isStale ? theme.status.warning : theme.ui.accent}>
              Enter: {isStale ? 're-authenticate' : 'open codex login'}
            </Text>
          </Box>
        </Box>
      )}

      {statusMsg && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {statusMsg.type === 'success' ? '✓ ' : '✗ '}
            {statusMsg.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: login | Esc: back
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config form: Local provider (Ollama, LM Studio)
// ---------------------------------------------------------------------------

interface LocalConfigProps {
  provider: ProviderInfo;
  saving: boolean;
  statusMsg: StatusMsg | null;
  onSave: () => void;
}

function LocalConfig({
  provider,
  saving,
  statusMsg,
}: LocalConfigProps): React.JSX.Element {
  const theme = useTheme();
  const endpoint =
    provider.id === 'ollama'
      ? 'http://localhost:11434'
      : 'http://localhost:1234';

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⊡ {provider.name}
        </Text>
      </Box>

      <Text color={theme.status.success}>No API key needed — runs locally</Text>
      <Box gap={1}>
        <Text dimColor>Endpoint:</Text>
        <Text color={theme.ui.muted}>{endpoint}</Text>
      </Box>
      <Text dimColor>
        Make sure {provider.name} is running before connecting.
      </Text>

      {saving ? (
        <Spinner label="Testing connection..." />
      ) : (
        <Box marginTop={1}>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text color={theme.status.success}>
              Enter: set as active & test
            </Text>
          </Box>
        </Box>
      )}

      {statusMsg && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {statusMsg.type === 'success' ? '✓ ' : '✗ '}
            {statusMsg.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>
          Enter: save & test | Esc: back
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Config form: Standard API key provider (OpenRouter, Moonshot, Z.AI, etc.)
// ---------------------------------------------------------------------------

interface ApiKeyProviderConfigProps {
  provider: ProviderInfo;
  auth: AuthStatus;
  editingKey: boolean;
  keyInput: string;
  saving: boolean;
  statusMsg: StatusMsg | null;
  onKeyChange: (val: string) => void;
  onKeySubmit: (val: string) => void;
}

function ApiKeyProviderConfig({
  provider,
  auth,
  editingKey,
  keyInput,
  saving,
  statusMsg,
  onKeyChange,
  onKeySubmit,
}: ApiKeyProviderConfigProps): React.JSX.Element {
  const theme = useTheme();

  // A provider is "configured" if it's the active provider and has a key
  const isConfigured =
    auth.anthropicProviderId === provider.id &&
    (auth.hasAnyProviderKey ?? false);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ◈ {provider.name}
        </Text>
        {provider.description ? (
          <Text dimColor>— {provider.description}</Text>
        ) : null}
      </Box>

      {saving ? (
        <Spinner label="Saving & testing..." />
      ) : editingKey ? (
        <Box gap={1}>
          <Text color={theme.status.warning}>Key: </Text>
          <TextInput
            value={keyInput}
            onChange={onKeyChange}
            onSubmit={onKeySubmit}
            placeholder={provider.keyPlaceholder || 'Paste API key...'}
            focus={true}
            mask="*"
          />
        </Box>
      ) : isConfigured ? (
        <Box gap={1}>
          <Text dimColor>Key: </Text>
          <Text color={theme.ui.dimmed} dimColor>
            {provider.maskedKeyDisplay || '••••••••••••'}
          </Text>
          <Text color={theme.status.success}> ✓</Text>
          <Text dimColor> (Enter: replace)</Text>
        </Box>
      ) : (
        <Box gap={1}>
          <Text dimColor>Key: </Text>
          <Text color={theme.status.error}>Not configured</Text>
          <Text dimColor> (Enter: add)</Text>
        </Box>
      )}

      {provider.keyPrefix && !editingKey && !saving && (
        <Text dimColor>
          Keys start with <Text bold>{provider.keyPrefix}</Text>
        </Text>
      )}

      {!editingKey && !saving && (
        <Box gap={2} marginTop={1}>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text color={isConfigured ? theme.status.success : theme.ui.dimmed}>
              S: Save & Test
            </Text>
          </Box>
          <Box
            borderStyle="round"
            borderColor={theme.ui.borderSubtle}
            paddingX={1}
          >
            <Text color={theme.ui.accent}>
              {isConfigured ? 'Enter: replace key' : 'Enter: add key'}
            </Text>
          </Box>
        </Box>
      )}

      {statusMsg && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.type === 'success'
                ? theme.status.success
                : theme.status.error
            }
          >
            {statusMsg.type === 'success' ? '✓ ' : '✗ '}
            {statusMsg.text}
          </Text>
        </Box>
      )}

      {!editingKey && !saving && (
        <Box marginTop={1}>
          <Text dimColor italic>
            Enter: edit key | S: save & test | Esc: back
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main AuthSection
// ---------------------------------------------------------------------------

interface AuthSectionProps {
  isActive: boolean;
}

export function AuthSection({ isActive }: AuthSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call, error: rpcError } = useRpc();

  // Remote state
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Navigation state
  const [providerIndex, setProviderIndex] = useState(0);

  // Sub-mode
  const [configuring, setConfiguring] = useState(false);

  // Key editing state (shared for Claude + API-key providers)
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  // Action states
  const [saving, setSaving] = useState(false);
  const [copilotLoggingIn, setCopilotLoggingIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMsg | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadAuthStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    const result = await call<void, AuthStatus>(
      'auth:getAuthStatus',
      undefined as unknown as void,
    );
    if (result) {
      setAuthStatus(result);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => {
    void loadAuthStatus();
  }, [loadAuthStatus]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  // All provider tile IDs: Claude is always first
  const tiles: string[] = authStatus
    ? [CLAUDE_TILE_ID, ...authStatus.availableProviders.map((p) => p.id)]
    : [CLAUDE_TILE_ID];

  const selectedTileId = tiles[providerIndex] ?? CLAUDE_TILE_ID;
  const selectedProvider =
    authStatus?.availableProviders.find((p) => p.id === selectedTileId) ?? null;

  const isClaudeTile = selectedTileId === CLAUDE_TILE_ID;
  const isCopilotProvider = selectedTileId === 'github-copilot';
  const isCodexProvider = selectedTileId === 'openai-codex';
  const isLocalProvider =
    !isClaudeTile &&
    (selectedProvider?.authType === 'none' ||
      selectedProvider?.isLocal === true);
  const isOAuthProvider =
    !isClaudeTile && selectedProvider?.authType === 'oauth';
  const isApiKeyProvider =
    !isClaudeTile && !isOAuthProvider && !isLocalProvider;

  // ---------------------------------------------------------------------------
  // Save & test helpers
  // ---------------------------------------------------------------------------

  const runSaveAndTest = useCallback(
    async (params: SaveParams): Promise<void> => {
      setSaving(true);
      setStatusMsg(null);

      const saveResult = await call<
        SaveParams,
        { success: boolean; error?: string }
      >('auth:saveSettings', params);

      if (!saveResult?.success) {
        setStatusMsg({
          type: 'error',
          text: saveResult?.error ?? 'Failed to save settings.',
        });
        setSaving(false);
        return;
      }

      const testResult = await call<
        void,
        { success: boolean; health: unknown; errorMessage?: string }
      >('auth:testConnection', undefined as unknown as void);

      if (testResult?.success) {
        setStatusMsg({ type: 'success', text: 'Connected successfully!' });
        await loadAuthStatus();
      } else {
        setStatusMsg({
          type: 'error',
          text: testResult?.errorMessage ?? 'Connection test failed.',
        });
      }

      setSaving(false);
    },
    [call, loadAuthStatus],
  );

  const handleClaudeKeySubmit = useCallback(
    async (value: string): Promise<void> => {
      setEditingKey(false);
      setKeyInput('');
      if (!value.trim()) return;

      await runSaveAndTest({
        authMethod: 'apiKey',
        anthropicApiKey: value.trim(),
      });
    },
    [runSaveAndTest],
  );

  const handleProviderKeySubmit = useCallback(
    async (value: string): Promise<void> => {
      setEditingKey(false);
      setKeyInput('');
      if (!value.trim()) return;

      await runSaveAndTest({
        authMethod: 'thirdParty',
        providerApiKey: value.trim(),
        anthropicProviderId: selectedTileId,
      });
    },
    [selectedTileId, runSaveAndTest],
  );

  const handleSaveAndTestExisting = useCallback(async (): Promise<void> => {
    if (isClaudeTile) {
      await runSaveAndTest({ authMethod: 'apiKey' });
    } else {
      await runSaveAndTest({
        authMethod: 'thirdParty',
        anthropicProviderId: selectedTileId,
      });
    }
  }, [isClaudeTile, selectedTileId, runSaveAndTest]);

  const handleCopilotLogin = useCallback(async (): Promise<void> => {
    setCopilotLoggingIn(true);
    setStatusMsg(null);
    const result = await call<
      Record<string, never>,
      { success: boolean; username?: string; error?: string }
    >('auth:copilotLogin', {});
    if (result?.success) {
      setStatusMsg({
        type: 'success',
        text: `Connected as ${result.username ?? 'GitHub user'}`,
      });
      await loadAuthStatus();
    } else {
      setStatusMsg({ type: 'error', text: result?.error ?? 'Login failed.' });
    }
    setCopilotLoggingIn(false);
  }, [call, loadAuthStatus]);

  const handleCopilotLogout = useCallback(async (): Promise<void> => {
    setSaving(true);
    setStatusMsg(null);
    const result = await call<Record<string, never>, { success: boolean }>(
      'auth:copilotLogout',
      {},
    );
    if (result?.success) {
      setStatusMsg({ type: 'success', text: 'Disconnected from GitHub.' });
      await loadAuthStatus();
    }
    setSaving(false);
  }, [call, loadAuthStatus]);

  const handleCodexLogin = useCallback(async (): Promise<void> => {
    setSaving(true);
    setStatusMsg(null);
    const result = await call<void, { success: boolean }>(
      'auth:codexLogin',
      undefined as unknown as void,
    );
    if (result?.success) {
      setStatusMsg({
        type: 'info',
        text: 'Codex login initiated in terminal.',
      });
    } else {
      setStatusMsg({ type: 'error', text: 'Failed to start Codex login.' });
    }
    setSaving(false);
  }, [call]);

  // ---------------------------------------------------------------------------
  // Keyboard handling: BROWSE mode
  // ---------------------------------------------------------------------------

  const browseNav = useKeyboardNav({
    itemCount: tiles.length,
    isActive: isActive && !loading && !configuring,
    onSelect: () => {
      setConfiguring(true);
      setStatusMsg(null);
      setEditingKey(false);
      setKeyInput('');
    },
  });

  useEffect(() => {
    setProviderIndex(browseNav.activeIndex);
  }, [browseNav.activeIndex]);

  // ---------------------------------------------------------------------------
  // Keyboard handling: CONFIG mode
  // ---------------------------------------------------------------------------

  useInput(
    (input, key) => {
      if (!configuring || editingKey || saving || copilotLoggingIn) return;

      // Escape: back to browse
      if (key.escape) {
        setConfiguring(false);
        setStatusMsg(null);
        setEditingKey(false);
        setKeyInput('');
        return;
      }

      // Enter: start key editing (Claude or standard API providers)
      if (key.return && (isClaudeTile || isApiKeyProvider)) {
        setEditingKey(true);
        setKeyInput('');
        return;
      }

      // Enter: Copilot login / logout
      if (key.return && isCopilotProvider) {
        if (authStatus?.copilotAuthenticated) {
          void handleCopilotLogout();
        } else {
          void handleCopilotLogin();
        }
        return;
      }

      // Enter: Codex login
      if (key.return && isCodexProvider) {
        void handleCodexLogin();
        return;
      }

      // Enter: Local provider — save & test
      if (key.return && isLocalProvider) {
        void handleSaveAndTestExisting();
        return;
      }

      // 's': Save & Test with existing credentials
      if (
        (input === 's' || input === 'S') &&
        !key.ctrl &&
        (isClaudeTile || isApiKeyProvider || isLocalProvider)
      ) {
        void handleSaveAndTestExisting();
        return;
      }
    },
    {
      isActive:
        isActive && configuring && !editingKey && !saving && !copilotLoggingIn,
    },
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return <Spinner label="Loading providers..." />;
  }

  if (!authStatus) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.error} bold>
          Failed to load auth status.
        </Text>
        {rpcError && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>RPC error: {rpcError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            Check that the RPC handler `auth:getAuthStatus` is registered and
            that the backend is reachable.
          </Text>
        </Box>
      </Box>
    );
  }

  // BROWSE mode
  if (!configuring) {
    return (
      <BrowseView
        tiles={tiles}
        selectedIndex={providerIndex}
        auth={authStatus}
        isActive={isActive}
      />
    );
  }

  // CONFIG mode: divider
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>Esc: back to providers</Text>
      </Box>

      {/* Claude */}
      {isClaudeTile && (
        <ClaudeConfig
          auth={authStatus}
          editingKey={editingKey}
          keyInput={keyInput}
          saving={saving}
          statusMsg={statusMsg}
          isActive={isActive}
          onKeyChange={setKeyInput}
          onKeySubmit={(val) => void handleClaudeKeySubmit(val)}
        />
      )}

      {/* GitHub Copilot */}
      {isCopilotProvider && (
        <CopilotConfig
          auth={authStatus}
          saving={saving}
          loggingIn={copilotLoggingIn}
          statusMsg={statusMsg}
          onLogin={() => void handleCopilotLogin()}
          onLogout={() => void handleCopilotLogout()}
        />
      )}

      {/* Codex */}
      {isCodexProvider && (
        <CodexConfig
          auth={authStatus}
          saving={saving}
          statusMsg={statusMsg}
          onLogin={() => void handleCodexLogin()}
        />
      )}

      {/* Local provider */}
      {isLocalProvider && selectedProvider && (
        <LocalConfig
          provider={selectedProvider}
          saving={saving}
          statusMsg={statusMsg}
          onSave={() => void handleSaveAndTestExisting()}
        />
      )}

      {/* Standard API key provider */}
      {isApiKeyProvider && selectedProvider && (
        <ApiKeyProviderConfig
          provider={selectedProvider}
          auth={authStatus}
          editingKey={editingKey}
          keyInput={keyInput}
          saving={saving}
          statusMsg={statusMsg}
          onKeyChange={setKeyInput}
          onKeySubmit={(val) => void handleProviderKeySubmit(val)}
        />
      )}
    </Box>
  );
}
