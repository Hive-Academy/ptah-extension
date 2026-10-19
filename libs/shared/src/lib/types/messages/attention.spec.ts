import {
  AttentionChangedPayloadSchema,
  AttentionOpenTargetPayloadSchema,
  AttentionNoticeSchema,
} from './schemas';
import { attentionRequestKey, workspaceIdFromPath } from './attention-identity';

const target = {
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  tabId: 'tab-1',
  surfaceMode: true,
};

const notice = {
  key: 'permission:request-1',
  generation: 2,
  kind: 'permission',
  title: 'Review the session',
  occurredAt: 1234,
  target,
};

describe('attention wire privacy', () => {
  it('accepts a bounded session title and safe routing identifiers', () => {
    expect(AttentionChangedPayloadSchema.safeParse({ change: 'upsert', notice }).success).toBe(true);
    expect(AttentionOpenTargetPayloadSchema.safeParse({
      key: notice.key,
      generation: notice.generation,
      target,
    }).success).toBe(true);
    expect(AttentionNoticeSchema.parse({ ...notice, title: 'x'.repeat(121) }).title).toHaveLength(120);
  });

  it.each(['question', 'prompt', 'toolInput', 'arguments', 'rawError', 'secret', 'filePath'])(
    'rejects the private %s field in an upsert', (field) => {
      const privateNotice = { ...notice, [field]: 'PRIVATE_CANARY' };
      expect(AttentionChangedPayloadSchema.safeParse({ change: 'upsert', notice: privateNotice }).success).toBe(false);
    },
  );

  it('rejects private fields in resolve, openTarget, and nested target', () => {
    expect(AttentionChangedPayloadSchema.safeParse({
      change: 'resolve', key: notice.key, generation: 2, rawError: 'PRIVATE_CANARY',
    }).success).toBe(false);
    expect(AttentionOpenTargetPayloadSchema.safeParse({
      key: notice.key, generation: 2, target, prompt: 'PRIVATE_CANARY',
    }).success).toBe(false);
    expect(AttentionNoticeSchema.safeParse({
      ...notice, target: { ...target, filePath: 'C:\\private\\file.ts' },
    }).success).toBe(false);
    expect(AttentionNoticeSchema.safeParse({
      ...notice, target: { ...target, workspaceId: 'C:\\private\\repo' },
    }).success).toBe(false);
  });

  it('requires valid discriminants and generations', () => {
    expect(AttentionChangedPayloadSchema.safeParse({
      change: 'resolve', key: notice.key, generation: -1,
    }).success).toBe(false);
    expect(AttentionChangedPayloadSchema.safeParse({ change: 'remove', notice }).success).toBe(false);
  });
});

describe('attention identity', () => {
  it('uses one path-free key and safely encodes unusual request ids', () => {
    expect(attentionRequestKey('permission', 'abc-1')).toBe('permission:abc-1');
    const key = attentionRequestKey('question', 'C:\\private\\request');
    expect(key).toMatch(/^question:x-[A-Za-z0-9_-]+$/);
    expect(key).not.toContain('private');
  });

  it('normalizes workspace roots into opaque ids', () => {
    expect(workspaceIdFromPath('C:\\Repo\\')).toBe(workspaceIdFromPath('c:/repo'));
    expect(workspaceIdFromPath('/private/workspace')).toMatch(/^ws-[a-z0-9]+$/);
    expect(workspaceIdFromPath('/private/workspace')).not.toContain('private');
  });
});
