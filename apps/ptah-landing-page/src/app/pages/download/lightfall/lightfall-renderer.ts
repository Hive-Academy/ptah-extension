import { LightfallOptions, hexToRgb } from './lightfall-options';
import { LIGHTFALL_FRAGMENT, LIGHTFALL_VERTEX } from './lightfall-shader';

/** Per-frame values; times are seconds, the pointer is in drawing-buffer pixels (y up). */
export interface LightfallFrame {
  readonly flowTime: number;
  readonly fogTime: number;
  /** 0 to 1: the one-second fade-in NGXUI plays on first light. */
  readonly fade: number;
  readonly pointerX: number;
  readonly pointerY: number;
}

const UNIFORMS = [
  'iResolution', 'iMouse', 'uWispDensity', 'uTiltScale', 'uFlowTime', 'uFogTime',
  'uBeamXFrac', 'uBeamYFrac', 'uFlowSpeed', 'uVLenFactor', 'uHLenFactor', 'uFogIntensity',
  'uFogScale', 'uWSpeed', 'uWIntensity', 'uFlowStrength', 'uDecay', 'uFalloffStart',
  'uFogFallSpeed', 'uColor', 'uCore', 'uFade',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/** Scalar options and the uniform each one drives. */
const SCALARS: readonly (readonly [UniformName, keyof LightfallOptions])[] = [
  ['uWispDensity', 'wispDensity'], ['uTiltScale', 'mouseTiltStrength'],
  ['uBeamXFrac', 'horizontalBeamOffset'], ['uBeamYFrac', 'verticalBeamOffset'],
  ['uFlowSpeed', 'flowSpeed'], ['uVLenFactor', 'verticalSizing'], ['uHLenFactor', 'horizontalSizing'],
  ['uFogIntensity', 'fogIntensity'], ['uFogScale', 'fogScale'], ['uWSpeed', 'wispSpeed'],
  ['uWIntensity', 'wispIntensity'], ['uFlowStrength', 'flowStrength'], ['uDecay', 'decay'],
  ['uFalloffStart', 'falloffStart'], ['uFogFallSpeed', 'fogFallSpeed'],
];

/**
 * One full-screen triangle running the Lightfall shader in a WebGL1 context it
 * owns. `dispose()` deletes every GL object and releases the context.
 */
export class LightfallRenderer {
  private readonly locations = new Map<UniformName, WebGLUniformLocation | null>();

  private constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly program: WebGLProgram,
    private readonly buffer: WebGLBuffer,
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.locations.set(name, gl.getUniformLocation(program, name));
  }

  /** Undefined when WebGL or the shader is unavailable; failures release what they made. */
  public static create(canvas: HTMLCanvasElement): LightfallRenderer | undefined {
    const gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) return undefined;
    // WebGL1 needs the extension requested before the shader's fwidth() compiles.
    gl.getExtension('OES_standard_derivatives');
    const fail = (shaders: (WebGLShader | null)[], program?: WebGLProgram | null): undefined => {
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) if (shader) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return undefined;
    };
    const vertex = compile(gl, gl.VERTEX_SHADER, LIGHTFALL_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, LIGHTFALL_FRAGMENT);
    if (!vertex || !fragment) return fail([vertex, fragment]);
    const program = gl.createProgram();
    if (!program) return fail([vertex, fragment]);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail([vertex, fragment], program);
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    const buffer = gl.createBuffer();
    if (!buffer) return fail([], program);
    gl.useProgram(program);
    return new LightfallRenderer(gl, program, buffer);
  }

  public setOptions(options: LightfallOptions): void {
    for (const [uniform, key] of SCALARS) this.gl.uniform1f(this.location(uniform), Number(options[key]));
    this.gl.uniform3fv(this.location('uColor'), hexToRgb(options.color));
    this.gl.uniform3fv(this.location('uCore'), hexToRgb(options.coreColor));
  }

  /** Sizes the drawing buffer to `width` x `height` CSS pixels at `ratio`. */
  public resize(width: number, height: number, ratio: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    this.gl.uniform3f(this.location('iResolution'), pixelWidth, pixelHeight, ratio);
  }

  public draw(frame: LightfallFrame): void {
    const gl = this.gl;
    gl.uniform1f(this.location('uFlowTime'), frame.flowTime);
    gl.uniform1f(this.location('uFogTime'), frame.fogTime);
    gl.uniform1f(this.location('uFade'), frame.fade);
    gl.uniform4f(this.location('iMouse'), frame.pointerX, frame.pointerY, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
