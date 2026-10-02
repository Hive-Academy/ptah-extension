<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <!-- Source for ../index.html (generated). Edit this file and compositions/frames/*.html, then run: node assemble.mjs -->
    <title>Ptah - agent lanes (C: session transcript)</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions@0.8.97/dist/index.global.js" integrity="sha384-fliw84YWa1ZYRre1SODpFDr6Vtfko4jlDK7lOK7gLEl0SycYYteSsCcSlaTxOP6t" crossorigin="anonymous"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #131317; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
      .scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background-color: #131317; }
      .scene + .scene { opacity: 0; }
      .fm { position: absolute; }
      /* Series grammar (STORYBOARD.md v2): caption bar, static vignette, lane diagram. Shared by every frame so cuts match. */
      .vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(0, 0, 0, 0) 58%, rgba(0, 0, 0, 0.4) 100%); }
      .cap { position: absolute; left: 192px; top: 112px; font-family: "Archivo Black", sans-serif; font-size: 84px; line-height: 1.05; letter-spacing: -0.01em; color: #e8e6e1; text-transform: uppercase; white-space: nowrap; }
      .cap > span { display: inline-block; }
      .cap .g { color: #d4af37; }
      .sub { position: absolute; left: 192px; top: 216px; font-family: Inter, sans-serif; font-size: 40px; font-weight: 600; color: #989291; white-space: nowrap; }
      .dia { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: visible; }
      .dia .ln { fill: none; stroke: #6b5a22; stroke-width: 6; stroke-linecap: round; }
      .dia .lnOn { fill: none; stroke: #d4af37; stroke-width: 6; stroke-linecap: round; }
      .dia .lnOk { fill: none; stroke: #16a34a; stroke-width: 6; stroke-linecap: round; }
      .dia .tick { fill: none; stroke: #f5d97d; stroke-width: 6; stroke-linecap: round; stroke-dasharray: 6 46; }
      .dia .node-ring { fill: #1a1a20; stroke: #d4af37; stroke-width: 6; }
      .dia .node-core { fill: #d4af37; }
      .dia .lbl { font-family: Inter, sans-serif; font-size: 36px; font-weight: 600; fill: #e8e6e1; }
      .dia .nlbl { font-family: Inter, sans-serif; font-size: 30px; font-weight: 500; fill: #989291; }
      .dia .run { fill: #3b82f6; }
      .dia .ok { fill: #16a34a; }
      .dia .pkt { fill: #f5d97d; }
      /* Prototype C: your session's transcript as one chat column (design width 1400, u 1). Items flow top-down with
         24 px gaps; the column scrolls up as items arrive, and its top edge fades out like the app's chat view. */
      .col { position: absolute; left: 260px; top: 300px; width: 1400px; height: 740px; overflow: hidden;
             -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 90px); mask-image: linear-gradient(to bottom, transparent 0, #000 90px); }
      .col-in { position: absolute; left: 0; top: 0; width: 1400px; height: 740px; }
/*@frames-css*/
    </style>
  </head>
  <body>
    <!-- Agent lanes, prototype C (session transcript), storyboard v2 Act 1. Grid: 134 BPM, beat 0.448 s, bar 1.791 s. Music offset 12.575 s puts the drop at 1.791 s. -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="@DURATION" data-width="1920" data-height="1080">
<!--@frames-->

      <!-- SFX bus (/hyperframes-audio): one compressor + limiter and one fader (-2 dB) over every sx-* clip -->
      <hf-audio-group id="sfx" data-label="SFX" data-volume="0.79" data-fx-chain='{"version":1,"nodes":[{"type":"compressor","id":"s1","params":{"threshold":-18,"ratio":3,"attack":5,"release":120}},{"type":"limiter","id":"s2","params":{"limit":-1}}]}'></hf-audio-group>

      <audio id="music" src="assets/music/mixkit-uplifting-bass.mp3" data-start="0" data-duration="@DURATION" data-media-start="12.575" data-track-index="10" data-volume="0.6"
        data-automation='{"version":1,"lanes":[{"target":"volume","points":[@MUSIC_POINTS]}]}'></audio>
    </div>
    <script>
      (function () {
        const tl = HyperShader.init({
          bgColor: "#131317",
          accentColor: "#d4af37",
          scenes: [/*@scenes*/],
          transitions: [
          /*@transitions*/
        ],
        });
/*@frames-js*/
        window.__timelines["main"] = tl;
      })();
    </script>
  </body>
</html>
