"""Restore English software terms that WhisperX wrote phonetically in Arabic script.

The speaker mixes Egyptian Arabic with English engineering vocabulary. Transcribed
with --language ar, WhisperX rendered many of those English terms in Arabic letters
("الاركتكتشر" for "architecture"). Arabic technical writing keeps them in Latin, so
uncleaned captions read as broken.

Reads transcript/words.json (immutable WhisperX output) plus transcript/
term-dictionary.json and writes transcript/words-clean.json. The dictionary is the
only place the mapping lives; edit it and re-run this script.

Timing is never altered. A term spelled as several Arabic words is merged into one
word entry that spans from the first word's start to the last word's end, keeping
both endpoints exactly. Each segment's text is rebuilt from its cleaned words so the
two always agree.

Usage:
    PYTHONUTF8=1 python scripts/clean_transliterations.py projects/builder-invitation
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

Word = dict[str, Any]
Rule = tuple[list[str], str]


def load_rules(path: Path) -> list[Rule]:
    """Read the dictionary and return match rules, longest token run first."""
    dictionary = json.loads(path.read_text(encoding="utf-8"))
    rules: list[Rule] = []
    for entry in dictionary["terms"]:
        tokens = str(entry["arabic"]).split()
        latin = str(entry["latin"])
        if tokens:
            rules.append((tokens, latin))
    rules.sort(key=lambda rule: len(rule[0]), reverse=True)
    return rules


def merge(words: list[Word], latin: str) -> Word:
    """Collapse a word run into one entry carrying the run's exact timing."""
    return {
        "word": latin,
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "score": min(word["score"] for word in words),
    }


def clean_words(words: list[Word], rules: list[Rule]) -> tuple[list[Word], int]:
    """Apply the rules to one segment's words. Returns the words and a hit count."""
    tokens = [str(word["word"]) for word in words]
    cleaned: list[Word] = []
    substitutions = 0
    index = 0
    while index < len(tokens):
        for pattern, latin in rules:
            end = index + len(pattern)
            if tokens[index:end] == pattern:
                cleaned.append(merge(words[index:end], latin))
                substitutions += 1
                index = end
                break
        else:
            cleaned.append(dict(words[index]))
            index += 1
    return cleaned, substitutions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path, help="project folder, e.g. projects/builder-invitation")
    parser.add_argument("--dictionary", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    transcript = args.job / "transcript"
    source = transcript / "words.json"
    dictionary_path = args.dictionary or transcript / "term-dictionary.json"
    output = args.output or transcript / "words-clean.json"

    if not source.exists():
        print(f"missing {source}", file=sys.stderr)
        return 1
    if not dictionary_path.exists():
        print(f"missing {dictionary_path}", file=sys.stderr)
        return 1

    data = json.loads(source.read_text(encoding="utf-8"))
    rules = load_rules(dictionary_path)

    total = 0
    word_segments: list[Word] = []
    for segment in data["segments"]:
        cleaned, substitutions = clean_words(segment["words"], rules)
        total += substitutions
        segment["words"] = cleaned
        segment["text"] = " " + " ".join(str(word["word"]) for word in cleaned)
        word_segments.extend(cleaned)
    data["word_segments"] = word_segments

    output.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {output}: {total} substitutions across {len(data['segments'])} segments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
