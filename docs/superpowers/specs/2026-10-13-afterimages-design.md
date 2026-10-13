# Afterimages: Design

Date: 2026-10-13
Status: awaiting review
Builds on: `2026-10-13-diplopia-camera-design.md`

## Purpose

Add the second effect to the app: afterimages. Keep the camera on something
bright or strongly coloured, and the view tires at that spot. Look away, and a
ghost of it lingers in the opposite colours and fades.

Like double vision, it happens by itself with time. Priorities are unchanged:
live realism first, tuning controls second, saving third.

## Scope

In scope:

- The afterimage effect, as a screen-fixed adaptation memory.
- An on/off switch for each effect, so they can run alone or together.
- Five tuning sliders for afterimages.
- A blink on every tap or Space press, whatever the effects are doing.
- Splitting the renderer into passes, and a small list of effects, so a third
  effect is one more entry.

Out of scope:

- Positive afterimages (the brief bright flash after a very strong light).
- Eye tracking. "Where you look" is the camera view itself.
- A fallback for graphics hardware without high-precision buffers.
- Any change to depth estimation, saving, or camera handling.

## What the user sees

- **Build-up.** Over the build time, a thing that stands out from the scene's
  average loses some brightness and colour while it stays in the same place on
  screen.
- **The ghost.** When it moves away, or the camera pans, its ghost stays where
  it was on the screen, in the opposite colours: a bright window leaves a dark
  patch, a red object leaves a cyan one. The ghost is soft-edged and fades
  over the fade time.
- **Selective.** Ordinary textures and mid-tones leave almost nothing.
- **With double vision.** The afterimage is applied to the finished picture,
  so it lies over the doubled, blurred view.
- **Blink.** While the view is dark, parts of the ghost show against it, as
  they do with closed eyes. The memory does not build during a blink.

## The model

All quantities are per point of the displayed picture, in display colour
values from 0 to 1. The memory is fixed to the screen, not to the scene.

- `s`: the picture's colour at this point, averaged over the memory cell.
- `m`: the mean colour of the whole picture this frame.
- `d = s - m`: how much this point stands out.
- `factor = smoothstep(0.5 t, 1.5 t + 0.02, length(d))`, with
  `t = 0.5 x selectivity`. Weak contrasts barely count; strong ones count fully.
- `T = d x factor`: what the memory is heading toward.
- `E`: the memory, a signed colour. Each frame it moves toward `T`:
  `E += (T - E) x rate`. The rate is the build rate when `T` is stronger than
  `E` (`|T| > |E|`), otherwise the fade rate.
- `build rate = 1 - exp(-dt / build time)`,
  `fade rate = 1 - exp(-dt / fade time)`. During a blink the build rate is
  scaled by `1 - blink`, so closed eyes do not adapt. Fading continues at its
  normal rate.
- `change = clamp(1 - dot(T, E) / dot(E, E), 0, 1)`: 0 while the thing that
  made the memory is still there, 1 once it has gone. Where `E` is zero it is
  taken as 1; nothing is shown there either way.
- `visible = mix(steady fading, 1, change)`.
- Shown colour: `picture - strength x E x visible`, clamped to 0..1.

`dt` is clamped to 0.1 seconds, so a tab that was hidden resumes without a
jump. The memory keeps what it held and fades normally.

## Tunable parameters

| Parameter | Key | Start | Range |
|---|---|---|---|
| Strength | `afterStrength` | 45% | 0 to 100% |
| Build time | `afterBuild` | 4 s | 1 to 15 s |
| Fade time | `afterFade` | 6 s | 1 to 30 s |
| Selectivity | `afterSelectivity` | 50% | 0 to 100% |
| Steady fading | `afterSteady` | 30% | 0 to 100% |

Two switches are stored the same way, as 0 or 1: `diplopiaOn` and
`afterimageOn`. Both start on.

Saved settings from before this change lack the new keys and get their
starting values. The storage key does not change.

## Rendering

The memory needs changes too small for 8-bit steps, so it lives in a
half-float buffer.

Per frame, with afterimages on:

1. Draw the picture so far (double vision, or the plain frame) into a hidden
   full-size buffer instead of the screen.
2. Reduce that buffer to a single mean colour, through a 32 x 32 step.
3. Update the memory from the picture, the mean and the previous memory. The
   memory is one eighth of the picture's width and height, held in two buffers
   that swap each frame. The red, green and blue channels hold `E`; the fourth
   holds `change`.
4. Draw the picture minus the memory to the screen. The memory is read with
   smooth (bicubic) interpolation so its coarse grid never shows.

With afterimages off, the picture is drawn straight to the screen as today,
and the memory is cleared so that switching back on starts fresh.

The memory is also cleared when the picture size changes (camera switch,
rotation) and when the graphics context is lost.

The depth debug view (`&debug=depth`) is drawn without afterimages.

## Structure

| File | Change | Responsibility |
|---|---|---|
| `js/gl.js` | New | Shader dialect headers, program and buffer helpers shared by the passes |
| `js/passes/diplopia.js` | New, moved from `renderer.js` | Blur and two-eye composite; `zoomFor`, `blurScale`, `displayToSource` |
| `js/passes/afterimage.js` | New | Mean, memory update and final subtraction; reports whether the device supports it |
| `js/renderer.js` | Rewritten, smaller | Owns the context and its loss and restore, uploads the frame, runs the passes in order, eases the zoom |
| `js/effects/index.js` | New | The list of effects (name, switch key, sliders); `defaultParams`, `sanitizeParams` over all of them |
| `js/effects/afterimage.js` | New | Afterimage slider definitions and the per-frame rates (pure logic) |
| `js/effects/blink.js` | New | The blink curve and a standalone blink timer (pure logic) |
| `js/effects/diplopia.js` | Changed | Uses the shared blink curve; gains `reset()`; no longer owns `defaultParams` and `sanitizeParams` |
| `js/ui.js` | Changed | The panel is built in sections, one per effect, each with a switch |
| `js/main.js` | Changed | Wires the switches, the standalone blink, and the new render call |

Each pass binds the textures it reads when it draws. No pass relies on a
binding left by another.

`renderer.render` takes the frame source and one description of the frame:

- `mirror`, `blink`, `showDepth`
- `diplopia`: `null` for the plain picture, or `{ frame, params, mode, depth }`
- `afterimage`: `null`, or `{ strength, steady, selectivity, build, fade }`
  where `build` and `fade` are this frame's rates

The renderer never reads the clock, so tests can drive it with any time step.

## Controls

- **Settings panel.** Two sections, "Double vision" and "Afterimages". Each
  has an on/off switch as its heading. A section's sliders are hidden while
  its switch is off. The depth sliders stay in the double vision section and
  still show only in depth-aware mode.
- **Reset to defaults** restores every slider and both switches.
- **Whole-frame / Depth-aware buttons** are disabled while double vision is
  off. Turning double vision off stops depth estimation; turning it on again
  resumes the mode that was selected.
- **Tap or Space** always blinks. If double vision is on and the view is not
  single, the blink also refocuses, as before. In depth-aware mode the tapped
  spot still becomes the fixation point.
- **Turning double vision off** returns the view to single at once and removes
  the slight zoom. Turning it on starts a fresh random delay.
- **Status line.** Shows `double vision off` in place of the phase when it is
  off.

## Failure handling

| Situation | Behaviour |
|---|---|
| The device cannot render to a half-float buffer | The Afterimages switch is disabled and off, with the reason shown beside it. Everything else works |
| Picture size changes | The memory is cleared; no stale ghost at the wrong scale |
| Graphics context lost and restored | Buffers are rebuilt and the memory starts empty |
| Tab hidden, then shown | The time step is clamped; the ghost neither jumps nor vanishes |

## Testing

Unit tests (Node's built-in runner):

- Afterimage rates: zero for a zero step; the expected value for 1/60 s at the
  starting times; clamped for a huge step; zero for an invalid step.
- Settings: defaults include the new keys; switches accept only 0 or 1;
  old saved settings gain the new keys; the delay rule still holds.
- Blink timer: closed at 0.08 s, open again at 0.30 s, idle afterwards; a
  second trigger during a blink does not restart it.
- Double vision model: `reset()` returns to focused with a new delay; the
  refocus blink uses the same curve as the standalone blink.

Browser checks with made-up pictures, driving the renderer directly and
reading pixels:

- A bright square on grey for several simulated seconds, then plain grey: the
  square's place is darker than its surroundings and returns to grey over the
  fade time.
- The same with a red square: its place is tinted cyan (red below, green and
  blue above the surroundings).
- A low-contrast texture: it leaves almost nothing.
- While the square is still shown, it dims by the steady-fading share and no
  more.
- Afterimages off: the output is identical to today's.
- Both effects on: the ghost lies over the doubled picture.
- Context loss and a size change both clear the memory.

How natural it looks on a real camera is judged by the user, with the sliders.

## Known limits

- Negative afterimages only.
- The memory is fixed to the screen. A camera on a tripod pointed at a moving
  scene will show faint ghosts behind slow, strong objects; selectivity and
  strength control how much.
- Devices without half-float render targets do not get the effect.
