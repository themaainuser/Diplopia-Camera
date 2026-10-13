# Diplopia Camera: Design

Date: 2026-10-13
Status: awaiting review

## Purpose

A web app that shows, through a live camera, what relaxed eyes see: the picture
is single and sharp, then after a short random delay the eye muscles "let go"
and the scene slides into soft double vision (physiological diplopia).

It is an experience to feel live and a sandbox for tuning perception effects.
Realism of the live behaviour comes first, tuning controls second, saving
third.

This is effect 1 of several planned eye and mind effects, so effects are kept
separate from camera, rendering and saving.

## Scope

In scope:

- Live camera view from a webcam or a phone's rear camera, with a front/rear switch.
- The diplopia effect in two switchable modes, for side-by-side comparison:
  - **Whole-frame**: the whole scene doubles by the same amount.
  - **Depth-aware**: doubling depends on each pixel's distance from the depth being looked at.
- Automatic drift that the user can steer, plus a refocus action.
- Saving a photo or a video clip of what is on screen.
- A panel of tuning sliders.

Out of scope for this build:

- Other effects.
- Hosting or deployment (the README notes the steps for phone testing).
- Audio in recordings.
- A Canvas 2D renderer.

## Constraints

- Plain JavaScript, ES modules, static files, no framework, no build step.
- Whole-frame mode uses no libraries.
- Depth-aware mode is the one exception: it loads one library and one model
  from the network (see Depth pipeline).
- Camera access requires a secure context: `localhost` or HTTPS.
- Camera frames never leave the device. The only network requests are the
  library and model downloads for depth-aware mode.

## Structure

| File | Responsibility | Depends on |
|---|---|---|
| `index.html`, `styles.css` | Page, layout, controls markup | |
| `js/main.js` | Wires modules together, runs the frame loop | all below |
| `js/camera.js` | Opens the camera, switches front/rear, reports errors, provides the test source | browser media APIs |
| `js/effects/diplopia.js` | Behaviour model: turns time and user input into per-frame numbers | nothing (pure logic) |
| `js/renderer.js` | Draws a source frame to a WebGL canvas from those numbers, in either mode | WebGL |
| `js/depth.js` | Owns the depth worker, throttles requests, smooths results | `depth-worker.js` |
| `js/depth-worker.js` | Loads the model and runs depth inference off the main thread | Transformers.js (CDN) |
| `js/capture.js` | Saves a photo or records a video from the canvas | canvas, MediaRecorder |
| `js/ui.js` | Sliders, buttons, gestures, status text, saved settings | DOM |
| `tests/diplopia.test.js` | Unit tests for the behaviour model | Node built-in test runner |
| `package.json` | Marks the project as ES modules and defines the test command; no dependencies | |
| `README.md` | How to run on desktop and on a phone | |

Each frame:

1. `main.js` gets the current source frame (camera video or test source).
2. The behaviour model advances by the elapsed time and returns a frame state.
3. In depth-aware mode, `depth.js` supplies the latest depth map and the depth
   at the fixation point.
4. `renderer.js` draws the frame.

## Behaviour model

`js/effects/diplopia.js` holds no DOM or drawing code. It takes its parameters
and a random-number function at creation, so tests can run it with a fixed
seed. It exposes: advance by a time step, push (steer), refocus, and the
current frame state.

### Frame state

| Field | Meaning |
|---|---|
| `separation.x`, `separation.y` | Distance between the two eye images, as a fraction of frame width. Each eye image is shifted by half of it, in opposite directions. |
| `blur` | Defocus amount, as a fraction of frame width. |
| `balance` | Weight of the left-eye image, 0 to 1. 0.5 means both equal. |
| `blink` | Darkness of the blink, 0 (open) to 1 (closed). |
| `relax` | How far the eyes have let go, 0 (focused) to 1 (fully relaxed). |
| `phase` | `focused`, `relaxing`, `drifting`, `fused` or `refocusing`. |

Using fractions of frame width means the effect looks the same on a phone, on
a laptop and in saved files.

### Phases

- **focused**: separation and blur are zero. A delay is drawn at random
  between the minimum and maximum onset delay. When it ends, move to
  `relaxing`.
- **relaxing**: `relax` eases from 0 to 1 over the onset duration. Separation
  eases toward the resting separation. Blur follows its own, slightly faster
  curve so the picture softens just before it visibly splits. Then move to
  `drifting`.
- **drifting**: separation wanders around the resting separation plus whatever
  the user has pushed. The wander is slow and irregular (smoothed noise),
  mostly horizontal, with a small vertical misalignment and a faint tremor.
  While drifting, separation stays between zero and 20% of frame width.
- **fused**: if separation falls below the fusion threshold while drifting,
  the two images pull together to zero, as eyes do when images get close
  enough to merge. Blur stays, because the eyes are still relaxed. The images
  come apart again only when the drift plus push exceeds the break-away
  threshold (1.5 times the fusion threshold), so they do not flicker at the
  boundary.
- **refocusing**: triggered by the user from any phase except `focused`. The
  view blinks (quick close, brief hold, slower open). Behind the blink,
  separation returns to zero, briefly overshooting past it (the only time it
  goes negative), and blur clears. The
  user's push is reset. Then move to `focused` with a fresh random delay.

Throughout the non-focused phases, `balance` sits at the eye-dominance setting
and wobbles slowly around it, so one image is always slightly stronger and the
stronger one changes over time.

### Tunable parameters

Starting values, to be tuned by eye during the build:

| Parameter | Start | Range |
|---|---|---|
| Onset delay, minimum | 2 s | 0.5 to 20 s |
| Onset delay, maximum | 6 s | 0.5 to 20 s |
| Onset duration | 1.5 s | 0.3 to 5 s |
| Resting separation | 3.5% of width | 0 to 12% |
| Drift amount | 40% of resting separation | 0 to 100% |
| Drift speed | 1x | 0.2x to 3x |
| Vertical misalignment | 0.2% of width | 0 to 1% |
| Blur | 0.6% of width | 0 to 2% |
| Eye dominance | 0.55 | 0.3 to 0.7 |
| Fusion threshold | 0.6% of width | 0 (off) to 2% |
| Depth doubling strength (depth-aware only) | 4% of width | 0 to 12% |
| Depth blur strength (depth-aware only) | 0.6% of width | 0 to 2% |

The onset delay minimum is never allowed to exceed the maximum.

## Renderer

One WebGL renderer serves both modes. The canvas has the source's resolution
and is scaled to fit the viewport with CSS, so saved photos are at camera
resolution.

For every output pixel the shader:

1. Computes a shift for each eye: half the separation, in opposite directions.
2. In depth-aware mode, adds a depth term to that shift: depth doubling
   strength x `relax` x (depth at this pixel minus depth at the fixation
   point). Pixels at the fixation depth get no extra shift; nearer and farther
   pixels shift in opposite directions.
3. Samples the source around each shifted position with a small blur kernel.
   The blur radius is `blur`, plus in depth-aware mode a term that grows with
   the pixel's distance from the fixation depth.
4. Mixes the two eye samples by `balance`.
5. Darkens the result by `blink`.

Whole-frame mode is the same shader with the depth terms switched off.

Other rules:

- The picture is zoomed in just enough that shifted samples never run off the
  edge of the frame.
- The front camera is shown mirrored; the rear camera is not. Saved output
  matches what is shown.

The depth term uses backward sampling (each output pixel looks up a shifted
source pixel). This is an approximation: it can smear at sharp depth edges.
The low-resolution, smoothed depth map keeps this soft. This is accepted.

## Depth pipeline (depth-aware mode only)

- Library: Transformers.js (`@huggingface/transformers`), loaded as an ES
  module from the jsDelivr CDN at a pinned version.
- Model: `onnx-community/depth-anything-v2-small`, via the `depth-estimation`
  pipeline. It returns relative depth per pixel, which is what the shift
  formula needs.
- Device: WebGPU when available, falling back to WASM with the 8-bit quantised
  model. WASM is expected to be slow.
- The model loads only when the user first switches to depth-aware mode, with
  a progress indicator. The browser caches it after the first download.
- Inference runs in a module Web Worker so the picture never stutters.
- `depth.js` sends a downscaled frame to the worker only when the previous
  result has come back. There is no queue, so the depth rate adapts to the
  device.
- The worker returns a depth map normalised to 0..1. Each new map is blended
  with the previous one to reduce flicker, then uploaded as a texture.
- The fixation point defaults to the centre of the frame. Its depth is re-read
  from every new depth map and smoothed, so it follows the scene.
- The current depth rate (maps per second) is shown in the status text.
- Video keeps rendering at full frame rate between depth updates, using the
  most recent map.

## Camera and sources

- Requests video only, rear camera preferred, around 1280x720.
- The camera switch button toggles front/rear and is hidden when the device
  has one camera.
- Test source: adding `?source=test` to the URL replaces the camera with a
  generated pattern. `?source=<path>` uses an image file from the project
  folder instead. Both go through the same rendering path as the camera.
- A generated pattern has no real depth, so the look of depth-aware mode has
  to be judged with a camera or a real photo.

## Controls

- **Drag left/right on the picture**: push the two images together or apart.
  The drift continues around the pushed position.
- **Tap the picture, or press Space**: blink and refocus. In depth-aware mode
  the tapped spot becomes the fixation point.
- **Bottom bar**: mode switch (Whole-frame / Depth-aware), photo, record,
  camera switch, settings.
- **Settings panel** (collapsible): one slider per tunable parameter, a reset
  button, and status text showing the current phase and depth rate.
- Slider values are remembered between visits.

The chrome is dark and minimal so the effect stays the focus.

## Saving

- **Photo**: the frame is captured immediately after a render, as a JPEG at
  canvas resolution. On devices that can share files it opens the share sheet;
  otherwise it downloads.
- **Video**: the record button starts and stops a recording of the canvas at
  30 fps with no audio. Elapsed time is shown while recording. Recording stops
  automatically at 60 seconds. The format is the first one the browser
  supports out of MP4 (H.264), then WebM (VP9, VP8). The finished clip goes
  through the same share or download path.
- The record button is hidden when the browser cannot record a canvas.
- Files are named `diplopia-<date>-<time>` with the matching extension.

## Failure handling

| Situation | Behaviour |
|---|---|
| Page is not on `localhost` or HTTPS | Message explaining that the camera needs a secure address |
| Camera permission denied | Message explaining how to allow it, with a retry button |
| No camera found | Message, with a link to the test source |
| WebGL unavailable | Message; the app cannot run |
| Depth library or model fails to load | Depth-aware mode is disabled with the reason shown; whole-frame mode keeps working |
| Recording unsupported | Record button hidden |

## Testing

Unit tests for the behaviour model, run with `node --test`, using a fixed
random seed:

- Separation and blur are zero while focused.
- Onset begins within the configured delay range.
- After onset, separation settles near the resting separation.
- Over a long run, separation stays within its limits.
- Pushing separation under the fusion threshold fuses the images.
- Fused images stay fused until the break-away threshold is passed.
- Refocus returns separation to zero and schedules a new random delay.
- The same seed gives the same sequence.

Manual checks in a browser, with the test source and with a real camera:

- Both modes render and switch live.
- Drag, tap and Space behave as described.
- A saved photo and a saved clip open and match what was on screen.
- Each failure case shows its message.

The look of the effect is subjective. The sliders exist so it can be tuned
with the user after the first working version.

## Running

- Desktop: any static file server on `localhost`. The README gives one command.
- Phone: the page must be served over HTTPS, by hosting it or by tunnelling.
  The README notes both options.

## Known limits

- Depth-aware mode needs a network connection the first time and a model
  download of tens of megabytes.
- Depth-aware mode will be slow on phones without WebGPU.
- Depth is estimated from a single camera, so it is plausible rather than
  measured, and can be wrong on glass, mirrors and flat textures.
