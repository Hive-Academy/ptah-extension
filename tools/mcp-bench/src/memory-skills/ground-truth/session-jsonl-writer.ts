/** Pure deterministic construction of SDK-shaped session JSONL and transcripts. */

export const RECORD_SEPARATOR = '\n\n';
export const SESSION_CWD = 'D:/bench/ptah-extension';

export interface SessionJsonlTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly turnIndex: number;
  readonly window: number;
  readonly factIds: readonly string[];
  readonly baitIds: readonly string[];
}

export interface SessionJsonlOutput<TBaitClass extends string> {
  readonly sessionId: string;
  readonly kind: 'standard' | 'long';
  readonly datedAt: string;
  readonly jsonl: string;
  readonly transcript: string;
  readonly turns: readonly SessionJsonlTurn[];
  readonly baits: readonly {
    id: string;
    baitClass: TBaitClass;
    turnIndex: number;
  }[];
  readonly windowPlan: {
    readonly plannedWindows: number;
    readonly exceedsWindowLimit: boolean;
    readonly factWindows: readonly { factId: string; window: number }[];
  };
}

/** Keeps raw JSONL and its flattened transcript synchronized. */
export class SessionJsonlWriter<TBaitClass extends string> {
  private readonly turns: SessionJsonlTurn[] = [];
  private readonly jsonlLines: string[] = [];
  private readonly records: string[] = [];
  private readonly baits: {
    id: string;
    baitClass: TBaitClass;
    turnIndex: number;
  }[] = [];
  private readonly startMs: number;
  private chars = 0;

  constructor(
    private readonly sessionId: string,
    startAt: string,
    private readonly minutesPerTurn: number,
    private readonly windowChars: number,
    private readonly windowLimit: number,
  ) {
    const parsed = Date.parse(startAt);
    if (Number.isNaN(parsed))
      throw new Error(
        `the injected clock returned an invalid instant: ${startAt}`,
      );
    this.startMs = parsed;
  }

  get currentWindow(): number {
    return Math.floor(this.chars / this.windowChars) + 1;
  }

  turn(
    role: 'user' | 'assistant',
    text: string,
    factIds: readonly string[] = [],
    baits: readonly { id: string; baitClass: TBaitClass }[] = [],
  ): void {
    const turnIndex = this.turns.length;
    const window = this.currentWindow;
    const timestamp = new Date(
      this.startMs + turnIndex * this.minutesPerTurn * 60_000,
    ).toISOString();
    this.jsonlLines.push(
      JSON.stringify({
        type: role,
        uuid: uuidOf(seededRandom(`${this.sessionId}:${turnIndex}`)),
        sessionId: this.sessionId,
        timestamp,
        cwd: SESSION_CWD,
        message: { role, content: [{ type: 'text', text }] },
      }),
    );
    const record = `${role.toUpperCase()}: ${text}`;
    this.records.push(record);
    this.chars +=
      this.records.length === 1
        ? record.length
        : RECORD_SEPARATOR.length + record.length;
    this.turns.push({
      role,
      text,
      turnIndex,
      window,
      factIds,
      baitIds: baits.map((bait) => bait.id),
    });
    for (const bait of baits)
      if (!this.baits.some((recorded) => recorded.id === bait.id))
        this.baits.push({ id: bait.id, baitClass: bait.baitClass, turnIndex });
  }

  build(
    kind: 'standard' | 'long',
    factWindows: readonly { factId: string; window: number }[],
  ): SessionJsonlOutput<TBaitClass> {
    const transcript = this.records.join(RECORD_SEPARATOR);
    const plannedWindows = Math.max(
      1,
      Math.ceil(transcript.length / this.windowChars),
    );
    return {
      sessionId: this.sessionId,
      kind,
      datedAt: new Date(this.startMs).toISOString(),
      jsonl: `${this.jsonlLines.join('\n')}\n`,
      transcript,
      turns: this.turns,
      baits: this.baits,
      windowPlan: {
        plannedWindows,
        exceedsWindowLimit: plannedWindows > this.windowLimit,
        factWindows,
      },
    };
  }
}

function uuidOf(random: () => number): string {
  let hex = '';
  while (hex.length < 32) hex += Math.floor(random() * 16).toString(16);
  const variant = '89ab'[Math.floor(random() * 4)];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
