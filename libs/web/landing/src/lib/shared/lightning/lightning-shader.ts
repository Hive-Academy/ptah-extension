/**
 * Lightning between two arbitrary points, up to `MAX_BOLTS` per frame: a port
 * of the NGXUI `<om-lightning>` technique (@omnedia/ngx-lightning) onto a
 * segment. Everything is in device pixels (`gl_FragCoord`).
 *
 * NGXUI warps the whole plane by a rotated multi-octave fbm that drifts with
 * time, then lights each pixel by `k / distance` to the warped line, so the
 * colour over-saturates to white at the core and falls off into a long hue
 * glow. Here the "line" is the segment uSeg[i] (start.xy, end.xy): a pixel's
 * position is taken along and across it, the fbm (sampled at that 2D
 * position, so the halo turns cloudy, not just the path) pushes it sideways,
 * and the push is tapered to zero at both ends so the bolt lands on its
 * endpoints. The 1/d tail is dimmed, modulated by the same noise (glow in
 * smoke) and cut at a radius so it cannot wash out the copy beneath it.
 *
 * uBolt[i] = (intensity, brightness px, halo radius px, seed); intensity 0
 * skips the bolt. uTime (s) makes the bolt writhe; uScale is the fbm cell
 * size in px and uJag the widest sideways push in px.
 *
 * mediump-safe noise: the lattice wraps every PERIOD cells, and each octave
 * steps with the integer matrix (2, 1; -1, 2) (x sqrt 5, turned 26.6 deg,
 * close to NGXUI's x2 and 0.45 rad). An integer matrix maps the wrap
 * lattice onto itself, so the coordinates can be wrapped into [0, PERIOD)
 * before every octave without a seam. The seed enters as mod(seed, 64), wrapped
 * into one period, so no noise coordinate leaves about +-100 (inside each
 * octave: [0, 96)): far inside mediump's +-16384.
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
uniform float uTime;
uniform float uScale;
uniform float uJag;
uniform float uHue;

#define OCTAVES 6
#define PERIOD 32.0
#define SPEED 0.8
// The halo below the white core is dimmed to about this share (keeps the copy legible).
#define HALO_CAP 0.6
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

// Value noise, periodic in PERIOD: the cell corners wrap, so p and p + PERIOD agree.
float noise(vec2 p) {
  vec2 fp = fract(p);
  // Wrapped too: mod() can round up to exactly PERIOD.
  vec2 ip = mod(floor(p), PERIOD);
  vec2 jp = mod(ip + 1.0, PERIOD);
  float a = hash12(ip);
  float b = hash12(vec2(jp.x, ip.y));
  float c = hash12(vec2(ip.x, jp.y));
  float d = hash12(jp);
  vec2 t = smoothstep(0.0, 1.0, fp);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

// Turning each octave (as NGXUI does) hides the grid; the x sqrt 5 step adds kinks.
float fbm(vec2 p) {
  // Columns (2, -1) and (1, 2): p' = (2x + y, 2y - x).
  const mat2 turn = mat2(2.0, -1.0, 1.0, 2.0);
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < OCTAVES; ++i) {
    p = mod(p, PERIOD);
    value += amplitude * noise(p);
    p = turn * p;
    amplitude *= 0.5;
  }
  return value;
}

// x: distance in px from p to the warped bolt along seg; y: the fbm there.
vec2 boltField(vec2 p, vec4 seg, float seed, float reach) {
  vec2 d = seg.zw - seg.xy;
  float len = max(length(d), 1.0);
  vec2 dir = d / len;
  vec2 q = p - seg.xy;
  float u = dot(q, dir);
  float s = dot(q, vec2(-dir.y, dir.x));
  float amp = min(len * 0.14, uJag);
  // |push| <= 2 * amp (|2n - 1| <= 1, taper <= 1): beyond that plus the halo
  // nothing can reach the bolt, skip the noise.
  if (abs(s) > 2.0 * amp + reach) return vec2(reach, 0.5);
  float t = clamp(u / len, 0.0, 1.0);
  // Rises fast off each end. No pow()/sqrt(): at 0 (and at sin(PI), a hair
  // below 0) some GPUs return NaN, which paints a white wedge past the ends.
  float arch = max(sin(PI * t), 0.0);
  float taper = arch * (2.0 - arch);
  // seed <= 2048 is exact in mediump, so the mod is too; the offset is wrapped
  // into one period, so the first octave starts within about +-50.
  vec2 shift = mod(mod(seed, 64.0) * vec2(1.37, 0.71), PERIOD);
  vec2 cell = vec2(u, s) / uScale + shift + SPEED * uTime;
  float n = fbm(cell);
  float push = (2.0 * n - 1.0) * 2.0 * amp * taper;
  float past = max(-u, 0.0) + max(u - len, 0.0);
  return vec2(length(vec2(past, s + push)), n);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 hue = hsv2rgb(vec3(uHue / 360.0, 0.78, 0.85));
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${MAX_BOLTS}; ++i) {
    vec4 bolt = uBolt[i];
    if (bolt.x <= 0.0) continue;
    vec2 field = boltField(p, uSeg[i], bolt.w, bolt.z);
    float dist = field.x;
    float light = bolt.y / max(dist, 0.5);
    // Full strength near the core; in the tail about HALO_CAP, swelling and
    // thinning with the noise that bends the bolt (glow lighting up smoke).
    float smoke = HALO_CAP * (0.45 + 1.1 * field.y);
    light *= mix(smoke, 1.0, smoothstep(0.6, 2.5, light));
    light *= 1.0 - smoothstep(0.25 * bolt.z, bolt.z, dist);
    col += hue * light * bolt.x;
  }
  // Over-saturated channels clip: amber glow, white-hot core.
  col = clamp(col, 0.0, 1.0);
  // Premultiplied output: colour never exceeds alpha.
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
`;
