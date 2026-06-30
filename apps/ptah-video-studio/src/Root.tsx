/**
 * Root — Remotion entry. Registers the single parametric ShowcaseVideo
 * composition. width/height/fps/durationInFrames are derived per-render from
 * the `manifest` prop via calculateMetadata, so the resolution tiers driven by
 * PTAH_SHOWCASE_RES (1080p/1440p/4k) flow through automatically (AC-5).
 */
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import { sceneManifestSchema } from './lib/load-manifest';
import {
  ShowcaseVideo,
  totalDurationInFrames,
  OUTPUT_FPS,
  type ShowcaseVideoProps,
} from './ShowcaseVideo';

// Fallback metadata used only when the composition is opened in the studio
// without props (e.g. picking it from the sidebar before render-all wires
// real props). render-all.mjs always supplies a real manifest.
const FALLBACK_MANIFEST: ShowcaseVideoProps['manifest'] = {
  scene: 'preview',
  title: 'Showcase Preview',
  recordStartMs: 0,
  durationMs: 6000,
  res: { width: 1920, height: 1080 },
  beats: [],
};

const calculateMetadata: CalculateMetadataFunction<ShowcaseVideoProps> = ({
  props,
}) => {
  const manifest = props.manifest ?? FALLBACK_MANIFEST;
  return {
    width: manifest.res.width,
    height: manifest.res.height,
    fps: OUTPUT_FPS,
    durationInFrames: totalDurationInFrames(
      manifest,
      props.introMs,
      props.outroMs,
    ),
  };
};

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShowcaseVideo"
      component={ShowcaseVideo}
      // Default metadata; overridden by calculateMetadata once props arrive.
      width={FALLBACK_MANIFEST.res.width}
      height={FALLBACK_MANIFEST.res.height}
      fps={OUTPUT_FPS}
      durationInFrames={totalDurationInFrames(FALLBACK_MANIFEST)}
      schema={undefined}
      calculateMetadata={calculateMetadata}
      defaultProps={{
        rawVideo: '',
        manifest: FALLBACK_MANIFEST,
        narrationFiles: {},
        durations: null,
        captions: [],
        kenBurns: true,
      }}
    />
  );
};

// Keep the schema import referenced (manifest validation lives in the scripts;
// re-exported here so the studio bundle keeps the boundary module live).
void sceneManifestSchema;

registerRoot(RemotionRoot);
