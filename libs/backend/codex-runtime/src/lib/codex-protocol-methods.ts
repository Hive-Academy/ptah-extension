import { z } from 'zod';
import {
  string,
  integer,
  json,
  object,
  empty,
  threadId,
  turnIds,
  itemIds,
  approvalIds,
  decision,
  approvalPolicy,
  reviewer,
  sandbox,
  input,
  commandAction,
  functionOutput,
  item,
  turnError,
  turn,
  thread,
  threadOptions,
  threadResult,
  permissions,
  elicitation,
  usage,
  rateWindow,
  rateLimits,
} from './codex-protocol-schemas';

/** Hand-written boundary schemas for the pinned runtime surface. */
export const codexRequestSchemas = {
  initialize: {
    params: z.strictObject({
      clientInfo: z.strictObject({ name: string, version: string }),
      capabilities: z.strictObject({
        experimentalApi: z.literal(true),
        extensions: object.nullish(),
        mcpServerOpenaiFormElicitation: z.boolean().optional(),
        optOutNotificationMethods: z.array(string).nullish(),
        requestAttestation: z.boolean().optional(),
      }),
    }),
    result: z.strictObject({
      codexHome: string,
      platformFamily: string,
      platformOs: string,
      userAgent: string,
    }),
  },
  'thread/start': {
    params: z.strictObject({
      ...threadOptions,
      ephemeral: z.boolean().nullish(),
      serviceName: string.nullish(),
      sessionStartSource: z.enum(['startup', 'clear']).nullish(),
      threadSource: string.nullish(),
    }),
    result: threadResult,
  },
  'thread/resume': {
    params: z.strictObject({
      ...threadOptions,
      ...threadId,
      excludeTurns: z.boolean().optional(),
    }),
    result: threadResult,
  },
  'turn/start': {
    params: z.strictObject({
      ...threadId,
      input,
      approvalPolicy: approvalPolicy.nullish(),
      approvalsReviewer: reviewer.nullish(),
      clientUserMessageId: string.nullish(),
      cwd: string.nullish(),
      effort: string.min(1).nullish(),
      model: string.nullish(),
      outputSchema: json.optional(),
      personality: threadOptions.personality,
      sandboxPolicy: sandbox.nullish(),
      serviceTier: string.nullish(),
      serviceTierForTurn: string.nullish(),
      summary: z.enum(['auto', 'concise', 'detailed', 'none']).nullish(),
      toolOutput: z
        .strictObject({
          name: string,
          namespace: string.nullish(),
          output: functionOutput,
        })
        .nullish(),
      turnTrigger: string.nullish(),
    }),
    result: z.strictObject({ turn }),
  },
  'turn/steer': {
    params: z.strictObject({
      ...threadId,
      expectedTurnId: string,
      input,
      clientUserMessageId: string.nullish(),
    }),
    result: z.strictObject({ turnId: string }),
  },
  'turn/interrupt': { params: z.strictObject(turnIds), result: empty },
  'thread/compact/start': { params: z.strictObject(threadId), result: empty },
  'account/rateLimits/read': {
    params: empty.nullish(),
    result: z.strictObject({
      rateLimits,
      accountId: string.nullish(),
      ordinaryUsageAllowed: z.boolean().nullish(),
      rateLimitsByLimitId: z.record(string, rateLimits).nullish(),
      rateLimitResetCredits: object.nullish(),
      rateLimitUpsell: json.optional(),
    }),
  },
} as const;

export const codexServerRequestSchemas = {
  'item/commandExecution/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      approvalId: string.nullish(),
      command: string.nullish(),
      commandActions: z.array(commandAction).nullish(),
      cwd: string.nullish(),
      environmentId: string.nullish(),
      kind: z.enum(['command', 'writeStdin']).optional(),
      reason: string.nullish(),
      proposedExecpolicyAmendment: z.array(string).nullish(),
      networkApprovalContext: z
        .strictObject({
          host: string,
          protocol: z.enum(['http', 'https', 'socks5Tcp', 'socks5Udp']),
        })
        .nullish(),
      proposedNetworkPolicyAmendments: z
        .array(
          z.strictObject({ host: string, action: z.enum(['allow', 'deny']) }),
        )
        .nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/fileChange/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      grantRoot: string.nullish(),
      reason: string.nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/permissions/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      cwd: string,
      environmentId: string.nullish(),
      permissions,
      reason: string.nullish(),
    }),
    result: z.strictObject({
      permissions,
      scope: z.enum(['turn', 'session']).optional(),
      strictAutoReview: z.boolean().nullish(),
    }),
  },
  'item/tool/requestUserInput': {
    params: z.strictObject({
      ...itemIds,
      isBlocking: z.boolean(),
      autoResolutionMs: integer.nonnegative().nullish(),
      questions: z.array(
        z.strictObject({
          id: string,
          header: string,
          question: string,
          isOther: z.boolean().optional(),
          isSecret: z.boolean().optional(),
          options: z
            .array(z.strictObject({ label: string, description: string }))
            .nullish(),
        }),
      ),
    }),
    result: z.strictObject({
      answers: z.record(string, z.strictObject({ answers: z.array(string) })),
    }),
  },
  'mcpServer/elicitation/request': {
    params: elicitation,
    result: z.strictObject({
      action: z.enum(['accept', 'decline', 'cancel']),
      content: json.optional(),
      _meta: json.optional(),
    }),
  },
} as const;

// Notification objects permit additional properties in the pinned schema.
// Keep these separate from the strict request/response contracts.
const notificationStatus = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('notLoaded') }),
  z.looseObject({ type: z.literal('idle') }),
  z.looseObject({ type: z.literal('systemError') }),
  z.looseObject({
    type: z.literal('active'),
    activeFlags: z.array(z.enum(['waitingOnApproval', 'waitingOnUserInput'])),
  }),
]);
const notificationRateLimits = rateLimits.loose().extend({
  primary: rateWindow.loose().nullish(),
  secondary: rateWindow.loose().nullish(),
  planType: z
    .enum([
      'free',
      'go',
      'plus',
      'pro',
      'prolite',
      'team',
      'self_serve_business_prolite',
      'self_serve_business_usage_based',
      'business',
      'ent26',
      'enterprise_cbp_automation',
      'enterprise_cbp_usage_based',
      'enterprise',
      'edu',
      'edu_plus',
      'edu_pro',
      'unknown',
    ])
    .nullish(),
  rateLimitReachedType: z
    .enum([
      'rate_limit_reached',
      'workspace_owner_credits_depleted',
      'workspace_member_credits_depleted',
      'workspace_owner_usage_limit_reached',
      'workspace_member_usage_limit_reached',
    ])
    .nullish(),
  individualLimit: rateLimits.shape.individualLimit
    .unwrap()
    .unwrap()
    .loose()
    .nullish(),
  credits: rateLimits.shape.credits.unwrap().unwrap().loose().nullish(),
});

export const codexNotificationSchemas = {
  initialized: empty.optional(),
  'account/rateLimits/updated': z.looseObject({
    rateLimits: notificationRateLimits,
  }),
  'mcpServer/startupStatus/updated': z.looseObject({
    name: string,
    status: z.enum(['starting', 'ready', 'failed', 'cancelled']),
    error: string.nullish(),
    failureReason: z.literal('reauthenticationRequired').nullish(),
    threadId: string.nullish(),
  }),
  'remoteControl/status/changed': z.looseObject({
    installationId: string,
    serverName: string,
    status: z.enum(['disabled', 'connecting', 'connected', 'errored']),
    environmentId: string.nullish(),
  }),
  'serverRequest/resolved': z.looseObject({
    ...threadId,
    requestId: z.union([string, integer]),
  }),
  'thread/started': z.looseObject({
    thread: thread.loose().extend({ status: notificationStatus }),
  }),
  'thread/status/changed': z.looseObject({
    ...threadId,
    status: notificationStatus,
  }),
  'turn/moderationMetadata': z.looseObject({ ...turnIds, metadata: json }),
  'item/started': z.strictObject({ ...turnIds, item, startedAtMs: integer }),
  'item/completed': z.strictObject({
    ...turnIds,
    item,
    completedAtMs: integer,
  }),
  'item/agentMessage/delta': z.strictObject({ ...itemIds, delta: string }),
  'turn/started': z.strictObject({ ...threadId, turn }),
  'turn/completed': z.strictObject({ ...threadId, turn }),
  'thread/tokenUsage/updated': z.strictObject({
    ...turnIds,
    tokenUsage: z.strictObject({
      last: usage,
      total: usage,
      modelContextWindow: integer.nullish(),
    }),
  }),
  error: z.strictObject({
    ...turnIds,
    error: turnError,
    willRetry: z.boolean(),
  }),
} as const;
