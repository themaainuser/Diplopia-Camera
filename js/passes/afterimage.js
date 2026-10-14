// Afterimages: a slow "fatigue" memory fixed to the screen, subtracted from the finished picture.
//
// Each frame the picture is reduced to its mean colour, the memory moves toward how much each
// point stands out from that mean (quickly for strong contrasts, not at all for weak ones), and
// the shown picture is the picture minus the memory. The memory is one eighth of the picture's
// size, in half-float, because its changes are too small for 8-bit steps.

import { makeProgram, makeTarget, deleteTarget, bindInputs, drawTo } from '../gl.js';

const MEMORY_SCALE = 8;
const MEAN_SIZE = 32; // must match MEAN_FRAGMENT

const COPY_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_source;
void main() {
  fragColor = vec4(SAMPLE(u_source, v_uv).rgb, 1.0);
}`;

// The mean of the 32 x 32 picture: 16 x 16 samples taken at texel corners, each averaging four texels.
const MEAN_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_source;
void main() {
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 16; y++) {
    for (int x = 0; x < 16; x++) {
      sum += SAMPLE(u_source, (vec2(float(x), float(y)) * 2.0 + 1.0) / 32.0).rgb;
    }
  }
  fragColor = vec4(sum / 256.0, 1.0);
}`;

// Moves the memory toward how much this point stands out. Output: memory in rgb, "change" in alpha.
const UPDATE_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_mean;
uniform sampler2D u_memory;
uniform vec2 u_sceneTexel;   // one scene pixel, in texture coordinates
uniform float u_build;
uniform float u_fade;
uniform float u_selectivity;
void main() {
  // The picture averaged over this memory cell: 4 x 4 samples, each the mean of 2 x 2 scene pixels.
  vec3 s = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      s += SAMPLE(u_scene, v_uv + (vec2(float(x), float(y)) * 2.0 - 3.0) * u_sceneTexel).rgb;
    }
  }
  s /= 16.0;

  vec3 d = s - SAMPLE(u_mean, vec2(0.5)).rgb;
  float t = 0.5 * u_selectivity;
  vec3 target = d * smoothstep(0.5 * t, 1.5 * t + 0.02, length(d));

  vec3 e = SAMPLE(u_memory, v_uv).rgb;
  float rate = dot(target, target) > dot(e, e) ? u_build : u_fade;
  e += (target - e) * rate;

  // 0 while the thing that made the memory is still there, 1 once it has gone.
  float ee = dot(e, e);
  float change = ee > 1e-6 ? clamp(1.0 - dot(target, e) / ee, 0.0, 1.0) : 1.0;
  fragColor = vec4(e, change);
}`;

// The picture minus the memory, read with B-spline bicubic interpolation so its coarse grid never shows.
const FINAL_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_memory;
uniform vec2 u_memorySize;   // in texels
uniform float u_strength;
uniform float u_steady;

vec4 smoothMemory(vec2 uv) {
  vec2 p = uv * u_memorySize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / u_memorySize;
  vec2 h1 = (i + 1.5 + w3 / g1) / u_memorySize;
  return g0.y * (g0.x * SAMPLE(u_memory, vec2(h0.x, h0.y)) + g1.x * SAMPLE(u_memory, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * SAMPLE(u_memory, vec2(h0.x, h1.y)) + g1.x * SAMPLE(u_memory, vec2(h1.x, h1.y)));
}

void main() {
  vec4 m = smoothMemory(v_uv);
  vec3 scene = SAMPLE(u_scene, v_uv).rgb;
  float visible = mix(u_steady, 1.0, m.a);
  fragColor = vec4(clamp(scene - u_strength * m.rgb * visible, 0.0, 1.0), 1.0);
}`;

export function createAfterimagePass(ctx) {
  const { gl } = ctx;

  // The memory needs a half-float buffer; without one the effect is not offered at all.
  const probe = makeTarget(ctx, 4, 4, { halfFloat: true });
  deleteTarget(ctx, probe);
  if (!probe) return { supported: false, draw() {}, clear() {} };

  const copy = makeProgram(ctx, COPY_FRAGMENT, ['u_mirror', 'u_source']);
  const mean = makeProgram(ctx, MEAN_FRAGMENT, ['u_mirror', 'u_source']);
  const update = makeProgram(ctx, UPDATE_FRAGMENT, [
    'u_mirror', 'u_scene', 'u_mean', 'u_memory', 'u_sceneTexel', 'u_build', 'u_fade', 'u_selectivity',
  ]);
  const final = makeProgram(ctx, FINAL_FRAGMENT, ['u_mirror', 'u_scene', 'u_memory', 'u_memorySize', 'u_strength', 'u_steady']);
  const meanGrid = makeTarget(ctx, MEAN_SIZE, MEAN_SIZE);
  const meanColour = makeTarget(ctx, 1, 1);
  let memory = null; // { width, height, read, write }: two buffers that swap each frame

  function use(program) {
    gl.useProgram(program.program);
    gl.uniform1f(program.uniforms.u_mirror, 1);
  }

  function empty(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Forgets everything: the next frame starts from an empty memory.
  function clear() {
    if (!memory) return;
    empty(memory.read);
    empty(memory.write);
  }

  // A new picture size gets a new, empty memory rather than a stretched old one.
  function ensureMemory(width, height) {
    const w = Math.ceil(width / MEMORY_SCALE);
    const h = Math.ceil(height / MEMORY_SCALE);
    if (memory && memory.width === w && memory.height === h) return;
    if (memory) {
      deleteTarget(ctx, memory.read);
      deleteTarget(ctx, memory.write);
    }
    memory = {
      width: w,
      height: h,
      read: makeTarget(ctx, w, h, { halfFloat: true }),
      write: makeTarget(ctx, w, h, { halfFloat: true }),
    };
    clear();
  }

  // Updates the memory from `scene` (the finished picture, full size) and draws the result to the screen.
  function draw(scene, { strength, steady, selectivity, build, fade, blink = 0 }, width, height) {
    ensureMemory(width, height);

    use(copy);
    bindInputs(ctx, copy, { u_source: scene.texture });
    drawTo(ctx, meanGrid, MEAN_SIZE, MEAN_SIZE);

    use(mean);
    bindInputs(ctx, mean, { u_source: meanGrid.texture });
    drawTo(ctx, meanColour, 1, 1);

    // Closed eyes see nothing, so nothing builds during a blink. Fading carries on.
    use(update);
    bindInputs(ctx, update, { u_scene: scene.texture, u_mean: meanColour.texture, u_memory: memory.read.texture });
    gl.uniform2f(update.uniforms.u_sceneTexel, 1 / width, 1 / height);
    gl.uniform1f(update.uniforms.u_build, build * (1 - blink));
    gl.uniform1f(update.uniforms.u_fade, fade);
    gl.uniform1f(update.uniforms.u_selectivity, selectivity);
    drawTo(ctx, memory.write, memory.width, memory.height);

    use(final);
    bindInputs(ctx, final, { u_scene: scene.texture, u_memory: memory.write.texture });
    gl.uniform2f(final.uniforms.u_memorySize, memory.width, memory.height);
    gl.uniform1f(final.uniforms.u_strength, strength);
    gl.uniform1f(final.uniforms.u_steady, steady);
    drawTo(ctx, null, width, height);

    [memory.read, memory.write] = [memory.write, memory.read];
  }

  return { supported: true, draw, clear };
}
