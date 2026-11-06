/** @jest-environment jsdom */
import { LightningRenderer } from './lightning-renderer';
import { LIGHTNING_FRAGMENT, MAX_BOLTS } from './lightning-shader';

interface FakeGl {
  readonly canvas: HTMLCanvasElement;
  readonly loseContext: jest.Mock;
  readonly [method: string]: unknown;
}

function fakeGl(canvas: HTMLCanvasElement, compiles = true): FakeGl {
  const loseContext = jest.fn();
  return {
    canvas,
    loseContext,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    ARRAY_BUFFER: 3,
    STATIC_DRAW: 4,
    FLOAT: 5,
    TRIANGLES: 6,
    COLOR_BUFFER_BIT: 7,
    COMPILE_STATUS: 8,
    LINK_STATUS: 9,
    createShader: jest.fn(() => ({})),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => compiles),
    deleteShader: jest.fn(),
    createProgram: jest.fn(() => ({})),
    attachShader: jest.fn(),
    detachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true),
    deleteProgram: jest.fn(),
    useProgram: jest.fn(),
    createBuffer: jest.fn(() => ({})),
    deleteBuffer: jest.fn(),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    getAttribLocation: jest.fn(() => 0),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    getUniformLocation: jest.fn((_program: unknown, name: string) => name),
    uniform1f: jest.fn(),
    uniform4fv: jest.fn(),
    viewport: jest.fn(),
    clearColor: jest.fn(),
    clear: jest.fn(),
    drawArrays: jest.fn(),
    getExtension: jest.fn((name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)),
  };
}

function canvasWith(gl: FakeGl | null): HTMLCanvasElement {
  const canvas = gl?.canvas ?? document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { configurable: true, value: jest.fn(() => gl) });
  return canvas;
}

function mock(gl: FakeGl, name: string): jest.Mock {
  return gl[name] as jest.Mock;
}

describe('LightningRenderer', () => {
  it('returns undefined when WebGL is unavailable', () => {
    expect(LightningRenderer.create(canvasWith(null))).toBeUndefined();
  });

  it('releases the context when the shader does not compile', () => {
    const gl = fakeGl(document.createElement('canvas'), false);
    expect(LightningRenderer.create(canvasWith(gl))).toBeUndefined();
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });

  it('draws arbitrary segments in device pixels with y flipped', () => {
    const gl = fakeGl(document.createElement('canvas'));
    const renderer = LightningRenderer.create(canvasWith(gl));
    expect(renderer).toBeDefined();

    renderer?.resize(400, 300, 2);
    expect(gl.canvas.width).toBe(800);
    expect(gl.canvas.height).toBe(600);
    expect(mock(gl, 'viewport')).toHaveBeenLastCalledWith(0, 0, 800, 600);

    renderer?.draw(
      [{ from: { x: 10, y: 20 }, to: { x: 110, y: 220 }, intensity: 0.5, core: 1, glow: 3, seed: 7 }],
      4,
    );
    const uniforms = new Map<string, number[]>();
    for (const [name, data] of mock(gl, 'uniform4fv').mock.calls) {
      uniforms.set(name as string, Array.from(data as Float32Array));
    }
    expect(uniforms.get('uSeg[0]')).toEqual([20, 560, 220, 160, 0, 0, 0, 0]);
    expect(uniforms.get('uBolt[0]')).toEqual([0.5, 2, 6, 7, 0, 0, 0, 0]);
    expect(mock(gl, 'uniform1f')).toHaveBeenCalledWith('uTime', 4);
    expect(mock(gl, 'uniform1f')).toHaveBeenCalledWith('uScale', 340);
    expect(mock(gl, 'uniform1f')).toHaveBeenCalledWith('uJag', 140);
    expect(mock(gl, 'drawArrays')).toHaveBeenCalledWith(6, 0, 6);
  });

  it('draws at most MAX_BOLTS bolts', () => {
    const gl = fakeGl(document.createElement('canvas'));
    const renderer = LightningRenderer.create(canvasWith(gl));
    const bolt = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, intensity: 1, core: 1, glow: 1, seed: 1 };
    renderer?.draw([bolt, bolt, bolt], 0);
    const data = mock(gl, 'uniform4fv').mock.calls.find(([name]) => name === 'uBolt[0]')?.[1] as Float32Array;
    expect(data).toHaveLength(MAX_BOLTS * 4);
  });

  it('deletes its objects and releases the context on dispose', () => {
    const gl = fakeGl(document.createElement('canvas'));
    LightningRenderer.create(canvasWith(gl))?.dispose();
    expect(mock(gl, 'deleteBuffer')).toHaveBeenCalledTimes(1);
    expect(mock(gl, 'deleteProgram')).toHaveBeenCalledTimes(1);
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });

  it('needs no derivatives extension and takes endpoints as uniforms', () => {
    expect(LIGHTNING_FRAGMENT).not.toContain('OES_standard_derivatives');
    expect(LIGHTNING_FRAGMENT).toContain(`uniform vec4 uSeg[${MAX_BOLTS}]`);
    expect(LIGHTNING_FRAGMENT).toContain(`uniform vec4 uBolt[${MAX_BOLTS}]`);
  });

  it('skips the noise only beyond the widest push (2 x jag) plus the halo', () => {
    expect(LIGHTNING_FRAGMENT).toContain('abs(s) > 2.0 * amp + reach');
  });

  it('keeps noise coordinates in a small wrapped domain for mediump', () => {
    // The seed is folded into one period and every octave is wrapped before it is sampled.
    expect(LIGHTNING_FRAGMENT).toContain('mod(mod(seed, 64.0)');
    expect(LIGHTNING_FRAGMENT).toContain('p = mod(p, PERIOD);');
    expect(LIGHTNING_FRAGMENT).toContain('vec2 ip = mod(floor(p), PERIOD);');
    // An integer octave matrix maps the wrap lattice onto itself, so wrapping leaves no seam.
    expect(LIGHTNING_FRAGMENT).toContain('mat2(2.0, -1.0, 1.0, 2.0)');
  });
});
