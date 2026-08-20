# selfshot/ — self-shot video ingest

One folder per video. Drop the founder's recordings in, then run the three
commands (see `../RECORDING.md`):

```
selfshot/<slug>/
  camera.mp4 | screen.mp4 | audio.wav   ← your recordings (gitignored)
  words.json                            ← whisper output   (selfshot:transcribe)
  beats.json                            ← the beats manifest (selfshot:draft, then edit)
  out/<slug>-16x9.mp4 | -9x16.mp4       ← renders          (gitignored)
  _public/, render-props.*.json         ← render staging   (gitignored)
```

Media files and render outputs are **gitignored** (they're large / private);
`beats.json`, `words.json`, and READMEs are tracked.

## `_smoke/` — pipeline smoke fixture

`_smoke/` is a throwaway end-to-end test that uses a showcase tour MP4 as a
stand-in "screen/camera recording" and a narration WAV as a stand-in voice
track. It proves `transcribe → draft → render` works for all three modes. To
rebuild it:

```bash
# from apps/ptah-video-studio (ffmpeg-static provides ffmpeg)
node -e "const {execFileSync}=require('child_process');const ff=require('ffmpeg-static');const s='../../dist/apps/ptah-electron-e2e/recordings/dashboard-tour';execFileSync(ff,['-y','-ss','20','-i',s+'/out/dashboard-tour.mp4','-t','4','-an','-c:v','libx264','-pix_fmt','yuv420p','selfshot/_smoke/camera.mp4']);execFileSync(ff,['-y','-ss','46','-i',s+'/out/dashboard-tour.mp4','-t','4','-an','-c:v','libx264','-pix_fmt','yuv420p','selfshot/_smoke/screen.mp4']);execFileSync(ff,['-y','-i',s+'/wav/0001.wav','-i',s+'/wav/0002.wav','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1','selfshot/_smoke/audio.wav']);"

npm run selfshot:transcribe -- --slug _smoke
npm run selfshot:draft      -- --slug _smoke
npm run selfshot:render     -- --slug _smoke --range 0-40   # fast, tiny
```
