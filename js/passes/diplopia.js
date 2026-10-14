// Double vision: draws a frame as two blended "eye" images.
// One composite shader serves both modes; whole-frame mode is depth-aware mode with the depth terms off.
//
// Defocus is a two-pass Gaussian blur done at reduced resolution, then the composite pass
// samples the sharp frame and the blurred copies once per eye. In depth-aware mode there are
// two blurred copies (at the fixation depth and at the largest depth difference) and each
// pixel blends between them by how far its depth is from the fixation depth.

import { makeProgram, makeTexture, makeTarget, deleteTarget, bindInputs, drawTo } from '../gl.js';

const MAX_ZOOM = 1.5;
const SIGMA_PER_RADIUS = 0.6; // Gaussian sigma that reads like a blur disc of a given radius
const TAPS_PER_SIDE = 12; // must match the loop bounds in BLUR_FRAGMENT

// How far to zoom in so that the largest shift never samples past the edge of the frame.
// That shift is the full range of the drift, or the current separation when a drag has pushed it further.
export function zoomFor(params, mode, separation = 0) {
  const spread = Math.max(params.restSeparation * (1 + params.driftAmount), Math.abs(separation));
  let half = 0.5 * spread + params.blur;
  if (mode === 'depth') half += 0.5 * params.depthStrength + params.depthBlur;
  return Math.min(MAX_ZOOM, 1 / Math.max(1e-3, 1 - 2 * half));
}

// How much smaller than the frame the blur buffers are. Sigma is the largest blur in frame pixels.
// Keeping sigma within four buffer pixels keeps neighbouring blur taps within one, so edges stay smooth.
export function blurScale(sigma) {
  if (sigma <= 8) return 2;
  if (sigma <= 16) return 4;
  if (sigma <= 32) return 8;
  return 16;
}

// Maps a point on the displayed picture (0..1, v = 0 at the top) back to the source frame.
export function displayToSource(u, v, { zoom, mirror }) {
  const su = (u - 0.5) / zoom + 0.5;
  return { u: mirror ? 1 - su : su, v: (v - 0.5) / zoom + 0.5 };
}

// One direction of a Gaussian blur. Run once across and once down.
const BLUR_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_step;   // one tap's offset, in texture coordinates
uniform float u_ratio; // tap spacing divided by sigma
uniform float u_lod;
void main() {
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x * u_ratio * u_ratio);
    sum += w * SAMPLE_LOD(u_source, v_uv + u_step * x, u_lod).rgb;
    total += w;
  }
  fragColor = vec4(sum / total, 1.0);
}`;

const COMPOSITE_FRAGMENT = `
VARYING vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_soft;    // blurred for the fixation depth
uniform sampler2D u_softer;  // blurred for the largest depth difference
uniform sampler2D u_depth;
uniform vec2 u_sep;
uniform float u_softMix;
uniform float u_softerMix;
uniform float u_balance;
uniform float u_blink;
uniform float u_relax;
uniform float u_depthStrength;
uniform float u_fixation;
uniform float u_useDepth;
uniform float u_showDepth;
uniform float u_aspect;
uniform float u_zoom;

// What one eye sees at p. "off" is 0 at the fixation depth and 1 at the largest depth difference.
vec3 eye(vec2 p, float off) {
  vec3 sharp = SAMPLE(u_video, p).rgb;
  vec3 atFixation = mix(sharp, SAMPLE(u_soft, p).rgb, u_softMix);
  if (u_useDepth < 0.5) return atFixation;
  vec3 farOff = mix(sharp, SAMPLE(u_softer, p).rgb, u_softerMix);
  return mix(atFixation, farOff, off);
}

void main() {
  vec2 uv = (v_uv - 0.5) / u_zoom + 0.5;
  float depth = SAMPLE(u_depth, uv).r;
  if (u_showDepth > 0.5) {
    fragColor = vec4(vec3(depth), 1.0);
    return;
  }
  // Signed distance from the depth being looked at: positive is nearer.
  float d = u_useDepth > 0.5 ? depth - u_fixation : 0.0;
  vec2 shift = 0.5 * vec2(u_sep.x + u_depthStrength * u_relax * d, u_sep.y * u_aspect);
  float off = min(1.0, abs(d));
  vec3 left = eye(uv - shift, off);
  vec3 right = eye(uv + shift, off);
  fragColor = vec4(mix(right, left, u_balance) * (1.0 - u_blink), 1.0);
}`;

export function createDiplopiaPass(ctx) {
  const { gl, gl2 } = ctx;
  const blur = makeProgram(ctx, BLUR_FRAGMENT, ['u_mirror', 'u_source', 'u_step', 'u_ratio', 'u_lod']);
  const composite = makeProgram(ctx, COMPOSITE_FRAGMENT, [
    'u_mirror', 'u_video', 'u_soft', 'u_softer', 'u_depth', 'u_sep', 'u_softMix', 'u_softerMix', 'u_balance',
    'u_blink', 'u_relax', 'u_depthStrength', 'u_fixation', 'u_useDepth', 'u_showDepth', 'u_aspect', 'u_zoom',
  ]);

  const depthTexture = makeTexture(ctx);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  let uploadedDepth = null; // the depth data and version currently in the texture
  let targets = null; // { width, height, scratch, soft, softer }: reduced-size buffers for the blur

  // How much smaller than the frame the blur buffers are for these settings.
  // It follows the sliders, not the moment-to-moment blur, so it never changes mid-effect.
  function scaleFor({ params, mode, depth }, width) {
    const useDepth = mode === 'depth' && depth !== null;
    return blurScale(SIGMA_PER_RADIUS * (params.blur + (useDepth ? params.depthBlur : 0)) * width);
  }

  function ensureTargets(width, height) {
    if (targets && targets.width === width && targets.height === height) return;
    if (targets) for (const target of [targets.scratch, targets.soft, targets.softer]) deleteTarget(ctx, target);
    targets = {
      width,
      height,
      scratch: makeTarget(ctx, width, height),
      soft: makeTarget(ctx, width, height),
      softer: makeTarget(ctx, width, height),
    };
  }

  function uploadDepth(depth) {
    if (uploadedDepth && uploadedDepth.data === depth.data && uploadedDepth.version === depth.version) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, depth.width, depth.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, depth.data);
    uploadedDepth = { data: depth.data, version: depth.version };
  }

  // Fills `target` with the frame blurred to `radius` (a fraction of frame width).
  // Returns how much of it to mix over the sharp frame: 1, except for blurs too small
  // for the reduced-size buffer to represent, which are faded in instead.
  function blurInto(videoTexture, target, radius, scale, frameWidth) {
    if (radius <= 0) return 0;
    const sigma = SIGMA_PER_RADIUS * radius * frameWidth; // in frame pixels
    const base = 0.5 * scale; // softening the reduced-size buffer adds by itself
    let sigmaTexels = 0;
    let mix = 1;
    if (sigma >= base) sigmaTexels = Math.sqrt(sigma * sigma - base * base) / scale;
    else mix = (sigma / base) ** 2;

    // Taps reach three sigma; they never sit closer than one texel.
    const step = Math.max(1, (3 * sigmaTexels) / TAPS_PER_SIDE);
    const ratio = step / Math.max(sigmaTexels, 0.01);

    gl.useProgram(blur.program);
    gl.uniform1f(blur.uniforms.u_mirror, 1);
    gl.uniform1f(blur.uniforms.u_ratio, ratio);

    bindInputs(ctx, blur, { u_source: videoTexture });
    gl.uniform2f(blur.uniforms.u_step, step / targets.width, 0);
    gl.uniform1f(blur.uniforms.u_lod, gl2 && scale > 2 ? Math.log2(scale) - 1 : 0);
    drawTo(ctx, targets.scratch, targets.width, targets.height);

    bindInputs(ctx, blur, { u_source: targets.scratch.texture });
    gl.uniform2f(blur.uniforms.u_step, 0, step / targets.height);
    gl.uniform1f(blur.uniforms.u_lod, 0);
    drawTo(ctx, target, targets.width, targets.height);
    return mix;
  }

  // Draws the doubled, blurred frame into `output`, or onto the screen when it is null.
  function draw(videoTexture, desc, output) {
    const { frame, params, mode, depth, mirror, blink, showDepth, zoom, width, height } = desc;
    const useDepth = mode === 'depth' && depth !== null;
    const scale = scaleFor(desc, width);
    ensureTargets(Math.max(1, Math.round(width / scale)), Math.max(1, Math.round(height / scale)));
    if (depth) uploadDepth(depth);

    const softRadius = frame.blur;
    const softerRadius = useDepth ? frame.blur + params.depthBlur * frame.relax : softRadius;
    const softMix = blurInto(videoTexture, targets.soft, softRadius, scale, width);
    const hasSofter = softerRadius > softRadius;
    const softerMix = hasSofter ? blurInto(videoTexture, targets.softer, softerRadius, scale, width) : softMix;

    const u = composite.uniforms;
    gl.useProgram(composite.program);
    bindInputs(ctx, composite, {
      u_video: videoTexture,
      u_soft: targets.soft.texture,
      u_softer: (hasSofter ? targets.softer : targets.soft).texture,
      u_depth: depthTexture,
    });
    gl.uniform1f(u.u_mirror, mirror ? -1 : 1);
    gl.uniform2f(u.u_sep, frame.separation.x, frame.separation.y);
    gl.uniform1f(u.u_softMix, softMix);
    gl.uniform1f(u.u_softerMix, softerMix);
    gl.uniform1f(u.u_balance, frame.balance);
    gl.uniform1f(u.u_blink, blink);
    gl.uniform1f(u.u_relax, frame.relax);
    gl.uniform1f(u.u_depthStrength, params.depthStrength);
    gl.uniform1f(u.u_fixation, depth ? depth.fixation : 0);
    gl.uniform1f(u.u_useDepth, useDepth ? 1 : 0);
    gl.uniform1f(u.u_showDepth, showDepth && depth ? 1 : 0);
    gl.uniform1f(u.u_aspect, width / height);
    gl.uniform1f(u.u_zoom, zoom);
    drawTo(ctx, output, width, height);
  }

  return { scaleFor, draw };
}
