/**
 * Fixed-option select rows of the ElevenLabs panel (pattern map V24/V25). The voice row is not
 * here because its options are loaded from the account.
 */

interface LabeledOption {
  readonly value: string;
  readonly label: string;
}

/** `VoiceProviderConfigElevenLabsDto` field each row writes through `voice:setProviderConfig`. */
export type ElevenLabsSelectKey = 'ttsModelId' | 'outputFormat' | 'sttModelId';

export interface ElevenLabsSelectRow {
  readonly key: ElevenLabsSelectKey;
  /** Element id is `elevenlabs-<slug>`, testid `elevenlabs-<slug>-select`. */
  readonly slug: string;
  readonly label: string;
  /** Also the toast label, as `ElevenLabs <ariaLabel lower-cased>`. */
  readonly ariaLabel: string;
  readonly options: readonly LabeledOption[];
}

const TTS_MODELS: readonly LabeledOption[] = [
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (default)' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (low latency)' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' },
  { value: 'eleven_monolingual_v1', label: 'Monolingual v1 (English)' },
];

const OUTPUT_FORMATS: readonly LabeledOption[] = [
  { value: 'mp3_44100_128', label: 'MP3 44.1 kHz / 128 kbps (default)' },
  { value: 'mp3_44100_64', label: 'MP3 44.1 kHz / 64 kbps' },
  { value: 'mp3_22050_32', label: 'MP3 22 kHz / 32 kbps' },
  { value: 'opus_48000_128', label: 'Opus 48 kHz / 128 kbps' },
  { value: 'pcm_16000', label: 'PCM 16 kHz' },
  { value: 'pcm_24000', label: 'PCM 24 kHz' },
];

const STT_MODELS: readonly LabeledOption[] = [
  { value: 'scribe_v1', label: 'Scribe v1' },
];

export const ELEVENLABS_TTS_ROWS: readonly ElevenLabsSelectRow[] = [
  {
    key: 'ttsModelId',
    slug: 'tts-model',
    label: 'Model',
    ariaLabel: 'Text-to-speech model',
    options: TTS_MODELS,
  },
  {
    key: 'outputFormat',
    slug: 'output-format',
    label: 'Output format',
    ariaLabel: 'Output format',
    options: OUTPUT_FORMATS,
  },
];

export const ELEVENLABS_STT_ROWS: readonly ElevenLabsSelectRow[] = [
  {
    key: 'sttModelId',
    slug: 'stt-model',
    label: 'Transcription model',
    ariaLabel: 'Transcription model',
    options: STT_MODELS,
  },
];
