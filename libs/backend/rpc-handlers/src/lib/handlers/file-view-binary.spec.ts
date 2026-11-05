import {
  FILE_VIEW_BINARY_IMAGE_MAX_BYTES,
  FILE_VIEW_BINARY_PDF_MAX_BYTES,
} from '@ptah-extension/shared';

import {
  binaryPayloadWithinCap,
  sniffFileViewBinary,
} from './file-view-binary';

describe('sniffFileViewBinary', () => {
  it.each([
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['gif87a', Buffer.from('GIF87a', 'ascii'), 'image/gif'],
    ['gif89a', Buffer.from('GIF89a', 'ascii'), 'image/gif'],
    [
      'webp',
      Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('WEBP', 'ascii'),
      ]),
      'image/webp',
    ],
    ['pdf', Buffer.from('%PDF-1.7', 'ascii'), 'application/pdf'],
  ] as const)('recognises %s', (_label, bytes, mime) => {
    expect(sniffFileViewBinary(bytes)).toBe(mime);
  });

  it('recognises a BMP only once the 14-byte header is present', () => {
    const short = Buffer.alloc(13);
    short[0] = 0x42;
    short[1] = 0x4d;
    expect(sniffFileViewBinary(short)).toBeNull();

    const header = Buffer.alloc(14);
    header[0] = 0x42;
    header[1] = 0x4d;
    expect(sniffFileViewBinary(header)).toBe('image/bmp');
  });

  it.each([
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')],
    ['xml svg', Buffer.from('<?xml version="1.0"?><svg></svg>', 'utf8')],
    ['riff wave', Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
    ])],
    ['pdf not at offset 0', Buffer.concat([Buffer.from('note '), Buffer.from('%PDF-')])],
    ['empty', Buffer.alloc(0)],
  ])('rejects %s', (_label, bytes) => {
    expect(sniffFileViewBinary(bytes)).toBeNull();
  });

  it('caps images at 15 MiB and PDF at 25 MiB, inclusive', () => {
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES, 'image/png')).toBe(true);
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1, 'image/jpeg')).toBe(false);
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1, 'image/gif')).toBe(false);
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1, 'image/webp')).toBe(false);
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1, 'image/bmp')).toBe(false);
    expect(
      binaryPayloadWithinCap(FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1, 'application/pdf'),
    ).toBe(true);
    expect(binaryPayloadWithinCap(FILE_VIEW_BINARY_PDF_MAX_BYTES, 'application/pdf')).toBe(true);
    expect(
      binaryPayloadWithinCap(FILE_VIEW_BINARY_PDF_MAX_BYTES + 1, 'application/pdf'),
    ).toBe(false);
  });
});
