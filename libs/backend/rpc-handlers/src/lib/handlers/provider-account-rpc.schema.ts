/**
 * Zod schemas for {@link ProviderAccountRpcHandlers} (`provider:*Account*`).
 *
 * The wire contracts live zod-free in `@ptah-extension/shared`
 * (`rpc-provider-accounts.types.ts`); these schemas are the boundary check in
 * front of them. Every object is strict: a caller names an account only by
 * provider, opaque profile ID, scope and the workspace root it acts for, plus
 * the revision it saw and an idempotency `requestId`. A directory, environment
 * bag, token, owner key or any other extra field fails the parse, so nothing
 * runs.
 */

import { z } from 'zod';
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  PROVIDER_ACCOUNT_SCOPES,
  isProviderAccountOpaqueId,
  isSafeProviderAccountLabel,
  type ProviderAccountRpcMethodName,
  type ProviderAccountRpcMethodRegistry,
} from '@ptah-extension/shared';

/** Upper bound for a workspace root; the handler checks it is an open folder. */
const WORKSPACE_ROOT_MAX_LENGTH = 4096;

const OpaqueIdSchema = z.string().refine(isProviderAccountOpaqueId);
const LabelSchema = z.string().refine(isSafeProviderAccountLabel);
const ProviderSchema = z.enum(PROVIDER_ACCOUNT_PROVIDERS);
const ScopeSchema = z.enum(PROVIDER_ACCOUNT_SCOPES);
const WorkspaceRootSchema = z
  .string()
  .min(1)
  .max(WORKSPACE_ROOT_MAX_LENGTH)
  .refine((value) => !value.includes('\0'));
/** Profile revisions start at 0. */
const ProfileRevisionSchema = z.number().int().nonnegative();
/** Selection revisions are `-1` until the first stored selection. */
const SelectionRevisionSchema = z.number().int().min(-1);

const SelectionWriteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ambient') }).strict(),
  z
    .object({
      kind: z.literal('named'),
      profileId: OpaqueIdSchema,
      expectedProfileRevision: ProfileRevisionSchema,
    })
    .strict(),
]);

export const ProviderListAccountsSchema = z
  .object({ provider: ProviderSchema, workspaceRoot: WorkspaceRootSchema })
  .strict();

export const ProviderAddAccountSchema = z
  .object({
    provider: ProviderSchema,
    workspaceRoot: WorkspaceRootSchema,
    requestId: OpaqueIdSchema,
    label: LabelSchema,
  })
  .strict();

/** Shared shape of a write against one profile at a seen revision. */
const profileWriteShape = {
  provider: ProviderSchema,
  workspaceRoot: WorkspaceRootSchema,
  requestId: OpaqueIdSchema,
  profileId: OpaqueIdSchema,
  expectedRevision: ProfileRevisionSchema,
};

export const ProviderRenameAccountSchema = z
  .object({ ...profileWriteShape, label: LabelSchema })
  .strict();

export const ProviderRemoveAccountSchema = z
  .object(profileWriteShape)
  .strict();

export const ProviderGetAccountStatusSchema = z
  .object({ provider: ProviderSchema, profileId: OpaqueIdSchema })
  .strict();

export const ProviderStartAccountSignInSchema = z
  .object(profileWriteShape)
  .strict();

export const ProviderCancelAccountSignInSchema = z
  .object({
    provider: ProviderSchema,
    workspaceRoot: WorkspaceRootSchema,
    requestId: OpaqueIdSchema,
    profileId: OpaqueIdSchema,
    operationId: OpaqueIdSchema,
  })
  .strict();

export const ProviderSignOutAccountSchema = z
  .object(profileWriteShape)
  .strict();

export const ProviderSetAccountSelectionSchema = z
  .object({
    provider: ProviderSchema,
    workspaceRoot: WorkspaceRootSchema,
    requestId: OpaqueIdSchema,
    scope: ScopeSchema,
    selection: SelectionWriteSchema,
    expectedSelectionRevision: SelectionRevisionSchema,
  })
  .strict();

export const ProviderSetAccountDefaultSchema = z
  .object({
    provider: ProviderSchema,
    workspaceRoot: WorkspaceRootSchema,
    requestId: OpaqueIdSchema,
    selection: SelectionWriteSchema,
    expectedSelectionRevisions: z
      .object({ main: SelectionRevisionSchema, lane: SelectionRevisionSchema })
      .strict(),
  })
  .strict();

/**
 * One schema per method. The mapped type proves each schema's output is
 * assignable to the shared params contract, so the two cannot drift.
 */
export const PROVIDER_ACCOUNT_RPC_SCHEMAS: {
  readonly [K in ProviderAccountRpcMethodName]: z.ZodType<
    ProviderAccountRpcMethodRegistry[K]['params']
  >;
} = {
  'provider:listAccounts': ProviderListAccountsSchema,
  'provider:addAccount': ProviderAddAccountSchema,
  'provider:renameAccount': ProviderRenameAccountSchema,
  'provider:removeAccount': ProviderRemoveAccountSchema,
  'provider:getAccountStatus': ProviderGetAccountStatusSchema,
  'provider:startAccountSignIn': ProviderStartAccountSignInSchema,
  'provider:cancelAccountSignIn': ProviderCancelAccountSignInSchema,
  'provider:signOutAccount': ProviderSignOutAccountSchema,
  'provider:setAccountSelection': ProviderSetAccountSelectionSchema,
  'provider:setAccountDefault': ProviderSetAccountDefaultSchema,
};
