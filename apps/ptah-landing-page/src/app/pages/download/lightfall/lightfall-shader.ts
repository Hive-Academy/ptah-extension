/*
 * Light-waterfall shader ported from NGXUI Lightfall (@omnedia/ngx-lightfall 4.0.1,
 * MIT, Copyright (c) 2025 Omnedia). Changes from the original: no Three.js (raw
 * WebGL1), no unused iTime uniform, the Safari fog branch folded into one line,
 * an opaque output for a 'mix-blend-mode: screen' canvas, and a uCore tint that
 * turns the brightest light white-hot instead of clipping at uColor.
 */

import { LIGHTFALL_DEFINES } from './shader/lightfall-defines.glsl';
import { LIGHTFALL_FUNCTIONS } from './shader/lightfall-functions.glsl';
import { LIGHTFALL_MAIN } from './shader/lightfall-main.glsl';
import { LIGHTFALL_UNIFORMS } from './shader/lightfall-uniforms.glsl';

export const LIGHTFALL_VERTEX = `
precision highp float;
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** The fragment shader, assembled in order from its named chunks. */
export const LIGHTFALL_FRAGMENT = [LIGHTFALL_UNIFORMS, LIGHTFALL_DEFINES, LIGHTFALL_FUNCTIONS, LIGHTFALL_MAIN].join('');
