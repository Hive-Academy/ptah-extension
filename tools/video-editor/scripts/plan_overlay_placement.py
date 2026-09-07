"""Plan where every rendered overlay goes, and on which video track.

Resolve's AppendToTimeline does NOT refuse an overlapping clip. It butts the
new one against the existing clip and silently trims its head, reporting
success. G08 lost a full second — its entire fade-in — that way.

The trap is that a graphic's FILE is longer than its CONTENT: the beat plan
records when the argument ends, but the render runs on through its fade-out.
So spans must be computed from the real frame count, never from the planned
out-point.

This reads the actual nb_frames from each rendered MOV, computes real spans,
and assigns alternating video tracks wherever two spans touch.

Usage:
    python scripts/plan_overlay_placement.py projects/builder-invitation
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

FPS = 60

# Beat id -> (folder, in-point in timeline seconds). The in-point is where the
# graphic must START; its length comes from the file.
BEATS: list[tuple[str, str, float]] = [
    ("G01", "g01-title", 0.0),
    ("G02", "g02-two-paths", 10.5),
    ("G03", "g03-what-you-lose", 29.2),
    ("G04", "g04-lifecycle-chain", 45.2),
    ("G05", "g05-two-weeks", 133.0),
    ("G06", "g06-faster-not-aware", 176.5),
    ("G07", "g07-degradation-curve", 226.0),
    ("G08", "g08-free-open-source", 253.0),
    ("G09", "g09-25-days-free", 278.8),
    ("G10", "g10-saas-chips", 293.0),
    ("G11", "g11-stack-welcome", 334.1),
    ("G12", "g12-signed-publisher", 370.2),
    ("G13", "g13-providers", 460.2),
    ("G14", "g14-workspace-analysis", 525.3),
    ("G15a", "g15a-memory-system", 568.5),
    ("G15b", "g15b-monorepo", 591.0),
    ("G16", "g16-canvas", 644.4),
    ("G17", "g17-failover", 716.9),
    ("G18", "g18-cut-the-hype", 764.4),
    ("G19", "g19-always-debt", 788.0),
]


def frame_count(path: Path) -> int | None:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=nb_frames", "-of", "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True, text=True,
    )
    value = probe.stdout.strip()
    return int(value) if value.isdigit() else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path)
    args = parser.parse_args()

    graphics = args.job / "graphics"
    placements = []
    missing = []

    for beat_id, folder, in_s in BEATS:
        renders = sorted((graphics / folder / "renders").glob("*.mov"))
        if not renders:
            missing.append(beat_id)
            continue
        path = renders[0]
        frames = frame_count(path)
        if frames is None:
            missing.append(f"{beat_id} (unreadable)")
            continue
        start = round(in_s * FPS)
        placements.append(
            {
                "beat": beat_id,
                "file": str(path),
                "record_frame": start,
                "frames": frames,
                "end_frame": start + frames,
                "in_s": in_s,
                "out_s": round((start + frames) / FPS, 2),
            }
        )

    placements.sort(key=lambda p: p["record_frame"])

    # Alternate tracks wherever a span touches the previous one on that track.
    track_free_at: dict[int, int] = {}
    for placement in placements:
        for track in (2, 3, 4):
            if track_free_at.get(track, -1) <= placement["record_frame"]:
                placement["track"] = track
                track_free_at[track] = placement["end_frame"]
                break
        else:
            placement["track"] = None

    overlaps = [
        (a["beat"], b["beat"], a["end_frame"] - b["record_frame"])
        for a, b in zip(placements, placements[1:])
        if b["record_frame"] < a["end_frame"]
    ]

    out = args.job / "graphics" / "placement.json"
    out.write_text(
        json.dumps({"fps": FPS, "placements": placements}, indent=2), encoding="utf-8"
    )

    print(f"{len(placements)} rendered overlays -> {out}")
    if missing:
        print(f"not yet rendered: {', '.join(missing)}")
    print(f"tracks used: {sorted({p['track'] for p in placements})}")
    if overlaps:
        print("spans that touch (handled by alternating tracks):")
        for first, second, frames in overlaps:
            print(f"  {first} overruns {second} by {frames} frames ({frames / FPS:.2f}s)")
    else:
        print("no touching spans")
    unplaced = [p["beat"] for p in placements if p["track"] is None]
    if unplaced:
        print(f"NO FREE TRACK for: {', '.join(unplaced)} — add a video track")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
