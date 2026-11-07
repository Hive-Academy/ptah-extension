/** @jest-environment jsdom */
import { LIGHTFALL_DEFAULTS } from './lightfall-options';
import { LightfallRenderer } from './lightfall-renderer';
import { LIGHTFALL_FRAGMENT } from './lightfall-shader';

type FakeGl = Record<string, unknown> & { readonly canvas: HTMLCanvasElement; readonly loseContext: jest.Mock };

function fakeGl(canvas: HTMLCanvasElement, compiles = true): FakeGl {
  const loseContext = jest.fn();
  return {
    canvas,
    loseContext,
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, ARRAY_BUFFER: 3, STATIC_DRAW: 4, FLOAT: 5, TRIANGLES: 6,
    COMPILE_STATUS: 8, LINK_STATUS: 9,
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
    uniform3f: jest.fn(),
    uniform3fv: jest.fn(),
    uniform4f: jest.fn(),
    viewport: jest.fn(),
    drawArrays: jest.fn(),
    getExtension: jest.fn((name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)),
  };
}

function canvasWith(gl: FakeGl | null): HTMLCanvasElement {
  const canvas = gl?.canvas ?? document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { configurable: true, value: jest.fn(() => gl) });
  return canvas;
}

describe('LightfallRenderer', () => {
  it('returns undefined without WebGL', () => {
    expect(LightfallRenderer.create(canvasWith(null))).toBeUndefined();
  });

  it('releases the context when the shader does not compile', () => {
    const gl = fakeGl(document.createElement('canvas'), false);
    expect(LightfallRenderer.create(canvasWith(gl))).toBeUndefined();
    expect(gl.loseContext).toHaveBeenCalled();
    expect(gl['deleteShader']).toHaveBeenCalled();
  });

  it('asks for an opaque context and the derivatives extension', () => {
    const gl = fakeGl(document.createElement('canvas'));
    const canvas = canvasWith(gl);
    LightfallRenderer.create(canvas);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl', expect.objectContaining({ alpha: false }));
    expect(gl['getExtension']).toHaveBeenCalledWith('OES_standard_derivatives');
  });

  it('sets every option uniform, sizes the buffer and draws one triangle', () => {
    const gl = fakeGl(document.createElement('canvas'));
    const renderer = LightfallRenderer.create(canvasWith(gl));
    if (!renderer) throw new Error('renderer expected');

    renderer.setOptions({ ...LIGHTFALL_DEFAULTS, flowSpeed: 0.5 });
    expect(gl['uniform1f']).toHaveBeenCalledWith('uFlowSpeed', 0.5);
    expect(gl['uniform3fv']).toHaveBeenCalledWith('uColor', expect.any(Array));

    renderer.resize(300, 200, 2);
    expect(gl.canvas.width).toBe(600);
    expect(gl.canvas.height).toBe(400);
    expect(gl['uniform3f']).toHaveBeenCalledWith('iResolution', 600, 400, 2);

    renderer.draw({ flowTime: 1, fogTime: 1, fade: 0.5, pointerX: 10, pointerY: 20 });
    expect(gl['uniform1f']).toHaveBeenCalledWith('uFade', 0.5);
    expect(gl['uniform4f']).toHaveBeenCalledWith('iMouse', 10, 20, 0, 0);
    expect(gl['drawArrays']).toHaveBeenCalledWith(6, 0, 3);
  });

  it('deletes its GL objects and the context on dispose', () => {
    const gl = fakeGl(document.createElement('canvas'));
    LightfallRenderer.create(canvasWith(gl))?.dispose();
    expect(gl['deleteBuffer']).toHaveBeenCalled();
    expect(gl['deleteProgram']).toHaveBeenCalled();
    expect(gl.loseContext).toHaveBeenCalled();
  });

  it('assembles the fragment chunks with the extension first and one entry point', () => {
    expect(LIGHTFALL_FRAGMENT.trimStart().startsWith('#extension GL_OES_standard_derivatives')).toBe(true);
    expect(LIGHTFALL_FRAGMENT.indexOf('#define PI')).toBeLessThan(LIGHTFALL_FRAGMENT.indexOf('float g('));
    expect(LIGHTFALL_FRAGMENT.indexOf('float vWisps(')).toBeLessThan(LIGHTFALL_FRAGMENT.indexOf('void mainImage('));
    expect(LIGHTFALL_FRAGMENT.match(/void main\(\)/g)).toHaveLength(1);
  });

  it('declares every uniform the renderer drives', () => {
    for (const declaration of [
      'vec3 uColor', 'vec3 uCore', 'float uFade', 'vec3 iResolution', 'vec4 iMouse', 'float uBeamYFrac',
    ]) {
      expect(LIGHTFALL_FRAGMENT).toContain(`uniform ${declaration};`);
    }
  });
});
