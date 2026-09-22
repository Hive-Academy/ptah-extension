/**
 * ProviderSetupWizardComponent — TASK_2026_523_c3df, group D1 (the wizard).
 *
 * Five-step guided provider setup inside `NativeDrawerComponent`
 * (design-spec.md "Wizard" and "Step affordance spec"): Provider /
 * Credential / Verify / Models / Scope.
 *
 * Rules honoured here:
 * - The verification exercises the DRAFT, never the persisted route. The
 *   draft lives in memory, is masked, and nothing is written to disk before
 *   the host commits. The draft credential leaves through
 *   `commitRequested` only, as a transient value.
 * - A failed probe stays on the Verify step: the non-secret values and the
 *   in-memory draft stay intact, and no state resets.
 * - Results from superseded probes are discarded (`probeId` mismatch or a
 *   settled probe), which is why `cancelDraftVerification` exists.
 * - Probe failure copy comes from a data map keyed by `ProbeFailureReason`.
 *   No message string is parsed, and no raw error text is rendered.
 * - The picker emits `''` for "provider default"; the literal `'inherit'`
 *   never appears in this component (sentinel translated at the review
 *   binding on the Scope step).
 * - Never `[innerHTML]`; never render a raw error message or a secret.
 *
 * The wizard owns no persistence and performs no RPC call itself: the probe
 * and cancel seams arrive as required inputs (see `## Backend seam` of the
 * batch report), and the commit goes out through `commitRequested`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { LucideAngularModule, Check, Loader2, Server } from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import {
  NativeDrawerComponent,
  ProviderMarkComponent,
  ProviderModelPickerComponent,
} from '@ptah-extension/ui';
import type { ProviderModelSelection, ProviderMarkLucideIcon } from '@ptah-extension/ui';
import { getAllAnthropicProviders, getAnthropicProvider, validateProviderBaseUrl } from '@ptah-extension/shared';
import type {
  AnthropicProvider,
  AuthCancelDraftVerificationParams,
  AuthCancelDraftVerificationResult,
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
  ProbeFailureReason,
  ProviderModelTier,
  SettingScope,
} from '@ptah-extension/shared';

/** One of the five wizard steps. */
export type WizardStepId = 'provider' | 'credential' | 'verify' | 'models' | 'scope';

/** The wizard's auth mode, as the draft-probe contract spells it. */
export type WizardAuthMode = AuthVerifyDraftConnectionParams['authMode'];

/**
 * Backend seam a later batch wires: run one draft probe
 * (`ClaudeRpcService.call('auth:verifyDraftConnection', params)`).
 */
export type DraftVerifyConnectionFn = (
  params: AuthVerifyDraftConnectionParams,
) => Promise<AuthVerifyDraftConnectionResult>;

/** Backend seam a later batch wires: abort one draft probe. */
export type DraftCancelVerificationFn = (
  params: AuthCancelDraftVerificationParams,
) => Promise<AuthCancelDraftVerificationResult>;

/** Sign-in state the host reports for OAuth / CLI modes. */
export type WizardSignInState = 'idle' | 'in-flight' | 'signed-in' | 'failed';

/** External sign-in and CLI-installation state the host mirrors in. */
export interface WizardExternalAuthState {
  readonly signInState: WizardSignInState;
  /** Human-readable account identity, when the host knows one. */
  readonly accountLabel: string | null;
  /** `null` when the host has not checked CLI installation yet. */
  readonly cliInstalled: boolean | null;
}

/** Requests for sign-in and CLI-installation work the host must perform. */
export type WizardExternalAction = 'sign-in' | 'sign-in-cancel' | 'cli-login' | 'cli-check';

/** Host-reported commit progress on the Scope step. */
export type WizardCommitState = 'idle' | 'saving' | 'saved' | 'failed';

/** What happens to the connection after the host commits. */
export type WizardActivation = 'connect-only' | 'use-main-agent';

/** Model tier slot of the Models step. */
export type WizardTierKey = 'everyday' | 'complex' | 'fast';

/** Tier mapping carried to the host; `''` means the provider default tier. */
export interface ProviderWizardTierMappings {
  readonly everyday: string;
  readonly complex: string;
  readonly fast: string;
}

/**
 * Everything the host needs to create and connect the provider in one
 * commit. The credential is TRANSIENT: the host persists it through the
 * secret store only, and nothing was written to disk before this output.
 */
export interface ProviderWizardCommit {
  /** Registry id, or the draft custom id for a custom endpoint. */
  readonly providerId: string;
  readonly displayName: string;
  readonly authMode: WizardAuthMode;
  /** Set only for a custom endpoint draft. */
  readonly customName: string | null;
  /** Set only for a custom endpoint draft. */
  readonly customProtocol: 'openai' | 'anthropic' | null;
  /** TRANSIENT draft credential; `null` when no new key was entered. */
  readonly credential: { kind: 'apiKey'; value: string } | null;
  /** True when the existing stored key stays in use and no key was sent. */
  readonly existingKeyReused: boolean;
  /** Base URL for local and custom modes; `null` elsewhere. */
  readonly baseUrl: string | null;
  /** Verified probe evidence, when the draft was verified. */
  readonly verified: {
    readonly probeId: string;
    readonly checkedAt: string;
    readonly latencyMs: number | null;
    readonly modelUsed: string | null;
  } | null;
  /** Tier mappings; `''` entries mean the provider default tier. */
  readonly tiers: ProviderWizardTierMappings;
  readonly saveTo: SettingScope;
  readonly activation: WizardActivation;
}

interface WizardStepDef {
  readonly id: WizardStepId;
  readonly label: string;
}

interface WizardTierDef {
  readonly key: WizardTierKey;
  readonly tier: ProviderModelTier;
  readonly label: string;
}

interface WizardProviderOption {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly fallback: ProviderMarkLucideIcon;
}

/** Selection on the Provider step: a registry entry or the custom endpoint. */
type WizardSelection = { readonly kind: 'registry'; readonly id: string } | { readonly kind: 'custom' };

/** Probe state machine of the Verify step. */
export type WizardProbeState = 'idle' | 'checking' | 'verified' | 'failed' | 'cancelled';

interface ProbeCopyContext {
  readonly hostname: string;
  readonly probeLimitSeconds: number;
  readonly modelUsed: string | null;
}

const STEP_ORDER: readonly WizardStepId[] = ['provider', 'credential', 'verify', 'models', 'scope'];

const STEP_DEFS = [
  { id: 'provider', label: 'Provider' },
  { id: 'credential', label: 'Credential' },
  { id: 'verify', label: 'Verify' },
  { id: 'models', label: 'Models' },
  { id: 'scope', label: 'Scope' },
] as const satisfies readonly WizardStepDef[];

const TIER_DEFS = [
  { key: 'everyday', tier: 'sonnet', label: 'Everyday · Sonnet' },
  { key: 'complex', tier: 'opus', label: 'Complex work · Opus' },
  { key: 'fast', tier: 'haiku', label: 'Fast work · Haiku' },
] as const satisfies readonly WizardTierDef[];

const TIER_KEYS: readonly WizardTierKey[] = ['everyday', 'complex', 'fast'];

/** Radio value of the custom-endpoint option on the Provider step. */
const CUSTOM_RADIO_VALUE = '__custom__';

const AUTH_MODE_LABELS: Readonly<Record<WizardAuthMode, string>> = {
  apiKey: 'API key',
  oauth: 'Provider sign-in',
  cli: 'CLI subscription login',
  'local-native': 'Local server',
  'local-proxy': 'Local server (proxied)',
  custom: 'Custom endpoint',
};

const SAVE_TARGET_LABELS: Readonly<Record<SettingScope, string>> = {
  global: 'Global · all apps',
  app: 'Desktop app',
  workspace: 'This workspace',
};

/**
 * Probe failure copy, keyed by `ProbeFailureReason`. The copy never parses a
 * message string, and the sanitized backend detail renders only inside the
 * collapsed diagnostics disclosure.
 */
const PROBE_FAILURE_COPY: Readonly<
  Record<ProbeFailureReason, (context: ProbeCopyContext) => string>
> = {
  'credential-rejected': () =>
    'The provider rejected this credential. Replace it or sign in again.',
  'permission-denied': () =>
    'This account cannot use the requested service or model.',
  unreachable: (context) =>
    `Could not reach ${context.hostname}. Check the address and that the service is running.`,
  timeout: (context) =>
    `No response within ${context.probeLimitSeconds} seconds. Check the service and retry.`,
  'rate-limited': () =>
    'The provider is rate-limiting requests. Retry in a moment.',
  'quota-exhausted': () =>
    'This account has no available quota for the test.',
  'model-unavailable': (context) =>
    `${context.modelUsed ?? 'The requested model'} is not available on this connection.`,
  cancelled: () =>
    'Connection check cancelled. Nothing was activated.',
  unclassified: () =>
    'The connection check failed. Retry or review the connection details.',
};

/** Monotonic probe id source; generation token of the draft probe. */
let PROBE_COUNTER = 0;

/** Auth mode of a registry entry, from its own flags — no id branching. */
function deriveAuthMode(entry: AnthropicProvider): WizardAuthMode {
  if (entry.nativeAuth) return 'cli';
  if (entry.authType === 'oauth') return 'oauth';
  if (entry.isLocal) return entry.requiresProxy ? 'local-proxy' : 'local-native';
  return 'apiKey';
}

/** Auth-method line of a provider entry on the Provider step. */
function authSummaryFor(entry: AnthropicProvider): string {
  if (entry.nativeAuth) return 'CLI subscription login';
  if (entry.authType === 'oauth') return 'Sign-in with your provider account';
  if (entry.isLocal) {
    return entry.supportsOptionalApiKey
      ? 'Local server · optional API key'
      : 'Local server · no API key required';
  }
  return 'API key';
}

/** Structural mark fallback for a provider entry — flag driven, not id driven. */
function markFallbackFor(entry: AnthropicProvider): ProviderMarkLucideIcon {
  if (entry.nativeAuth) return 'Terminal';
  return entry.isLocal ? 'Server' : 'Bot';
}

/** Hostname of a base URL, or the provider name when the URL does not parse. */
function hostnameOf(baseUrl: string | null, fallback: string): string {
  if (!baseUrl) return fallback;
  try {
    const parsed = new URL(baseUrl);
    return parsed.host || fallback;
  } catch {
    return fallback;
  }
}

@Component({
  selector: 'ptah-provider-setup-wizard',
  standalone: true,
  imports: [LucideAngularModule, NativeDrawerComponent, ProviderMarkComponent, ProviderModelPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Static progress glyph under prefers-reduced-motion. */
    .ptah-wizard-spinner {
      animation: ptah-wizard-spin 1s linear infinite;
    }
    @keyframes ptah-wizard-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ptah-wizard-spinner {
        animation: none;
      }
    }
  `,
  template: `
    <ptah-native-drawer
      [isOpen]="open()"
      widthClass="w-full max-w-2xl"
      ariaLabel="Connect provider"
      (closed)="requestWizardClose()"
    >
      <div drawer-header class="flex items-start gap-3">
        @if (hasSelection()) {
          <ptah-provider-mark [providerId]="markProviderId()" [fallback]="markFallback()" />
        }
        <div class="min-w-0">
          <h2
            id="wizard-title"
            class="text-lg font-semibold text-base-content"
            data-testid="wizard-title"
          >
            {{ wizardTitle() }}
          </h2>
          <p class="text-xs text-base-content-muted" data-testid="wizard-subtitle">
            {{ wizardSubtitle() }}
          </p>
        </div>
      </div>

      <div class="border-b border-base-300 bg-base-100 p-3" data-testid="wizard-progress">
        <ol
          class="steps steps-horizontal hidden w-full text-xs sm:flex"
          data-testid="wizard-steps"
        >
          @for (step of STEP_DEFS; track step.id; let i = $index) {
            <li
              class="step"
              [class.step-primary]="stepIndex() >= i"
              [attr.aria-current]="isCurrentStep(step.id) ? 'step' : null"
            >
              @if (isCompletedStep(step.id)) {
                <button
                  type="button"
                  class="min-h-9 text-xs text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  [disabled]="probeChecking()"
                  (click)="goToStep(step.id)"
                  data-testid="wizard-step-link"
                >
                  {{ step.label }}<span class="sr-only"> · Complete</span>
                </button>
              } @else {
                <span [class.opacity-50]="!isCurrentStep(step.id)" class="text-xs">{{
                  step.label
                }}</span>
              }
            </li>
          }
        </ol>
        <p
          class="text-xs font-semibold text-base-content sm:hidden"
          data-testid="wizard-mobile-step"
        >
          Step {{ stepIndex() + 1 }} of 5 · {{ currentLabel() }}
        </p>
        <details class="sm:hidden" data-testid="wizard-mobile-steps">
          <summary
            class="min-h-9 cursor-pointer text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          >
            All steps
          </summary>
          <ul class="mt-1 space-y-1">
            @for (step of STEP_DEFS; track step.id; let i = $index) {
              <li>
                @if (isCompletedStep(step.id)) {
                  <button
                    type="button"
                    class="min-h-9 text-xs text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [disabled]="probeChecking()"
                    (click)="goToStep(step.id)"
                    data-testid="wizard-step-link"
                  >
                    {{ step.label }}<span class="sr-only"> · Complete</span>
                  </button>
                } @else if (isCurrentStep(step.id)) {
                  <span class="text-xs font-semibold text-base-content">{{ step.label }}</span>
                } @else {
                  <span class="text-xs text-base-content-muted">{{ step.label }}</span>
                }
              </li>
            }
          </ul>
        </details>
      </div>

      <div class="space-y-4 p-3" data-testid="wizard-body" #wizardHost>
        @if (closeReview()) {
          <div
            class="rounded-md border border-base-300 bg-base-100 p-3"
            data-testid="wizard-discard-review"
          >
            <p
              #closeReviewHeading
              tabindex="-1"
              class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              data-testid="wizard-discard-heading"
            >
              Discard this setup?
            </p>
            <p class="text-xs text-base-content-muted" data-testid="wizard-discard-copy">
              Your credential, verification, and model choices are not saved. Nothing was written to disk.
            </p>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                (click)="onKeepEditing()"
                data-testid="wizard-discard-keep"
              >
                Keep editing
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                (click)="onDiscard()"
                data-testid="wizard-discard-confirm"
              >
                Discard
              </button>
            </div>
          </div>
        }

        @if (externalMessage()) { <p role="status">{{ externalMessage() }}</p> }
      @switch (step()) {
          @case ('provider') {
            <div data-testid="wizard-step-provider">
              <h3
                #stepHeading
                tabindex="-1"
                class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="wizard-step-heading"
              >
                Provider
              </h3>
              <label class="mt-3 flex flex-col gap-1">
                <span class="text-xs font-medium text-base-content-muted" id="wizard-search-label"
                  >Search providers</span
                >
                <input
                  type="text"
                  class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  aria-labelledby="wizard-search-label"
                  [value]="search()"
                  (input)="onSearchInput($event)"
                  data-testid="wizard-provider-search"
                />
              </label>
              <fieldset class="mt-3 space-y-2" data-testid="wizard-provider-options">
                <legend class="text-sm font-semibold text-base-content">Choose a provider</legend>
                @for (option of providerOptions(); track option.id) {
                  <label
                    class="flex items-start gap-2 rounded-md border border-base-300 bg-base-100 p-2"
                    data-testid="wizard-provider-option"
                  >
                    <input
                      type="radio"
                      class="radio radio-sm mt-0.5"
                      name="wizard-provider"
                      [value]="option.id"
                      [checked]="selectionId() === option.id"
                      (change)="onSelectProvider($event, option.id)"
                      data-testid="wizard-provider-radio"
                    />
                    <ptah-provider-mark [providerId]="option.id" [fallback]="option.fallback" />
                    <span class="min-w-0">
                      <span class="block text-sm text-base-content">{{ option.name }}</span>
                      <span class="block break-all text-xs text-base-content-muted">{{
                        option.summary
                      }}</span>
                    </span>
                  </label>
                } @empty {
                  <p
                    class="text-xs text-base-content-muted"
                    data-testid="wizard-provider-no-match"
                  >
                    No providers match “{{ search() }}”.
                  </p>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    (click)="onClearSearch()"
                    data-testid="wizard-clear-search"
                  >
                    Clear search
                  </button>
                }
                <label
                  class="flex items-start gap-2 rounded-md border border-base-300 bg-base-100 p-2"
                  data-testid="wizard-provider-custom-option"
                >
                  <input
                    type="radio"
                    class="radio radio-sm mt-0.5"
                    name="wizard-provider"
                    [value]="CUSTOM_RADIO_VALUE"
                    [checked]="isCustomSelected()"
                    (change)="onSelectCustom($event)"
                    data-testid="wizard-provider-custom-radio"
                  />
                  <lucide-angular [img]="ServerIcon" class="h-6 w-6 text-base-content" aria-hidden="true" />
                  <span class="min-w-0">
                    <span class="block text-sm text-base-content">Custom endpoint</span>
                    <span class="block text-xs text-base-content-muted"
                      >Enter a provider that is not in the list</span
                    >
                  </span>
                </label>
              </fieldset>

              @if (isCustomSelected()) {
                <div
                  class="mt-3 space-y-3 rounded-md border border-base-300 bg-base-100 p-3"
                  data-testid="wizard-custom-fields"
                >
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-base-content-muted"
                      >Name for this connection</span
                    >
                    <input
                      type="text"
                      class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [value]="customName()"
                      (input)="onCustomNameInput($event)"
                      [attr.aria-invalid]="customNameError() ? true : null"
                      [attr.aria-describedby]="customNameError() ? 'wizard-custom-name-error' : null"
                      data-testid="wizard-custom-name"
                    />
                  </label>
                  @if (customNameError(); as nameError) {
                    <p
                      id="wizard-custom-name-error"
                      class="text-xs text-base-content"
                      data-testid="wizard-custom-name-error"
                    >
                      {{ nameError }}
                    </p>
                  }
                  <fieldset class="space-y-2">
                    <legend class="text-xs font-medium text-base-content-muted">
                      Compatibility protocol
                    </legend>
                    <label class="flex items-start gap-2">
                      <input
                        type="radio"
                        class="radio radio-sm mt-0.5"
                        name="wizard-protocol"
                        [checked]="customProtocol() === 'openai'"
                        (change)="onProtocolSelect('openai')"
                        data-testid="wizard-protocol-openai"
                      />
                      <span class="min-w-0">
                        <span class="block text-sm text-base-content">OpenAI-compatible</span>
                        <span class="block text-xs text-base-content-muted"
                          >Uses OpenAI-style endpoints and model IDs.</span
                        >
                      </span>
                    </label>
                    <label class="flex items-start gap-2 rounded-md bg-base-100 p-2">
                      <input
                        type="radio"
                        class="radio radio-sm mt-0.5"
                        name="wizard-protocol"
                        [checked]="customProtocol() === 'anthropic'"
                        (change)="onProtocolSelect('anthropic')"
                        data-testid="wizard-protocol-anthropic"
                      />
                      <span class="min-w-0">
                        <span class="block text-sm text-base-content">Anthropic-compatible</span>
                        <span class="block text-xs text-base-content-muted"
                          >Speaks the Anthropic Messages API.</span
                        >
                      </span>
                    </label>
                  </fieldset>
                  @if (customProtocolError(); as protocolError) {
                    <p
                      class="text-xs text-base-content"
                      data-testid="wizard-custom-protocol-error"
                    >
                      {{ protocolError }}
                    </p>
                  }
                </div>
              }

              @if (providerChangeReview()) {
                <div
                  class="mt-3 rounded-md border border-base-300 bg-base-100 p-3"
                  data-testid="wizard-provider-change-review"
                >
                  <p
                    #providerChangeHeading
                    tabindex="-1"
                    class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    data-testid="wizard-provider-change-copy"
                  >
                    Changing the provider discards the credential, verification, and model choices
                    for {{ displayName() }}.
                  </p>
                  <div class="mt-2 flex gap-2">
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="confirmProviderChange()"
                      data-testid="wizard-provider-change-discard"
                    >
                      Discard and change
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="cancelProviderChange()"
                      data-testid="wizard-provider-change-keep"
                    >
                      Keep editing
                    </button>
                  </div>
                </div>
              }
            </div>
          }
          @case ('credential') {
            <div data-testid="wizard-step-credential">
              <h3
                #stepHeading
                tabindex="-1"
                class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="wizard-step-heading"
              >
                Credential
              </h3>
              @switch (authMode()) {
                @case ('apiKey') {
                  <p class="text-xs">Verification requires entering the credential, even when a key is already stored. Use Replace key to enter it. Nothing is saved until you confirm.</p>
                  @if (existingCredentialPresent() && !replacingKey()) {
                    <p
                      class="mt-3 text-sm text-base-content"
                      data-testid="wizard-key-stored"
                    >
                      Key stored
                    </p>
                    <button
                      type="button"
                      class="btn btn-outline btn-sm mt-2 min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="onReplaceKey()"
                      data-testid="wizard-replace-key"
                    >
                      Replace key
                    </button>
                    <p class="mt-1 text-xs text-base-content-muted">
                      The stored key stays in use until you replace it.
                    </p>
                  } @else {
                    <label class="mt-3 flex flex-col gap-1">
                      <span
                        id="wizard-api-key-label"
                        class="text-xs font-medium text-base-content-muted"
                        >API key</span
                      >
                      <input
                        [type]="showApiKey() ? 'text' : 'password'"
                        class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        autocomplete="off"
                        aria-labelledby="wizard-api-key-label"
                        [value]="apiKeyDraft()"
                        (input)="onApiKeyInput($event)"
                        data-testid="wizard-api-key"
                      />
                    </label>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm mt-1 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-pressed]="showApiKey()"
                      (click)="toggleKeyVisibility()"
                      data-testid="wizard-key-visibility"
                    >
                      {{ showApiKey() ? 'Hide API key' : 'Show API key' }}
                    </button>
                    @if (apiKeyError(); as keyError) {
                      <p
                        class="text-xs text-base-content"
                        aria-describedby="wizard-api-key-label"
                        data-testid="wizard-credential-error"
                      >
                        {{ keyError }}
                      </p>
                    }
                    @if (keyPrefixHint(); as prefixHint) {
                      <p class="text-xs text-base-content-muted" data-testid="wizard-key-prefix-hint">
                        {{ prefixHint }}
                      </p>
                    }
                  }
                }
                @case ('oauth') {
                  @if (signInState() === 'signed-in') {
                    <p class="mt-3 text-sm text-base-content" data-testid="wizard-sign-in-ok">
                      {{ accountLabel() ? 'Signed in as ' + accountLabel() : 'Signed in' }}
                    </p>
                  } @else if (signInState() === 'in-flight') {
                    <p
                      class="mt-3 text-sm text-base-content"
                      role="status"
                      data-testid="wizard-sign-in-waiting"
                    >
                      Waiting for sign-in…
                    </p>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm mt-2 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="emitExternalAction('sign-in-cancel')"
                      data-testid="wizard-sign-in-cancel"
                    >
                      Cancel sign-in
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm mt-3 min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="emitExternalAction('sign-in')"
                      data-testid="wizard-sign-in"
                    >
                      Sign in with {{ displayName() }}
                    </button>
                    @if (signInState() === 'failed') {
                      <p
                        class="mt-2 text-xs text-base-content"
                        role="alert"
                        data-testid="wizard-sign-in-failed"
                      >
                        Sign-in was not completed. Try again.
                      </p>
                    }
                  }
                }
                @case ('cli') {
                  @if (cliInstalled() === false) {
                    <p
                      class="mt-3 text-sm text-base-content"
                      role="alert"
                      data-testid="wizard-cli-not-installed"
                    >
                      The command-line client for {{ displayName() }} was not found. Install it,
                      then check again.
                    </p>
                    <button
                      type="button"
                      class="btn btn-outline btn-sm mt-2 min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="emitExternalAction('cli-check')"
                      data-testid="wizard-cli-check"
                    >
                      Check again
                    </button>
                  } @else if (signInState() === 'signed-in') {
                    <p class="mt-3 text-sm text-base-content" data-testid="wizard-cli-signed-in">
                      Signed in
                    </p>
                  } @else {
                    <p class="mt-3 text-sm text-base-content" data-testid="wizard-cli-signed-out">
                      Sign in to {{ displayName() }}, then verify this connection.
                    </p>
                    <button
                      type="button"
                      class="btn btn-outline btn-sm mt-2 min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      (click)="emitExternalAction('cli-login')"
                      data-testid="wizard-cli-login"
                    >
                      Open login
                    </button>
                  }
                }
                @case ('local-native') {
                  <label class="mt-3 flex flex-col gap-1">
                    <span
                      id="wizard-base-url-label"
                      class="text-xs font-medium text-base-content-muted"
                      >Server URL</span
                    >
                    <input
                      type="text"
                      class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      aria-labelledby="wizard-base-url-label"
                      [value]="baseUrlDraft()"
                      (input)="onBaseUrlInput($event)"
                      [attr.aria-invalid]="baseUrlError() ? true : null"
                      data-testid="wizard-base-url"
                    />
                  </label>
                  @if (baseUrlError(); as urlError) {
                    <p class="text-xs text-base-content" data-testid="wizard-url-error">
                      {{ urlError }}
                    </p>
                  }
                  <p
                    class="mt-1 text-xs text-base-content-muted"
                    data-testid="wizard-data-destination"
                  >
                    Credentials and prompts are sent to {{ destinationHostname() }}.
                  </p>
                  @if (supportsOptionalKey()) {
                    <label class="mt-3 flex flex-col gap-1">
                      <span
                        id="wizard-optional-key-label"
                        class="text-xs font-medium text-base-content-muted"
                        >API key (optional)</span
                      >
                      <input
                        [type]="showApiKey() ? 'text' : 'password'"
                        class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        autocomplete="off"
                        aria-labelledby="wizard-optional-key-label"
                        [value]="apiKeyDraft()"
                        (input)="onApiKeyInput($event)"
                        data-testid="wizard-optional-key"
                      />
                    </label>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm mt-1 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-pressed]="showApiKey()"
                      (click)="toggleKeyVisibility()"
                      data-testid="wizard-optional-key-visibility"
                    >
                      {{ showApiKey() ? 'Hide API key' : 'Show API key' }}
                    </button>
                  }
                }
                @case ('local-proxy') {
                  <label class="mt-3 flex flex-col gap-1">
                    <span
                      id="wizard-base-url-label"
                      class="text-xs font-medium text-base-content-muted"
                      >Server URL</span
                    >
                    <input
                      type="text"
                      class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      aria-labelledby="wizard-base-url-label"
                      [value]="baseUrlDraft()"
                      (input)="onBaseUrlInput($event)"
                      [attr.aria-invalid]="baseUrlError() ? true : null"
                      data-testid="wizard-base-url"
                    />
                  </label>
                  @if (baseUrlError(); as urlError) {
                    <p class="text-xs text-base-content" data-testid="wizard-url-error">
                      {{ urlError }}
                    </p>
                  }
                  <p
                    class="mt-1 text-xs text-base-content-muted"
                    data-testid="wizard-data-destination"
                  >
                    Credentials and prompts are sent to {{ destinationHostname() }}.
                  </p>
                  @if (supportsOptionalKey()) {
                    <label class="mt-3 flex flex-col gap-1">
                      <span
                        id="wizard-optional-key-label"
                        class="text-xs font-medium text-base-content-muted"
                        >API key (optional)</span
                      >
                      <input
                        [type]="showApiKey() ? 'text' : 'password'"
                        class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        autocomplete="off"
                        aria-labelledby="wizard-optional-key-label"
                        [value]="apiKeyDraft()"
                        (input)="onApiKeyInput($event)"
                        data-testid="wizard-optional-key"
                      />
                    </label>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm mt-1 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-pressed]="showApiKey()"
                      (click)="toggleKeyVisibility()"
                      data-testid="wizard-optional-key-visibility"
                    >
                      {{ showApiKey() ? 'Hide API key' : 'Show API key' }}
                    </button>
                  }
                }
                @case ('custom') {
                  <label class="mt-3 flex flex-col gap-1">
                    <span
                      id="wizard-base-url-label"
                      class="text-xs font-medium text-base-content-muted"
                      >Server URL</span
                    >
                    <input
                      type="text"
                      class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      aria-labelledby="wizard-base-url-label"
                      [value]="baseUrlDraft()"
                      (input)="onBaseUrlInput($event)"
                      [attr.aria-invalid]="baseUrlError() ? true : null"
                      data-testid="wizard-base-url"
                    />
                  </label>
                  @if (baseUrlError(); as urlError) {
                    <p class="text-xs text-base-content" data-testid="wizard-url-error">
                      {{ urlError }}
                    </p>
                  }
                  <p
                    class="mt-1 text-xs text-base-content-muted"
                    data-testid="wizard-data-destination"
                  >
                    Credentials and prompts are sent to {{ destinationHostname() }}.
                  </p>
                  <label class="mt-3 flex flex-col gap-1">
                    <span
                      id="wizard-api-key-label"
                      class="text-xs font-medium text-base-content-muted"
                      >API key</span
                    >
                    <input
                      [type]="showApiKey() ? 'text' : 'password'"
                      class="input input-bordered input-sm w-full min-h-9 border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      autocomplete="off"
                      aria-labelledby="wizard-api-key-label"
                      [value]="apiKeyDraft()"
                      (input)="onApiKeyInput($event)"
                      data-testid="wizard-api-key"
                    />
                  </label>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm mt-1 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-pressed]="showApiKey()"
                    (click)="toggleKeyVisibility()"
                    data-testid="wizard-key-visibility"
                  >
                    {{ showApiKey() ? 'Hide API key' : 'Show API key' }}
                  </button>
                  <p class="text-xs text-base-content-muted" data-testid="wizard-custom-protocol-note">
                    Compatibility: {{ customProtocol() === 'anthropic' ? 'Anthropic-compatible' : 'OpenAI-compatible' }}
                  </p>
                }
              }
              @if (credentialReady()) {
                <p
                  class="mt-3 text-xs font-medium text-base-content"
                  data-testid="wizard-credential-ready"
                >
                  Ready to verify
                </p>
              }
            </div>
          }
          @case ('verify') {
            <div data-testid="wizard-step-verify">
              <h3
                #stepHeading
                tabindex="-1"
                class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="wizard-step-heading"
              >
                Verify
              </h3>
              <p
                class="mt-3 text-xs text-base-content-muted"
                data-testid="wizard-verify-route"
              >
                Testing {{ displayName() }} · {{ authModeLabel() }}{{ verifyDestinationSuffix() }}
              </p>
              <p class="mt-1 text-xs text-base-content-muted" data-testid="wizard-verify-usage">
                The verification runs one small test request on this connection. It may count
                against provider usage.
              </p>
              @if (probeChecking()) {
                <div
                  class="mt-3 flex items-center gap-2"
                  role="status"
                  data-testid="wizard-verify-checking"
                >
                  <lucide-angular
                    [img]="LoaderIcon"
                    class="ptah-wizard-spinner h-4 w-4 text-base-content"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-base-content">Checking {{ displayName() }}…</span>
                </div>
                <p
                  class="mt-1 text-xs text-base-content-muted"
                  data-testid="wizard-verify-elapsed"
                >
                  {{ elapsedSeconds() }} s elapsed
                </p>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm mt-2 min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  (click)="onCancelProbe()"
                  data-testid="wizard-verify-cancel"
                >
                  Cancel check
                </button>
              } @else if (probeState() === 'verified') {
                <div
                  class="mt-3 flex items-center gap-2"
                  role="status"
                  data-testid="wizard-verify-success"
                >
                  <lucide-angular [img]="CheckIcon" class="h-4 w-4 text-base-content" aria-hidden="true" />
                  <span class="text-sm font-semibold text-base-content">Connection verified.</span>
                </div>
                <p
                  class="mt-1 text-xs text-base-content-muted"
                  data-testid="wizard-verify-meta"
                >
                  Checked {{ checkedAtLabel() }}
                  @if (latencyLabel(); as latency) {
                    · {{ latency }}
                  }
                </p>
              } @else {
                @if (probeState() === 'failed') {
                  <div
                    class="mt-3 space-y-2 rounded-md border border-base-300 bg-base-100 p-3"
                    role="alert"
                    data-testid="wizard-verify-failure"
                  >
                    <h4
                      #failureHeading
                      tabindex="-1"
                      class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      data-testid="wizard-failure-heading"
                    >
                      Connection could not be verified
                    </h4>
                    <p
                      class="text-sm text-base-content"
                      data-testid="wizard-failure-copy"
                    >
                      {{ failureCopy() }}
                    </p>
                    @if (probeDetail(); as detail) {
                      <details data-testid="wizard-verify-diagnostics">
                        <summary
                          class="min-h-9 cursor-pointer text-xs text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        >
                          Diagnostic details
                        </summary>
                        <p class="break-all text-xs text-base-content-muted">{{ detail }}</p>
                      </details>
                    }
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        (click)="startProbe()"
                        data-testid="wizard-verify-retry"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                        (click)="goToStep('credential')"
                        data-testid="wizard-edit-credential"
                      >
                        Edit credential
                      </button>
                    </div>
                  </div>
                }
                @if (probeState() === 'cancelled') {
                  <p
                    class="mt-3 text-sm text-base-content"
                    role="status"
                    data-testid="wizard-verify-cancelled"
                  >
                    Connection check cancelled. Nothing was activated.
                  </p>
                }
                <button
                  type="button"
                  class="btn btn-primary btn-sm mt-3 min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  [disabled]="!credentialReady()"
                  (click)="startProbe()"
                  data-testid="wizard-verify-start"
                >
                  Verify connection
                </button>
              }
            </div>
          }
          @case ('models') {
            <div data-testid="wizard-step-models">
              <h3
                #stepHeading
                tabindex="-1"
                class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="wizard-step-heading"
              >
                Models
              </h3>
              <p class="mt-3 text-xs text-base-content-muted" data-testid="wizard-models-copy">
                Choose the model this connection uses for each kind of work, or use the provider's
                defaults.
              </p>
              <div class="mt-3 space-y-4">
                @for (tier of TIER_DEFS; track tier.key) {
                  <div class="space-y-1" [attr.data-testid]="'wizard-tier-' + tier.key">
                    <ptah-provider-model-picker
                      [label]="tier.label"
                      [fixedProvider]="verifyProviderId()"
                      [model]="tierModel(tier.key)"
                      [defaultTier]="tier.tier"
                      (selectionChange)="onTierChange(tier.key, $event)"
                    />
                    <p
                      class="text-xs text-base-content-muted"
                      data-testid="wizard-tier-source"
                    >
                      {{ tierSource(tier.key) }}
                    </p>
                  </div>
                }
              </div>
              @if (defaultsResolvable()) {
                <button
                  type="button"
                  class="btn btn-outline btn-sm mt-3 min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  (click)="useProviderDefaults()"
                  data-testid="wizard-use-defaults"
                >
                  Use provider defaults
                </button>
              }
            </div>
          }
          @case ('scope') {
            <div data-testid="wizard-step-scope">
              <h3
                #stepHeading
                tabindex="-1"
                class="text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="wizard-step-heading"
              >
                Scope
              </h3>
              <dl class="mt-3 space-y-2" data-testid="wizard-review">
                <div class="flex gap-2">
                  <dt class="w-40 shrink-0 text-xs text-base-content-muted">Provider</dt>
                  <dd class="text-sm text-base-content" data-testid="wizard-review-provider">
                    {{ displayName() }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-40 shrink-0 text-xs text-base-content-muted">Authentication</dt>
                  <dd class="text-sm text-base-content" data-testid="wizard-review-auth">
                    {{ authModeLabel() }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-40 shrink-0 text-xs text-base-content-muted">Credential</dt>
                  <dd class="text-sm text-base-content" data-testid="wizard-review-credential">
                    {{ credentialReviewLabel() }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-40 shrink-0 text-xs text-base-content-muted">Connection check</dt>
                  <dd class="text-sm text-base-content" data-testid="wizard-review-probe">
                    {{ probeReviewLabel() }}
                  </dd>
                </div>
                @for (tier of TIER_DEFS; track tier.key) {
                  <div class="flex gap-2">
                    <dt class="w-40 shrink-0 text-xs text-base-content-muted">{{ tier.label }}</dt>
                    <dd class="text-sm text-base-content" data-testid="wizard-review-tier">
                      {{ tierReview(tier.key) }}
                    </dd>
                  </div>
                }
              </dl>

              <fieldset class="mt-4 space-y-2" data-testid="wizard-activation">
                <legend class="text-sm font-semibold text-base-content">After connecting</legend>
                <label class="flex items-start gap-2 rounded-md bg-base-100 p-2">
                  <input
                    type="radio"
                    class="radio radio-sm mt-0.5"
                    name="wizard-activation"
                    [checked]="activation() === 'connect-only'"
                    (change)="onActivationChange('connect-only')"
                    [disabled]="selectionId() === 'anthropic'" data-testid="wizard-activation-connect-only"
                  />
                  <span class="min-w-0">
                    <span class="block text-sm text-base-content">Connect only</span>
                    <span class="block text-xs text-base-content-muted"
                      >The connection is available, but the main agent keeps its current
                      provider.</span
                    >
                  </span>
                </label>
                <label class="flex items-start gap-2 rounded-md bg-base-100 p-2">
                  <input
                    type="radio"
                    class="radio radio-sm mt-0.5"
                    name="wizard-activation"
                    [checked]="activation() === 'use-main-agent'"
                    (change)="onActivationChange('use-main-agent')"
                    data-testid="wizard-activation-use-main-agent"
                  />
                  <span class="min-w-0">
                    <span class="block text-sm text-base-content">Use for main agent</span>
                    <span class="block text-xs text-base-content-muted"
                      >New main-agent requests use this connection. Background assignments follow
                      the main agent.</span
                    >
                  </span>
                </label>
              </fieldset>
              @if (activation() === 'use-main-agent' && affectedConsumers().length > 0) {
                <p
                  class="mt-1 text-xs text-base-content-muted"
                  data-testid="wizard-affected-consumers"
                >
                  Background assignments that follow the main agent:
                  {{ affectedConsumers().join(', ') }}.
                </p>
              }

              <fieldset class="mt-4 space-y-2" data-testid="wizard-save-to">
                <legend class="text-sm font-semibold text-base-content">Save to</legend>
                @for (target of saveTargetOptions(); track target.scope) {
                  <label class="flex items-start gap-2 rounded-md bg-base-100 p-2">
                    <input
                      type="radio"
                      class="radio radio-sm mt-0.5"
                      name="wizard-save-to"
                      [checked]="saveTo() === target.scope"
                      [disabled]="target.disabled"
                      (change)="onSaveToChange(target.scope)"
                      data-testid="wizard-save-to-option"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm text-base-content">{{ target.label }}</span>
                      @if (target.reason; as reason) {
                        <span class="block text-xs text-base-content-muted">{{ reason }}</span>
                      }
                    </span>
                  </label>
                }
              </fieldset>

              @if (commitState() === 'saved') {
                <p
                  class="mt-4 text-sm font-semibold text-base-content"
                  role="status"
                  data-testid="wizard-saved"
                >
                  {{ savedCopy() }}
                </p>
                <button
                  type="button"
                  class="btn btn-primary btn-sm mt-2 min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  (click)="onDone()"
                  data-testid="wizard-done"
                >
                  Done
                </button>
              }
              @if (selectionId() === 'anthropic') { <p>Claude API setup also selects it for the main agent. Connect only is unavailable on this host.</p> }
              @if (contextChanged()) { <p role="alert">The workspace changed. Review the destination before saving.</p><button type="button" class="btn min-h-9" (click)="reviewContextRequested.emit()">Review current workspace</button> }
              @if (commitDetail()) { <p role="status" class="break-words">{{ commitDetail() }}</p> }
              @if (commitState() === 'failed') {
                <p
                  class="mt-4 text-sm text-base-content"
                  role="alert"
                  data-testid="wizard-save-failed"
                >
                  Could not save this connection. Review the error and retry. Your setup is still
                  here.
                </p>
              }
            </div>
          }
        }
      </div>

      <div
        drawer-footer
        class="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 bg-base-100 px-4 py-3"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [disabled]="stepIndex() === 0 || probeChecking() || commitBusy()"
            (click)="goBack()"
            data-testid="wizard-back"
          >
            Back
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [disabled]="commitBusy()"
            (click)="requestWizardClose()"
            data-testid="wizard-cancel"
          >
            Cancel
          </button>
        </div>
        @if (step() === 'scope') {
          <button
            type="button"
            class="btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [disabled]="commitBusy() || !modelsValid() || contextChanged()"
            (click)="onCommit()"
            data-testid="wizard-commit"
          >
            {{ commitState() === 'saving' ? 'Saving connection…' : commitButtonLabel() }}
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [disabled]="!canContinue()"
            (click)="goForward()"
            data-testid="wizard-continue"
          >
            Continue
          </button>
        }
      </div>
    </ptah-native-drawer>
  `,
})
export class ProviderSetupWizardComponent implements OnDestroy {
  protected readonly CheckIcon: LucideIconData = Check;
  protected readonly LoaderIcon: LucideIconData = Loader2;
  protected readonly ServerIcon: LucideIconData = Server;
  protected readonly STEP_DEFS = STEP_DEFS;
  protected readonly TIER_DEFS = TIER_DEFS;
  protected readonly CUSTOM_RADIO_VALUE = CUSTOM_RADIO_VALUE;

  // ------------------------------------------------------------------ seams

  /**
   * Draft-verification seam a later batch wires. The wizard calls it with
   * the draft params only; it never reads a persisted provider route.
   */
  readonly verifyDraftConnection = input.required<DraftVerifyConnectionFn>();

  /** Draft-verification cancel seam; required by the probe contract. */
  readonly cancelDraftVerification = input.required<DraftCancelVerificationFn>();

  // -------------------------------------------------------------- host state

  /** Parent-owned drawer visibility; false resets the whole draft. */
  readonly open = input.required<boolean>();

  /** Preselects this registry provider on open; the wizard still displays the Provider step. */
  readonly deepLinkProviderId = input<string>('');

  /** True when a working credential is already stored for this provider. */
  readonly existingCredentialPresent = input<boolean>(false);

  /** External sign-in / CLI-installation state mirrored in by the host. */
  readonly externalAuth = input<WizardExternalAuthState>({
    signInState: 'idle',
    accountLabel: null,
    cliInstalled: null,
  });

  /** True when the host can resolve the provider's default tier models. */
  readonly defaultsResolvable = input<boolean>(true);

  /** True when a main-agent route already exists. */
  readonly mainRouteExists = input<boolean>(false);

  /** Write targets the backend supports for this connection. */
  readonly supportedSaveTargets = input<readonly SettingScope[]>(['global', 'app']);

  /** Consumers that follow the main-agent route, for the Scope review. */
  readonly affectedConsumers = input<readonly string[]>([]);

  /** Workspace label for the Save-to option. */
  readonly workspaceName = input<string | null>(null);

  /** Probe timeout, forwarded to the seam and used in timeout copy. */
  readonly probeTimeoutMs = input<number>(30000);

  /** Host-reported commit progress; `saved` requires the host read-back. */
  readonly commitState = input<WizardCommitState>('idle');

  // ---------------------------------------------------------------- outputs

  /** Parent closes the drawer (and thereby the wizard). */
  readonly closed = output<void>();

  /** The draft is complete and verified; the host persists and connects. */
  readonly commitRequested = output<ProviderWizardCommit>();

  /** Sign-in and CLI work the host must perform. */
  readonly externalActionRequested = output<{ providerId: string; action: WizardExternalAction }>();
  readonly providerChanged = output<string>();
  readonly reviewContextRequested = output<void>();
  readonly contextChanged = input(false);
  readonly commitDetail = input('');
  readonly externalMessage = input<string | null>(null);
  readonly initialSetup = input<{ providerId: string; baseUrl: string | null; tiers: { sonnet: string | null; opus: string | null; haiku: string | null }; customName?: string; customProtocol?: 'openai' | 'anthropic' } | null>(null);

  // ------------------------------------------------------------ draft state

  private readonly _step = signal<WizardStepId>('provider');
  private readonly _selection = signal<WizardSelection | null>(null);
  private readonly _search = signal('');
  private readonly _customName = signal('');
  private readonly _customId = signal('');
  private readonly _customProtocol = signal<'openai' | 'anthropic' | null>(null);
  /** In-memory credential draft; rendered only through a password input. */
  private readonly _apiKeyDraft = signal('');
  private readonly _showApiKey = signal(false);
  private readonly _replacingKey = signal(false);
  private readonly _baseUrlDraft = signal('');
  private readonly _baseUrlTouched = signal(false);
  private readonly _probeState = signal<WizardProbeState>('idle');
  private readonly _probeResult = signal<AuthVerifyDraftConnectionResult | null>(null);
  private readonly _probeId = signal<string | null>(null);
  private readonly _elapsedSeconds = signal(0);
  private readonly _tiers: Record<WizardTierKey, WritableSignal<string>> = {
    everyday: signal(''),
    complex: signal(''),
    fast: signal(''),
  };
  private readonly _saveTo = signal<SettingScope>('app');
  private readonly _activation = signal<WizardActivation>('connect-only');
  private readonly _providerChangeReview = signal(false);
  private readonly _pendingSelection = signal<WizardSelection | null>(null);
  private readonly _closeReview = signal(false);
  private readonly _scopeTouched = signal(false);

  private readonly hostElement = viewChild.required<ElementRef<HTMLElement>>(
    'wizardHost',
  );

  /** Non-signal: any settled probe (result applied or cancelled) discards late arrivals. */
  private probeSettled = true;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private readonly failureHeading = viewChild<ElementRef<HTMLElement>>('failureHeading');
  private readonly closeReviewHeading = viewChild<ElementRef<HTMLElement>>('closeReviewHeading');
  private readonly providerChangeHeading = viewChild<ElementRef<HTMLElement>>(
    'providerChangeHeading',
  );

  protected readonly step = this._step.asReadonly();
  protected readonly search = this._search.asReadonly();
  protected readonly customName = this._customName.asReadonly();
  protected readonly customProtocol = this._customProtocol.asReadonly();
  protected readonly apiKeyDraft = this._apiKeyDraft.asReadonly();
  protected readonly showApiKey = this._showApiKey.asReadonly();
  protected readonly replacingKey = this._replacingKey.asReadonly();
  protected readonly baseUrlDraft = this._baseUrlDraft.asReadonly();
  protected readonly probeState = this._probeState.asReadonly();
  protected readonly providerChangeReview = this._providerChangeReview.asReadonly();
  protected readonly closeReview = this._closeReview.asReadonly();

  protected readonly stepIndex = computed<number>(() => STEP_ORDER.indexOf(this._step()));

  protected readonly currentLabel = computed<string>(
    () => STEP_DEFS[this.stepIndex()]?.label ?? 'Provider',
  );

  protected readonly isCurrentStep = (id: WizardStepId): boolean => this._step() === id;

  protected readonly isCompletedStep = (id: WizardStepId): boolean =>
    STEP_ORDER.indexOf(id) < this.stepIndex() && this.canVisitStep(id);

  protected readonly hasSelection = computed<boolean>(() => this._selection() !== null);

  protected readonly selectionId = computed<string>(() => {
    const selection = this._selection();
    return selection?.kind === 'registry' ? selection.id : '';
  });

  protected readonly isCustomSelected = computed<boolean>(
    () => this._selection()?.kind === 'custom',
  );

  protected readonly selectedEntry = computed<AnthropicProvider | null>(() => {
    const selection = this._selection();
    if (selection?.kind !== 'registry') return null;
    return getAnthropicProvider(selection.id) ?? null;
  });

  protected readonly authMode = computed<WizardAuthMode>(() => {
    const selection = this._selection();
    if (selection?.kind === 'custom') return 'custom';
    const entry = this.selectedEntry();
    return entry ? deriveAuthMode(entry) : 'apiKey';
  });

  protected readonly authModeLabel = computed<string>(() => AUTH_MODE_LABELS[this.authMode()]);

  protected readonly displayName = computed<string>(() => {
    const selection = this._selection();
    if (selection?.kind === 'custom') {
      return this._customName().trim() || 'Custom endpoint';
    }
    return this.selectionId() === 'anthropic' ? 'Claude API' : this.selectedEntry()?.name ?? 'Connect provider';
  });

  protected readonly wizardTitle = computed<string>(() => 'Connect provider');

  protected readonly wizardSubtitle = computed<string>(() => {
    const selection = this._selection();
    if (!selection) return 'Connect a model provider to this app.';
    return this.displayName();
  });

  protected readonly markProviderId = computed<string>(() => this.selectionId());

  protected readonly markFallback = computed<ProviderMarkLucideIcon>(() => {
    const entry = this.selectedEntry();
    if (entry) return markFallbackFor(entry);
    if (this._selection()?.kind === 'custom') return 'Server';
    return 'Bot';
  });

  protected readonly providerOptions = computed<readonly WizardProviderOption[]>(() => {
    const query = this._search().trim().toLowerCase();
    const all = getAllAnthropicProviders();
    const matched = query
      ? all.filter(
          (entry) => entry.name.toLowerCase().includes(query) || entry.id.includes(query),
        )
      : all;
    const options: WizardProviderOption[] = matched.map((entry) => ({
      id: entry.id,
      name: entry.name,
      summary: authSummaryFor(entry),
      fallback: markFallbackFor(entry),
    }));
    if (!query || 'claude api anthropic'.includes(query)) options.unshift({ id: 'anthropic', name: 'Claude API', summary: 'API key - activates the main agent', fallback: 'Bot' });
    return options;
  });

  protected readonly customNameError = computed<string | null>(() => {
    if (!this.isCustomSelected()) return null;
    return this._customName().trim().length === 0 ? 'Enter a name for the connection.' : null;
  });

  protected readonly customProtocolError = computed<string | null>(() => {
    if (!this.isCustomSelected()) return null;
    return this._customProtocol() === null ? 'Choose a compatibility protocol.' : null;
  });

  protected readonly selectionValid = computed<boolean>(() => {
    const selection = this._selection();
    if (!selection) return false;
    if (selection.kind === 'registry') return selection.id.length > 0;
    return this.customNameError() === null && this.customProtocolError() === null;
  });

  protected readonly apiKeyError = computed<string | null>(() =>
    this._apiKeyDraft().trim().length === 0 ? 'Enter an API key to continue.' : null,
  );

  protected readonly keyPrefixHint = computed<string | null>(() => {
    const entry = this.selectedEntry();
    const prefix = entry?.keyPrefix ?? '';
    if (prefix.length === 0) return null;
    if (this._apiKeyDraft().trim().length === 0) return null;
    return this._apiKeyDraft().trim().startsWith(prefix)
      ? null
      : `This provider's keys usually start with ${prefix}.`;
  });

  protected readonly baseUrlError = computed<string | null>(() => {
    const mode = this.authMode();
    if (mode !== 'local-native' && mode !== 'local-proxy' && mode !== 'custom') return null;
    return validateProviderBaseUrl(this._baseUrlDraft()).ok
      ? null
      : 'Enter an http:// or https:// URL.';
  });

  protected readonly supportsOptionalKey = computed<boolean>(
    () => this.selectedEntry()?.supportsOptionalApiKey === true,
  );

  protected readonly signInState = computed<WizardSignInState>(() => this.externalAuth().signInState);

  protected readonly accountLabel = computed<string | null>(() => this.externalAuth().accountLabel);

  protected readonly cliInstalled = computed<boolean | null>(() => this.externalAuth().cliInstalled);

  protected readonly credentialReady = computed<boolean>(() => {
    if (!this.selectionValid()) return false;
    switch (this.authMode()) {
      case 'apiKey':
        return this._apiKeyDraft().trim().length > 0;
      case 'oauth':
        return this.signInState() === 'signed-in';
      case 'cli':
        return this.cliInstalled() === true;
      case 'local-native':
      case 'local-proxy':
        return this.baseUrlError() === null;
      case 'custom':
        return this.baseUrlError() === null && this._apiKeyDraft().trim().length > 0;
    }
  });

  protected readonly probeChecking = computed<boolean>(() => this._probeState() === 'checking');

  protected readonly elapsedSeconds = computed<number>(() => this._elapsedSeconds());

  protected readonly probeDetail = computed<string | null>(() => this._probeResult()?.detail ?? null);

  protected readonly destinationHostname = computed<string>(() => {
    const entry = this.selectedEntry();
    const fallback = this.isCustomSelected() ? this.displayName() : entry?.name ?? 'the provider';
    return hostnameOf(this._baseUrlDraft(), fallback);
  });

  protected readonly verifyDestinationSuffix = computed<string>(() => {
    const mode = this.authMode();
    if (mode !== 'local-native' && mode !== 'local-proxy' && mode !== 'custom') return '';
    return ` at ${this.destinationHostname()}`;
  });

  protected readonly checkedAtLabel = computed<string>(() => {
    const checkedAt = this._probeResult()?.checkedAt ?? '';
    if (checkedAt.length === 0) return '';
    try {
      return new Date(checkedAt).toLocaleTimeString();
    } catch {
      return checkedAt;
    }
  });

  protected readonly latencyLabel = computed<string | null>(() => {
    const latencyMs = this._probeResult()?.latencyMs ?? null;
    return latencyMs === null ? null : `${latencyMs} ms`;
  });

  protected readonly failureCopy = computed<string>(() => {
    const result = this._probeResult();
    const reason: ProbeFailureReason = result?.reason ?? 'unclassified';
    const mode = this.authMode();
    const needsBaseUrl = mode === 'local-native' || mode === 'local-proxy' || mode === 'custom';
    const entry = this.selectedEntry();
    const hostname = needsBaseUrl
      ? hostnameOf(this._baseUrlDraft(), entry?.name ?? 'the service')
      : entry?.name ?? 'the provider';
    const copy = PROBE_FAILURE_COPY[reason];
    return copy({
      hostname,
      probeLimitSeconds: Math.round(this.probeTimeoutMs() / 1000),
      modelUsed: result?.modelUsed ?? null,
    });
  });

  protected readonly modelsValid = computed<boolean>(() => {
    if (this.defaultsResolvable()) return true;
    return TIER_KEYS.every((key) => this._tiers[key]().length > 0);
  });

  protected readonly saveTargetOptions = computed<
    readonly { scope: SettingScope; label: string; disabled: boolean; reason: string | null }[]
  >(() => {
    const targets = this.supportedSaveTargets();
    const scopes: readonly SettingScope[] = ['global', 'app', 'workspace'];
    return scopes.map((scope) => {
      const supported = targets.includes(scope);
      return {
        scope,
        label: SAVE_TARGET_LABELS[scope],
        disabled: !supported,
        reason:
          scope === 'workspace' && !supported
            ? 'Open a workspace to save an override.'
            : null,
      };
    });
  });

  protected readonly activation = this._activation.asReadonly();
  protected readonly saveTo = this._saveTo.asReadonly();

  protected readonly commitButtonLabel = computed<string>(() =>
    this._activation() === 'use-main-agent'
      ? 'Connect and use for main agent'
      : 'Connect provider',
  );

  protected readonly savedCopy = computed<string>(() =>
    this._activation() === 'use-main-agent'
      ? `${this.displayName()} is now used for new main-agent requests.`
      : `${this.displayName()} connected.`,
  );

  protected readonly credentialReviewLabel = computed<string>(() => {
    switch (this.authMode()) {
      case 'apiKey':
        if (this._apiKeyDraft().trim().length > 0) return 'Key entered for this setup';
        return this.existingCredentialPresent() ? 'Enter the key to verify this draft' : 'No key entered';
      case 'oauth':
      case 'cli':
        return this.signInState() === 'signed-in'
          ? this.accountLabel()
            ? `Signed in as ${this.accountLabel()}`
            : 'Signed in'
          : 'Not signed in';
      case 'local-native':
      case 'local-proxy':
        return this._apiKeyDraft().trim().length > 0
          ? 'Key entered (optional)'
          : 'No API key required';
      case 'custom':
        return this._apiKeyDraft().trim().length > 0 ? 'Key entered' : 'No key entered';
    }
  });

  protected readonly probeReviewLabel = computed<string>(() => {
    switch (this._probeState()) {
      case 'verified':
        return `Verified · checked ${this.checkedAtLabel()}`;
      case 'failed':
        return 'Could not be verified';
      case 'cancelled':
        return 'Check cancelled';
      case 'checking':
        return 'Checking…';
      case 'idle':
        return 'Not checked';
    }
  });

  protected readonly tierReview = (key: WizardTierKey): string =>
    this._tiers[key]() === '' ? 'Provider default' : this._tiers[key]();

  protected readonly tierSource = (key: WizardTierKey): string =>
    this._tiers[key]() === ''
      ? `Provider default · ${TIER_DEFS.find((tier) => tier.key === key)?.tier ?? ''} tier`
      : `Set in this wizard · ${this._tiers[key]()}`;

  protected readonly tierModel = (key: WizardTierKey): string => this._tiers[key]();

  protected readonly hasUserDraft = computed<boolean>(() => {
    return (
      this._selection() !== null ||
      this._apiKeyDraft().length > 0 ||
      this._baseUrlTouched() ||
      this._customName().length > 0 ||
      this._probeState() !== 'idle' ||
      TIER_KEYS.some((key) => this._tiers[key]().length > 0)
    );
  });

  private readonly hasLaterDrafts = computed<boolean>(() => {
    return (
      this._apiKeyDraft().length > 0 ||
      this._baseUrlTouched() ||
      this._probeState() !== 'idle' ||
      TIER_KEYS.some((key) => this._tiers[key]().length > 0)
    );
  });

  protected readonly canContinue = computed<boolean>(() => {
    if (this.probeChecking()) return false;
    const next = STEP_ORDER[this.stepIndex() + 1];
    return next !== undefined && this.canVisitStep(next);
  });

  protected readonly commitBusy = computed<boolean>(() => this.commitState() === 'saving');

  constructor() {
    let appliedSetup: unknown = null;
    effect(() => {
      const setup = this.initialSetup();
      if (!setup || setup === appliedSetup || setup.providerId !== this.selectionId()) return;
      appliedSetup = setup;
      if (setup.customName && setup.customProtocol) {
        this._selection.set({ kind: 'custom' }); this._customId.set(setup.providerId);
        this._customName.set(setup.customName); this._customProtocol.set(setup.customProtocol);
      }
      if (!this._baseUrlTouched()) this._baseUrlDraft.set(setup.baseUrl ?? this.selectedEntry()?.baseUrl ?? '');
      this._tiers.everyday.set(setup.tiers.sonnet ?? '');
      this._tiers.complex.set(setup.tiers.opus ?? '');
      this._tiers.fast.set(setup.tiers.haiku ?? '');
    });
    // Reset on close; deep-link preselect on open, without displaying the step.
    effect(() => {
      const open = this.open();
      if (!open) {
        this.resetDraft();
        return;
      }
      const deepLink = this.deepLinkProviderId();
      if (deepLink && !this._selection()) {
        const entry = getAnthropicProvider(deepLink);
        if (entry || deepLink === 'anthropic') {
          this.applySelection({ kind: 'registry', id: deepLink });
        }
      }
    });

    // Clear the in-memory secret once the host confirmed the commit.
    effect(() => {
      if (this.commitState() === 'saved') {
        this._apiKeyDraft.set('');
        this._showApiKey.set(false);
        this._replacingKey.set(false);
      }
    });

    // Announce a failure exactly once and move focus to its heading. The
    // heading renders in the same cycle as the state change, so the focus
    // waits for the microtask after the render.
    effect(() => {
      const state = this._probeState();
      if (state !== 'failed') return;
      queueMicrotask(() => {
        const heading = this.failureHeading();
        if (!heading) return;
        heading.nativeElement.focus();
      });
    });

    // Focus management on step navigation and on the discard review.
    effect(() => {
      if (!this.open()) return;
      void this._step();
      void this._closeReview();
      void this._providerChangeReview();
      queueMicrotask(() => {
        const target =
          this._closeReview()
            ? this.closeReviewHeading()?.nativeElement
            : this._providerChangeReview()
              ? this.providerChangeHeading()?.nativeElement
              : this.stepHeading()?.nativeElement;
        if (target && document.activeElement !== target) target.focus();
      });
    });
  }

  ngOnDestroy(): void {
    this.stopElapsedTimer();
  }

  // ------------------------------------------------------------ step machine

  protected readonly canVisitStep = (target: WizardStepId): boolean => {
    const index = STEP_ORDER.indexOf(target);
    if (index < 0) return false;
    if (index === 0) return true;
    if (!this.selectionValid()) return false;
    if (index >= 2 && !this.credentialReady()) return false;
    if (index >= 3 && this._probeState() !== 'verified') return false;
    if (index >= 4 && !this.modelsValid()) return false;
    return true;
  };

  protected goToStep(target: WizardStepId): void {
    if (this.probeChecking() || this.commitBusy()) return;
    if (!this.canVisitStep(target)) return;
    if (target === 'scope') this.applyScopeDefaults();
    this._step.set(target);
  }

  protected goForward(): void {
    const next = STEP_ORDER[this.stepIndex() + 1];
    if (next !== undefined) this.goToStep(next);
  }

  protected goBack(): void {
    const previous = STEP_ORDER[this.stepIndex() - 1];
    if (previous !== undefined) this.goToStep(previous);
  }

  // ----------------------------------------------------------- provider step

  protected onSearchInput(event: Event): void {
    this._search.set((event.target as HTMLInputElement).value);
  }

  protected onClearSearch(): void {
    this._search.set('');
  }

  protected onSelectProvider(event: Event, id: string): void {
    if (this.probeChecking()) return;
    const radio = event.target as HTMLInputElement;
    if (this.selectionId() === id) {
      radio.checked = true;
      return;
    }
    if (this.hasLaterDrafts()) {
      this._pendingSelection.set({ kind: 'registry', id });
      this._providerChangeReview.set(true);
      radio.checked = false;
      return;
    }
    this.applySelection({ kind: 'registry', id });
  }

  protected onSelectCustom(event: Event): void {
    if (this.probeChecking()) return;
    const radio = event.target as HTMLInputElement;
    if (this.isCustomSelected()) {
      radio.checked = true;
      return;
    }
    if (this.hasLaterDrafts()) {
      this._pendingSelection.set({ kind: 'custom' });
      this._providerChangeReview.set(true);
      radio.checked = false;
      return;
    }
    this.applySelection({ kind: 'custom' });
  }

  protected onCustomNameInput(event: Event): void {
    this._customName.set((event.target as HTMLInputElement).value);
  }

  protected onProtocolSelect(protocol: 'openai' | 'anthropic'): void {
    this._customProtocol.set(protocol);
  }

  protected confirmProviderChange(): void {
    const pending = this._pendingSelection();
    this._providerChangeReview.set(false);
    this._pendingSelection.set(null);
    if (pending) this.applySelection(pending);
  }

  protected cancelProviderChange(): void {
    this._providerChangeReview.set(false);
    this._pendingSelection.set(null);
    // Restore the selected radio: the browser set the clicked one, and the
    // unchanged [checked] binding values do not re-apply on their own.
    const radios = this.hostElement().nativeElement.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="wizard-provider"]',
    );
    for (const radio of radios) {
      radio.checked = radio.value === this.selectionId();
    }
  }

  private applySelection(selection: WizardSelection): void {
    this._selection.set(selection);
    this.providerChanged.emit(selection.kind === 'registry' ? selection.id : '');
    this._customName.set('');
    this._customId.set('');
    this._customProtocol.set(null);
    this._apiKeyDraft.set('');
    this._showApiKey.set(false);
    this._replacingKey.set(false);
    this._baseUrlTouched.set(false);
    this._baseUrlDraft.set(this.selectedEntry()?.baseUrl ?? '');
    this._probeState.set('idle');
    this._probeResult.set(null);
    this._probeId.set(null);
    this.probeSettled = true;
    this.stopElapsedTimer();
    this._elapsedSeconds.set(0);
    for (const key of TIER_KEYS) this._tiers[key].set('');
    this._saveTo.set('app');
    this._activation.set('connect-only');
    this._scopeTouched.set(false);
  }

  // ---------------------------------------------------------- credential step

  protected onApiKeyInput(event: Event): void {
    this._apiKeyDraft.set((event.target as HTMLInputElement).value);
    this.invalidateVerification();
  }

  protected toggleKeyVisibility(): void {
    this._showApiKey.update((visible) => !visible);
  }

  protected onReplaceKey(): void {
    this._replacingKey.set(true);
    this.invalidateVerification();
  }

  protected onBaseUrlInput(event: Event): void {
    this._baseUrlDraft.set((event.target as HTMLInputElement).value);
    this._baseUrlTouched.set(true);
    this.invalidateVerification();
  }

  protected emitExternalAction(action: WizardExternalAction): void {
    this.externalActionRequested.emit({ providerId: this.verifyProviderId(), action });
  }

  /** Key, method, or URL change invalidates prior verification and probes. */
  private invalidateVerification(): void {
    const wasChecking = this.probeChecking();
    const probeId = this._probeId();
    this._probeState.set('idle');
    this._probeResult.set(null);
    this._probeId.set(null);
    this.probeSettled = true;
    this.stopElapsedTimer();
    this._elapsedSeconds.set(0);
    if (wasChecking && probeId) {
      void this.cancelDraftVerification()({ probeId }).catch((error: unknown) => {
        const errorType = error instanceof Error ? error.constructor.name : typeof error;
        console.error('[ProviderSetupWizardComponent] Cancel draft verification failed:', errorType);
      });
    }
  }

  // --------------------------------------------------------------- verify step

  protected startProbe(): void {
    if (this.probeChecking() || !this.credentialReady()) return;
    const probeId = `draft-probe-${(PROBE_COUNTER += 1)}`;
    this._probeId.set(probeId);
    this._probeState.set('checking');
    this._probeResult.set(null);
    this.probeSettled = false;
    this.startElapsedTimer();

    const params = this.buildProbeParams(probeId);
    void this.verifyDraftConnection()(params)
      .then((result) => {
        this.stopElapsedTimer();
        if (this.probeSettled || result.probeId !== this._probeId()) return;
        this._probeResult.set(result);
        this.probeSettled = true;
        this._probeState.set(
          result.outcome === 'verified'
            ? 'verified'
            : result.outcome === 'cancelled'
              ? 'cancelled'
              : 'failed',
        );
      })
      .catch(() => {
        this.stopElapsedTimer();
        if (this.probeSettled || this._probeId() !== probeId) return;
        this.probeSettled = true;
        this._probeResult.set({
          probeId,
          outcome: 'failed',
          reason: 'unclassified',
          detail: null,
          latencyMs: null,
          modelUsed: null,
          checkedAt: new Date().toISOString(),
        });
        this._probeState.set('failed');
      });
  }

  protected onCancelProbe(): void {
    const probeId = this._probeId();
    if (!probeId || !this.probeChecking()) return;
    void this.cancelDraftVerification()({ probeId })
      .then((result) => {
        if (result.cancelled && this._probeState() === 'checking' && this._probeId() === probeId) {
          this.stopElapsedTimer();
          this.probeSettled = true;
          this._probeResult.set(null);
          this._probeState.set('cancelled');
        }
      })
      .catch((error: unknown) => {
        const errorType = error instanceof Error ? error.constructor.name : typeof error;
        console.error('[ProviderSetupWizardComponent] Cancel probe failed:', errorType);
        if (this._probeState() === 'checking' && this._probeId() === probeId) {
          this.stopElapsedTimer();
          this.probeSettled = true;
          this._probeResult.set({
            probeId,
            outcome: 'failed',
            reason: 'unclassified',
            detail: null,
            latencyMs: null,
            modelUsed: null,
            checkedAt: new Date().toISOString(),
          });
          this._probeState.set('failed');
        }
      });
  }

  private buildProbeParams(probeId: string): AuthVerifyDraftConnectionParams {
    const mode = this.authMode();
    const params: AuthVerifyDraftConnectionParams = {
      probeId,
      providerId: this.verifyProviderId(),
      authMode: mode,
    };
    const key = this._apiKeyDraft().trim();
    if (
      key.length > 0 &&
      (mode === 'apiKey' || mode === 'custom' || this.supportsOptionalKey())
    ) {
      params.credential = { kind: 'apiKey', value: key };
    }
    if (mode === 'local-native' || mode === 'local-proxy' || mode === 'custom') {
      params.baseUrl = this._baseUrlDraft().trim();
    }
    params.timeoutMs = this.probeTimeoutMs();
    return params;
  }

  protected verifyProviderId(): string {
    const selection = this._selection();
    if (selection?.kind === 'custom') return this._customId() || this._customName().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return this.selectionId();
  }

  // -------------------------------------------------------------- models step

  protected onTierChange(key: WizardTierKey, selection: ProviderModelSelection): void {
    this._tiers[key].set(selection.model);
  }

  protected useProviderDefaults(): void {
    for (const key of TIER_KEYS) this._tiers[key].set('');
  }

  // --------------------------------------------------------------- scope step

  protected onActivationChange(activation: WizardActivation): void {
    this._activation.set(activation);
    this._scopeTouched.set(true);
  }

  protected onSaveToChange(scope: SettingScope): void {
    const target = this.saveTargetOptions().find((option) => option.scope === scope);
    if (!target || target.disabled) return;
    this._saveTo.set(scope);
    this._scopeTouched.set(true);
  }

  private applyScopeDefaults(): void {
    if (this._scopeTouched()) return;
    const targets = this.supportedSaveTargets();
    const defaultTarget = targets.includes('app')
      ? 'app'
      : (targets[0] ?? 'app');
    this._saveTo.set(defaultTarget);
    this._activation.set(this.selectionId() !== 'anthropic' && this.mainRouteExists() ? 'connect-only' : 'use-main-agent');
  }

  protected onCommit(): void {
    if (this.commitBusy() || !this.modelsValid() || this.contextChanged()) return;
    this.commitRequested.emit(this.buildCommit());
  }

  protected onDone(): void {
    this.closed.emit();
  }

  private buildCommit(): ProviderWizardCommit {
    const selection = this._selection();
    const mode = this.authMode();
    const key = this._apiKeyDraft().trim();
    const isCustom = selection?.kind === 'custom';
    const needsBaseUrl = mode === 'local-native' || mode === 'local-proxy' || mode === 'custom';
    const result = this._probeResult();
    return {
      providerId: this.verifyProviderId(),
      displayName: this.displayName(),
      authMode: mode,
      customName: isCustom ? this._customName().trim() : null,
      customProtocol: isCustom ? this._customProtocol() : null,
      credential: key.length > 0 ? { kind: 'apiKey', value: key } : null,
      existingKeyReused:
        mode === 'apiKey' && this.existingCredentialPresent() && key.length === 0,
      baseUrl: needsBaseUrl ? this._baseUrlDraft().trim() : null,
      verified:
        result !== null && result.outcome === 'verified'
          ? {
              probeId: result.probeId,
              checkedAt: result.checkedAt,
              latencyMs: result.latencyMs,
              modelUsed: result.modelUsed,
            }
          : null,
      tiers: {
        everyday: this._tiers.everyday(),
        complex: this._tiers.complex(),
        fast: this._tiers.fast(),
      },
      saveTo: this._saveTo(),
      activation: this._activation(),
    };
  }

  // ------------------------------------------------------- drawer and discard

  /** Drawer close, backdrop, Escape, and the Cancel button all land here. */
  protected requestWizardClose(): void {
    if (this.commitBusy()) return;
    if (this.probeChecking()) {
      // A close during the check cancels the probe first; the user stays on
      // Verify and can close again once the check is no longer in flight.
      this.onCancelProbe();
      return;
    }
    if (this.hasUserDraft()) {
      this._closeReview.set(true);
      return;
    }
    this.closed.emit();
  }

  protected onKeepEditing(): void {
    this._closeReview.set(false);
  }

  protected onDiscard(): void {
    this._apiKeyDraft.set('');
    this._showApiKey.set(false);
    this._replacingKey.set(false);
    this.closed.emit();
  }

  // ------------------------------------------------------------------ helpers

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this._elapsedSeconds.set(0);
    this.probeTimer = setInterval(() => {
      this._elapsedSeconds.update((seconds) => seconds + 1);
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.probeTimer === null) return;
    clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  private resetDraft(): void {
    this.stopElapsedTimer();
    this._step.set('provider');
    this._selection.set(null);
    this._search.set('');
    this._customName.set('');
    this._customId.set('');
    this._customProtocol.set(null);
    this._apiKeyDraft.set('');
    this._showApiKey.set(false);
    this._replacingKey.set(false);
    this._baseUrlDraft.set('');
    this._baseUrlTouched.set(false);
    this._probeState.set('idle');
    this._probeResult.set(null);
    this._probeId.set(null);
    this._elapsedSeconds.set(0);
    this.probeSettled = true;
    for (const key of TIER_KEYS) this._tiers[key].set('');
    this._saveTo.set('app');
    this._activation.set('connect-only');
    this._scopeTouched.set(false);
    this._providerChangeReview.set(false);
    this._pendingSelection.set(null);
    this._closeReview.set(false);
  }
}