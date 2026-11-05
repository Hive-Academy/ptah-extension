/**
 * The NGXUI / ReactBits "Lightning" path (one jagged vertical bolt bent by
 * fbm noise), drawn crisp: distance to the bolt is measured in screen pixels
 * (`fwidth`), so the white-hot core is a fixed `uCore` px wide, antialiased
 * over one pixel, with a tight amber halo that decays over `uGlow` px. The
 * original 1/distance bloom (a halo hundreds of pixels wide) and its
 * per-frame random flicker are gone; brightness over time comes only from
 * `uIntensity`, which the component drives with the strike envelope.
 * Edge masks fade the bolt out before the canvas border.
 */
export const LIGHTNING_VERTEX = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const LIGHTNING_FRAGMENT = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uHue;
uniform float uXOffset;
uniform float uSpeed;
uniform float uIntensity;
uniform float uSize;
uniform float uTransparent;
uniform float uCore;
uniform float uGlow;

#define OCTAVE_COUNT 7
#define GLOW_PEAK 0.32

vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

mat2 rotate2d(float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return mat2(c, -s, s, c);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float a = hash12(ip);
  float b = hash12(ip + vec2(1.0, 0.0));
  float c = hash12(ip + vec2(0.0, 1.0));
  float d = hash12(ip + vec2(1.0, 1.0));
  vec2 t = smoothstep(0.0, 1.0, fp);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < OCTAVE_COUNT; ++i) {
    value += amplitude * noise(p);
    p *= rotate2d(0.45);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 raw = 2.0 * (gl_FragCoord.xy / iResolution.xy) - 1.0;
  vec2 uv = raw;
  uv.x *= iResolution.x / iResolution.y;
  uv.x += uXOffset;
  uv += 2.0 * fbm(uv * uSize + 0.8 * iTime * uSpeed) - 1.0;
  float px = abs(uv.x) / max(fwidth(uv.x), 1e-4);
  float core = 1.0 - smoothstep(uCore, uCore + 1.0, px);
  float glow = GLOW_PEAK * exp(-px / uGlow);
  vec3 amber = hsv2rgb(vec3(uHue / 360.0, 0.72, 1.0));
  vec3 hot = vec3(1.0, 0.976, 0.922);
  vec3 col = (amber * glow + hot * core) * uIntensity;
  float mask = smoothstep(1.0, 0.55, abs(raw.x)) * smoothstep(1.0, 0.8, abs(raw.y));
  col = clamp(col * mask, 0.0, 1.0);
  float alpha = mix(1.0, max(col.r, max(col.g, col.b)), uTransparent);
  gl_FragColor = vec4(col, alpha);
}
`;
