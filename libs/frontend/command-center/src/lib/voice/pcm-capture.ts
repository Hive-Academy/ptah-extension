export type CaptureFailureReason = 'denied' | 'unavailable' | 'worklet';

export class CaptureError extends Error {
  public constructor(public readonly reason: CaptureFailureReason) {
    super(reason);
  }
}

export interface PcmClip {
  readonly audioBase64: string;
  readonly mimeType: 'audio/wav';
}

export interface CaptureFactories {
  readonly getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  readonly audioContext: () => AudioContext;
}

const WORKLET = `class PcmRing extends AudioWorkletProcessor {
  constructor() {
    super(); this.ring = new Float32Array(Math.ceil(sampleRate * 0.35));
    this.index = 0; this.filled = 0; this.recording = false; this.utteranceId = 0;
    this.port.onmessage = ({data}) => {
      if (data.kind === 'start') {
        this.recording = true; this.utteranceId = data.id;
        const prior = new Float32Array(this.filled);
        for (let i = 0; i < this.filled; i++) prior[i] = this.ring[(this.index - this.filled + i + this.ring.length) % this.ring.length];
        this.port.postMessage({kind:'samples', id:data.id, samples:prior}, [prior.buffer]);
      } else if (data.kind === 'end' && data.id === this.utteranceId) {
        this.recording = false; this.port.postMessage({kind:'end', id:data.id});
      }
    };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    const frame = new Float32Array(samples);
    for (const value of samples) { this.ring[this.index] = value; this.index = (this.index + 1) % this.ring.length; this.filled = Math.min(this.filled + 1, this.ring.length); }
    this.port.postMessage({kind:'frame', samples:frame}, [frame.buffer]);
    if (this.recording) {
      const copy = new Float32Array(samples);
      this.port.postMessage({kind:'samples', id:this.utteranceId, samples:copy}, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('ptah-pcm-ring', PcmRing);`;

const MAX_WAV_BYTES = 18_000_000;

/** One microphone and one worklet for the active voice session. */
export class PcmCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private moduleUrl: string | null = null;
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private utteranceId = 0;
  private readonly discardedIds = new Set<number>();

  public constructor(
    private readonly onFrame: (samples: Float32Array, timeMs: number) => void,
    private readonly onClip: (clip: PcmClip | null) => void,
    private readonly factories: CaptureFactories = {
      getUserMedia: (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      audioContext: () => new AudioContext(),
    },
  ) {}

  public async start(): Promise<void> {
    if (this.stream) return;
    try {
      this.stream = await this.factories.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error: unknown) {
      throw new CaptureError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'denied'
          : 'unavailable',
      );
    }
    try {
      this.context = this.factories.audioContext();
      this.moduleUrl = URL.createObjectURL(
        new Blob([WORKLET], { type: 'text/javascript' }),
      );
      await this.context.audioWorklet.addModule(this.moduleUrl);
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'ptah-pcm-ring');
      this.node.port.onmessage = (
        event: MessageEvent<{
          kind: string;
          id?: number;
          samples?: Float32Array;
        }>,
      ) => {
        const { kind, id, samples } = event.data;
        if (kind === 'frame' && samples)
          this.onFrame(samples, performance.now());
        else if (
          kind === 'samples' &&
          samples &&
          id === this.utteranceId &&
          !this.discardedIds.has(id)
        ) {
          this.sampleCount += samples.length;
          if (this.sampleCount * 2 + 44 <= MAX_WAV_BYTES)
            this.chunks.push(samples);
          else {
            this.chunks = [];
            this.sampleCount = MAX_WAV_BYTES;
          }
        } else if (kind === 'end' && id !== undefined) {
          if (this.discardedIds.delete(id)) this.onClip(null);
          else if (id === this.utteranceId) this.finishClip();
        }
      };
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
    } catch {
      await this.stop();
      throw new CaptureError('worklet');
    }
  }

  public beginUtterance(): void {
    this.utteranceId++;
    this.chunks = [];
    this.sampleCount = 0;
    this.node?.port.postMessage({ kind: 'start', id: this.utteranceId });
  }

  public endUtterance(): void {
    this.node?.port.postMessage({ kind: 'end', id: this.utteranceId });
  }

  public discardUtterance(): void {
    const discardedId = this.utteranceId;
    this.discardedIds.add(discardedId);
    this.utteranceId++;
    this.chunks = [];
    this.sampleCount = 0;
    this.node?.port.postMessage({ kind: 'end', id: discardedId });
  }

  private finishClip(): void {
    if (
      this.sampleCount <= 0 ||
      this.sampleCount * 2 + 44 > MAX_WAV_BYTES ||
      !this.context
    ) {
      this.onClip(null);
    } else {
      const bytes = new Uint8Array(44 + this.sampleCount * 2);
      const view = new DataView(bytes.buffer);
      const label = (at: number, text: string): void => {
        for (let i = 0; i < text.length; i++)
          view.setUint8(at + i, text.charCodeAt(i));
      };
      label(0, 'RIFF');
      view.setUint32(4, bytes.length - 8, true);
      label(8, 'WAVE');
      label(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, this.context.sampleRate, true);
      view.setUint32(28, this.context.sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      label(36, 'data');
      view.setUint32(40, bytes.length - 44, true);
      let offset = 44;
      for (const chunk of this.chunks)
        for (const sample of chunk) {
          const clipped = Math.max(-1, Math.min(1, sample));
          view.setInt16(
            offset,
            clipped < 0 ? clipped * 32768 : clipped * 32767,
            true,
          );
          offset += 2;
        }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      this.onClip({ audioBase64: btoa(binary), mimeType: 'audio/wav' });
    }
    this.chunks = [];
    this.sampleCount = 0;
  }

  public async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
    if (this.context) await this.context.close();
    this.context = null;
    if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    this.moduleUrl = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.discardedIds.clear();
  }
}
