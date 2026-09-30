<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <!-- Source for ../index.html (generated). Edit this file and compositions/frames/*.html, then run: node assemble.mjs -->
    <title>Ptah - agent lanes v3</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions@0.8.97/dist/index.global.js" integrity="sha384-fliw84YWa1ZYRre1SODpFDr6Vtfko4jlDK7lOK7gLEl0SycYYteSsCcSlaTxOP6t" crossorigin="anonymous"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #131317; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
      .scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background-color: #131317; }
      .scene + .scene { opacity: 0; }
      .fm { position: absolute; }
/*@frames-css*/
    </style>
  </head>
  <body>
    <!-- Agent lanes v3. Grid: 134 BPM, beat 0.448 s, bar 1.791 s. Music offset 12.575 s puts the drop at 1.791 s. -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="@DURATION" data-width="1920" data-height="1080">
<!--@frames-->

      <audio id="music" src="assets/music/mixkit-uplifting-bass.mp3" data-start="0" data-duration="@DURATION" data-media-start="12.575" data-track-index="10" data-volume="0.6"></audio>
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
