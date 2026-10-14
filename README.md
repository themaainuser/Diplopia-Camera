# Diplopia Camera

A camera view that behaves like human eyes. It has two effects, which can run alone or together:

- **Double vision.** The picture starts single and sharp; after a short random delay it softens and slides into double vision (physiological diplopia), drifts on its own, and snaps back when you blink.
- **Afterimages.** Keep the camera on something bright or strongly coloured and the view tires at that spot. Look away, and a soft ghost of it lingers in the opposite colours and fades.

It is plain JavaScript with no build step and nothing to install.

## Run

Requires Node 20 or newer.

```bash
npm start
```

Then open <http://localhost:8443>. The browser asks for the camera; allow it.

Run the tests with:

```bash
npm test
```

## Controls

| Action | What it does |
|---|---|
| Drag right on the picture | Pushes the two images apart (double vision) |
| Drag left on the picture | Brings them together; close images merge into one |
| Tap the picture, or press Space | Blinks. With double vision on, it also refocuses, and the effect returns after a new random delay |
| Whole-frame / Depth-aware | Switches how the doubling is drawn (see below). Disabled while double vision is off |
| Round white button | Saves a photo of what is on screen |
| Red button | Starts and stops a video recording (no sound, 60 seconds at most) |
| Camera button | Switches between front and rear cameras, when there are two |
| Sliders button | Opens the settings |

Photos and clips open the share sheet on a phone and download on a computer. If you close the share sheet without sharing, a "Save to device" button stays up for a few seconds. Files are named `diplopia-<date>-<time>`. Both include whatever effects are showing.

### Settings

The settings panel has a section for each effect. Its heading is an on/off switch; switching an effect off hides its sliders. Every switch and slider acts on the live picture and is remembered between visits. "Reset to defaults" restores the starting values and turns both effects on.

**Double vision**

- **Onset delay, min / max**: the range the random delay is drawn from.
- **Onset duration**: how long the eyes take to let go.
- **Resting separation**: how far apart the two images settle.
- **Drift amount / Drift speed**: how much and how fast they wander.
- **Vertical misalignment**: a small up-down offset between the images.
- **Blur**: how soft the relaxed picture is.
- **Eye dominance**: which image is stronger. 0.50 is equal.
- **Fusion threshold**: how close the images must get before they merge. Zero switches merging off.
- **Depth doubling / Depth blur** (depth-aware mode only): how strongly depth changes the doubling and the blur.

Switching double vision off returns the view to single at once. Switching it on starts a fresh random delay.

**Afterimages**

- **Strength**: how visible the ghost is.
- **Build time**: how long a ghost takes to form.
- **Fade time**: how long it lingers once the thing has gone.
- **Selectivity**: how much a thing must stand out from the rest of the scene before it leaves a ghost.
- **Steady fading**: how much a thing dims while you keep looking at it.

## The two modes of double vision

- **Whole-frame**: the whole scene doubles by the same amount. It uses no libraries and starts at once.
- **Depth-aware**: the app estimates how far away each part of the scene is. What sits at the depth you are looking at doubles least; nearer and farther things shift in opposite directions and blur more. Tap a spot to look at it. The resting separation still applies on top; set it to zero to see the depth effect alone.

Depth-aware mode downloads a library (Transformers.js) and a depth model of tens of megabytes the first time you choose it. The browser keeps them afterwards. It is fastest in a browser with WebGPU, where a laptop manages roughly a dozen depth updates a second, and slow on phones without it. If the download fails, the mode is switched off with the reason shown, and whole-frame mode keeps working. Reload the page to try again.

## Afterimages

To see one: hold the camera still on a lamp, a bright window or something strongly coloured for about five seconds, then pan to a plain wall. A dark or opposite-coloured patch stays where the thing was and fades over a few seconds.

- The ghost is fixed to the screen, not to the scene, the way an afterimage follows your eye: it stays put while the view moves under it.
- Ordinary textures and mid-tones leave almost nothing; what counts is how much a thing stands out from the average of the scene.
- The effect needs graphics support for high-precision (half-float) buffers. Almost every current device has it; where it is missing, the Afterimages switch is disabled with the reason shown.
- Rotating the phone, or switching to a camera with a different picture size, clears any ghost. Switching between cameras with the same picture size keeps it for a moment, the way an afterimage stays when you look somewhere else.
- Switching Afterimages off and on again always starts from a clear view.

## URL options

| Address | Effect |
|---|---|
| `?source=test` | Uses a built-in test picture instead of the camera |
| `?source=photos/desk.jpg` | Uses an image file from this folder (a relative path) |
| `&debug=depth` | In depth-aware mode, shows the depth map instead of the picture. Brighter is nearer |

A test picture has no real depth, so judge depth-aware mode with a camera or a real photo.

## On a phone

Browsers only allow the camera on `localhost` or over HTTPS, so `npm start` (plain HTTP, this computer only) will not work from a phone. Three ways around it:

1. **Same network.** Run `npm run start:phone`. It serves the app over HTTPS on port 8080 to your local network and prints the address to open on the phone, such as `https://10.29.36.235:8080`. The phone must be on the same network as this computer.
   - The first run makes a certificate in `.certs/` (never served, never committed). It is made on this computer and trusted by nothing, so the phone says the connection is not private: choose Advanced, then Proceed, then allow the camera.
   - Windows Firewall must let Node.js accept connections. On a network marked Public it usually does not; if the phone cannot connect, mark the network as Private in Windows settings (only on a network you trust) and allow Node.js on private networks.
2. Upload this folder to any static host that serves HTTPS, for example GitHub Pages.
3. Run `npm start` and expose port 8443 through an HTTPS tunnel, for example `cloudflared tunnel --url http://127.0.0.1:8443`, then open the tunnel's address on the phone. Anyone with that address can open the app while the tunnel runs.

The local server only serves the app's own files (HTML, CSS, JavaScript and images) and never anything inside dot-folders such as `.git`, so tunnelling it does not expose the rest of the folder.

## Privacy

Camera frames never leave the device. The only network requests are the library and model downloads for depth-aware mode.

## Layout

| Path | Purpose |
|---|---|
| `js/effects/index.js` | The list of effects and their shared settings |
| `js/effects/diplopia.js` | Double vision's behaviour model: turns time and input into separation, blur, balance and blink |
| `js/effects/afterimage.js` | Afterimage settings and per-frame timing |
| `js/effects/blink.js` | The blink, shared by both effects |
| `js/renderer.js` | Runs the drawing passes for each frame |
| `js/passes/diplopia.js`, `js/passes/afterimage.js` | The WebGL drawing for each effect |
| `js/gl.js` | WebGL helpers shared by the passes |
| `js/depth.js`, `js/depth-worker.js` | Depth model loading and inference, off the main thread |
| `js/depth-math.js` | Depth-map smoothing, shared by the page and the worker |
| `js/camera.js` | Camera, test picture and image sources |
| `js/capture.js` | Photo and video saving |
| `js/ui.js` | Messages, gestures, settings panel |
| `js/main.js` | Wires everything together and runs the frame loop |
| `tools/serve.js` | The local server behind `npm start` |
| `docs/superpowers/` | Design specs and implementation plans |
