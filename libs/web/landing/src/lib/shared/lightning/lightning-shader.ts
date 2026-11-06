/**
 * Crisp lightning between two arbitrary points, up to `MAX_BOLTS` per frame.
 * Everything is in device pixels (`gl_FragCoord`), so the white-hot core is
 * a fixed `core` px half-width, antialiased over one pixel, with a tight
 * amber halo that decays over `glow` px (no wide bloom).
 *
 * The bolt is the segment uSeg[i] (start.xy, end.xy) bent sideways by a
 * piecewise-linear 1D noise (sharp zigzag corners), tapered to zero at both
 * ends so it always lands exactly on its endpoints. The distance is divided
 * by the local slope so steep jags keep the same thickness. `seed` re-jags
 * the whole bolt; `uShimmer` re-jags only the finest octave (the flicker).
 *
 * uBolt[i] = (intensity, core px, glow px, seed); intensity 0 skips the bolt.
 */
export const MAX_BOLTS = 2;

export const LIGHTNING_VERTEX = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const LIGHTNING_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec4 uSeg[${MAX_BOLTS}];
uniform vec4 uBolt[${MAX_BOLTS}];
uniform float uShimmer;
uniform float uJag;
uniform float uHue;

#define OCTAVES 4
#define GLOW_PEAK 0.3
#define PI 3.14159265

vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Linear, not smooth, interpolation: the bolt gets sharp corners.
float zigzag(float x, float seed) {
  float i = floor(x);
  return mix(hash12(vec2(i, seed)), hash12(vec2(i + 1.0, seed)), fract(x)) * 2.0 - 1.0;
}

float jag(float t, float seed) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 5.0;
  for (int o = 0; o < OCTAVES; ++o) {
    float s = o == OCTAVES - 1 ? seed + uShimmer : seed;
    value += amplitude * zigzag(t * frequency, s + float(o) * 17.0);
    frequency *= 2.1;
    amplitude *= 0.5;
  }
  return value;
}

// Sideways offset in px at distance u along a bolt of length len.
float offsetAt(float u, float len, float amp, float seed) {
  float t = clamp(u / len, 0.0, 1.0);
  return jag(t, seed) * sin(PI * t) * amp;
}

float boltDistance(vec2 p, vec4 seg, float seed) {
  vec2 d = seg.zw - seg.xy;
  float len = max(length(d), 1.0);
  vec2 dir = d / len;
  vec2 q = p - seg.xy;
  float u = dot(q, dir);
  float s = dot(q, vec2(-dir.y, dir.x));
  if (u <= 0.0) return length(q);
  if (u >= len) return length(p - seg.zw);
  float amp = min(len * 0.09, uJag);
  // Far from any jag: skip the noise.
  if (abs(s) > amp + 64.0) return abs(s) - amp;
  float offset = offsetAt(u, len, amp, seed);
  float slope = 0.5 * (offsetAt(u + 1.0, len, amp, seed) - offsetAt(u - 1.0, len, amp, seed));
  return abs(s - offset) / sqrt(1.0 + slope * slope);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 amber = hsv2rgb(vec3(uHue / 360.0, 0.72, 1.0));
  vec3 hot = vec3(1.0, 0.976, 0.922);
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${MAX_BOLTS}; ++i) {
    vec4 bolt = uBolt[i];
    if (bolt.x <= 0.0) continue;
    float dist = boltDistance(p, uSeg[i], bolt.w);
    float core = 1.0 - smoothstep(bolt.y, bolt.y + 1.0, dist);
    float glow = GLOW_PEAK * exp(-dist / bolt.z);
    col += (amber * glow + hot * core) * bolt.x;
  }
  col = clamp(col, 0.0, 1.0);
  // Premultiplied output: colour never exceeds alpha.
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
`;
