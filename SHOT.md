# SHOT.md — camera shot types and their presets

Source: [StudioBinder, "Ultimate Guide to Camera Shots"](https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/) (page dated Jan 13, 2025). Code: `src/packages/rig-core/src/shots.ts` (`SHOT_TYPES`, `shotPreset(id, opts)`). Tests: `src/packages/rig-core/test/shots.test.ts`.

**Source check (Oct 29):** the fetch returned the page text verbatim only up to the end of the Shot Size and Shot Framing chapters. The Shot Focus definitions, and everything after (angles, movement, equipment), came from a model summary of the page, not its text. The names are standard, but re-read those sections on the page before quoting a definition from them. The page's top nav also lists "Medium Full Shot (MFS)", which the body text did not define; it is not included.

## How a preset works

Every shot type has an `id`. `shotPreset(id, { id, target, fovDeg, frames })` returns a contract-valid `Shot` (121 frames, 25 fps, 3 segments) or `null`.

| Support | Meaning |
|---|---|
| **camera** | Compiles to a camera track. Framed on the node `subject` (default: the 1.8 m mannequin, soles 0.9 m below `target`), at `fovDeg` (default 40°). |
| **alias** | Same track as another preset (`aliasOf`). |
| **prompt-only** | A camera track cannot express it. `promptHint` is text for the LTX prompt. The depth guide carries geometry only, and the lens/DoF layer is Parking Lot (SPEC.md §2), so focus effects are requests to the model, not guarantees, and the verifier cannot check them. |

Conventions: right-handed, Y-up, camera looks down local -Z, quaternions `[x, y, z, w]`. The subject faces +Z, so the camera sits on +Z looking toward -Z.

## 1. Shot size

Preset: the camera backs off until `span` metres of the subject's height fill the frame, aimed at a body point (fraction of height from the soles). Camera height is the aim point, except for wide shots (1.6 m eye height).

| id | Shot | What it is (page) | Used for (page) | Aim | Span |
|---|---|---|---|---|---|
| `extreme-wide` | Extreme Wide / Long (EWS, ELS) | Subject small against the location | Isolation, distance, grand locations | 0.50 | 18 m |
| `wide` | Wide / Long (WS, LS) | Whole body in view, space above and below | Setting, how the character fits the area | 0.50 | 3.6 m |
| `full` | Full (FS) | Subject fills the frame, scenery still matters | Several characters in one shot | 0.50 | 2.1 m |
| `medium-wide` | Medium Wide / Medium Long (MWS, MLS) | Roughly knees up | Between a full shot and a medium shot | 0.64 | 1.4 m |
| `cowboy` | Cowboy (CS) | Roughly mid-thighs up | Showing a holster or gun on the hip | 0.70 | 1.2 m |
| `medium` | Medium (MS) | Roughly waist up | Versatile: fights, two-shots, dialogue buffer | 0.78 | 0.9 m |
| `medium-close-up` | Medium Close-Up (MCU) | Roughly chest up | Face-forward but still distant | 0.86 | 0.58 m |
| `close-up` | Close-Up (CU) | Part of the subject, often the face, fills the frame | Emotion, reactions, important moments | 0.93 | 0.32 m |
| `extreme-close-up` | Extreme Close-Up (ECU) | One feature: eyes, mouth, a trigger | Detail as the focal point | 0.92 | 0.10 m |
| `establishing` | Establishing | Opens a scene, shows where it happens (wide or extreme wide) | Geography, introducing a scene | 0.50 | 24 m, camera 6 m up |

Span depends on `fovDeg`: the distance is `span / (2·tan(fov/2))`, so a longer lens moves the camera back and compresses the background.

## 2. Shot framing

| id | Shot | What it is (page) | Support |
|---|---|---|---|
| `single` | Single | One subject; "clean" (no one else visible) or "dirty" (extras or foreground in frame) | alias → `medium` |
| `two-shot` | Two Shot | Two characters in one frame: chemistry, power, proximity | prompt-only; needs a second figure |
| `three-shot` | Three Shot | Three characters in one frame | prompt-only; needs two more figures |
| `over-the-shoulder` | Over-the-Shoulder (OTS) | Subject seen past another character's shoulder; conversation | prompt-only; needs a second figure |
| `over-the-hip` | Over-the-Hip (OTH) | Like OTS with a hip in the foreground; power imbalance when one is seated | prompt-only; needs a second figure |
| `pov` | Point of View (POV) | Exactly what one character sees | camera: at the subject's eyes (0.93 of height), looking +Z |

The two/three/OTS/OTH presets stay prompt-only until the scene can hold a second figure with a known position.

## 3. Shot focus (all prompt-only)

| id | Shot | Prompt hint |
|---|---|---|
| `rack-focus` | Rack Focus / Focus Pull | focus shifts from the foreground subject to the background |
| `shallow-focus` | Shallow Focus | shallow depth of field, subject sharp, background and foreground blurred |
| `deep-focus` | Deep Focus | everything in frame sharp |
| `tilt-shift` | Tilt-Shift | selective focus band, miniature look |
| `soft-focus` | Soft Focus | dreamy glow, nothing fully sharp |
| `split-diopter` | Split Diopter | foreground and background both sharp, blurred middle |

## 4. Camera angle

Camera 5 m from the subject (`aerial`, `birds-eye` differ), aimed at the point shown. Heights are fractions of the subject's height from the soles.

| id | Shot | Camera height → aim | Effect |
|---|---|---|---|
| `eye-level` | Eye Level | 0.90 → 0.90 | Neutral, relatable |
| `low-angle` | Low Angle | 0.10 → 0.85, looks up | Power, dominance |
| `high-angle` | High Angle | +3 m above centre → centre, looks down | Subject looks small or weak |
| `hip-level` | Hip Level | 0.50 → 0.50 | Level view at the hip |
| `knee-level` | Knee Level | 0.28 → 0.28 | Low, level view |
| `ground-level` | Ground Level | 0.05 → 0.20 | Ground in the frame |
| `shoulder-level` | Shoulder Level | 0.80 → 0.80 | Standard working height |
| `dutch-angle` | Dutch Angle | eye level, rolled 20° | Unease, disorientation |
| `birds-eye` | Bird's Eye / Overhead | 12 m above, 0.5 m back (straight down is degenerate for lookAt) | Scale, movement |
| `aerial` | Aerial | 22 m up, 22 m back, 55° lens | Large scenery |

## 5. Camera movement

Duration is the whole clip (4.8 s). Distances are metres from the subject on +Z.

| id | Shot | Track | Notes |
|---|---|---|---|
| `static` | Static / Fixed | none | |
| `push-in` | Push-In | z 7 → 3 | |
| `pull-out` | Pull-Out | z 3 → 7 | |
| `dolly` | Dolly | alias → `push-in` | Use `pull-out` for the other direction. |
| `zoom-in` | Zoom In | fixed camera, FOV × 0.5 | Verifier does not gate FOV. |
| `zoom-out` | Zoom Out | fixed camera, FOV × 0.5 → 1 | Same. |
| `dolly-zoom` | Dolly Zoom | z 8 → 3, FOV widens to hold subject size | See SPEC.md §6: translation and FOV are not gated on this shot. |
| `vertigo` | Vertigo | alias → `dolly-zoom` | |
| `pan` | Pan | yaw 0 → 30° (left) | Rotation-only scoring. |
| `tilt` | Tilt | pitch -20° → +20° | Rotation-only scoring. |
| `whip-pan` | Whip Pan | hold, then 90° yaw in 8 frames at 45% of the clip | Motion blur is not rendered. |
| `whip-tilt` | Whip Tilt | hold, then 60° pitch in 8 frames | Same. |
| `tracking` | Tracking | x -4 → +4 at z 5, always looking at the subject | The subject is static, so this is a lateral arc. |
| `crab` | Crab | x -3 → +3 at z 6, heading fixed | |
| `arc` | Arc | orbit radius 5, -60° → +60° | |

## 6. Equipment

Equipment sets how a move feels. Only the path is a preset.

| id | Shot | Preset |
|---|---|---|
| `sticks` | Sticks / Tripod | alias → `static` |
| `slider` | Slider | x -0.6 → +0.6 at z 4, heading fixed |
| `handheld` | Handheld | static at z 4 with deterministic sway (~0.4°, ~1 cm) |
| `steadicam` | Steadicam | alias → `tracking` |
| `gimbal` | Gimbal | alias → `tracking` |
| `crane` | Crane | y 1 → 6, z 7 → 5, looking at the subject |
| `jib` | Jib | y 1.4 → 2.6, z 6 → 5.2 |
| `drone` | Drone | (0, 15, 25) → (0, 3, 8), looking at the subject |
| `wire` | Wire | alias → `tracking` |

## Not done

- The studio UI still lists only the original 5 moves (`apps/studio/src/logic/presets.ts`). Shot types are not wired into it yet.
- Presets are untested on live LTX takes, and no pass gate is calibrated for the new moves (tilt, whip, crane, handheld).
