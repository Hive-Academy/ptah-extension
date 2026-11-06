import { LIGHTNING_FRAGMENT, LIGHTNING_VERTEX, MAX_BOLTS } from './lightning-shader';

/** A point in CSS pixels, relative to the canvas' top-left corner. */
export interface BoltPoint {
  readonly x: number;
  readonly y: number;
}

/** One bolt to draw this frame. Sizes are CSS pixels; the renderer scales them. */
export interface LightningBolt {
  readonly from: BoltPoint;
  readonly to: BoltPoint;
  /** 0 to 1; 0 draws nothing. */
  readonly intensity: number;
  /** Brightness `k` of the `k / distance` light: about the white-hot core's half-width. */
  readonly core: number;
  /** Radius at which the amber halo is cut off. */
  readonly glow: number;
  /** Shifts the noise field: a different path for every strike. */
  readonly seed: number;
}

/** Amber, as the gold symbols (#f5a524). */
const HUE = 38;
/** Widest sideways push, in CSS pixels (shorter bolts push less: 14% of their length). */
const MAX_JAG = 70;
/** Size of the coarsest noise cell, in CSS pixels: sets how far apart the big bends are. */
const NOISE_SCALE = 170;

const UNIFORMS = ['uSeg', 'uBolt', 'uTime', 'uScale', 'uJag', 'uHue'] as const;
type UniformName = (typeof UNIFORMS)[number];

/**
 * One full-screen quad running the segment lightning shader. It owns the one
 * WebGL context of the page; `dispose()` releases it.
 */
export class LightningRenderer {
  private readonly locations = new Map<UniformName, WebGLUniformLocation | null>();
  private readonly segments = new Float32Array(MAX_BOLTS * 4);
  private readonly shapes = new Float32Array(MAX_BOLTS * 4);
  private ratio = 1;

  private constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly program: WebGLProgram,
    private readonly buffer: WebGLBuffer,
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) {
      // Arrays are looked up by their first element, which addresses the whole array.
      const lookup = name === 'uSeg' || name === 'uBolt' ? `${name}[0]` : name;
      this.locations.set(name, gl.getUniformLocation(program, lookup));
    }
    gl.uniform1f(this.location('uHue'), HUE);
  }

  /**
   * Returns undefined when WebGL or the shader is unavailable. Every failure
   * path deletes the GL objects it made and releases the context.
   */
  public static create(canvas: HTMLCanvasElement): LightningRenderer | undefined {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return undefined;
    const fail = (shaders: (WebGLShader | null)[], program?: WebGLProgram | null): undefined => {
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) if (shader) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return undefined;
    };

    const vertex = compile(gl, gl.VERTEX_SHADER, LIGHTNING_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, LIGHTNING_FRAGMENT);
    if (!vertex || !fragment) return fail([vertex, fragment]);
    const program = gl.createProgram();
    if (!program) return fail([vertex, fragment]);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail([vertex, fragment], program);
    // Linked: the program keeps the compiled code, the shader objects can go.
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    const buffer = gl.createBuffer();
    if (!buffer) return fail([], program);
    gl.useProgram(program);
    return new LightningRenderer(gl, program, buffer);
  }

  /** Sizes the drawing buffer to `width` x `height` CSS pixels at `ratio`. */
  public resize(width: number, height: number, ratio: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    this.ratio = ratio;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  /** Draws up to `MAX_BOLTS` bolts; `time` (seconds) drifts the noise so they writhe. */
  public draw(bolts: readonly LightningBolt[], time: number): void {
    const gl = this.gl;
    const height = (gl.canvas as HTMLCanvasElement).height;
    const ratio = this.ratio;
    this.segments.fill(0);
    this.shapes.fill(0);
    // Runs every frame: written in place, nothing allocated.
    const count = Math.min(bolts.length, MAX_BOLTS);
    for (let i = 0; i < count; ++i) {
      const bolt = bolts[i];
      const at = i * 4;
      // CSS y runs down, gl_FragCoord y runs up.
      this.segments[at] = bolt.from.x * ratio;
      this.segments[at + 1] = height - bolt.from.y * ratio;
      this.segments[at + 2] = bolt.to.x * ratio;
      this.segments[at + 3] = height - bolt.to.y * ratio;
      this.shapes[at] = Math.max(0, bolt.intensity);
      this.shapes[at + 1] = bolt.core * ratio;
      this.shapes[at + 2] = Math.max(0.5, bolt.glow * ratio);
      this.shapes[at + 3] = bolt.seed;
    }
    gl.uniform4fv(this.location('uSeg'), this.segments);
    gl.uniform4fv(this.location('uBolt'), this.shapes);
    gl.uniform1f(this.location('uTime'), time);
    gl.uniform1f(this.location('uScale'), NOISE_SCALE * ratio);
    gl.uniform1f(this.location('uJag'), MAX_JAG * ratio);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public clear(): void {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  public dispose(): void {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private location(name: UniformName): WebGLUniformLocation | null {
    return this.locations.get(name) ?? null;
  }
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}
