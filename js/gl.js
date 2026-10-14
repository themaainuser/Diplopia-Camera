// WebGL plumbing shared by the render passes: the context, the shader dialect, programs, textures
// and off-screen targets. Nothing here knows about any effect.

// The shaders are written once and prefixed with a header for the GLSL dialect in use.
const HEADERS = {
  2: {
    vertex: `#version 300 es
#define ATTRIBUTE in
#define VARYING out
`,
    fragment: `#version 300 es
precision highp float;
#define VARYING in
#define SAMPLE(s, p) texture(s, p)
#define SAMPLE_LOD(s, p, lod) textureLod(s, p, lod)
out vec4 fragColor;
`,
  },
  1: {
    vertex: `#define ATTRIBUTE attribute
#define VARYING varying
`,
    fragment: `precision highp float;
#define VARYING varying
#define SAMPLE(s, p) texture2D(s, p)
#define SAMPLE_LOD(s, p, lod) texture2D(s, p)
#define fragColor gl_FragColor
`,
  },
};

// Every pass draws one full-screen quad. `u_mirror` of -1 flips it left to right.
const VERTEX = `
ATTRIBUTE vec2 a_pos;
uniform float u_mirror;
VARYING vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos.x * u_mirror, a_pos.y, 0.0, 1.0);
}`;

// WebGL 2 first, for mipmaps on frames of any size; WebGL 1 otherwise. Null when neither is available.
export function createContext(canvas) {
  const options = { alpha: false, antialias: false };
  const gl2 = canvas.getContext('webgl2', options);
  const gl = gl2 || canvas.getContext('webgl', options);
  if (!gl) return null;
  return { gl, gl2: Boolean(gl2), headers: HEADERS[gl2 ? 2 : 1] };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error('Shader failed to compile: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function makeProgram({ gl, headers }, fragment, uniformNames) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, headers.vertex + VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, headers.fragment + fragment));
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error('Shader program failed to link: ' + gl.getProgramInfoLog(program));
  }
  const uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]));
  return { program, uniforms };
}

// A smoothly filtered, edge-clamped texture, left bound to texture unit 0.
export function makeTexture({ gl }) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

// The texture format for a half-float target, or null when the device cannot render to one.
function halfFloatFormat({ gl, gl2 }) {
  if (gl2) {
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
    return { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT };
  }
  const half = gl.getExtension('OES_texture_half_float');
  if (!half || !gl.getExtension('OES_texture_half_float_linear') || !gl.getExtension('EXT_color_buffer_half_float')) {
    return null;
  }
  return { internalFormat: gl.RGBA, type: half.HALF_FLOAT_OES };
}

// An off-screen image that can be drawn into and then read as a texture.
// Null when the device cannot make it (for example, no half-float support).
export function makeTarget(ctx, width, height, { halfFloat = false } = {}) {
  const { gl } = ctx;
  const format = halfFloat ? halfFloatFormat(ctx) : { internalFormat: gl.RGBA, type: gl.UNSIGNED_BYTE };
  if (!format) return null;
  const texture = makeTexture(ctx);
  gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, width, height, 0, gl.RGBA, format.type, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return null;
  }
  return { texture, framebuffer, width, height };
}

export function deleteTarget({ gl }, target) {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

// Binds each texture a program reads to its own unit, in order from 0, and points the sampler at it.
// Passes call this on every draw, so none depends on a binding another pass left behind.
// The program must already be in use.
export function bindInputs({ gl }, { uniforms }, inputs) {
  Object.entries(inputs).forEach(([name, texture], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms[name], unit);
  });
}

// Draws the quad into `target`, or onto the screen when `target` is null.
export function drawTo({ gl }, target, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function setUpQuad({ gl }) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
