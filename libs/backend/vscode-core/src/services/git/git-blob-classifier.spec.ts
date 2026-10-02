import { GIT_DIFF_MAX_SIDE_BYTES } from '@ptah-extension/shared';
import { classifyBlobBytes } from './git-blob-classifier';

const OID =
  'sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393';

const pointer = (body: string): Buffer => Buffer.from(body, 'utf8');

describe('classifyBlobBytes', () => {
  it('returns text as content', () => {
    expect(classifyBlobBytes(Buffer.from('hello\n'))).toEqual({
      outcome: 'content',
      content: 'hello\n',
    });
  });

  it('returns bytes with a NUL as binary with their length', () => {
    expect(classifyBlobBytes(Buffer.from([0x50, 0x00, 0x4e]))).toEqual({
      outcome: 'binary',
      byteLength: 3,
    });
  });

  it('returns a side over the limit as too-large with its length', () => {
    const bytes = Buffer.alloc(GIT_DIFF_MAX_SIDE_BYTES + 1, 0x61);
    expect(classifyBlobBytes(bytes)).toEqual({
      outcome: 'too-large',
      byteLength: GIT_DIFF_MAX_SIDE_BYTES + 1,
    });
  });

  it('keeps a side exactly at the limit', () => {
    const bytes = Buffer.alloc(GIT_DIFF_MAX_SIDE_BYTES, 0x61);
    expect(classifyBlobBytes(bytes).outcome).toBe('content');
  });

  it('labels a Git LFS pointer with its oid and size', () => {
    const bytes = pointer(
      `version https://git-lfs.github.com/spec/v1\noid ${OID}\nsize 12345\n`,
    );
    expect(classifyBlobBytes(bytes)).toEqual({
      outcome: 'lfs-pointer',
      oid: OID,
      size: 12345,
    });
  });

  it('labels a pointer written with CRLF line endings', () => {
    const bytes = pointer(
      `version https://git-lfs.github.com/spec/v1\r\noid ${OID}\r\nsize 7\r\n`,
    );
    expect(classifyBlobBytes(bytes)).toEqual({
      outcome: 'lfs-pointer',
      oid: OID,
      size: 7,
    });
  });

  it.each([
    ['without an oid', 'size 10\n'],
    ['without a size', `oid ${OID}\n`],
    ['with a non-numeric size', `oid ${OID}\nsize ten\n`],
  ])('treats a pointer-like file %s as content', (_name, rest) => {
    const text = `version https://git-lfs.github.com/spec/v1\n${rest}`;
    expect(classifyBlobBytes(pointer(text))).toEqual({
      outcome: 'content',
      content: text,
    });
  });

  it('treats a file over 1 KiB that starts like a pointer as content', () => {
    const text =
      `version https://git-lfs.github.com/spec/v1\noid ${OID}\nsize 1\n` +
      'x'.repeat(1024);
    expect(classifyBlobBytes(pointer(text)).outcome).toBe('content');
  });
});
