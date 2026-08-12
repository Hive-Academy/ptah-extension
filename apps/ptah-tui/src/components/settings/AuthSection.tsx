import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { useLoginProgress } from '../../hooks/use-login-progress.js';
import type { LoginProgress } from '../../hooks/use-login-progress.js';
import { useTuiContext } from '../../context/TuiContext.js';
import { useEscapeClaim } from '../../context/EscapeClaimContext.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { BadgeVariant } from '../atoms/index.js';
import {
  CLAUDE_TILE_ID,
  formKeyIsOptional,
  resolveProviderEndpoint,
  resolveProviderFormKind,
} from './provider-form.js';
import {
  CustomProviderForm,
  type CustomProviderFormStatus,
} from './CustomProviderForm.js';
import {
  customProviderFormFromEntry,
  customProviderSecurityNote,
  emptyCustomProviderForm,
  type CustomProviderFormMode,
  type CustomProviderFormValues,
} from './custom-provider-form.js';
import type { CustomProviderEntry } from '@ptah-extension/shared';

/**
 * Synthetic tile that opens the add-custom-provider form.
 *
 * Kept out of `availableProviders` on purpose: it is an action, not a
 * provider, and putting it in the registry projection would mean every other
 * consumer of `auth:getAuthStatus` had to learn to skip it.
 */
export const ADD_CUSTOM_TILE_ID = '__add-custom-provider';

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
  /** Registry base URL — the single source for the endpoint a tile displays. */
  baseUrl?: string;
  /** Keyless works, but a key unlocks more (ollama-cloud). */
  supportsOptionalApiKey?: boolean;
  /** Runs on ambient `~/.claude` credentials — no endpoint, no key. */
  nativeAuth?: boolean;
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

function providerIcon(id: string): string {
  switch (id) {
    case 'claude':
    case 'claude-cli':
      return '⊛';
    case 'github-copilot':
      return '⎇';
    case 'openai-codex':
      return '⌥';
    case 'ollama':
    case 'ollama-cloud':
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
  const kind = resolveProviderFormKind(tileId, provider ?? null);
  const isActive =
    auth.anthropicProviderId === tileId && (auth.hasAnyProviderKey ?? false);

  // The Claude Subscription tile runs on the host's `~/.claude` login, so its
  // readiness is "is that login present?", not "is a key stored?".
  if (kind === 'ambient') {
    return auth.claudeCliInstalled ? 'Local Claude login' : 'CLI not found';
  }
  // Ollama Cloud: usable signed-in without a key, better with one. Say which.
  if (kind === 'local-optional-key') {
    return isActive ? 'Key set' : 'No key needed';
  }
  if (kind === 'local') return 'No key needed';

  return isActive ? 'Configured' : 'Not configured';
}

function keyStatusVariant(tileId: string, auth: AuthStatus): BadgeVariant {
  const label = keyStatusLabel(tileId, auth);
  if (label === 'Not configured' || label === 'Not connected') return 'error';
  if (label === 'Token expired' || label === 'CLI not found') return 'warning';
  return 'success';
}

interface BrowseViewProps {
  tiles: string[];
  selectedIndex: number;
  auth: AuthStatus;
  isActive: boolean;
  /** Ids of user-defined entries, badged so they are distinguishable. */
  customIds: ReadonlySet<string>;
}

function BrowseView({
  tiles,
  selectedIndex,
  auth,
  isActive,
  customIds,
}: BrowseViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {tiles.map((tileId, index) => {
        const isSelected = index === selectedIndex && isActive;

        if (tileId === ADD_CUSTOM_TILE_ID) {
          return (
            <ListItem
              key={tileId}
              label="＋ Add custom provider"
              isSelected={isSelected}
              badge={<Badge variant="accent">New</Badge>}
            />
          );
        }

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
            label={`${providerIcon(tileId)} ${name}${
              customIds.has(tileId) ? ' (custom)' : ''
            }`}
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
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⊛ Claude
        </Text>
      </Box>

      <Box gap={1}>
        <Text dimColor>Method:</Text>
        <Text color={theme.ui.brand} bold inverse={isActive}>
          {' '}
          API Key{' '}
        </Text>
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

/**
 * Renders an in-flight device-code login prominently: the code the user must
 * type, the URL to open, and the tail of whatever the login subprocess printed.
 *
 * This is the entire point of the `auth:deviceCode` / `auth:loginOutput` push
 * events — before them the code went to a `console.log` the TUI swallows, so a
 * device-code login showed nothing but a spinner for up to five minutes.
 */
function LoginProgressView({
  progress,
}: {
  progress: LoginProgress;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { deviceCode, output } = progress;

  if (!deviceCode && output.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1} gap={1}>
      {deviceCode?.userCode && (
        <Box
          borderStyle="round"
          borderColor={theme.ui.accent}
          paddingX={1}
          gap={1}
        >
          <Text dimColor>Code:</Text>
          <Text bold color={theme.ui.accent}>
            {deviceCode.userCode}
          </Text>
          <Text dimColor>(copied to clipboard)</Text>
        </Box>
      )}

      {deviceCode?.verificationUri && (
        <Box gap={1}>
          <Text dimColor>Open:</Text>
          <Text bold color={theme.ui.brand}>
            {deviceCode.verificationUri}
          </Text>
        </Box>
      )}

      {output.length > 0 && (
        <Box flexDirection="column">
          {output.map((line, index) => (
            <Text key={`${index}-${line}`} dimColor wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface CopilotConfigProps {
  auth: AuthStatus;
  saving: boolean;
  loggingIn: boolean;
  statusMsg: StatusMsg | null;
  progress: LoginProgress;
  onLogin: () => void;
  onLogout: () => void;
}

function CopilotConfig({
  auth,
  saving,
  loggingIn,
  statusMsg,
  progress,
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
        <Box flexDirection="column">
          <Spinner
            label={
              loggingIn
                ? 'Signing in via GitHub — waiting for authorization...'
                : 'Processing...'
            }
          />
          <LoginProgressView progress={progress} />
        </Box>
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

interface CodexConfigProps {
  auth: AuthStatus;
  saving: boolean;
  statusMsg: StatusMsg | null;
  progress: LoginProgress;
  onLogin: () => void;
}

function CodexConfig({
  auth,
  saving,
  statusMsg,
  progress,
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
        <Box flexDirection="column">
          <Spinner label="Running `codex login --device-auth`..." />
          <LoginProgressView progress={progress} />
        </Box>
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

/**
 * The Claude Subscription tile. It has no endpoint and no key: the Agent SDK
 * runs on whatever `~/.claude` login the Claude CLI created. Rendering it
 * through {@link LocalConfig} (which is what `authType: 'none'` used to cause)
 * advertised a localhost server that does not exist.
 */
function AmbientConfig({
  provider,
  auth,
  saving,
  statusMsg,
}: {
  provider: ProviderInfo;
  auth: AuthStatus;
  saving: boolean;
  statusMsg: StatusMsg | null;
}): React.JSX.Element {
  const theme = useTheme();
  const cliFound = auth.claudeCliInstalled ?? false;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⊛ {provider.name}
        </Text>
      </Box>

      <Text color={theme.status.success}>
        No API key needed — uses your local Claude login
      </Text>
      <Box gap={1}>
        <Text dimColor>Credentials:</Text>
        <Text color={theme.ui.muted}>
          ~/.claude (managed by the Claude CLI)
        </Text>
      </Box>

      {cliFound ? (
        <Text color={theme.status.success}>✓ Claude CLI detected</Text>
      ) : (
        <Text color={theme.status.warning}>
          ⚠ Claude CLI not found — run `claude login` to sign in with your
          subscription
        </Text>
      )}

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
              Enter: set as active &amp; test
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
          Enter: save &amp; test | Esc: back
        </Text>
      </Box>
    </Box>
  );
}

interface LocalConfigProps {
  provider: ProviderInfo;
  /** True for providers whose API key is optional (Ollama Cloud). */
  optionalKey: boolean;
  /** True when the tile currently has a stored key. */
  hasKey: boolean;
  editingKey: boolean;
  keyInput: string;
  saving: boolean;
  statusMsg: StatusMsg | null;
  onKeyChange: (val: string) => void;
  onKeySubmit: (val: string) => void;
}

function LocalConfig({
  provider,
  optionalKey,
  hasKey,
  editingKey,
  keyInput,
  saving,
  statusMsg,
  onKeyChange,
  onKeySubmit,
}: LocalConfigProps): React.JSX.Element {
  const theme = useTheme();
  // Registry-sourced (via `auth:getAuthStatus`), never a hardcoded port.
  const endpoint = resolveProviderEndpoint(provider);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Text color={theme.ui.accent} bold>
          ⊡ {provider.name}
        </Text>
      </Box>

      <Text color={theme.status.success}>
        {optionalKey
          ? 'No API key required — a key is optional'
          : 'No API key needed — runs locally'}
      </Text>
      {endpoint && (
        <Box gap={1}>
          <Text dimColor>Endpoint:</Text>
          <Text color={theme.ui.muted}>{endpoint}</Text>
        </Box>
      )}
      <Text dimColor>
        {optionalKey
          ? `Without a key, requests proxy through your signed-in local Ollama. Paste an ollama.com key for direct cloud access, live models & pricing.`
          : `Make sure ${provider.name} is running before connecting.`}
      </Text>

      {optionalKey &&
        (editingKey ? (
          <Box gap={1}>
            <Text color={theme.status.warning}>Key: </Text>
            <TextInput
              value={keyInput}
              onChange={onKeyChange}
              onSubmit={onKeySubmit}
              placeholder={
                provider.keyPlaceholder || 'Optional — paste API key...'
              }
              focus={true}
              mask="*"
            />
          </Box>
        ) : hasKey ? (
          <Box gap={1}>
            <Text dimColor>Key: </Text>
            <Text color={theme.ui.dimmed} dimColor>
              {provider.maskedKeyDisplay || '••••••••••••'}
            </Text>
            <Text color={theme.status.success}> ✓</Text>
          </Box>
        ) : (
          <Box gap={1}>
            <Text dimColor>Key: </Text>
            <Text color={theme.ui.muted}>Not set (optional)</Text>
          </Box>
        ))}

      {saving ? (
        <Spinner label="Testing connection..." />
      ) : (
        !editingKey && (
          <Box marginTop={1} gap={2}>
            <Box
              borderStyle="round"
              borderColor={theme.ui.borderSubtle}
              paddingX={1}
            >
              <Text color={theme.status.success}>S: save &amp; test</Text>
            </Box>
            {optionalKey && (
              <Box
                borderStyle="round"
                borderColor={theme.ui.borderSubtle}
                paddingX={1}
              >
                <Text color={theme.ui.accent}>
                  {hasKey
                    ? 'Enter: replace optional key'
                    : 'Enter: add optional key'}
                </Text>
              </Box>
            )}
          </Box>
        )
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

      {!editingKey && (
        <Box marginTop={1}>
          <Text dimColor italic>
            {optionalKey
              ? 'Enter: edit optional key | S: save & test (keyless is fine) | Esc: back'
              : 'Enter: save & test | Esc: back'}
          </Text>
        </Box>
      )}
    </Box>
  );
}

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

interface AuthSectionProps {
  isActive: boolean;
}

export function AuthSection({ isActive }: AuthSectionProps): React.JSX.Element {
  const theme = useTheme();
  const { call, error: rpcError } = useRpc();
  const { reinitializeSdk, pushAdapter } = useTuiContext();

  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [providerIndex, setProviderIndex] = useState(0);

  const [configuring, setConfiguring] = useState(false);

  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [copilotLoggingIn, setCopilotLoggingIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMsg | null>(null);

  // User-defined entries are read from `provider:listCustomEntries` rather than
  // inferred from a flag on the auth-status projection: this call also carries
  // the lane, tiers and pricing the edit form has to pre-fill, which the tile
  // projection deliberately does not include.
  const [customEntries, setCustomEntries] = useState<CustomProviderEntry[]>([]);
  const [customForm, setCustomForm] = useState<{
    mode: CustomProviderFormMode;
    entryId: string | null;
    values: CustomProviderFormValues;
  } | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [customStatus, setCustomStatus] =
    useState<CustomProviderFormStatus | null>(null);

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

  const loadCustomEntries = useCallback(async (): Promise<void> => {
    const result = await call<void, { entries: CustomProviderEntry[] }>(
      'provider:listCustomEntries',
      undefined as unknown as void,
    );
    setCustomEntries(result?.entries ?? []);
  }, [call]);

  useEffect(() => {
    void loadAuthStatus();
    void loadCustomEntries();
  }, [loadAuthStatus, loadCustomEntries]);

  const customIds = new Set(customEntries.map((entry) => entry.id));

  const tiles: string[] = authStatus
    ? [
        CLAUDE_TILE_ID,
        ...authStatus.availableProviders.map((p) => p.id),
        ADD_CUSTOM_TILE_ID,
      ]
    : [CLAUDE_TILE_ID, ADD_CUSTOM_TILE_ID];

  const selectedTileId = tiles[providerIndex] ?? CLAUDE_TILE_ID;
  const selectedProvider =
    authStatus?.availableProviders.find((p) => p.id === selectedTileId) ?? null;

  // One classification, resolved by the pure module so it is testable and so
  // `supportsOptionalApiKey` / `nativeAuth` can no longer be swallowed by the
  // broad `authType === 'none'` test (TASK_2026_172 Issues 3 & 4).
  const isAddCustomTile = selectedTileId === ADD_CUSTOM_TILE_ID;
  /** The stored entry behind the selected tile, when that tile is user-defined. */
  const selectedCustomEntry =
    customEntries.find((entry) => entry.id === selectedTileId) ?? null;

  const formKind = resolveProviderFormKind(selectedTileId, selectedProvider);
  const isClaudeTile = !isAddCustomTile && formKind === 'claude';
  const isCopilotProvider = formKind === 'copilot';
  const isCodexProvider = formKind === 'codex';
  const isAmbientProvider = formKind === 'ambient';
  const isLocalProvider =
    formKind === 'local' || formKind === 'local-optional-key';
  const isApiKeyProvider = !isAddCustomTile && formKind === 'api-key';
  const hasOptionalKey = formKeyIsOptional(formKind);
  /** Whether the SELECTED tile currently has a stored provider key. */
  const selectedHasKey =
    authStatus?.anthropicProviderId === selectedTileId &&
    (authStatus?.hasAnyProviderKey ?? false);

  // Only the two device-code providers emit login progress; every other tile
  // subscribes to nothing.
  const loginProgress = useLoginProgress(
    pushAdapter,
    isCopilotProvider || isCodexProvider ? selectedTileId : null,
  );
  // Stable across renders (useCallback in the hook) — safe as a dep, unlike
  // the freshly-built `loginProgress` object itself.
  const resetLoginProgress = loginProgress.reset;

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
        await reinitializeSdk();
      } else {
        setStatusMsg({
          type: 'error',
          text: testResult?.errorMessage ?? 'Connection test failed.',
        });
      }

      setSaving(false);
    },
    [call, loadAuthStatus, reinitializeSdk],
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

  /**
   * Optional-key submit (Ollama Cloud). Unlike {@link handleProviderKeySubmit}
   * an EMPTY value is meaningful, not a no-op: it clears any stored key and
   * saves the provider keyless, which is the supported signin-only mode.
   * `auth:saveSettings` deletes the key when `providerApiKey` is blank.
   */
  const handleOptionalKeySubmit = useCallback(
    async (value: string): Promise<void> => {
      setEditingKey(false);
      setKeyInput('');

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
    resetLoginProgress();
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
      await reinitializeSdk();
    } else {
      setStatusMsg({ type: 'error', text: result?.error ?? 'Login failed.' });
    }
    setCopilotLoggingIn(false);
  }, [call, loadAuthStatus, reinitializeSdk, resetLoginProgress]);

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
    resetLoginProgress();
    // In the TUI runtime this RPC now runs `codex login --device-auth` to
    // completion and reports the real exit status, so success here means the
    // login actually finished — not merely that a command was dispatched.
    const result = await call<void, { success: boolean; error?: string }>(
      'auth:codexLogin',
      undefined as unknown as void,
    );
    if (result?.success) {
      setStatusMsg({ type: 'success', text: 'Codex login complete.' });
      await loadAuthStatus();
      await reinitializeSdk();
    } else {
      setStatusMsg({
        type: 'error',
        text: result?.error ?? 'Failed to start Codex login.',
      });
    }
    setSaving(false);
  }, [call, loadAuthStatus, reinitializeSdk, resetLoginProgress]);

  /**
   * Probe a saved custom entry and surface the backend's message VERBATIM.
   *
   * Unlike `auth:testConnection` (which polls local SDK-adapter health and so
   * cannot tell a typo'd host from a working one), this RPC makes one real
   * round-trip through the entry's declared lane. Its message is the only
   * evidence the user has about a URL they typed themselves, so it is shown
   * unedited — no "Connection failed" paraphrase over the top of it.
   */
  const runCustomTest = useCallback(
    async (id: string): Promise<void> => {
      setCustomBusy(true);
      const result = await call<
        { id: string },
        { ok: boolean; message: string; latencyMs?: number }
      >('provider:testCustomEntry', { id });
      if (!result) {
        setCustomStatus({
          type: 'error',
          text: rpcError ?? 'provider:testCustomEntry returned no result.',
        });
      } else {
        setCustomStatus({
          type: result.ok ? 'success' : 'error',
          text:
            result.latencyMs !== undefined
              ? `${result.message} (${result.latencyMs}ms)`
              : result.message,
        });
      }
      setCustomBusy(false);
    },
    [call, rpcError],
  );

  const handleCustomSubmit = useCallback(
    async (entry: CustomProviderEntry, apiKey?: string): Promise<void> => {
      const form = customForm;
      if (!form) return;

      setCustomBusy(true);
      setCustomStatus(null);

      const isEdit = form.mode === 'edit' && form.entryId !== null;
      const result = isEdit
        ? await call<
            {
              id: string;
              changes: Omit<CustomProviderEntry, 'id'>;
              apiKey?: string;
            },
            { entry: CustomProviderEntry }
          >('provider:updateCustomEntry', {
            id: form.entryId as string,
            changes: (({ id: _id, ...rest }) => rest)(entry),
            ...(apiKey ? { apiKey } : {}),
          })
        : await call<
            { entry: CustomProviderEntry; apiKey?: string },
            { entry: CustomProviderEntry }
          >('provider:addCustomEntry', {
            entry,
            ...(apiKey ? { apiKey } : {}),
          });

      if (!result) {
        setCustomStatus({
          type: 'error',
          text: rpcError ?? 'Could not save the custom provider.',
        });
        setCustomBusy(false);
        return;
      }

      await loadCustomEntries();
      await loadAuthStatus();
      setCustomForm(null);
      setCustomBusy(false);
      // Save & Test: a user-typed endpoint that saves cleanly still proves
      // nothing, so the probe runs immediately after the write.
      await runCustomTest(result.entry?.id ?? entry.id);
    },
    [
      call,
      customForm,
      loadAuthStatus,
      loadCustomEntries,
      rpcError,
      runCustomTest,
    ],
  );

  const handleCustomDelete = useCallback(async (): Promise<void> => {
    const id = customForm?.entryId;
    if (!id) return;
    setCustomBusy(true);
    setCustomStatus(null);
    const result = await call<{ id: string }, { removed: boolean }>(
      'provider:removeCustomEntry',
      { id },
    );
    if (result?.removed === true) {
      await loadCustomEntries();
      await loadAuthStatus();
      setCustomForm(null);
      setCustomStatus({ type: 'success', text: `Removed ${id}.` });
    } else {
      setCustomStatus({
        type: 'error',
        text: rpcError ?? `Could not remove ${id}.`,
      });
    }
    setCustomBusy(false);
  }, [call, customForm, loadAuthStatus, loadCustomEntries, rpcError]);

  const browseNav = useKeyboardNav({
    itemCount: tiles.length,
    isActive: isActive && !loading && !configuring,
    onSelect: (index: number) => {
      setConfiguring(true);
      setStatusMsg(null);
      setEditingKey(false);
      setKeyInput('');
      setCustomStatus(null);
      // The add tile is an action, so selecting it opens the create form
      // directly instead of a provider configurator with nothing to configure.
      setCustomForm(
        tiles[index] === ADD_CUSTOM_TILE_ID
          ? {
              mode: 'create',
              entryId: null,
              values: emptyCustomProviderForm(),
            }
          : null,
      );
    },
  });

  useEffect(() => {
    setProviderIndex(browseNav.activeIndex);
  }, [browseNav.activeIndex]);

  // Mirrors the guard on the handler below exactly. Escape backs out of the
  // provider configurator and nothing else — before the claim it also reached
  // the AppShell handler, which left Settings in the same press.
  useEscapeClaim(
    'settings.auth-configuring',
    configuring && !editingKey && !saving && !copilotLoggingIn && !customForm,
  );

  // The custom-provider form binds its own Escape (cancel), so it holds its own
  // claim — otherwise one press would close the form AND leave Settings.
  useEscapeClaim(
    'settings.auth-custom-form',
    customForm !== null && !customBusy,
  );

  useInput(
    (input, key) => {
      if (
        !configuring ||
        editingKey ||
        saving ||
        copilotLoggingIn ||
        customForm
      ) {
        return;
      }

      // `e` on a user-defined tile opens the same form the add tile uses, in
      // edit mode — that form owns delete (with confirm) too, so there is one
      // destructive path rather than a second bare chord.
      if (
        (input === 'e' || input === 'E') &&
        !key.ctrl &&
        selectedCustomEntry
      ) {
        setCustomStatus(null);
        setCustomForm({
          mode: 'edit',
          entryId: selectedCustomEntry.id,
          values: customProviderFormFromEntry(selectedCustomEntry),
        });
        return;
      }

      if (
        (input === 't' || input === 'T') &&
        !key.ctrl &&
        selectedCustomEntry
      ) {
        void runCustomTest(selectedCustomEntry.id);
        return;
      }

      if (key.escape) {
        setConfiguring(false);
        setStatusMsg(null);
        setEditingKey(false);
        setKeyInput('');
        return;
      }

      // Enter opens the key editor for every tile that accepts a key —
      // including the OPTIONAL-key tiles, which previously had no way in at
      // all because they were classified as plain local providers.
      if (key.return && (isClaudeTile || isApiKeyProvider || hasOptionalKey)) {
        setEditingKey(true);
        setKeyInput('');
        return;
      }

      if (key.return && isCopilotProvider) {
        if (authStatus?.copilotAuthenticated) {
          void handleCopilotLogout();
        } else {
          void handleCopilotLogin();
        }
        return;
      }

      if (key.return && isCodexProvider) {
        void handleCodexLogin();
        return;
      }

      // Keyless local tiles + the ambient Claude tile: Enter is "activate".
      // (Optional-key tiles were already handled above; `S` saves them.)
      if (key.return && (isLocalProvider || isAmbientProvider)) {
        void handleSaveAndTestExisting();
        return;
      }

      if (
        (input === 's' || input === 'S') &&
        !key.ctrl &&
        (isClaudeTile ||
          isApiKeyProvider ||
          isLocalProvider ||
          isAmbientProvider)
      ) {
        void handleSaveAndTestExisting();
        return;
      }
    },
    {
      isActive:
        isActive &&
        configuring &&
        !editingKey &&
        !saving &&
        !copilotLoggingIn &&
        !customForm,
    },
  );

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

  if (customForm) {
    return (
      <CustomProviderForm
        // Remounting on mode/id change is what resets the field state — the
        // form owns its values, so a stale edit must not bleed into the next.
        key={`${customForm.mode}:${customForm.entryId ?? 'new'}`}
        mode={customForm.mode}
        initialValues={customForm.values}
        busy={customBusy}
        status={customStatus}
        isActive={isActive}
        onSubmit={(entry, apiKey) => void handleCustomSubmit(entry, apiKey)}
        onTest={() => {
          if (customForm.entryId) void runCustomTest(customForm.entryId);
        }}
        onDelete={() => void handleCustomDelete()}
        onCancel={() => {
          setCustomForm(null);
          setConfiguring(false);
        }}
      />
    );
  }

  if (!configuring) {
    return (
      <BrowseView
        tiles={tiles}
        selectedIndex={providerIndex}
        auth={authStatus}
        isActive={isActive}
        customIds={customIds}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>Esc: back to providers</Text>
      </Box>

      {selectedCustomEntry && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            {customProviderSecurityNote(selectedCustomEntry.baseUrl)}
          </Text>
          <Box gap={2}>
            <KeyHint keys="e" label="edit / delete" />
            <KeyHint keys="t" label="test connection" />
          </Box>
          {customStatus && (
            <Text
              color={
                customStatus.type === 'success'
                  ? theme.status.success
                  : customStatus.type === 'error'
                    ? theme.status.error
                    : theme.status.info
              }
              wrap="wrap"
            >
              {customStatus.type === 'success' ? '✓ ' : '✗ '}
              {customStatus.text}
            </Text>
          )}
        </Box>
      )}

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

      {isCopilotProvider && (
        <CopilotConfig
          auth={authStatus}
          saving={saving}
          loggingIn={copilotLoggingIn}
          statusMsg={statusMsg}
          progress={loginProgress}
          onLogin={() => void handleCopilotLogin()}
          onLogout={() => void handleCopilotLogout()}
        />
      )}

      {isCodexProvider && (
        <CodexConfig
          auth={authStatus}
          saving={saving}
          statusMsg={statusMsg}
          progress={loginProgress}
          onLogin={() => void handleCodexLogin()}
        />
      )}

      {isAmbientProvider && selectedProvider && (
        <AmbientConfig
          provider={selectedProvider}
          auth={authStatus}
          saving={saving}
          statusMsg={statusMsg}
        />
      )}

      {isLocalProvider && selectedProvider && (
        <LocalConfig
          provider={selectedProvider}
          optionalKey={hasOptionalKey}
          hasKey={selectedHasKey}
          editingKey={editingKey}
          keyInput={keyInput}
          saving={saving}
          statusMsg={statusMsg}
          onKeyChange={setKeyInput}
          onKeySubmit={(val) => void handleOptionalKeySubmit(val)}
        />
      )}

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
