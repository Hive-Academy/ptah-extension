import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  GatewayApproveBindingResult,
  GatewayBindingDto,
  GatewayBlockBindingResult,
  GatewayListBindingsResult,
  GatewayPlatformId,
  GatewaySetTokenResult,
  GatewayStartResult,
  GatewayStatusChangedPayload,
  GatewayStatusResult,
  GatewayStopResult,
} from '@ptah-extension/shared';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useTuiContext } from '../../context/TuiContext.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { FormField, ListItem } from '../molecules/index.js';

interface GatewayPanelProps {
  isActive: boolean;
  degraded: boolean;
  reason?: string;
}

type GatewayMode = 'overview' | 'token' | 'approve';

const PLATFORMS: readonly GatewayPlatformId[] = [
  'telegram',
  'discord',
  'slack',
];

export function GatewayPanel({
  isActive,
  degraded,
  reason,
}: GatewayPanelProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();
  const { pushAdapter } = useTuiContext();

  const [mode, setMode] = useState<GatewayMode>('overview');
  const [status, setStatus] = useState<GatewayStatusResult | null>(null);
  const [bindings, setBindings] = useState<GatewayBindingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [platformIndex, setPlatformIndex] = useState(0);
  const [tokenInput, setTokenInput] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, GatewayStatusResult>(
      'gateway:status',
      {},
    );
    if (result) setStatus(result);
  }, [call]);

  const loadBindings = useCallback(async (): Promise<void> => {
    const result = await call<Record<string, never>, GatewayListBindingsResult>(
      'gateway:listBindings',
      {},
    );
    setBindings(result?.bindings ?? []);
  }, [call]);

  useEffect(() => {
    if (degraded) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadBindings()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [degraded, loadStatus, loadBindings]);

  useEffect(() => {
    if (degraded) return;
    const handler = (payload: GatewayStatusChangedPayload): void => {
      setStatus(payload.status);
    };
    pushAdapter.on(MESSAGE_TYPES.GATEWAY_STATUS_CHANGED, handler);
    return () => {
      pushAdapter.off(MESSAGE_TYPES.GATEWAY_STATUS_CHANGED, handler);
    };
  }, [degraded, pushAdapter]);

  const pendingBindings = bindings.filter(
    (b) => b.approvalStatus === 'pending',
  );

  const navActive =
    isActive && !degraded && mode === 'approve' && !busy;

  const { activeIndex } = useKeyboardNav({
    itemCount: pendingBindings.length,
    isActive: navActive,
  });

  const toggleAdapter = useCallback(
    async (platform: GatewayPlatformId, running: boolean): Promise<void> => {
      setBusy(true);
      if (running) {
        await call<{ platform: GatewayPlatformId }, GatewayStopResult>(
          'gateway:stop',
          { platform },
        );
      } else {
        await call<{ platform: GatewayPlatformId }, GatewayStartResult>(
          'gateway:start',
          { platform },
        );
      }
      await loadStatus();
      setBusy(false);
    },
    [call, loadStatus],
  );

  const submitToken = useCallback(
    async (value: string): Promise<void> => {
      const platform = PLATFORMS[platformIndex];
      const token = value;
      setTokenInput('');
      if (!token.trim()) {
        setMode('overview');
        return;
      }
      setBusy(true);
      const result = await call<
        { platform: GatewayPlatformId; token: string },
        GatewaySetTokenResult
      >('gateway:setToken', { platform, token });
      setNotice(result?.ok ? `Token saved for ${platform}.` : null);
      setBusy(false);
      setMode('overview');
      await loadStatus();
    },
    [call, platformIndex, loadStatus],
  );

  const approveBinding = useCallback(
    async (binding: GatewayBindingDto, code: string): Promise<void> => {
      if (!code.trim()) return;
      setBusy(true);
      const result = await call<
        { bindingId: string; code: string },
        GatewayApproveBindingResult
      >('gateway:approveBinding', { bindingId: binding.id, code: code.trim() });
      setApprovalCode('');
      setNotice(
        result?.ok ? 'Binding approved.' : 'Approval failed (invalid code).',
      );
      await loadBindings();
      setBusy(false);
    },
    [call, loadBindings],
  );

  const blockBinding = useCallback(
    async (binding: GatewayBindingDto): Promise<void> => {
      setBusy(true);
      await call<{ bindingId: string }, GatewayBlockBindingResult>(
        'gateway:blockBinding',
        { bindingId: binding.id },
      );
      await loadBindings();
      setBusy(false);
    },
    [call, loadBindings],
  );

  useInput(
    (input, key) => {
      if (degraded || busy) return;

      if (mode === 'token') {
        if (key.escape) {
          setTokenInput('');
          setMode('overview');
        }
        return;
      }

      if (mode === 'approve') {
        if (key.escape) {
          setApprovalCode('');
          setMode('overview');
          return;
        }
        const binding = pendingBindings[activeIndex];
        if (!binding) return;
        if (input === 'b') void blockBinding(binding);
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input === 't') {
        setPlatformIndex((prev) => (prev + 1) % PLATFORMS.length);
        return;
      }
      if (input === 'k') {
        setNotice(null);
        setMode('token');
        return;
      }
      if (input === 'a') {
        setNotice(null);
        setMode('approve');
        return;
      }
      if (input === 's') {
        const platform = PLATFORMS[platformIndex];
        const adapter = status?.adapters.find((a) => a.platform === platform);
        void toggleAdapter(platform, adapter?.running ?? false);
      }
    },
    { isActive: isActive && !degraded && !busy },
  );

  if (degraded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>
          Gateway subsystem degraded{reason ? ` — ${reason}` : ''}.
        </Text>
        <Text dimColor>Chat remains available; gateway features are paused.</Text>
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Loading gateway…" />;
  }

  const selectedPlatform = PLATFORMS[platformIndex];

  if (mode === 'token') {
    return (
      <Box flexDirection="column">
        <FormField label={`${selectedPlatform} bot token`} required>
          <TextInput
            value={tokenInput}
            onChange={setTokenInput}
            onSubmit={(val) => {
              void submitToken(val);
            }}
            mask="*"
            focus={true}
            placeholder="paste token and press Enter"
          />
        </FormField>
        {busy ? <Spinner label="Saving…" /> : null}
        <Box marginTop={1}>
          <KeyHint keys="T" label="cycle platform (overview)" />
          <KeyHint keys="Esc" label="cancel" separator />
        </Box>
      </Box>
    );
  }

  if (mode === 'approve') {
    const binding = pendingBindings[activeIndex];
    return (
      <Box flexDirection="column">
        <Text color={theme.ui.accent} bold>
          Pending bindings
        </Text>
        {pendingBindings.length === 0 ? (
          <Text dimColor>No pending bindings.</Text>
        ) : (
          pendingBindings.map((b, index) => (
            <ListItem
              key={b.id}
              label={b.displayName ?? b.externalChatId}
              description={b.platform}
              isSelected={index === activeIndex && isActive}
            />
          ))
        )}
        {binding ? (
          <Box marginTop={1}>
            <Text color={theme.status.warning}>Pairing code: </Text>
            <TextInput
              value={approvalCode}
              onChange={setApprovalCode}
              onSubmit={(val) => {
                void approveBinding(binding, val);
              }}
              placeholder="6-digit code"
              focus={true}
            />
          </Box>
        ) : null}
        <Box marginTop={1} gap={2}>
          <KeyHint keys="Enter" label="approve" />
          <KeyHint keys="B" label="block" />
          <KeyHint keys="Esc" label="back" />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>gateway: </Text>
        <Badge variant={status?.enabled ? 'success' : 'ghost'}>
          {status?.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Box>

      {PLATFORMS.map((platform, index) => {
        const adapter = status?.adapters.find((a) => a.platform === platform);
        const running = adapter?.running ?? false;
        return (
          <ListItem
            key={platform}
            label={platform}
            isSelected={index === platformIndex && isActive}
            badge={
              <Badge variant={running ? 'success' : 'ghost'}>
                {running ? 'running' : 'stopped'}
              </Badge>
            }
            description={adapter?.lastError ? `error: ${adapter.lastError}` : undefined}
          />
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          {pendingBindings.length} pending binding
          {pendingBindings.length === 1 ? '' : 's'}
        </Text>
      </Box>

      {notice ? (
        <Box marginTop={1}>
          <Text color={theme.status.info}>{notice}</Text>
        </Box>
      ) : null}

      {busy ? (
        <Box marginTop={1}>
          <Spinner label="Working…" />
        </Box>
      ) : null}

      <Box marginTop={1} gap={2}>
        <KeyHint keys="T" label="select platform" />
        <KeyHint keys="S" label="start/stop" />
        <KeyHint keys="K" label="set token" />
        <KeyHint keys="A" label="approvals" />
      </Box>
    </Box>
  );
}

export default GatewayPanel;
