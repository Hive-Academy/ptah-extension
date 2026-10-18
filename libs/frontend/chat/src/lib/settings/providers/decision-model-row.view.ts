import {
  DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
  DECISION_MODEL_INVALID_BASE_URL,
  DECISION_MODEL_INVALID_MODEL,
  DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  type DecisionModelSelectionDto,
  type DecisionModelSelectionInputDto,
  type DecisionModelStateDto,
  type DecisionModelStatusDto,
} from '@ptah-extension/shared';
import { formatProviderDisplayName } from './provider-consumer-rows';

/**
 * Decision-model row view (TASK_2026_646 Req 1; TASK_2026_684 C12): the row's pure view logic, moved out of
 * `provider-consumer-rows.ts`. Every function here is pure: the caller passes in the state it read.
 */

/** The decision-model kinds (Req 1.2; TASK_2026_684 adds Ollama Cloud and the custom endpoint). */
export type DecisionModelKind = DecisionModelSelectionDto['kind'];

export const DECISION_ROW_NAME = 'Decision model';

/** Every kind, in the picker's order (TASK_2026_684 plan C12, criterion 1.1); Unset is the default. */
export const DECISION_KIND_OPTIONS: readonly {
  readonly value: DecisionModelKind;
  readonly label: string;
}[] = [
  { value: 'unset', label: 'Unset' },
  { value: 'ollama', label: 'Ollama decision model' },
  { value: 'ollama-cloud', label: 'Ollama Cloud' },
  { value: 'jev', label: 'TypeSafe Jev' },
  { value: 'custom', label: 'Custom endpoint (/v1/systemone)' },
  { value: 'structured', label: 'Structured-output model' },
];

/** The model the host applies when a Jev write omits one (`DecisionModelSelectionDto`, rpc-agents.types.ts). */
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';

/** The model field's label for a kind. */
export function decisionModelLabel(kind: DecisionModelKind): string {
  switch (kind) {
    case 'jev':
      return 'Jev model (optional)';
    case 'ollama':
      return 'Ollama model';
    case 'ollama-cloud':
      return 'Ollama Cloud model';
    case 'custom':
      return 'Model';
    default:
      return 'Model with structured output';
  }
}

/**
 * The model field's placeholder for a kind: Jev shows the host default; Ollama Cloud and the custom endpoint show an
 * example of the expected shape. A placeholder only: the value is never filled in (D3, no preselection).
 */
export function decisionModelPlaceholder(kind: DecisionModelKind): string {
  switch (kind) {
    case 'jev':
      return JEV_DEFAULT_MODEL;
    case 'ollama-cloud':
      return 'e.g. clef:27b-cloud';
    case 'custom':
      return 'model id';
    default:
      return '';
  }
}

/**
 * Host save errors the row repeats word for word (DC12): fixed shared constants, never free host text.
 */
const HOST_SAVE_SENTENCES: ReadonlySet<string> = new Set([
  DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_INVALID_BASE_URL,
  DECISION_MODEL_INVALID_MODEL,
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
]);

/** The host's save error when it is one of the fixed shared sentences, else `null` (the row shows its own). */
export function hostSaveSentence(error: string | undefined): string | null {
  return error !== undefined && HOST_SAVE_SENTENCES.has(error) ? error : null;
}

/** The decision-model row's view: fixed sentences, plus the host's `detail` shown as plain text. */
export interface DecisionModelRow {
  readonly id: 'decision';
  readonly name: string;
  /** The cell's text, e.g. "Ollama · tev1". */
  readonly cellLabel: string;
  /** The badge in the tier slot. */
  readonly stateLabel: string;
  readonly stateMessage: string;
  readonly detail: string | null;
  readonly localityMessage: string | null;
  readonly confidenceMessage: string | null;
  /**
   * The provider the "Set up" link opens (Req 1.5); `null` offers no link (the Jev and custom endpoint keys are
   * entered in this row).
   */
  readonly setupProviderId: string | null;
  readonly setupProviderName: string;
  /** The state needs the user's attention: no credential, not reachable, unsupported, or not read. */
  readonly attention: boolean;
}

const STATE_LABELS: Readonly<Record<DecisionModelStateDto, string>> = {
  unset: 'unset',
  ready: 'ready',
  'no-credential': 'no credential',
  unreachable: 'not reachable',
  'unsupported-endpoint': 'not supported',
};

/** Who serves the selection, in words. A custom endpoint is named by its host, so the user sees where data goes. */
function servedBy(selection: DecisionModelSelectionDto): string {
  if (selection.kind === 'ollama') return 'Ollama';
  if (selection.kind === 'ollama-cloud') return 'Ollama Cloud';
  if (selection.kind === 'jev') return 'TypeSafe Jev';
  if (selection.kind === 'custom') return endpointHost(selection.baseUrl);
  if (selection.kind === 'structured')
    return formatProviderDisplayName(selection.providerId);
  return 'No provider';
}

/** `host[:port]` of a custom endpoint base URL, or the base URL as given when it does not parse. */
function endpointHost(baseUrl: string): string {
  return parseUrl(baseUrl)?.host || baseUrl;
}

function stateMessageOf(
  selection: DecisionModelSelectionDto,
  state: DecisionModelStateDto,
): string {
  const name = servedBy(selection);
  switch (state) {
    case 'unset':
      return 'No decision model is set. Code ranking chooses lanes and models, and no decision request is sent.';
    case 'ready':
      return `${name} is ready to answer routing questions.`;
    case 'no-credential':
      if (selection.kind === 'jev')
        return 'No TypeSafe Jev API key is stored. Add one in this row to use Jev.';
      if (selection.kind === 'ollama-cloud')
        return 'Ollama Cloud has no working credential. Set up Ollama Cloud to use it.';
      if (selection.kind === 'custom')
        return `${name} needs a valid API key. Add one in this row to use this endpoint.`;
      return `${name} has no credential. Set it up to use it.`;
    case 'unreachable':
      return `Could not reach ${name}. Check that it is running and reachable.`;
    case 'unsupported-endpoint':
      return selection.kind === 'ollama' ||
        (selection.kind === 'structured' && selection.providerId === 'ollama')
        ? 'This Ollama endpoint does not serve decision models. It needs Ollama 0.35 or later.'
        : `${name} does not support decision requests.`;
  }
}

/** The provider whose set-up wizard fixes the state; Jev and the custom endpoint have none (their key is entered in this row). */
function setupProviderOf(selection: DecisionModelSelectionDto): string | null {
  if (selection.kind === 'ollama') return 'ollama';
  if (selection.kind === 'ollama-cloud') return 'ollama-cloud';
  if (selection.kind === 'structured') return selection.providerId;
  return null;
}

function localityMessageOf(status: DecisionModelStatusDto): string | null {
  if (status.selection.kind === 'unset') return null;
  if (status.locality === 'local')
    return 'Runs on this machine: the request text and lane data stay on this machine.';
  if (status.locality === 'remote')
    return `The request text and lane data are sent to ${servedBy(status.selection)}.`;
  return null;
}

/**
 * The decision-model row (Req 1.4, 1.5, 1.8). `status` is `null` when the status could not be read: the row then
 * says "not reachable" and saving stays open (plan part A §11, failure behaviour).
 */
export function buildDecisionRow(
  status: DecisionModelStatusDto | null,
): DecisionModelRow {
  if (!status) {
    return {
      id: 'decision',
      name: DECISION_ROW_NAME,
      cellLabel: 'Status not reachable',
      stateLabel: 'not reachable',
      stateMessage:
        'The decision model status is not reachable. You can still choose and save a decision model.',
      detail: null,
      localityMessage: null,
      confidenceMessage: null,
      setupProviderId: null,
      setupProviderName: '',
      attention: true,
    };
  }
  const { selection, state } = status;
  const needsSetup =
    state === 'no-credential' ||
    state === 'unreachable' ||
    state === 'unsupported-endpoint';
  return {
    id: 'decision',
    name: DECISION_ROW_NAME,
    cellLabel:
      selection.kind === 'unset'
        ? 'Unset · code ranking'
        : `${servedBy(selection)} · ${selection.model}`,
    stateLabel: STATE_LABELS[state],
    stateMessage: stateMessageOf(selection, state),
    detail: status.detail,
    localityMessage: localityMessageOf(status),
    confidenceMessage:
      selection.kind === 'structured' && !status.reportsConfidence
        ? 'This model reports no confidence, so its answers carry no confidence score.'
        : null,
    setupProviderId: needsSetup ? setupProviderOf(selection) : null,
    setupProviderName: servedBy(selection),
    attention: needsSetup,
  };
}

/** The decision-model editor's draft (one shape for every kind). */
export interface DecisionModelDraft {
  readonly kind: DecisionModelKind;
  readonly model: string;
  readonly providerId: string;
  /** The custom endpoint's base URL as typed; `''` for every other kind. */
  readonly baseUrl: string;
}

export function decisionDraftFrom(
  selection: DecisionModelSelectionDto | null,
): DecisionModelDraft {
  if (!selection || selection.kind === 'unset')
    return { kind: 'unset', model: '', providerId: '', baseUrl: '' };
  return {
    kind: selection.kind,
    model: selection.model,
    providerId: selection.kind === 'structured' ? selection.providerId : '',
    baseUrl: selection.kind === 'custom' ? selection.baseUrl : '',
  };
}

/** The draft for a newly picked kind: the saved values when that kind is the saved one, else empty fields. */
export function decisionDraftForKind(
  kind: DecisionModelKind,
  saved: DecisionModelSelectionDto | null,
): DecisionModelDraft {
  return saved?.kind === kind
    ? decisionDraftFrom(saved)
    : { kind, model: '', providerId: '', baseUrl: '' };
}

/** The `agent:setConfig` selection for a draft, or `null` while a required field is empty. Jev's model is optional. */
export function decisionModelInput(
  draft: DecisionModelDraft,
): DecisionModelSelectionInputDto | null {
  const model = draft.model.trim();
  switch (draft.kind) {
    case 'unset':
      return { kind: 'unset' };
    case 'ollama':
      return model ? { kind: 'ollama', model } : null;
    case 'ollama-cloud':
      return model ? { kind: 'ollama-cloud', model } : null;
    case 'jev':
      return model ? { kind: 'jev', model } : { kind: 'jev' };
    case 'custom': {
      const baseUrl = draft.baseUrl.trim();
      return baseUrl && model ? { kind: 'custom', baseUrl, model } : null;
    }
    case 'structured':
      return draft.providerId && model
        ? { kind: 'structured', providerId: draft.providerId, model }
        : null;
  }
}

/**
 * Whether a write would store the selection that is already saved (Jev without a model is the host default; a
 * custom base URL is compared in the host's normalised form).
 */
export function sameDecisionSelection(
  input: DecisionModelSelectionInputDto,
  saved: DecisionModelSelectionDto | null,
): boolean {
  if (!saved) return false;
  switch (input.kind) {
    case 'unset':
      return saved.kind === 'unset';
    case 'jev':
      return (
        saved.kind === 'jev' &&
        (input.model ?? JEV_DEFAULT_MODEL) === saved.model
      );
    case 'ollama':
      return saved.kind === 'ollama' && input.model === saved.model;
    case 'ollama-cloud':
      return saved.kind === 'ollama-cloud' && input.model === saved.model;
    case 'custom':
      return (
        saved.kind === 'custom' &&
        normaliseEndpointBaseUrl(input.baseUrl) === saved.baseUrl &&
        input.model === saved.model
      );
    case 'structured':
      return (
        saved.kind === 'structured' &&
        input.providerId === saved.providerId &&
        input.model === saved.model
      );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isState = (value: unknown): value is DecisionModelStateDto =>
  value === 'unset' ||
  value === 'ready' ||
  value === 'no-credential' ||
  value === 'unreachable' ||
  value === 'unsupported-endpoint';

function parseSelection(value: unknown): DecisionModelSelectionDto | null {
  if (!isRecord(value)) return null;
  const { kind, model, providerId, baseUrl } = value;
  if (kind === 'unset') return { kind };
  if (typeof model !== 'string' || !model) return null;
  if (kind === 'ollama' || kind === 'ollama-cloud' || kind === 'jev')
    return { kind, model };
  if (kind === 'custom' && typeof baseUrl === 'string' && baseUrl)
    return { kind, baseUrl, model };
  if (kind === 'structured' && typeof providerId === 'string' && providerId)
    return { kind, providerId, model };
  return null;
}

/** Validates `agent:getConfig`'s `decisionModel` before it reaches view state; any other shape is `null` (not read). */
export function parseDecisionModelStatus(
  value: unknown,
): DecisionModelStatusDto | null {
  if (!isRecord(value)) return null;
  const selection = parseSelection(value['selection']);
  const { locality, reportsConfidence, state, detail, apiKeyStored } = value;
  if (!selection || !isState(state) || typeof reportsConfidence !== 'boolean')
    return null;
  if (locality !== null && locality !== 'local' && locality !== 'remote')
    return null;
  if (detail !== null && typeof detail !== 'string') return null;
  if (apiKeyStored !== undefined && typeof apiKeyStored !== 'boolean')
    return null;
  const status: DecisionModelStatusDto = {
    selection,
    locality,
    reportsConfidence,
    state,
    detail,
  };
  return apiKeyStored === undefined ? status : { ...status, apiKeyStored };
}

// ------------------------------------------------------------------ custom endpoint fields (TASK_2026_684 C12)

/** A custom endpoint field the row can mark invalid. */
export type DecisionEndpointField = 'baseUrl' | 'model';

/**
 * An inline field hint. `message` is one of the host's fixed save errors without its "Could not save the decision
 * model." lead: the hint shows while typing, before any save, so it must not read as a failed save (P4 visual 3).
 */
export interface DecisionEndpointFieldError {
  readonly field: DecisionEndpointField;
  readonly message: string;
}

/**
 * The first invalid custom endpoint field of a draft, in form order, or `null` when the draft is not a custom
 * endpoint or every field passes. Mirrors the host's base URL policy (`decision-endpoint.url.ts` in lane-routing)
 * and D4: a key may only travel over https or to this machine. `keyPresent` is a key typed in the row or one the
 * host reports stored. A hint only: the host stays the authority on save.
 */
export function endpointFieldError(
  draft: DecisionModelDraft,
  keyPresent: boolean,
): DecisionEndpointFieldError | null {
  if (draft.kind !== 'custom') return null;
  const baseUrl = normaliseEndpointBaseUrl(draft.baseUrl);
  if (baseUrl === null)
    return fieldHint('baseUrl', DECISION_MODEL_INVALID_BASE_URL);
  if (keyPresent && !keyTransportAllowed(baseUrl))
    return fieldHint('baseUrl', DECISION_MODEL_KEY_NEEDS_HTTPS);
  if (!draft.model.trim())
    return fieldHint('model', DECISION_MODEL_INVALID_MODEL);
  return null;
}

/** The lead every shared decision-model save error starts with (rpc-agents.types.ts). */
const SAVE_ERROR_LEAD = 'Could not save the decision model. ';

/** A host save error as an inline hint: the same sentence without the save-failure lead. */
export function inlineHintOf(saveError: string): string {
  return saveError.startsWith(SAVE_ERROR_LEAD)
    ? saveError.slice(SAVE_ERROR_LEAD.length)
    : saveError;
}

function fieldHint(
  field: DecisionEndpointField,
  saveError: string,
): DecisionEndpointFieldError {
  return { field, message: inlineHintOf(saveError) };
}

/** Same limit as `ENDPOINT_BASE_URL_MAX_LENGTH` in lane-routing. */
const ENDPOINT_BASE_URL_MAX_LENGTH = 2048;
const HTTP_SCHEME = /^https?:\/\//i;
/**
 * Same rule as the host's `isLoopbackBase` (lane-routing `decision-endpoint.url.ts`): `localhost`, `localhost.`,
 * `[::1]` (`URL` brackets an IPv6 literal) and IPv4 127.0.0.0/8. Other `*.localhost` names are not loopback.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.',
  '[::1]',
]);
/** `URL` serialises every IPv4 spelling as a dotted quad, so `127.0.0.1.evil.com` stays a domain and fails. */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * The host's normalised form of a base URL (WHATWG serialisation without trailing slashes), or `null` when the host
 * would refuse it: empty, longer than the limit, not http(s), or carrying credentials, a query or a fragment.
 */
function normaliseEndpointBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > ENDPOINT_BASE_URL_MAX_LENGTH) return null;
  if (!HTTP_SCHEME.test(trimmed)) return null;
  if (trimmed.includes('?') || trimmed.includes('#')) return null;
  const authority = authorityOf(trimmed);
  // `@` anywhere in the authority is userinfo, even an empty `http://:@host`.
  if (!authority || authority.includes('@')) return null;
  const url = parseUrl(trimmed);
  if (!url || url.username || url.password) return null;
  return stripTrailingSlashes(url.href);
}

/**
 * Whether the saved custom endpoint's stored key would travel with a draft base URL: only when the draft has the
 * saved URL's origin (scheme, host, port). Mirrors the host's key binding (`decision-model-writer.ts` in rpc-handlers,
 * `originOf` in lane-routing): a stored custom key is sent only to the origin it is bound to.
 */
export function storedKeyBoundTo(
  draftBaseUrl: string,
  saved: DecisionModelSelectionDto | undefined,
): boolean {
  if (saved?.kind !== 'custom') return false;
  const draft = normaliseEndpointBaseUrl(draftBaseUrl);
  const bound = parseUrl(saved.baseUrl);
  if (draft === null || !bound || bound.origin === 'null') return false;
  return parseUrl(draft)?.origin === bound.origin;
}

/**
 * The host's knowledge of a keyed kind's stored key: `apiKeyStored` when the saved selection is that kind and reports
 * it, else a saved Jev selection's state (`ready` = stored, `no-credential` = none); `null` when unknown. The host
 * reports `apiKeyStored` for the saved kind only (DC13), so a key of another kind is always unknown here.
 */
export function storedKeyKnown(
  kind: 'jev' | 'custom' | null,
  status: DecisionModelStatusDto | null,
): boolean | null {
  if (!kind || status?.selection.kind !== kind) return null;
  if (status.apiKeyStored !== undefined) return status.apiKeyStored;
  if (kind === 'jev' && status.state === 'ready') return true;
  if (kind === 'jev' && status.state === 'no-credential') return false;
  return null;
}

/** D4: a key may be sent only over https or to a loopback host. */
function keyTransportAllowed(baseUrl: string): boolean {
  const url = parseUrl(baseUrl);
  if (!url) return false;
  return (
    url.protocol === 'https:' ||
    LOOPBACK_HOSTNAMES.has(url.hostname) ||
    LOOPBACK_IPV4.test(url.hostname)
  );
}

/** Text between `://` and the first `/`, `\`, `?` or `#`. */
function authorityOf(absolute: string): string {
  const rest = absolute.slice(absolute.indexOf('://') + 3);
  const end = rest.search(/[/\\?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
}

/** Text that `URL` cannot parse is "not a URL" here, so it is answered with `null` instead of a failure. */
function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}
