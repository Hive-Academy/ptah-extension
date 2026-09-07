"""Build a reference WAV that matches the rebuilt 60 fps timeline exactly.

Cuts each source range out of the raw file with ffmpeg and concatenates them in
timeline order. The result carries timeline-relative timing, so every word time
WhisperX reports maps straight onto a timeline frame:

    frame = round(seconds * 60)

This never touches Resolve and never modifies a raw file.

Usage:
    python scripts/build_reference_audio.py projects/builder-invitation
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path

SAMPLE_RATE = 16000  # what WhisperX wants


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path)
    parser.add_argument("--target-fps", type=int, default=60)
    args = parser.parse_args()

    edl = json.loads(
        (args.job / "edit" / "timeline1-items.json").read_text(encoding="utf-8")
    )
    ratio = Fraction(args.target_fps, edl["timeline"]["fps"])
    source_fps = Fraction(edl["source_fps"])

    out_dir = args.job / "transcript"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "reference.wav"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        segments = []
        for item in edl["items"]:
            duration = round(item["timeline_duration"] * ratio)
            start_s = Fraction(item["source_start"]) / source_fps
            duration_s = Fraction(duration) / source_fps
            seg_path = tmp_dir / f"{item['n']:03d}.wav"
            subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-y",
                    "-ss", f"{float(start_s):.6f}",
                    "-t", f"{float(duration_s):.6f}",
                    "-i", edl["sources"][item["source"]],
                    "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
                    "-c:a", "pcm_s16le",
                    str(seg_path),
                ],
                check=True,
            )
            segments.append(seg_path)

        list_path = tmp_dir / "concat.txt"
        list_path.write_text(
            "".join(f"file '{p.as_posix()}'\n" for p in segments), encoding="utf-8"
        )
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(list_path),
                "-c", "copy", str(out_path),
            ],
            check=True,
        )

    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(out_path),
        ],
        check=True, capture_output=True, text=True,
    )
    seconds = float(probe.stdout.strip())
    expected = sum(
        round(item["timeline_duration"] * ratio) for item in edl["items"]
    ) / args.target_fps
    print(f"{out_path} -> {seconds:.2f}s (timeline {expected:.2f}s)")
    if abs(seconds - expected) > 0.5:
        print("length mismatch beyond half a second", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
