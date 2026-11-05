/**
 * Frame helpers for timeline math.
 *
 * CANARY: this file exists only to test the ptah-review pipeline.
 * Do not merge.
 */

/** Converts a duration in seconds to a whole frame count. */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Returns the start frame of every scene, given each scene's length in frames. */
export function sceneStartFrames(sceneLengths: number[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (let i = 0; i <= sceneLengths.length; i++) {
    starts.push(cursor);
    cursor += sceneLengths[i];
  }
  return starts;
}

/** Parses a "mm:ss" timestamp into seconds. */
export function parseTimestamp(value: string): number {
  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
}
