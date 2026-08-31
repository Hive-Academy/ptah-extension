# FFmpeg Video Analysis Automation Patterns

Shell automation recipes for batch analysis, structured report generation, threshold checks, and CI-style validation around FFmpeg detection filters, quality metrics, and frame information. SKILL.md keeps the core filter commands and best practices; this reference holds repeatable automation workflows.

## Automation Patterns

### QC Pipeline Script

```bash
#!/bin/bash
# Comprehensive video QC analysis

INPUT="$1"
OUTPUT_DIR="qc_results"
mkdir -p "$OUTPUT_DIR"

echo "Analyzing: $INPUT"

# 1. Black frame detection
ffmpeg -i "$INPUT" -vf "blackdetect=d=0.5" -f null - 2>&1 | \
  grep blackdetect > "$OUTPUT_DIR/black_frames.txt"

# 2. Freeze detection
ffmpeg -i "$INPUT" -vf "freezedetect=n=0.003:d=2" -f null - 2>&1 | \
  grep freeze > "$OUTPUT_DIR/frozen_frames.txt"

# 3. Scene detection
ffmpeg -i "$INPUT" -vf "scdet=threshold=10,metadata=print:file=$OUTPUT_DIR/scenes.txt" -f null -

# 4. Crop detection
ffmpeg -i "$INPUT" -vf "cropdetect=24:16:0" -f null - 2>&1 | \
  grep crop | tail -1 > "$OUTPUT_DIR/crop.txt"

# 5. Interlace detection
ffmpeg -i "$INPUT" -vf "idet" -frames:v 500 -f null - 2>&1 | \
  grep -A5 "Repeated" > "$OUTPUT_DIR/interlace.txt"

# 6. Signal stats
ffmpeg -i "$INPUT" -vf "signalstats=stat=brng,metadata=print:file=$OUTPUT_DIR/signal.txt" \
  -f null -

echo "QC analysis complete. Results in $OUTPUT_DIR/"
```

### Extract Frames at Scene Changes

```bash
# Extract one frame per scene
ffmpeg -i input.mp4 \
  -vf "scdet=threshold=10,select='gt(scene,0.4)'" \
  -vsync vfr \
  -frame_pts 1 \
  scene_%04d.jpg

# Extract with timestamp in filename
ffmpeg -i input.mp4 \
  -vf "scdet=threshold=10,select='gt(scene,0.4)',showinfo" \
  -vsync vfr \
  "scene_%04d_%{pts}.jpg"
```

### Quality Comparison Batch

```bash
#!/bin/bash
# Compare multiple encodes against reference

REFERENCE="reference.mp4"

for encoded in encode_*.mp4; do
  echo "Comparing: $encoded"

  # PSNR
  psnr=$(ffmpeg -i "$REFERENCE" -i "$encoded" \
    -lavfi "[0:v][1:v]psnr" -f null - 2>&1 | \
    grep -oP 'average:\K[0-9.]+')

  # SSIM
  ssim=$(ffmpeg -i "$REFERENCE" -i "$encoded" \
    -lavfi "[0:v][1:v]ssim" -f null - 2>&1 | \
    grep -oP 'All:\K[0-9.]+')

  echo "  PSNR: $psnr dB, SSIM: $ssim"
done
```

---

