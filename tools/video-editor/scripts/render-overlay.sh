#!/usr/bin/env bash
# Render one HyperFrames composition as a transparent ProRes 4444 overlay.
#
# Usage: scripts/render-overlay.sh <composition-dir> [output.mov]
#
# HyperFrames is pinned. Do not float to latest: a version bump can change how
# a graphic renders. Bump HYPERFRAMES_VERSION deliberately, then re-render
# every overlay in the job.
set -euo pipefail
export PYTHONUTF8=1

HYPERFRAMES_VERSION="0.8.30"
# Every overlay in this job must match the 60 fps timeline. The rate itself
# comes from the composition's root `data-fps`; this is the assertion that
# catches a composition that forgot it. HyperFrames silently defaults to 30.
EXPECT_FPS="${EXPECT_FPS:-60}"

comp="${1:?composition dir required}"
# Resolve both paths BEFORE the render changes directory. A relative output
# path used to resolve a second time inside the composition dir and land in a
# nested projects/... tree.
comp="$(cd "$comp" && pwd)"
out="${2:-$comp/renders/overlay.mov}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"

# HyperFrames shells out to `npx`; from Git Bash it cannot find npx.cmd,
# so the render runs through PowerShell.
comp_win="$(cygpath -w "$comp")"
out_win="$(cygpath -w "$out")"
powershell.exe -NoProfile -Command \
  "Set-Location '$comp_win'; \$env:PYTHONUTF8='1'; npx -y hyperframes@$HYPERFRAMES_VERSION render . --format mov -q high -o '$out_win'"

ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames \
  -of default=nw=1 "$out"

actual_fps="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate \
  -of default=nw=1:nk=1 "$out")"
if [ "$actual_fps" != "$EXPECT_FPS/1" ] && [ "$actual_fps" != "$EXPECT_FPS" ]; then
  echo "FAIL: rendered at $actual_fps, expected $EXPECT_FPS." >&2
  echo "Set data-fps=\"$EXPECT_FPS\" on the composition root in index.html." >&2
  exit 1
fi

pix_fmt="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt \
  -of default=nw=1:nk=1 "$out")"
case "$pix_fmt" in
  yuva*) ;;
  *) echo "FAIL: $pix_fmt carries no alpha channel." >&2; exit 1 ;;
esac
