"""Build an Arabic SRT from the cleaned word-level transcript.

Reads  projects/<job>/transcript/words-clean.json
Writes projects/<job>/transcript/captions-ar.srt

Cue timings come straight from WhisperX word boundaries, so they match the
rebuilt 60 fps timeline exactly (the reference audio was cut from the same
source ranges). Upload the SRT to YouTube rather than burning it in: the viewer
can turn it off, and a wording fix costs nothing.

Typography: a restored Latin term joined directly to an Arabic prefix
("الproject") renders badly in a bidirectional line. Conventional Arabic
technical writing separates them with a tatweel ("الـproject"), so any
Arabic-run immediately followed by a Latin-run inside one token gets one.

Usage:
    python scripts/build_srt.py projects/builder-invitation
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# Cue shaping. Arabic sets wider than Latin at the same point size, so the line
# budget is lower than the usual 42 characters.
MAX_CHARS_PER_LINE = 38
MAX_LINES = 2
MAX_CUE_SECONDS = 6.0
MIN_CUE_SECONDS = 1.0
# A pause this long is a sentence boundary the speaker gave us for free.
GAP_BREAK_SECONDS = 0.45

ARABIC = r"؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿"
TATWEEL = "ـ"
_ARABIC_THEN_LATIN = re.compile(f"([{ARABIC}])(?=[A-Za-z])")


def add_tatweel(token: str) -> str:
    """Separate an Arabic prefix from a Latin term: الproject -> الـproject."""
    return _ARABIC_THEN_LATIN.sub(rf"\1{TATWEEL}", token)


def wrap(text: str) -> str:
    """Greedy wrap to at most MAX_LINES lines."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > MAX_CHARS_PER_LINE:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) <= MAX_LINES:
        return "\n".join(lines)
    # Too long to wrap cleanly: rebalance across MAX_LINES rather than drop text.
    per_line = -(-len(words) // MAX_LINES)
    return "\n".join(
        " ".join(words[i : i + per_line]) for i in range(0, len(words), per_line)
    )


def timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


_LATIN = re.compile(r"[A-Za-z]")


def _splits_latin_term(before: dict, after: dict) -> bool:
    """Would a break here cut a multi-word English term in half?

    "software application", "life cycle", "Domain Driven Design" are single
    terms to the reader. The speaker never pauses inside one, so a pause-based
    heuristic cannot see the boundary — this rule can.
    """
    return bool(
        _LATIN.search(before.get("word", "")) and _LATIN.search(after.get("word", ""))
    )


def _split_at_widest_pause(words: list[dict]) -> int:
    """Index to break before, chosen at the biggest pause the speaker left.

    Breaking purely on the character budget cuts terms in half — one cue ends
    on "software" and the next opens with "application". Backtracking to the
    widest gap keeps a term whole at the cost of a slightly shorter cue.
    """
    if len(words) < 4:
        return len(words)
    # Keep the break near the middle: a break at word 1 or at the last word
    # trades one bad cue for two.
    low, high = max(1, len(words) // 4), len(words) - 1
    candidates = [
        (words[i]["start"] - words[i - 1]["end"], i)
        for i in range(low, high + 1)
        if not _splits_latin_term(words[i - 1], words[i])
    ]
    if not candidates:
        # Every position would cut an English term. Take the widest pause anyway.
        candidates = [
            (words[i]["start"] - words[i - 1]["end"], i) for i in range(low, high + 1)
        ]
    widest_gap, index = max(candidates)
    return index if widest_gap > 0.08 else len(words)


def build_cues(segments: list[dict]) -> list[dict]:
    cues: list[dict] = []
    for segment in segments:
        words = [w for w in segment.get("words", []) if w.get("word", "").strip()]
        current: list[dict] = []
        for word in words:
            if current:
                gap = word["start"] - current[-1]["end"]
                span = word["end"] - current[0]["start"]
                text_len = len(" ".join(w["word"] for w in current + [word]))
                if gap >= GAP_BREAK_SECONDS:
                    # A real pause. Break exactly here.
                    cues.append(_close(current))
                    current = []
                elif span > MAX_CUE_SECONDS or text_len > MAX_CHARS_PER_LINE * MAX_LINES:
                    # Forced break. Fall back to the best pause we passed.
                    at = _split_at_widest_pause(current)
                    cues.append(_close(current[:at]))
                    current = current[at:]
            current.append(word)
        if current:
            cues.append(_close(current))
    return _enforce_minimum(cues)


def _close(words: list[dict]) -> dict:
    text = " ".join(add_tatweel(w["word"].strip()) for w in words)
    return {"start": words[0]["start"], "end": words[-1]["end"], "text": wrap(text)}


def _enforce_minimum(cues: list[dict]) -> list[dict]:
    """Hold a very short cue on screen longer, without overrunning the next one."""
    for i, cue in enumerate(cues):
        if cue["end"] - cue["start"] >= MIN_CUE_SECONDS:
            continue
        ceiling = cues[i + 1]["start"] if i + 1 < len(cues) else cue["end"] + MIN_CUE_SECONDS
        cue["end"] = min(cue["start"] + MIN_CUE_SECONDS, ceiling)
    return cues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path)
    args = parser.parse_args()

    source = args.job / "transcript" / "words-clean.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    cues = build_cues(data["segments"])

    blocks = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(
            f"{index}\n{timestamp(cue['start'])} --> {timestamp(cue['end'])}\n{cue['text']}\n"
        )

    out = args.job / "transcript" / "captions-ar.srt"
    out.write_text("\n".join(blocks), encoding="utf-8")

    overlaps = sum(1 for a, b in zip(cues, cues[1:]) if b["start"] < a["end"])
    longest = max(cue["end"] - cue["start"] for cue in cues)
    print(f"{len(cues)} cues -> {out}")
    print(f"overlaps: {overlaps} | longest cue: {longest:.2f}s")
    return 1 if overlaps else 0


if __name__ == "__main__":
    raise SystemExit(main())
