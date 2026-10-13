# Diplopia Camera

A camera view that behaves like relaxed eyes. The picture starts single and sharp; after a short random delay it softens and slides into double vision (physiological diplopia), drifts on its own, and snaps back when you blink.

It is plain JavaScript with no build step and nothing to install.

## Run

Requires Node 20 or newer.

```bash
npm start
```

Then open <http://localhost:8080>. The browser asks for the camera; allow it.

Run the tests with:

```bash
npm test
```

## Controls

| Action | What it does |
|---|---|
| Drag right on the picture | Pushes the two images apart |
| Drag left on the picture | Brings them together; close images merge into one |
| Tap the picture, or press Space | Blinks and refocuses. The effect returns after a new random delay |
| Whole-frame / Depth-aware | Switches how the doubling is drawn (see below) |
| Round white button | Saves a photo of what is on screen |
| Red button | Starts and stops a video recording (no sound, 60 seconds at most) |
| Camera button | Switches between front and rear cameras, when there are two |
| Sliders button | Opens the settings |

Photos and clips open the share sheet on a phone and download on a computer. If you close the share sheet without sharing, a "Save to device" button stays up for a few seconds. Files are named `diplopia-<date>-<time>`.

### Settings

Every slider acts on the live picture and is remembered between visits. "Reset to defaults" restores the starting values.

- **Onset delay, min / max**: the range the random delay is drawn from.
- **Onset duration**: how long the eyes take to let go.
- **Resting separation**: how far apart the two images settle.
- **Drift amount / Drift speed**: how much and how fast they wander.
- **Vertical misalignment**: a small up-down offset between the images.
- **Blur**: how soft the relaxed picture is.
- **Eye dominance**: which image is stronger. 0.50 is equal.
- **Fusion threshold**: how close the images must get before they merge. Zero switches merging off.
- **Depth doubling / Depth blur** (depth-aware mode only): how strongly depth changes the doubling and the blur.

## The two modes

- **Whole-frame**: the whole scene doubles by the same amount. It uses no libraries and starts at once.
- **Depth-aware**: the app estimates how far away each part of the scene is. What sits at the depth you are looking at doubles least; nearer and farther things shift in opposite directions and blur more. Tap a spot to look at it. The resting separation still applies on top; set it to zero to see the depth effect alone.

Depth-aware mode downloads a library (Transformers.js) and a depth model of tens of megabytes the first time you choose it. The browser keeps them afterwards. It is fastest in a browser with WebGPU, where a laptop manages roughly a dozen depth updates a second, and slow on phones without it. If the download fails, the mode is switched off with the reason shown, and whole-frame mode keeps working. Reload the page to try again.

## URL options

| Address | Effect |
|---|---|
| `?source=test` | Uses a built-in test picture instead of the camera |
| `?source=photos/desk.jpg` | Uses an image file from this folder (a relative path) |
| `&debug=depth` | In depth-aware mode, shows the depth map instead of the picture. Brighter is nearer |

A test picture has no real depth, so judge depth-aware mode with a camera or a real photo.

## On a phone

Browsers only allow the camera on `localhost` or over HTTPS, so opening your computer's address from a phone will not work. Two ways around it:

1. Upload this folder to any static host that serves HTTPS, for example GitHub Pages.
2. Run `npm start` and expose port 8080 through an HTTPS tunnel, for example `cloudflared tunnel --url http://localhost:8080`, then open the tunnel's address on the phone.

The local server only serves the app's own files (HTML, CSS, JavaScript and images) and never anything inside dot-folders such as `.git`, so tunnelling it does not expose the rest of the folder.

## Privacy

Camera frames never leave the device. The only network requests are the library and model downloads for depth-aware mode.

## Layout

| Path | Purpose |
|---|---|
| `js/effects/diplopia.js` | The behaviour model: turns time and input into separation, blur, balance and blink |
| `js/renderer.js` | WebGL drawing for both modes |
| `js/depth.js`, `js/depth-worker.js` | Depth model loading and inference, off the main thread |
| `js/camera.js` | Camera, test picture and image sources |
| `js/capture.js` | Photo and video saving |
| `js/ui.js` | Messages, gestures, settings panel |
| `js/main.js` | Wires everything together and runs the frame loop |
| `tools/serve.js` | The local server behind `npm start` |
| `docs/superpowers/` | Design spec and implementation plan |
