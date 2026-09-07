"""Conform a recovered 24 fps edit decision list to a 60 fps timeline.

Reads edit/timeline1-items.json (written from the Resolve MCP source_range_report)
and writes edit/clip_infos-60.json, ready for
media_pool(action="create_timeline_from_clips", params={"clip_infos": [...]}).

Source frames are already counted in the media's own 60 fps rate, so only the
DURATION needs conforming: 24 fps -> 60 fps is x2.5 exactly. record_frame is
cumulative and timeline-relative, per the clip_infos contract in CLAUDE.md.

Clip ids differ per project, so this script takes a path -> clip_id map at the
command line. Resolve the ids in the NEW project first.

Usage:
    python scripts/rebuild_clip_infos.py projects/builder-invitation \
        --clip-id 22-04-23=<uuid> --clip-id 22-14-20=<uuid> ...
"""

from __future__ import annotations

import argparse
import json
import sys
from fractions import Fraction
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path)
    parser.add_argument(
        "--clip-id",
        action="append",
        default=[],
        metavar="KEY=UUID",
        help="media pool clip id for a source key, repeatable",
    )
    parser.add_argument("--target-fps", type=int, default=60)
    args = parser.parse_args()

    edl_path = args.job / "edit" / "timeline1-items.json"
    edl = json.loads(edl_path.read_text(encoding="utf-8"))

    clip_ids = dict(pair.split("=", 1) for pair in args.clip_id)
    missing = sorted({item["source"] for item in edl["items"]} - clip_ids.keys())
    if missing:
        print(f"missing --clip-id for: {', '.join(missing)}", file=sys.stderr)
        return 1

    ratio = Fraction(args.target_fps, edl["timeline"]["fps"])
    clip_infos = []
    record_frame = 0
    for item in edl["items"]:
        duration = round(item["timeline_duration"] * ratio)
        start = item["source_start"]
        clip_infos.append(
            {
                "clip_id": clip_ids[item["source"]],
                "start_frame": start,
                "end_frame": start + duration,
                "record_frame": record_frame,
            }
        )
        record_frame += duration

    out_path = args.job / "edit" / f"clip_infos-{args.target_fps}.json"
    out_path.write_text(
        json.dumps({"fps": args.target_fps, "clip_infos": clip_infos}, indent=2),
        encoding="utf-8",
    )

    source_seconds = edl["timeline"]["end_frame"] - edl["timeline"]["start_frame"]
    source_seconds /= edl["timeline"]["fps"]
    print(f"{len(clip_infos)} clips -> {out_path}")
    print(
        f"length {record_frame} frames @ {args.target_fps} "
        f"= {record_frame / args.target_fps:.2f}s "
        f"(original {source_seconds:.2f}s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
