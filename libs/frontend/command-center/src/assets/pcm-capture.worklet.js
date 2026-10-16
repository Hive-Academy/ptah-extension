class PcmRing extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(Math.ceil(sampleRate * 0.35));
    this.index = 0;
    this.filled = 0;
    this.recording = false;
    this.utteranceId = 0;
    this.port.onmessage = ({ data }) => {
      if (data.kind === 'start') {
        this.recording = true;
        this.utteranceId = data.id;
        const prior = new Float32Array(this.filled);
        for (let i = 0; i < this.filled; i++)
          prior[i] =
            this.ring[
              (this.index - this.filled + i + this.ring.length) %
                this.ring.length
            ];
        this.port.postMessage(
          { kind: 'samples', id: data.id, samples: prior },
          [prior.buffer],
        );
      } else if (data.kind === 'end' && data.id === this.utteranceId) {
        this.recording = false;
        this.port.postMessage({ kind: 'end', id: data.id });
      }
    };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    const frame = new Float32Array(samples);
    for (const value of samples) {
      this.ring[this.index] = value;
      this.index = (this.index + 1) % this.ring.length;
      this.filled = Math.min(this.filled + 1, this.ring.length);
    }
    this.port.postMessage({ kind: 'frame', samples: frame }, [frame.buffer]);
    if (this.recording) {
      const copy = new Float32Array(samples);
      this.port.postMessage(
        { kind: 'samples', id: this.utteranceId, samples: copy },
        [copy.buffer],
      );
    }
    return true;
  }
}
registerProcessor('ptah-pcm-ring', PcmRing);
