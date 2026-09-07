"""Transcribe one raw clip with WhisperX, word-level timestamps, cached forever.

Usage (run with the WhisperX venv python):
    python transcribe.py <job-dir> [--audio <path>] [--force]

Reads  projects/<job>/raw/<clip>, or --audio when the cut already exists and
       the timing must match a rebuilt timeline instead of a raw file
Writes projects/<job>/transcript/words.json

Device: CUDA float16 when a GPU is usable, else CPU int8. A CUDA failure at
load or mid-run falls back to CPU and keeps going.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONUTF8", "1")
# Windows refuses symlink creation without Developer Mode or admin rights, and
# huggingface_hub uses symlinks in its cache. The failure surfaces at model load
# as OSError(22, 'A required privilege is not held by the client'), which the
# device loop then charges to CUDA and falls back to CPU for. Disable symlinks
# and the CUDA path works.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

MODEL = "large-v3"
VIDEO_EXT = {".mov", ".mp4", ".mkv", ".m4v", ".avi", ".mxf", ".wav", ".m4a", ".mp3"}


def find_raw(job: Path) -> Path:
    raw = job / "raw"
    clips = sorted(p for p in raw.iterdir() if p.suffix.lower() in VIDEO_EXT)
    if len(clips) != 1:
        sys.exit(f"expected exactly one clip in {raw}, found {len(clips)}")
    return clips[0]


DEVICE_FAULT_MARKERS = (
    "cuda", "cudnn", "cublas", "out of memory", "no kernel image", "gpu"
)


def is_device_fault(error: Exception) -> bool:
    """Would running on CPU plausibly fix this? Only then is a fallback useful."""
    text = f"{type(error).__name__} {error}".lower()
    return any(marker in text for marker in DEVICE_FAULT_MARKERS)


def run(audio_path: str, device: str, compute_type: str, language: str | None = None) -> dict:
    import whisperx  # noqa: WPS433 (import inside function is deliberate: slow)

    batch_size = 16 if device == "cuda" else 4
    model = whisperx.load_model(
        MODEL, device, compute_type=compute_type, language=language
    )
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=batch_size, language=language)
    language = result["language"]
    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    aligned = whisperx.align(
        result["segments"], align_model, metadata, audio, device, return_char_alignments=False
    )
    return {
        "model": MODEL,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "segments": aligned["segments"],
        "word_segments": aligned.get("word_segments", []),
    }


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    job = Path(sys.argv[1]).resolve()
    force = "--force" in sys.argv
    out = job / "transcript" / "words.json"
    if out.exists() and not force:
        print(f"cached: {out}")
        return

    if "--audio" in sys.argv:
        clip = Path(sys.argv[sys.argv.index("--audio") + 1]).resolve()
    else:
        clip = find_raw(job)
    out.parent.mkdir(parents=True, exist_ok=True)

    language = None
    if "--language" in sys.argv:
        language = sys.argv[sys.argv.index("--language") + 1]

    import torch

    attempts = [("cuda", "float16")] if torch.cuda.is_available() else []
    attempts.append(("cpu", "int8"))

    last_error: Exception | None = None
    for device, compute_type in attempts:
        try:
            print(f"transcribing {clip.name} on {device}/{compute_type} with {MODEL}")
            data = run(str(clip), device, compute_type, language)
            break
        except Exception as error:  # noqa: BLE001 - fall back to the next device
            last_error = error
            print(f"{device} failed: {error!r}")
            if device == "cuda":
                torch.cuda.empty_cache()
                # Only a device fault earns a CPU retry. A missing NLTK corpus
                # or a bad model id fails identically on CPU, and retrying
                # spends another CPU-speed pass to learn nothing. Twice this
                # discarded a finished GPU transcription (TASK notes 2026-09-06).
                if not is_device_fault(error):
                    raise SystemExit(f"not a device fault, not retrying: {error!r}")
    else:
        raise SystemExit(f"transcription failed on every device: {last_error!r}")

    data["source"] = clip.name
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    words = sum(len(s.get("words", [])) for s in data["segments"])
    print(f"wrote {out} ({len(data['segments'])} segments, {words} words)")


if __name__ == "__main__":
    main()
