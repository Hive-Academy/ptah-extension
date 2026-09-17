import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ElectronStateLegacyFormatError,
  readLegacySpan,
  scanLegacyObject,
  type LegacyScanResult,
} from './electron-state-storage-legacy-scanner';

type ScanEvent =
  | readonly ['entry', string, number, number, number | null]
  | readonly ['element', string, number, number, number];

interface Scanned {
  readonly events: ScanEvent[];
  readonly result: LegacyScanResult;
}

type ReadSizer = (requested: number, position: number) => number;

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memoryHandle(bytes: Buffer, sizer: ReadSizer): fs.FileHandle {
  const handle = {
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const available = Math.max(0, bytes.length - position);
      const count = Math.min(available, sizer(length, position), length);
      bytes.copy(buffer, offset, position, position + count);
      return { bytesRead: count, buffer };
    },
  };
  return handle as unknown as fs.FileHandle;
}

async function scanBytes(
  bytes: Buffer,
  splitKeys: readonly string[],
  sizer: ReadSizer = (requested) => requested,
  chunkBytes?: number,
): Promise<Scanned> {
  const events: ScanEvent[] = [];
  const result = await scanLegacyObject(
    memoryHandle(bytes, sizer),
    { splitKeys: new Set(splitKeys), chunkBytes },
    {
      onEntry: (key, start, end, elementCount) => {
        events.push(['entry', key, start, end, elementCount]);
      },
      onElement: (key, index, start, end) => {
        events.push(['element', key, index, start, end]);
      },
    },
  );
  return { events, result };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const GRAMMAR_VALUE = {
  plain: 'value',
  '0': 'integer-like key',
  '17': [1, 2, 3],
  'quote " and \\ backslash': 'text with "quotes" and \\ slashes \\"',
  'astral 😀 界': 'multi-byte 😀😀 é 界 \u0000 \u2028',
  records: [
    { id: 'a', nested: { deep: [1, { x: '}]"' }] } },
    'string element',
    42,
    -1.5e-3,
    true,
    null,
    [],
    {},
    [[['deep']]],
  ],
  notSplit: { schemaVersion: 1, items: [] },
  empty: [],
  bool: false,
  nothing: null,
  number: 123.456,
};

function expectSpansMatch(
  bytes: Buffer,
  scanned: Scanned,
  source: Record<string, unknown>,
): void {
  const decode = (start: number, end: number): unknown =>
    JSON.parse(bytes.subarray(start, end).toString('utf8'));
  for (const event of scanned.events) {
    if (event[0] === 'entry') {
      expect(decode(event[2], event[3])).toEqual(source[event[1]]);
    } else {
      const array = source[event[1]] as unknown[];
      expect(decode(event[3], event[4])).toEqual(array[event[2]]);
    }
  }
  expect(
    scanned.events.filter((event) => event[0] === 'entry').map((e) => e[1]),
  ).toEqual(Object.keys(JSON.parse(bytes.toString('utf8'))));
  expect(scanned.result).toEqual({ sha256: sha256(bytes), size: bytes.length });
}

describe('scanLegacyObject grammar', () => {
  it.each([
    ['pretty', JSON.stringify(GRAMMAR_VALUE, null, 2)],
    ['compact', JSON.stringify(GRAMMAR_VALUE)],
    [
      'whitespace-heavy',
      JSON.stringify(GRAMMAR_VALUE, null, '\t').replace(/\n/g, '\r\n \t'),
    ],
  ])('reports exact value spans for a %s file', async (_label, text) => {
    const bytes = Buffer.from(` \n${text}\r\n\t `, 'utf8');
    const scanned = await scanBytes(bytes, ['records', 'notSplit', 'empty']);

    expectSpansMatch(bytes, scanned, GRAMMAR_VALUE);
    const elements = scanned.events.filter((event) => event[0] === 'element');
    expect(elements).toHaveLength(GRAMMAR_VALUE.records.length);
    expect(
      scanned.events.find(
        (event) => event[0] === 'entry' && event[1] === 'records',
      )?.[4],
    ).toBe(GRAMMAR_VALUE.records.length);
    expect(
      scanned.events.find(
        (event) => event[0] === 'entry' && event[1] === 'empty',
      )?.[4],
    ).toBe(0);
    expect(
      scanned.events.find(
        (event) => event[0] === 'entry' && event[1] === 'notSplit',
      )?.[4],
    ).toBeNull();
  });

  it('emits every element of a split array before the array entry', async () => {
    const bytes = Buffer.from('{"a":1,"list":[1,"x",{"y":2}],"b":2}', 'utf8');
    const { events } = await scanBytes(bytes, ['list']);

    expect(events.map((event) => [event[0], event[1]])).toEqual([
      ['entry', 'a'],
      ['element', 'list'],
      ['element', 'list'],
      ['element', 'list'],
      ['entry', 'list'],
      ['entry', 'b'],
    ]);
  });

  it('accepts an empty object', async () => {
    const bytes = Buffer.from(' { } ', 'utf8');
    expect((await scanBytes(bytes, [])).events).toEqual([]);
  });

  it('reads spans positionally from a real file handle', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-legacy-scan-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'state.json');
    const text = JSON.stringify(GRAMMAR_VALUE, null, 2);
    await fs.writeFile(filePath, text, 'utf8');
    const handle = await fs.open(filePath, 'r');
    try {
      const entries: [string, number, number][] = [];
      const result = await scanLegacyObject(
        handle,
        { splitKeys: new Set(['records']), chunkBytes: 5 },
        {
          onEntry: (key, start, end) => {
            entries.push([key, start, end]);
          },
          onElement: () => undefined,
        },
      );
      expect(result.size).toBe(Buffer.byteLength(text));
      for (const [key, start, end] of entries) {
        const span = await readLegacySpan(handle, start, end);
        expect(JSON.parse(span.toString('utf8'))).toEqual(
          (GRAMMAR_VALUE as Record<string, unknown>)[key],
        );
      }
      await expect(
        readLegacySpan(handle, result.size - 1, result.size + 4),
      ).rejects.toBeInstanceOf(ElectronStateLegacyFormatError);
    } finally {
      await handle.close();
    }
  });
});

describe('scanLegacyObject chunk boundaries', () => {
  const text = JSON.stringify(GRAMMAR_VALUE, null, 2);
  const bytes = Buffer.from(text, 'utf8');
  const splitKeys = ['records', 'notSplit'];

  it('has split points inside 4-byte UTF-8, inside escapes and on quotes', () => {
    const astral = bytes.indexOf(Buffer.from('😀', 'utf8'));
    const escapedQuote = bytes.indexOf(Buffer.from('\\"', 'utf8'));
    const escapedSlash = bytes.indexOf(Buffer.from('\\\\', 'utf8'));
    expect(Buffer.from('😀', 'utf8')).toHaveLength(4);
    expect([astral, escapedQuote, escapedSlash].every((at) => at > 0)).toBe(
      true,
    );
  });

  it('gives identical events and hash for every two-chunk split point', async () => {
    const baseline = await scanBytes(bytes, splitKeys);
    for (let split = 1; split < bytes.length; split++) {
      const scanned = await scanBytes(
        bytes,
        splitKeys,
        (requested, position) =>
          position < split ? Math.min(requested, split - position) : requested,
      );
      expect(scanned).toEqual(baseline);
    }
  });

  it.each([1, 2, 3, 7, 64, 4096])(
    'gives identical events and hash with %i-byte chunks',
    async (chunkBytes) => {
      const baseline = await scanBytes(bytes, splitKeys);
      expect(
        await scanBytes(bytes, splitKeys, (requested) => requested, chunkBytes),
      ).toEqual(baseline);
    },
  );

  it('gives identical events and hash for 200 seeded random chunkings', async () => {
    const baseline = await scanBytes(bytes, splitKeys);
    const random = seeded(430);
    for (let run = 0; run < 200; run++) {
      const maxChunk = 1 + Math.floor(random() * 97);
      const scanned = await scanBytes(
        bytes,
        splitKeys,
        (requested) =>
          Math.max(1, Math.min(requested, Math.ceil(random() * maxChunk))),
        128,
      );
      expect(scanned).toEqual(baseline);
    }
  });
});

describe('scanLegacyObject malformed input', () => {
  const small = Buffer.from(
    '{"a": [1, {"b": "x\\"y"}], "c": "😀", "d": null}\n',
    'utf8',
  );

  it('rejects truncation at every byte', async () => {
    const lastBrace = small.lastIndexOf(0x7d);
    for (let length = 0; length <= lastBrace; length++) {
      await expect(
        scanBytes(small.subarray(0, length), ['a']),
      ).rejects.toBeInstanceOf(ElectronStateLegacyFormatError);
    }
    await expect(scanBytes(small, ['a'])).resolves.toBeDefined();
  });

  it.each([
    ['an empty file', ''],
    ['whitespace only', ' \n\t'],
    ['a byte order mark', '\uFEFF{"a":1}'],
    ['an array top level', '[1,2]'],
    ['a string top level', '"text"'],
    ['a number top level', '42'],
    ['trailing garbage', '{"a":1} x'],
    ['a second object', '{"a":1}{"b":2}'],
    ['an unterminated string', '{"a":"never closed}'],
    ['an unterminated key', '{"never closed'],
    ['a missing colon', '{"a" 1}'],
    ['a missing comma', '{"a":1 "b":2}'],
    ['a trailing comma', '{"a":1,}'],
    ['a trailing element comma', '{"a":[1,]}'],
    ['a missing value', '{"a":}'],
    ['a mismatched bracket', '{"a":[1}'],
    ['an extra closer', '{"a":{}}]'],
    ['a bare key', '{a:1}'],
    ['a quote inside a scalar', '{"a":tr"ue}'],
    ['a duplicate key', '{"a":1,"b":2,"a":3}'],
    ['a duplicate key spelled with an escape', '{"a":1,"\\u0061":2}'],
    ['an invalid key escape', '{"\\x":1}'],
  ])('rejects %s', async (_label, text) => {
    await expect(
      scanBytes(Buffer.from(text, 'utf8'), ['a']),
    ).rejects.toBeInstanceOf(ElectronStateLegacyFormatError);
  });

  it('leaves invalid scalars inside a span to the span parser', async () => {
    const bytes = Buffer.from('{"a": 01, "b": tru, "c": [1e999]}', 'utf8');
    const { events } = await scanBytes(bytes, []);

    expect(
      events.map((event) =>
        bytes.subarray(event[2], event[3] as number).toString('utf8'),
      ),
    ).toEqual(['01', 'tru', '[1e999]']);
  });
});
