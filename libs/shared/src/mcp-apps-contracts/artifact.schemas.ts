import { z } from 'zod';
import type {
  ArtifactHostToPageMessage,
  ArtifactListResponse,
  ArtifactPageToHostMessage,
  ArtifactPublishInput,
  ArtifactPublishResult,
  ArtifactPublishedNotification,
  ArtifactRecord,
  ArtifactThemeVarName,
} from './artifact.types';

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_HEIGHT_MIN = 160;
export const ARTIFACT_HEIGHT_MAX = 1600;
export const ARTIFACT_PROTOCOL_SCHEME = 'ptah-artifact';
export const ARTIFACT_THEME_VAR_ALLOWLIST = [
  '--b1', '--b2', '--b3', '--bc', '--bcm', '--ptah-gold',
  '--ptah-accent-ink', '--ptah-link', '--state-ink-err',
  '--state-ink-done', '--surface-highlight',
] as const satisfies readonly ArtifactThemeVarName[];

const title = z.string().trim().min(1).max(120);
const html = z.string().min(1).refine(
  (value) => new TextEncoder().encode(value).byteLength <= ARTIFACT_MAX_BYTES,
  'HTML exceeds 2 MiB UTF-8',
);
const path = z.string().min(1).max(1024).refine(
  (value) => value.trim().length > 0,
  'Path must not be blank',
);

/** Strict branches enforce exactly one source without discarding unknown keys. */
export const ArtifactPublishInputSchema = z.union([
  z.strictObject({ title, html }),
  z.strictObject({ title, path }),
]) satisfies z.ZodType<ArtifactPublishInput>;

const id = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const sessionId = z.string().min(1).max(256);
const viewerUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === `${ARTIFACT_PROTOCOL_SCHEME}:`
      && /^[A-Za-z0-9_-]{16,128}$/.test(url.hostname)
      && url.pathname === '/index.html'
      && !url.search && !url.hash;
  } catch {
    // degradation-audit: reported — `false` is the refine's invalid-URL result.
    return false;
  }
}, 'Invalid artifact viewer URL');

export const ArtifactRecordSchema = z.strictObject({
  id,
  title,
  revision: z.number().int().positive(),
  sessionId,
  viewerUrl,
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<ArtifactRecord>;

export const ArtifactPublishResultSchema = ArtifactRecordSchema.extend({
  savedPath: path,
}) satisfies z.ZodType<ArtifactPublishResult>;

export const ArtifactPublishedNotificationSchema = ArtifactRecordSchema satisfies
  z.ZodType<ArtifactPublishedNotification>;
export const ArtifactListRequestSchema = z.strictObject({
  sessionId: z.string().trim().min(1).max(200),
});
export const ArtifactListResponseSchema = z.strictObject({
  artifacts: z.array(ArtifactRecordSchema),
}) satisfies z.ZodType<ArtifactListResponse>;

const nonce = z.string().min(16).max(128);
const themeVars = z.record(z.string(), z.string().max(200)).refine(
  (vars) => Object.keys(vars).every((key) =>
    ARTIFACT_THEME_VAR_ALLOWLIST.includes(key as ArtifactThemeVarName)),
  'Unknown theme variable',
);
export const ArtifactThemeMessageSchema = z.strictObject({
  type: z.literal('theme'),
  mode: z.enum(['light', 'dark']),
  vars: themeVars,
  nonce,
}) satisfies z.ZodType<ArtifactHostToPageMessage>;

export const ArtifactHeightMessageSchema = z.strictObject({
  type: z.literal('height'),
  px: z.number().int().min(ARTIFACT_HEIGHT_MIN).max(ARTIFACT_HEIGHT_MAX),
  nonce,
});
export const ArtifactOpenLinkMessageSchema = z.strictObject({
  type: z.literal('open-link'),
  url: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Only HTTP(S) links are allowed'),
  nonce,
});
export const ArtifactPageToHostMessageSchema = z.discriminatedUnion('type', [
  ArtifactHeightMessageSchema,
  ArtifactOpenLinkMessageSchema,
]) satisfies z.ZodType<ArtifactPageToHostMessage>;
