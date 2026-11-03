import type {
  ClaudeAmbientStatusView,
  CodexReadinessView,
  ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { AnthropicProviderInfo, CliDetectionResult } from '@ptah-extension/shared';

export type ProviderKind = 'claude-cli' | 'openai-codex';
export type ProviderReadinessState =
  | 'checking' | 'slow' | 'ready' | 'missing' | 'signed-out' | 'stale' | 'error';
export type ProviderReadinessErrorCause =
  | 'timeout' | 'unreadable' | 'home' | 'local';

export interface ProviderReadinessView {
  readonly provider: ProviderKind;
  readonly state: ProviderReadinessState;
  readonly errorCause: ProviderReadinessErrorCause | null;
  readonly failedFact: 'binary' | 'sign-in' | null;
  readonly path: string | null;
  readonly version: string | null;
  readonly source: 'installed' | 'bundled' | null;
}

export interface ClaudeReadinessInputs {
  readonly detection: ProvidersSettingsSection<readonly CliDetectionResult[]>;
  readonly ambient: ClaudeAmbientStatusView;
  /** True only during the mount follow-up cycle. */
  readonly retrying?: boolean;
}

function view(
  provider: ProviderKind,
  state: ProviderReadinessState,
  path: string | null = null,
  version: string | null = null,
  source: 'installed' | 'bundled' | null = null,
  errorCause: ProviderReadinessErrorCause | null = null,
  failedFact: 'binary' | 'sign-in' | null = null,
): ProviderReadinessView {
  return { provider, state, errorCause, failedFact, path, version, source };
}

/** Preserve the existing Claude first-match order and installed-row facts. */
export function deriveClaudeReadiness(input: ClaudeReadinessInputs): ProviderReadinessView {
  const { detection, ambient, retrying = false } = input;
  const row = detection.data?.find((entry) => entry.cli === 'claude');
  const path = row?.installed ? row.path ?? null : null;
  const version = row?.installed ? row.version ?? null : null;
  const result = ambient.result;
  const make = (state: ProviderReadinessState, cause: ProviderReadinessErrorCause | null = null) =>
    view('claude-cli', state, path, version, row?.installed ? 'installed' : null, cause,
      cause === null ? null : 'sign-in');

  if (detection.status === 'unloaded' || detection.status === 'loading' ||
      ambient.status === 'checking' || ambient.status === 'idle' || ambient.status === 'inert') {
    return view('claude-cli', 'checking');
  }
  if ((detection.status === 'ready' && row?.installed === false) ||
      (result?.state === 'unknown' && result.reason === 'cli-missing')) {
    return make('missing');
  }
  if (detection.status === 'error' || !row) {
    return view('claude-cli', 'error', path, version, row?.installed ? 'installed' : null,
      'local', 'binary');
  }
  if (ambient.transportTimeout || (result?.state === 'unknown' && result.reason === 'timeout')) {
    return make(retrying ? 'slow' : 'error', retrying ? null : 'timeout');
  }
  if (ambient.localFailure || !result) return make('error', 'local');
  if (result.state === 'unknown') {
    return make('error', result.reason === 'unreadable' ? 'unreadable' : 'local');
  }
  return make(result.state === 'connected' ? 'ready' : 'signed-out');
}

export function deriveCodexReadiness(
  input: CodexReadinessView,
  retrying = false,
): ProviderReadinessView {
  const result = input.result;
  const binary = result?.binary;
  const path = binary?.state === 'found' ? binary.path : null;
  const version = binary?.state === 'found' ? binary.version : null;
  const source = binary?.state === 'found' ? binary.source : null;
  const make = (state: ProviderReadinessState, cause: ProviderReadinessErrorCause | null = null,
    fact: 'binary' | 'sign-in' | null = null) =>
    view('openai-codex', state, path, version, source, cause, fact);

  if (input.status !== 'ready') return make('checking');
  if (binary?.state === 'missing') return make('missing');
  if (binary?.state === 'unknown') {
    const cause = binary.reason;
    return make(cause === 'timeout' && retrying ? 'slow' : 'error',
      cause === 'timeout' && retrying ? null : cause, 'binary');
  }
  if (input.transportTimeout || result?.signIn.outcome === 'timeout') {
    return make(retrying ? 'slow' : 'error', retrying ? null : 'timeout', 'sign-in');
  }
  if (input.localFailure || !result) return make('error', 'local', 'sign-in');
  switch (result.signIn.outcome) {
    case 'signed-in': return make('ready');
    case 'signed-out': return make('signed-out');
    case 'stale': return make('stale');
    case 'unreadable': return make('error',
      result.signIn.unreadable === 'home' ? 'home' : 'unreadable', 'sign-in');
  }
}

export type SelectionView =
  | { readonly kind: 'loading' | 'unreadable' | 'not-confirmed' }
  | { readonly kind: ProviderKind }
  | { readonly kind: 'other'; readonly name: string };

export interface SelectionInputs {
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
  readonly authMethod: string;
  readonly providerId: string;
  readonly availableProviders: readonly Pick<AnthropicProviderInfo, 'id' | 'name'>[];
}

export function deriveSelection(input: SelectionInputs): SelectionView {
  if (!input.isLoaded) return { kind: input.isLoading ? 'loading' : 'unreadable' };
  if (input.authMethod === 'claudeCli') return { kind: 'claude-cli' };
  if (input.authMethod === 'thirdParty' && input.providerId === 'openai-codex') {
    return { kind: 'openai-codex' };
  }
  return { kind: 'other', name: input.authMethod === 'apiKey'
    ? 'Anthropic API key'
    : input.availableProviders.find((entry) => entry.id === input.providerId)?.name ?? input.providerId };
}

export interface ChosenConnectionView {
  readonly selection: SelectionView;
  readonly provider: ProviderKind | null;
  readonly name: string;
  readonly readiness: ProviderReadinessView | null;
}

export function deriveChosen(
  selection: SelectionView,
  claude: ProviderReadinessView,
  codex: ProviderReadinessView,
): ChosenConnectionView {
  const provider = selection.kind === 'claude-cli' || selection.kind === 'openai-codex'
    ? selection.kind : null;
  return {
    selection,
    provider,
    name: provider === 'claude-cli' ? 'Claude Code'
      : provider === 'openai-codex' ? 'Codex'
      : selection.kind === 'other' ? selection.name : 'Connection',
    readiness: provider === 'claude-cli' ? claude : provider === 'openai-codex' ? codex : null,
  };
}
