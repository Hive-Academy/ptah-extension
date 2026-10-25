/**
 * Zod schemas for the provider-account vocabulary.
 *
 * Dependency direction is schemas → types, matching `provider-profile`.
 * Parse helpers return data or a closed failure code. They do not return
 * Zod issues, which can echo a rejected path, env bag or identity.
 */

import { z } from 'zod';

import {
  PROVIDER_ACCOUNT_BINDING_VERSION,
  PROVIDER_ACCOUNT_OWNER_MARKERS,
  PROVIDER_ACCOUNT_PROVIDERS,
  PROVIDER_ACCOUNT_RESULT_CODES,
  PROVIDER_ACCOUNT_SCOPES,
  PROVIDER_ACCOUNT_STATES,
  isProviderAccountFingerprint,
  isProviderAccountOpaqueId,
  isProviderAccountOwnerKey,
  isSafeProviderAccountLabel,
  isSafeProviderAccountSummary,
} from './provider-account.types';
import type {
  ProviderAccountActionResult,
  ProviderAccountBinding,
  ProviderAccountBindingPresence,
  ProviderAccountSelection,
  ProviderAccountSelectionField,
  ProviderAccountSelectionRequest,
  ProviderAccountSummary,
} from './provider-account.types';

const providerSchema = z.enum(PROVIDER_ACCOUNT_PROVIDERS);
const scopeSchema = z.enum(PROVIDER_ACCOUNT_SCOPES);
const stateSchema = z.enum(PROVIDER_ACCOUNT_STATES);
const resultCodeSchema = z.enum(PROVIDER_ACCOUNT_RESULT_CODES);
const ownerMarkerSchema = z.enum(PROVIDER_ACCOUNT_OWNER_MARKERS);

const opaqueIdSchema = z.string().refine(isProviderAccountOpaqueId);
const fingerprintSchema = z.string().refine(isProviderAccountFingerprint);
const labelSchema = z.string().refine(isSafeProviderAccountLabel);
const summarySchema = z.string().refine(isSafeProviderAccountSummary);
const ownerKeySchema = z.string().refine(isProviderAccountOwnerKey);

/** Positive safe integer. Floats and coerced numeric strings are rejected. */
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Registry auth epochs and route revisions start at zero (migration 0058). */
const accountRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const activeRunCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000);

const omittedSelectionSchema = z.object({ kind: z.literal('omitted') }).strict();

const ambientSelectionSchema = z.object({ kind: z.literal('ambient') }).strict();

const namedSelectionSchema = z
  .object({
    kind: z.literal('named'),
    profileId: opaqueIdSchema,
  })
  .strict();

export const ProviderAccountSelectionSchema: z.ZodType<ProviderAccountSelection> =
  z.discriminatedUnion('kind', [
    omittedSelectionSchema,
    ambientSelectionSchema,
    namedSelectionSchema,
  ]);

export const ProviderAccountSelectionRequestSchema: z.ZodType<ProviderAccountSelectionRequest> =
  z
    .object({
      provider: providerSchema,
      scope: scopeSchema,
      selection: ProviderAccountSelectionSchema,
    })
    .strict();

export const ProviderAccountSummarySchema: z.ZodType<ProviderAccountSummary> = z
  .object({
    profileId: opaqueIdSchema,
    label: labelSchema,
    provider: providerSchema,
    state: stateSchema,
    owner: ownerMarkerSchema,
    revision: revisionSchema,
    activeRunCount: activeRunCountSchema,
  })
  .strict();

export const ProviderAccountActionResultSchema: z.ZodType<ProviderAccountActionResult> =
  z
    .object({
      code: resultCodeSchema,
      summary: summarySchema,
    })
    .strict();

const knownIdentitySchema = z
  .object({
    kind: z.literal('known'),
    ownerKey: ownerKeySchema,
  })
  .strict();

const unknownIdentitySchema = z.object({ kind: z.literal('unknown') }).strict();

export const ProviderAccountIdentityEvidenceSchema = z.discriminatedUnion(
  'kind',
  [knownIdentitySchema, unknownIdentitySchema],
);

export const ProviderAccountBindingSchema: z.ZodType<ProviderAccountBinding> = z
  .object({
    version: z.literal(PROVIDER_ACCOUNT_BINDING_VERSION),
    provider: providerSchema,
    profileId: opaqueIdSchema,
    routeRevision: accountRevisionSchema,
    routeFingerprint: fingerprintSchema,
    authEpoch: accountRevisionSchema,
    runId: opaqueIdSchema,
    identity: ProviderAccountIdentityEvidenceSchema,
  })
  .strict();

export type ProviderAccountParseOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'rejected' };

function parseWith<T>(schema: z.ZodType<T>, value: unknown): ProviderAccountParseOutcome<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, code: 'rejected' };
  return { ok: true, value: parsed.data };
}

export function parseProviderAccountSelectionRequest(
  value: unknown,
): ProviderAccountParseOutcome<ProviderAccountSelectionRequest> {
  return parseWith(ProviderAccountSelectionRequestSchema, value);
}

export function parseProviderAccountSummary(
  value: unknown,
): ProviderAccountParseOutcome<ProviderAccountSummary> {
  return parseWith(ProviderAccountSummarySchema, value);
}

export function parseProviderAccountActionResult(
  value: unknown,
): ProviderAccountParseOutcome<ProviderAccountActionResult> {
  return parseWith(ProviderAccountActionResultSchema, value);
}

export function parseProviderAccountBinding(
  value: unknown,
): ProviderAccountParseOutcome<ProviderAccountBinding> {
  return parseWith(ProviderAccountBindingSchema, value);
}

/**
 * `undefined` is a legacy absent binding. `null`, a wrong version, excess
 * authority fields and any other malformed present value are `invalid-bound`.
 */
export function classifyProviderAccountBinding(
  value: unknown,
): ProviderAccountBindingPresence {
  if (value === undefined) return { status: 'absent' };
  const parsed = parseProviderAccountBinding(value);
  if (!parsed.ok) return { status: 'invalid-bound' };
  return { status: 'bound', binding: parsed.value };
}

/**
 * A missing field is the omitted route. `null` and excess keys are invalid,
 * not an implicit ambient or named selection.
 */
export function readProviderAccountSelectionField(
  value: unknown,
): ProviderAccountSelectionField {
  if (value === undefined) return { status: 'omitted' };
  const parsed = ProviderAccountSelectionSchema.safeParse(value);
  if (!parsed.success) return { status: 'invalid' };
  return { status: 'present', selection: parsed.data };
}
