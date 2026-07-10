/**
 * Zod boundary validation for Discord control-command and autocomplete
 * interaction payloads (TASK_2026_156, SEC-8).
 *
 * The adapter extracts plain values from the `DiscordInteractionLike` seam
 * and parses them here BEFORE any `GatewayCommandInvocation` /
 * `GatewayAutocompleteRequest` is built. A payload that fails validation
 * never reaches the command handler: commands get a fixed ephemeral error,
 * autocomplete gets an empty choice list.
 */
import { z } from 'zod';
import type { GatewayCommand } from '../../commands/gateway-command.types';

/** The four control-plane top-level command names (plan §2.1). */
export const DISCORD_CONTROL_COMMAND_NAMES = [
  'sessions',
  'session',
  'new',
  'workspace',
] as const;

const PICK_MAX_CHARS = 200;

const pickSchema = z.string().trim().min(1).max(PICK_MAX_CHARS);

/**
 * Command payload → `GatewayCommand`. A union of the five valid shapes; any
 * other commandName/subcommand/pick combination fails closed.
 */
export const discordControlCommandSchema = z.union([
  z
    .object({ commandName: z.literal('sessions') })
    .transform((): GatewayCommand => ({ kind: 'sessions' })),
  z
    .object({ commandName: z.literal('new') })
    .transform((): GatewayCommand => ({ kind: 'new' })),
  z
    .object({
      commandName: z.literal('session'),
      subcommand: z.literal('use'),
      pick: pickSchema,
    })
    .transform((v): GatewayCommand => ({ kind: 'session-use', pick: v.pick })),
  z
    .object({
      commandName: z.literal('workspace'),
      subcommand: z.literal('list'),
    })
    .transform((): GatewayCommand => ({ kind: 'workspace-list' })),
  z
    .object({
      commandName: z.literal('workspace'),
      subcommand: z.literal('use'),
      pick: pickSchema,
    })
    .transform(
      (v): GatewayCommand => ({ kind: 'workspace-use', pick: v.pick }),
    ),
]);

/** Routing envelope shared by command and autocomplete interactions. */
const routingSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().min(1).nullable(),
  userId: z.string().min(1),
  isThread: z.boolean(),
  parentId: z.string().min(1).nullable(),
});

const autocompleteSchema = routingSchema.extend({
  commandName: z.enum(['session', 'workspace']),
  focused: z.string().transform((s) => s.slice(0, PICK_MAX_CHARS)),
});

export interface DiscordControlCommandRaw {
  commandName: string;
  channelId: string;
  guildId: string | null;
  userId: string | undefined;
  isThread: boolean;
  parentId: string | null;
  subcommand: string | null;
  pick: string | null;
}

export interface ParsedDiscordControlCommand {
  command: GatewayCommand;
  /** Parent channel id in a thread, else the channel id itself. */
  externalChatId: string;
  /** Present iff the interaction happened inside a thread. */
  threadId?: string;
  /** Guild id (rate-limit key), absent for DMs. */
  allowListId?: string;
}

export function parseDiscordControlCommand(
  raw: DiscordControlCommandRaw,
): ParsedDiscordControlCommand | null {
  const routing = routingSchema.safeParse(raw);
  if (!routing.success) return null;
  const payload = discordControlCommandSchema.safeParse(raw);
  if (!payload.success) return null;
  const r = routing.data;
  const externalChatId = r.isThread ? r.parentId : r.channelId;
  if (externalChatId === null) return null;
  return {
    command: payload.data,
    externalChatId,
    threadId: r.isThread ? r.channelId : undefined,
    allowListId: r.guildId ?? undefined,
  };
}

export interface DiscordAutocompleteRaw {
  commandName: string;
  channelId: string;
  guildId: string | null;
  userId: string | undefined;
  isThread: boolean;
  parentId: string | null;
  focused: string;
}

export interface ParsedDiscordAutocomplete {
  target: 'session-pick' | 'workspace-pick';
  externalChatId: string;
  threadId?: string;
  allowListId?: string;
  /** Focused text, length-clamped — untrusted, filter-only downstream. */
  query: string;
}

export function parseDiscordAutocomplete(
  raw: DiscordAutocompleteRaw,
): ParsedDiscordAutocomplete | null {
  const parsed = autocompleteSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const externalChatId = p.isThread ? p.parentId : p.channelId;
  if (externalChatId === null) return null;
  return {
    target: p.commandName === 'session' ? 'session-pick' : 'workspace-pick',
    externalChatId,
    threadId: p.isThread ? p.channelId : undefined,
    allowListId: p.guildId ?? undefined,
    query: p.focused,
  };
}
