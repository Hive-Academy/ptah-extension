import { LIGHTNING_FRAGMENT, LIGHTNING_VERTEX } from './lightning-shader';

export interface LightningUniforms {
  readonly hue: number;
  readonly xOffset: number;
  readonly speed: number;
  readonly intensity: number;
  readonly size: number;
  readonly transparent: boolean;
  /** Half-width of the white-hot core, in CSS pixels. */
  readonly core: number;
  /** Decay distance of the amber halo, in CSS pixels. */
  readonly glow: number;
}

const UNIFORMS = [
  'iResolution',
  'iTime',
  'uHue',
  'uXOffset',
  'uSpeed',
  'uIntensity',
  'uSize',
  'uTransparent',
  'uCore',
  'uGlow',
] as const;

type UniformName = (typeof UNIFORMS)[number];

/** One full-screen quad running the lightning fragment shader. */
export class LightningRenderer {
  private readonly locations = new Map<UniformName, WebGLUniformLocation | null>();

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
    for (const name of UNIFORMS) this.locations.set(name, gl.getUniformLocation(program, name));
  }

  /**
   * Returns undefined when WebGL, the derivatives extension or the shader is
   * unavailable. Every failure path deletes the GL objects it made and
   * releases the context; on success the shaders are deleted once linked.
   */
  public static create(canvas: HTMLCanvasElement): LightningRenderer | undefined {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return undefined;
    const fail = (shaders: (WebGLShader | null)[], program?: WebGLProgram | null): undefined => {
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) if (shader) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return undefined;
    };
    if (!gl.getExtension('OES_standard_derivatives')) return fail([]);

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

  public draw(time: number, uniforms: LightningUniforms): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(this.location('iResolution'), width, height);
    gl.uniform1f(this.location('iTime'), time);
    gl.uniform1f(this.location('uHue'), uniforms.hue);
    gl.uniform1f(this.location('uXOffset'), uniforms.xOffset);
    gl.uniform1f(this.location('uSpeed'), uniforms.speed);
    gl.uniform1f(this.location('uIntensity'), uniforms.intensity);
    gl.uniform1f(this.location('uSize'), uniforms.size);
    gl.uniform1f(this.location('uTransparent'), uniforms.transparent ? 1 : 0);
    gl.uniform1f(this.location('uCore'), uniforms.core * ratio);
    gl.uniform1f(this.location('uGlow'), uniforms.glow * ratio);
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
