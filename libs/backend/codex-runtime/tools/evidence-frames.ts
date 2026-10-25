import { z } from 'zod';

export const MAX_FRAME_BYTES = 1024 * 1024;

export const idSchema = z.union([z.string(), z.number().int()]);
export const methodSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_./:-]+$/);
export const header = {
  jsonrpc: z.literal('2.0').optional(),
  emittedAtMs: z.number().int().nonnegative().optional(),
};
export const requestFrame = z
  .object({
    ...header,
    id: idSchema,
    method: methodSchema,
    params: z.unknown().optional(),
  })
  .strict();
export const notificationFrame = z
  .object({ ...header, method: methodSchema, params: z.unknown().optional() })
  .strict();
export const responseFrame = z
  .object({ ...header, id: idSchema, result: z.unknown() })
  .strict();
export const errorFrame = z
  .object({
    ...header,
    id: idSchema,
    error: z.object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    }),
  })
  .strict();
export const envelope = z.union([
  requestFrame,
  notificationFrame,
  responseFrame,
  errorFrame,
]);
export type Frame = z.infer<typeof envelope>;
export type RequestFrame = z.infer<typeof requestFrame>;

/** Buffer bytes, not decoded characters: multibyte sequences may span chunks. */
export class FrameDecoder {
  private pending = Buffer.alloc(0);
  rejectedFrameKeys: string[] = [];
  push(chunk: Buffer): Frame[] {
    const frames: Frame[] = [];
    this.rejectedFrameKeys = [];
    let start = 0;
    for (
      let end = chunk.indexOf(10);
      end !== -1;
      end = chunk.indexOf(10, start)
    ) {
      const part = chunk.subarray(start, end);
      if (this.pending.length + part.length > MAX_FRAME_BYTES)
        throw new Error('frame too large');
      const bytes = Buffer.concat([this.pending, part]);
      this.pending = Buffer.alloc(0);
      if (bytes.length) {
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        const parsed = envelope.safeParse(value);
        if (!parsed.success) {
          this.rejectedFrameKeys =
            typeof value === 'object' && value !== null && !Array.isArray(value)
              ? Object.keys(value)
                  .filter((key) => /^[a-z][A-Za-z0-9]{0,31}$/.test(key))
                  .slice(0, 10)
              : []; // camelCase protocol keys only: no paths or env names
          throw new Error('invalid or oversized protocol frame');
        }
        frames.push(parsed.data);
      }
      start = end + 1;
    }
    if (this.pending.length + chunk.length - start > MAX_FRAME_BYTES)
      throw new Error('frame too large');
    this.pending = Buffer.concat([this.pending, chunk.subarray(start)]);
    return frames;
  }
}
