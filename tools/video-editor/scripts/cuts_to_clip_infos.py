"""Convert transcript/cuts.json into the clip_infos list for
media_pool(action="create_timeline_from_clips").

Usage:
    python cuts_to_clip_infos.py <job-dir> --clip-id <MediaPoolItem unique id> --fps <resolve FPS>

The fps MUST be the value Resolve reports through GetClipProperty('FPS') after
import, not the ffprobe value. iPhone VFR .MOV reads 29.97 in ffprobe and 30.00
in Resolve.

Frames are source frames at that fps. end_frame is exclusive.
record_frame is timeline-relative and cumulative.

Writes transcript/clip_infos.json and prints it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job")
    parser.add_argument("--clip-id", required=True)
    parser.add_argument("--fps", required=True, type=float)
    args = parser.parse_args()

    job = Path(args.job).resolve()
    cuts = json.loads((job / "transcript" / "cuts.json").read_text(encoding="utf-8"))
    segments = cuts["segments"] if isinstance(cuts, dict) else cuts

    clip_infos = []
    record = 0
    for index, seg in enumerate(segments):
        start = round(seg["start"] * args.fps)
        end = round(seg["end"] * args.fps)
        if end <= start:
            raise SystemExit(f"segment {index} has zero or negative length: {seg}")
        clip_infos.append(
            {
                "clip_id": args.clip_id,
                "start_frame": start,
                "end_frame": end,
                "record_frame": record,
                "track_index": 1,
            }
        )
        record += end - start

    out = job / "transcript" / "clip_infos.json"
    out.write_text(json.dumps(clip_infos, indent=2), encoding="utf-8")
    total_seconds = record / args.fps
    print(json.dumps(clip_infos))
    print(f"\n{len(clip_infos)} clips, {record} frames, {total_seconds:.2f}s at {args.fps} fps -> {out}")


if __name__ == "__main__":
    main()
