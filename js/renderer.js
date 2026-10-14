// Runs the render passes for one frame: uploads the source frame, then draws double vision
// (or the plain picture) to the screen. Owns the WebGL context and rebuilds everything after a context loss.
// It never reads the clock: everything that depends on time arrives in the render call.

import { createContext, makeTexture, setUpQuad } from './gl.js';
import { createDiplopiaPass, zoomFor } from './passes/diplopia.js';

export { zoomFor, blurScale, displayToSource } from './passes/diplopia.js';

const ZOOM_EASE = 0.15; // share of the remaining zoom change applied per frame

// The plain picture is double vision at rest, with nothing that zooms or blurs it.
const PLAIN = {
  frame: { separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' },
  params: { blur: 0, depthBlur: 0, depthStrength: 0, restSeparation: 0, driftAmount: 0 },
  mode: 'whole',
  depth: null,
};

export function createRenderer(canvas) {
  const ctx = createContext(canvas);
  if (!ctx) throw new Error('WebGL unavailable');
  const { gl, gl2 } = ctx;

  let lost = false;
  let videoTexture;
  let diplopia;
  let zoom = null;

  // Everything that dies with the GL context is built here, so it can be rebuilt after a context loss.
  function init() {
    setUpQuad(ctx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    videoTexture = makeTexture(ctx);
    diplopia = createDiplopiaPass(ctx);
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    init();
    lost = false;
  });
  init();

  function resize(width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  function uploadFrame(element, mipmapped) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D);
  }

  // `diplopia` is null for the plain picture, or { frame, params, mode, depth }.
  function render(element, { mirror = false, blink = 0, showDepth = false, diplopia: doubleVision = null } = {}) {
    if (lost) return;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const desc = doubleVision ?? PLAIN;

    // Large blurs read the frame from smaller mipmap levels, which only WebGL 2 has for any frame size.
    uploadFrame(element, gl2 && diplopia.scaleFor(desc, width) > 2);

    // Ease the zoom, so a mode switch or a slider change does not make the picture jump in size.
    const useDepth = desc.mode === 'depth' && desc.depth !== null;
    const targetZoom = zoomFor(desc.params, useDepth ? 'depth' : 'whole', desc.frame.separation.x);
    zoom = zoom === null ? targetZoom : zoom + (targetZoom - zoom) * ZOOM_EASE;

    diplopia.draw(videoTexture, { ...desc, mirror, blink, showDepth, zoom, width, height }, null);
  }

  return {
    resize,
    render,
    // The zoom the last frame was drawn with, for mapping taps back to the source. Null before the first frame.
    get zoom() {
      return zoom;
    },
    get supportsAfterimage() {
      return false;
    },
  };
}
