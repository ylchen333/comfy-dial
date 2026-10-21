# Higgsfield camera controls: public-docs reference

Compiled 2026-10-21 from public web pages only (search results, fetched blog/tutorial pages). No logged-in app, no JS bundles, no API calls, no reverse-engineering tools. Nothing here was checked against the live product.

Source reliability key:
- **HF-marketing**: higgsfield.ai blog or geo.higgsfield.ai pages. Vendor promotional copy; every claim is **unverified**.
- **3P**: third-party tutorial or doc. Secondhand.
- Anything marked "unverified" is a marketing claim or a single secondhand source.

## 0. Terms of service

- URL: https://higgsfield.ai/terms-of-use-agreement (fetched; page states "Last updated: July 26, 2026").
- Dated variant also exists: https://higgsfield.ai/terms-of-use-agreement-23-07-2026. An older version shows "March 16, 2024". `https://higgsfield.ai/terms` returns 404.
- Their blog (https://higgsfield.ai/blog/terms-of-use-privacy-policy-update) says a new version takes effect Aug 27, 2026. A third party (https://mindstudio.ai/blog/higgsfield-terms-of-service-backlash) disputes how it describes training rights. I did not read the Aug 27 text directly. Re-check before relying on any of this.
- Clauses relevant to this task, as summarised by a fetch of the Jul 26 text (paraphrase, not read in full):
  - 5.2(v): no disassembling, decompiling or reverse engineering of the Service.
  - 5.2(vi): no scraping or crawling of pages in the Service.
  - 1.5: usage limits on API calls must not be circumvented.
  - 5.1(iii)/5.2(iv): no using the Service or its outputs to build competing products or train ML models, with limited exceptions.
- Consequence: documentation-only research (this file) is fine. Any app inspection, bundle reading or traffic capture would conflict with 5.2(v)/(vi). Do not do it.

## 1. Feature inventory

### 1.1 Cinema Studio (virtual camera rig before generation)
Versions: 2.0 and a later "3.5" are mentioned; one guide says 3.5 builds on 2.0's camera/lens controls (3P, via search summary). Exact version history unverified.

| Control | What is claimed | Source | Status |
|---|---|---|---|
| Workflow | Script/reference, "Build the Rig", preview stills, choose anchor image, bridge to video, direct camera motion, generate | https://geo.higgsfield.ai/blog/recommended/which-ai-video-tool-gives-the-most-control-over-camera-movement-127299 | unverified (HF-marketing) |
| Camera "profiles" | RED V-Raptor, Sony Venice, ARRI Alexa, IMAX, Panavision DXL2. Described as look presets, not measurable sensors | https://vidpros.com/higgsfield-cinema-studio/ | 3P, unverified |
| Lens types, spherical | Petzval, Zeiss Ultra Prime, Helios, ARRI Signature Prime, Canon K-35, Laowa Macro, Cooke S4, Lensbaby | same vidpros page | 3P, unverified |
| Lens types, anamorphic | JDC Xtal Xpress, Panavision C-Series, Hawk V-Lite | same | 3P, unverified |
| Focal lengths | 8, 14, 35, 50, 75 mm (vidpros). A Higgsfield WAN page instead names 35/50/85 mm equivalents | vidpros; https://higgsfield.ai/de/blog/turn-your-video-into-cinema-using-wan-camera-control | conflicting, unverified |
| Sensor size / aperture | Not documented in any page I reached. A search summary said no official page lists exact sensor, focal range or aperture values | search results | not found |
| Aspect ratio | Not stated for Cinema Studio | vidpros says not covered | not found |
| Models it drives | Applies the same camera logic to Seedance 2.0, Veo 3.1, Kling 3.0 | de WAN page above | unverified |

Interpretation: camera body and lens are almost certainly prompt/style conditioning for an image/video model, not optical simulation. This is inference; no source confirms the mechanism.

### 1.2 WAN Camera Control (motion presets on Wan)
- Built around WAN 2.6 (de WAN page, HF-marketing).
- "20+ dynamic camera motion presets", described as "motion blueprints" (geo.higgsfield.ai control-over-camera-movement page). A German third party claims "50+ moves" (https://mind-verse.de/news/neue-moeglichkeiten-kamerasteuerung-ki-videoproduktion); not corroborated.
- Output: 1080p, up to 10 s, 9:16 and 16:9 (same geo page). Speed and intensity: "not specified" on that page.
- The de WAN page lists controls: camera path, focus/depth-of-field shifts, lens behaviour ultra-wide to macro, "movement speed", stabilisation logic including simulated handheld shake, 35/50/85 mm equivalents. All unverified marketing; no numeric ranges given.
- Tip in the page: check at 720p before paying for 1080p (unverified).
- English URL https://higgsfield.ai/blog/WAN-AI-Camera-Control-Your-Guide-to-Cinematic-Motion returned 404 when fetched, though it appeared in search. Content above comes from the other-language and geo pages.

### 1.3 Camera Control preset library / Higgsfield DoP
- DoP intro post https://higgsfield.ai/blog/Introducing-Higgsfield-DoP-preview returned 404; not read.
- Third-party listing of DoP presets: https://docs.florafauna.ai/models/video-models/higgsfield-dop-by-higgsfield (redirects to docs.flora.ai). The redirected page I fetched did NOT contain preset lists; the preset names below came only from a search-engine summary of the original page. Treat as secondhand.
- Menu names seen via search summaries: 360 Orbit, Crash Zoom In, Dolly In, Bullet Time, FPV Drone, Snorricam.
- Higgsfield prompt bank (https://higgsfield.ai/academy/apps/prompt-bank) defines crash zoom as a fast FOV change with the camera held still (via search summary).
- No source reached documents per-preset parameters (duration, magnitude, direction sliders). Presets appear to be discrete named choices (inference).

## 2. Named moves

V = seen in a Higgsfield-owned page (still marketing, not a spec). S = seen only in a third-party or search summary. "Unverified" means I never saw the primary page text for it.

| Move | Where seen | Status |
|---|---|---|
| Dolly in | WAN de page (V); DoP list (S) | verified as named (V), details unverified |
| Dolly out / left / right | DoP list (S) | unverified |
| Orbit, incl. 180 degree orbit | WAN de page (V) | named, unverified details |
| 360 Orbit | preset menu (S) | unverified |
| Arc Right / Arc Left | DoP list (S) | unverified |
| Crane up / Crane down | WAN de page (V, "crane-up"); crane page "Crane Shot (Ascending, Wide Arc)" (V) | named; user sets start and end points per that page |
| Lateral pan | WAN de page (V) | named |
| Tilt | DoP list (S) | unverified |
| Tracking shot | WAN de page (V) | named |
| Over-shoulder view | WAN de page (V) | named |
| Reveal transition | WAN de page (V) | named |
| Dolly zoom (in/out) | geo crane/dolly-zoom page (V, "Dolly Zoom (Emphasis)"); DoP list (S) | named; one source gives "50mm to 24mm" example (S, unverified) |
| Crash zoom in / out | prompt bank (V via summary); DoP (S) | named |
| Zoom in / out | DoP list (S) | unverified |
| Bullet time / bullet-time spin | geo page (V) | named |
| FPV drone sweep | geo page (V) | named |
| Handheld | geo page (V "handheld-style realism"); DoP (S) | named |
| Snorricam | preset menu (S) | unverified |
| Product reveal (tracking) | geo crane page (V) | named |
| Static / locked | DoP (S); frankx.ai guide (S) | unverified |
| Earth Zoom Out, Hyperlapse, Object POV | DoP list (S) | unverified |

Not a move: "Cinematic Lens Flare" and "Dreamy Glow" are looks.

## 3. Mapping to our Shot contract

Contract recap (src/packages/contracts/schema/shot.schema.json): `track` keyframes `{t, position, quaternion, fov_v_deg}`; `frames = 1+8k`, `fps = 25`; segments contiguous. rig-core presets (src/packages/rig-core/src/presets.ts) implement dolly/push-in/pull-out, orbit, pan, zoom, dollyZoom. No separate aperture, focus, roll-rate or shake field exists in the contract.

| Higgsfield item | Mapping | Notes |
|---|---|---|
| Dolly in/out | direct | `dolly`/`pushIn`/`pullOut` |
| Dolly left/right (truck) | direct | position keys along X; add as a preset (not yet in presets.ts) |
| Orbit, arc, 180/360 | direct | `orbit` with start/end degrees; 360 needs end-start = 360 |
| Pan | direct | `pan` (yaw). Tilt is a pitch version; add helper |
| Tilt | direct | quaternion only |
| Crane up/down | direct | Y translation with look-at; helper to add |
| Tracking shot | approximate | needs a moving subject; our scene has static nodes plus camera path, so a lateral move with look-at approximates it |
| Dolly zoom | direct | `dollyZoom` |
| Zoom in/out | direct | `zoom` (fov ramp) |
| Crash zoom | direct | same as zoom with a short fast fov ramp; needs non-linear easing or dense keys (sampler interpolation is linear per presets.ts comment, so approximate via keys) |
| Bullet time | approximate | orbit with a time-freeze; contract has no subject-time control, only camera path; frozen subject must come from the generator |
| FPV drone sweep | approximate | needs dense keys with banking (roll in quaternion) and high speed; representable, but must be authored by hand |
| Handheld / simulated shake | approximate | add small noise to position and quaternion per frame as dense keys; contract has no "shake" parameter |
| Snorricam | approximate | camera rigidly follows a subject: keys must track a moving subject; scene nodes are static in our contract |
| Object POV, over-shoulder | approximate | fixed offset from a scene node; representable as hand-authored keys |
| Reveal transition | not representable | depends on occluder/wipe, not camera pose |
| Hyperlapse, Earth Zoom Out | not representable | time-lapse and scale-change effects |
| Static / locked | direct | two identical keys (still must have >=2 keys) |
| Focus pulls, depth of field, aperture | not representable | no focus/aperture field |
| Lens flare, glow, camera body look, lens "character" (Petzval swirl, anamorphic flare) | not representable | style, not geometry |
| Focal length (35/50/85 mm) | direct | convert to `fov_v_deg` given a sensor height. A sensor height assumption must be stated (e.g. 24 mm full-frame vertical); rig-core fov.ts has conversions |
| Aspect ratio 16:9, 9:16 | direct | `resolution` (our default is 768x512; widths must match model constraints) |
| Duration up to 10 s | direct | frames 1+8k at 25 fps; 10 s = 251 frames (k=31.25 so not exact: 249 or 257). Nearest valid: 249 (9.96 s) |
| Movement speed | direct | `t` spacing of keys or the clip duration |

## 4. Gaps and unconfirmed

- No official numeric specification for: sensor sizes, focal-length range, aperture, speed ranges, preset magnitude, intensity. None of the pages reached give numbers; all numbers above are marketing or secondhand.
- The preset count (20+ vs 50+) is unverified and sources conflict.
- Focal length list conflicts (8/14/35/50/75 vs 35/50/85).
- Did not read: the English WAN Camera Control post (404), DoP preview post (404), Higgsfield help-centre pages, Higgsfield Academy pages beyond search summaries, the Aug 27, 2026 terms text.
- Unknown whether moves are model-conditioning via prompt text, LoRAs, or true camera-pose conditioning (Wan "camera control" in the open-source world uses pose/trajectory inputs; whether Higgsfield does is unconfirmed).
- Unknown whether Cinema Studio 3D/"scene planning" gives a user-editable 3D camera path or only discrete presets. A third-party search summary mentions "3D filmmaking" pages on geo.higgsfield.ai that I did not open.
- A Blender-plugin "Camera" feature (phone as virtual camera) appeared in one search summary; unverified, not researched.
- All geo.higgsfield.ai pages are SEO marketing content.

## 5. UI controls worth building in our studio

Based on what the public material suggests users value, and what our contract can express:
1. Preset picker with a live 3D preview: dolly, truck, orbit/arc, pan/tilt, crane, zoom, crash zoom, dolly zoom, static. All are expressible today or via small helpers.
2. Per-preset magnitude and direction sliders (distance, degrees, fov start/end), with a duration/speed control that snaps frames to 1+8k.
3. Focal-length selector (e.g. 14/24/35/50/85 mm) shown alongside the derived `fov_v_deg`, with the sensor-height assumption visible.
4. Aspect ratio toggle (16:9, 9:16, plus our fixed model-compatible sizes).
5. Handheld shake amount (adds noise to dense keys) and an easing choice (linear, ease-in-out, fast-in for crash zoom), implemented as key generation, not new contract fields.
Deliberately skip: camera-body and lens "look" menus (style conditioning, not geometry) until we know our generator can use them.
