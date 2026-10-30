# DESIGN.md: ComfyDial studio restyle

**What this is:** the visual spec for the studio (`src/apps/studio`). It changes how the app **looks and responds**, not what it does. SPEC.md still decides behaviour; this file decides appearance.

**Approved drafts:** `docs/design/drafts/*.dc.html`. They are reference files from a design canvas: copy their CSS and markup structure, but don't load or bundle them, because they rely on that canvas's runtime.

**Timing:** this touches only `src/apps/studio` (styles and markup) plus one brand string. Whether it ships before or after the Oct 30 submission is the owner's call.

---

## 0. TL;DR (read only this if busy)

| Decision | Value |
|---|---|
| Look | **Programmatic brutalist with vintage-computing structure**: dotted paper, ink hairlines, Win98-style title bars and folder tabs, hard offset shadows. No gradients, glows or spheres |
| Brand | **ComfyDial** in the UI (repo and package names stay `comfy-osh`) |
| Fonts | **Instrument Serif** for the brand and room tabs only · **Pixelify Sans** for every label and sentence · **VT323** for numbers, timecode and ids |
| Colour | Ink on paper does almost everything. **Blue `#2F4FD8`**: pass line, focus, playhead. **Orange `#E2552B`**: anything that spends credits, or a drifted segment. Yellow and cyan only appear inside dark "screens" |
| Review room | Take tabs on top → **video about 75% of the width** → narrow side panel (score, segments, repair, paths, downloads) |
| "All UI responds" | Every control has hover, pressed, focus-visible, disabled and selected states (§6). Every room reflows down to 360 px wide with no horizontal page scroll (§5) |

---

## 1. Rules

1. **No behaviour changes.** Same props, handlers, endpoints, shortcuts and copy meaning. Only the class names, CSS, wrapper markup and the brand string change.
2. **No new features.** Anything a draft shows that the app doesn't have yet (for example the 5 move thumbnails, if presets are still plain buttons) is a Parking Lot item, except the restyle of the existing control.
3. **The draft values are illustrative.** Numbers in the drafts (seeds 3000–3004, angles) are mock data. Always render real `RunView` / `TakeView` data.
4. **Ownership:** the `studio` lane owns `src/apps/studio/`. Nothing outside it changes; `PageBar.tsx` is already inside the studio.
5. **Done** = `pnpm -r test` is green **and** the Playwright checks in §9 pass.

---

## 2. Tokens: replace the `:root` block at the top of `src/apps/studio/src/ui/styles.css`

```css
:root {
  /* surfaces */
  --paper: #ecebe5;           /* page ground, with the dot screen below */
  --panel: #f7f6f1;           /* boxes */
  --field: #faf9f4;           /* buttons, inputs, tracks */
  --tab-idle: #e2e1da;        /* unselected tabs */
  --ink: #141414;             /* all text, borders, shadows */
  --ink-2: #3a3a3a;           /* hints (10:1 on --panel) */
  --offset: #8f9bb0;          /* misregistered outline, decoration only */
  /* signals */
  --blue: #2f4fd8;            /* pass line, focus ring, playhead (6:1 on --panel) */
  --orange: #e2552b;          /* FILL ONLY, always with --ink text (4.9:1). Never orange text on paper (3.5:1 fails) */
  --orange-2: #f3a17f;        /* hatch partner for drifted segments */
  /* screens (viewport, video, path plots) */
  --screen-0: #05070d; --screen-1: #0b1020; --screen-text: #f7f6f1;
  --authored: #ffd23f; --recovered: #3fd2ff;   /* only on screens */
  /* type */
  --f-display: "Instrument Serif", serif;
  --f-ui: "Pixelify Sans", ui-monospace, monospace;
  --f-num: "VT323", ui-monospace, monospace;
  /* geometry */
  --shadow: 3px 3px 0 var(--ink);
  --shadow-sm: 2px 2px 0 var(--ink);
  --hit: 44px;                /* minimum touch target */
  --gap: 22px;
}
body {
  background-color: var(--paper);
  background-image: radial-gradient(rgba(20,20,20,.07) 1px, transparent 1.3px);
  background-size: 6px 6px;
  color: var(--ink);
  font: 400 14px/1.4 var(--f-ui);
}
```

**Fonts:** the app must run fully local (Open Weights Only), so self-host them instead of using the Google CDN:

```bash
pnpm --filter @comfy-osh/studio add @fontsource/instrument-serif @fontsource/pixelify-sans @fontsource/vt323
```

Import them once in `src/main.tsx`: `instrument-serif/400.css`, `pixelify-sans/{400,500,700}.css`, `vt323/400.css`. If a package name fails to resolve, stop and report it. Don't swap in another font.

**Type scale:** use the extremes and skip the middle.

| Use | Font | Size |
|---|---|---|
| Brand "ComfyDial" | Instrument Serif 400 | 50 px (header) |
| Room tabs | Instrument Serif 400 | 34 px |
| Big score / lens numbers | VT323 | 72–84 px |
| Section title bars | Pixelify Sans 700, uppercase, `letter-spacing: .08em` | 12 px |
| Body, buttons | Pixelify Sans 400/500 | 14 px |
| Hints | Pixelify Sans 400, `--ink-2` | 12.5 px |
| Data (frames, seeds, timecode) | VT323 | 16–28 px |

---

## 3. Primitives: add to `styles.css` and reuse them everywhere

| Class | Look | Notes |
|---|---|---|
| `.box` | `--panel` fill, 1 px ink border | Every panel |
| `.box--double` | `border: 4px double var(--ink)` | Hero frames only: viewport, review video, prompt |
| `.box--offset` | `::before` at `inset: 7px -7px -7px 7px`, 1 px `--offset` border, `z-index:-1` | The misprint look. Side panels only. The parent needs `position: relative`, and the page root needs `isolation: isolate` |
| `.titlebar` | Flex row: LABEL · `.rule` (flex 1, 9 px of 1 px stripes every 3 px) · optional `[x]` in VT323 | Top of every `.box`. The `[x]` is decorative (`aria-hidden`) unless it really closes something |
| `.btn` | `--field` fill, 1 px ink border, `--shadow`, min-height 44 px | `.btn.on` = ink fill with paper text. `.btn.spend` = orange fill with ink text |
| `.key` | 44×44 square, VT323 glyph, `--shadow-sm` | Transport, pan, zoom, view keys, take +/− |
| `.toggle` | Joined `.btn`s inside one bordered box | Editor/Camera, Solid/Depth, Dry/Live. Live when on uses orange fill |
| `.tab` (rooms) | Instrument Serif 34 px, no border; hover adds a 1 px border; selected = ink fill, paper text | `TopBar` in `PageBar.tsx` |
| `.tab` (takes) | `--tab-idle`, 1 px border without a bottom edge, joined to the panel below | Selected: `--panel` fill, `box-shadow: inset 0 3px 0 var(--ink)`, 10 px taller |
| `.mark--held` | ■ (9 px ink square) + "HELD" | Status is always shape + word |
| `.mark--drift` | ▲ + "DRIFTED" on an orange fill with ink text | |
| `.mark--advisory` | Dashed 1 px border + text | Move label |
| `.meter` | 22 px bar; fill = ink (orange if any segment drifted); `.gate` = 2 px dashed blue line at 2.75 / 5 = 55% | Rotation error. Gate position comes from the frozen threshold, not a literal |
| `.scrub` | 3-column grid, VT323 labels; drifted cell = 135° orange/`--orange-2` hatch; blue 2 px playhead | Replaces the coloured segment strip |
| `.screen` | Gradient `--screen-0` → `--screen-1` → `--blue` + 1 px scanlines every 3 px | Viewport, video stage, path plot. Text on it is `--screen-text` |
| `.field select` | Square, 1 px ink, `--field`, 44 px, custom ▼ via `::after` | `appearance: none` |
| `input[type=range].ruled` | Track: 12 px, 1 px ink, ticks every 10 px. Thumb: 16×30 ink block | |
| `.counter` | Two VT323 digit cells (52×72 px), ▲▼ keys beside | Take count |
| `.chk` | 26 px checkerboard square | Brand mark in the header, decoration only |

Delete the old flat-dark tokens (`--bg`, `--surface`, `--raise`, …) once nothing references them.

---

## 4. Rooms

### 4.1 Shell (`PageBar.tsx`, `App.tsx`)
- **Header** (`TopBar`): `.chk` · "ComfyDial" (Instrument Serif 50 px) · room tabs (Author / Generate / Review) · spacer · two bracketed status boxes `[ shot id ]` `[ DRY · free ]` or `[ LIVE · about N credits ]`. The bottom border is `4px double`. **Replace the string "Cinema Studio" with "ComfyDial"**: that name is Higgsfield's product.
- The **Next** button keeps working but is styled `.btn.on` (Author → Generate) and is disabled until takes exist (Generate → Review).
- **StatusBar:** paper strip with a 1 px top border, VT323 text; same content as today.

### 4.2 Author (`App.tsx` author page, `Viewport.tsx`, `Timeline.tsx`, `Menu.tsx`, `ItemPanel.tsx`, `ActorPanel.tsx`, `ReferencePanel.tsx`)
| Region | Treatment |
|---|---|
| Left panel (view controls) | `.box.box--offset`, title "VIEW". Wireframe orbit sphere (button, 136 px, ink line art on `--field`, `--shadow`; if no such control exists yet, show the rotate hint only), pan keys in a 3×3 grid, zoom −/+ keys, F/R/T/C view keys (C = camera view; `.on` while in camera view) |
| **Rotate hint** (required) | Shown twice: under the orbit control ("Rotate the scene: **Alt + drag** (**Option + drag** on Mac)") and as a pill inside the viewport, top-left ("Rotate the scene: Alt + drag · Option + drag on Mac"). Hide the viewport pill in Camera view |
| Moves | `.box` with title "MOVES". Presets as tiles (104×66 `.screen` thumbnail + `[n] LABEL`); selected = `4px double` outline + inverted caption. If tiles need new glyph art, a plain `.btn` per preset is fine for now |
| Viewport | `.box--double.box--offset` with the toolbar moved into the title bar (Editor/Camera, Solid/Depth, Undo/Redo as small `.btn`s). The canvas is untouched; overlays (`vp-info`, PiP, legend, checks, rot readout) restyle to `--screen-text`, PiP gets a 1 px paper border |
| Timeline | `.box`, title "TIMELINE" + `121 F · 25 FPS`. Transport `.key`s, VT323 timecode at 28 px, ruler with ink ticks, lanes with dashed borders, keyframes as 14 px ink diamonds (hover: `--authored`), blue playhead |
| Right panel | `.box.box--offset`, title "LENS" (dial + 72 px VT323 focal readout + ruled slider + selects) then title "SCENE" (subject, set, add model, generate actor, hint, checks box with a dashed border) |

### 4.3 Generate (`GeneratePage.tsx`, `RunPanel.tsx`)
| Region | Treatment |
|---|---|
| Shot facts | `.box--offset`, title "THE SHOT", label/value grid with VT323 values |
| Prompt | `.box--double.box--offset`, title bar "PROMPT ····· who · where · what · how it looks"; textarea ruled every 30 px (`repeating-linear-gradient`), Pixelify 16/30. Avoid box below it, plain `.box` |
| Takes | `.box--offset`, title "TAKES": `.counter`, ruled strength slider with a VT323 34 px value, Dry/Live `.toggle`, mode hint, then **Shoot** = full-width 96 px block: ink fill with paper Instrument Serif 40 px text in Dry; **orange fill with ink text in Live**; `4px double` border, 5 px `--offset` shadow; press drops into the shadow |
| Earlier runs | `.box`, table with a 1 px header rule and dashed row rules, LIVE tag = orange fill, Open = `.btn` |

### 4.4 Review (`Review.tsx`, `ContactSheet.tsx`): new layout
```
[#1 3000 0.70° ■HELD][#2 3001 …][#5 3002 1.80° ▲DRIFTED*][…]      ← take tabs (role=tablist)
┌────────────────────────────────────────────┐ ┌──────────────┐
│                                            │ │ TAKE 3002    │
│        VIDEO  (box--double, 3:2)           │ │ 1.80°  meter │
│        about 75% of the width              │ │ seg1 seg2 seg3│
│                                            │ │ [Repair seg 3]│
└────────────────────────────────────────────┘ │ paths (small)│
[⏮][◀][▶][▶][⏭]  F060 / 120     shortcuts      │ [Video][Poses]│
[ SEG 1 1.2° HELD | SEG 2 1.5° HELD |▒SEG 3 3.1° DRIFT▒ ]       │ [Upscale]    │
                                               └──────────────┘
```
- **Take tabs** come from today's `takepick` nav, restyled as folder tabs: rank (VT323 15), seed (VT323 26), rotation (VT323 20), then `.mark`. Keep `[` `]` to switch takes.
- **Video column**: `flex: 999 1 640px`, a `.screen` stage at `aspect-ratio: 3/2`, then transport `.key`s with VT323 timecode, then the `.scrub` strip. **The existing `ErrorChart` stays** (click to scrub): restyle it ink-on-paper and put it under `.scrub`, or merge the two if that's simpler.
- **Side panel**: `flex: 1 1 260px; max-width: 300px`, in this order:
  1. `.box--offset` with title "TAKE <seed>", the verdict mark, the rotation number (VT323 84 px), the "ROTATION ERROR" label, `.meter`, and an axis row "0° · PASS LINE 2.75° (blue) · 5°".
  2. Three segment boxes (drifted = hatch).
  3. Translation / move label rows between dashed rules.
  4. `RepairButton` as `.btn.spend` (keeps its existing confirm flow), or the existing post-repair line.
  5. The camera-paths 3D stage, shrunk into a `.box` with a `.screen` (keep the component; only its container changes).
  6. Download video / poses / `UpscaleButton` as `.btn`s.
- `ContactSheet` (on Generate) uses the same `.tab` + `.mark` vocabulary for its tiles.

---

## 5. Responsive behaviour

Desktop first; **no horizontal page scroll at any width ≥ 360 px**. Wide tables scroll inside their own `overflow-x: auto` box.

| Width | Shell | Author | Generate | Review |
|---|---|---|---|---|
| ≥ 1280 | One-row header | 3 columns: view 232 · main · lens 320 | 3 columns: shot · prompt · takes | Video about 75% + side panel 300 |
| 1024–1279 | Header wraps; status boxes drop to row 2 | Lens panel moves under main (full width, 2-column grid inside) | Takes panel moves under the prompt | Side panel 260; video still on the left |
| 720–1023 | Room tabs shrink to 26 px | View panel becomes a horizontal toolbar above the viewport; viewport min-height 360 | Single column: shot facts as one-line chips | **Side panel moves under the video**, as a 2-column grid (score + segments, then repair + paths + downloads) |
| < 720 | Brand 36 px; tabs fill a row (each `flex: 1`); status boxes hidden behind a `[ i ]` key that toggles them | Moves tiles scroll in a row; timeline lanes keep 34 px; keyframes stay 44 px hit targets (invisible padding) | Shoot button sticks to the bottom of the viewport (`position: sticky; bottom: 0`) | Take tabs become a scroll-snap row; video full width; side panel stacks in one column |

Implement with flex-wrap and `minmax` grids first, plus at most these 3 media queries: `1279px`, `1023px`, `719px`. The offset outline (`.box--offset`) shrinks to 4 px below 720.

---

## 6. Every control responds

| State | Rule | Applies to |
|---|---|---|
| Hover | Invert: ink fill, `--field` text. Tiles and tabs: 1 px outline at 3 px offset | `.btn`, `.key`, `.tab`, tiles, keyframes (fill turns `--authored`) |
| Pressed (`:active`) | `transform: translate(3px,3px); box-shadow: none` (2 px for `.key`) | Everything with a hard shadow |
| Focus-visible | `outline: 2px dashed var(--blue); outline-offset: 4px` | Every focusable element, including canvas wrappers that take keys |
| Selected / on | Ink fill + paper text (`.btn.on`, `.key.on`, room tab); take tab: inset 3 px top rule and taller; tile: `4px double` outline | Toggles, current room, current take, chosen preset |
| Disabled | `opacity: .4; box-shadow: none; cursor: default`; no hover inversion | `.btn:disabled`, Next before takes exist, Redo |
| Busy | Label swaps to `RUNNING…` in VT323, and a 12-step `.meter` fill crawls | Shoot, Repair, Upscale while their request is in flight (use existing state flags) |
| Error | `.box` with orange title bar and ink text; message in Pixelify | Existing `messages` / `errors` lists |
| Spend confirm | Existing confirm step, restyled: the button turns `.btn.spend` with "Confirm · N credits", and a 1 px dashed blue outline pulses in 2 steps | Live Shoot, Repair, Upscale |

**Keyboard:** keep every existing shortcut (Alt+1/2/3, Space, ← →, [ ], G, N, 0/1/3/5/7, Home/End). Tab order goes header → left → main → right. Take tabs follow the ARIA tabs pattern (← → move between tabs when a tab has focus).

---

## 7. Motion

Stepped, never smooth. Wrap everything in `@media (prefers-reduced-motion: no-preference)` and turn it all off otherwise.

| Element | Trigger | Motion | Timing |
|---|---|---|---|
| Buttons, keys, tabs | hover / press | invert / drop into the shadow | instant (no transition) |
| Orbit sphere | hover | wireframe turns | `4s steps(24) infinite` |
| Meter | score arrives | width fills | `500ms steps(12)` |
| Busy meter | while running | crawl | `1.2s steps(12) infinite` |
| Spend confirm | armed | dashed outline blinks | `1s steps(2) infinite` |

---

## 8. Accessibility

- Status is **never colour alone**: ■ held, ▲ drifted, dashed border = advisory, always with a word.
- Contrast (checked): ink on paper about 16:1, `--ink-2` on panel 10:1, blue on panel 6:1, ink on orange 4.9:1. **Never set orange as a text colour.**
- Every icon-only `.key` has an `aria-label`; the decorative `[x]` and `.chk` are `aria-hidden`.
- The meter is `role="img"` with an `aria-label` like "Rotation error 1.80 degrees, pass line 2.75".
- Minimum hit target is 44×44, including keyframe diamonds (pad them with a transparent hit area).

---

## 9. Verification (Playwright, in `src/apps/studio/test/e2e/`)

Use the `webapp-testing` skill or Playwright MCP against `pnpm --filter @comfy-osh/studio dev` with the server in **dry** mode (no credits).

| # | Check | Pass when |
|---|---|---|
| 1 | Screenshot each room at 1440, 1100, 820 and 390 px wide | 12 PNGs saved to `test/e2e/__screens__/`; owner eyeballs them against the drafts |
| 2 | No horizontal page scroll | `document.documentElement.scrollWidth <= innerWidth` in every room at all 4 widths |
| 3 | Fonts loaded | `document.fonts.check('16px "Pixelify Sans"')` (also for VT323 and Instrument Serif) is true, with the network offline |
| 4 | Every interactive element responds | For each `button, a[href], [role=tab], input, select`: tab to it and assert a computed outline exists; hover and assert the background or outline changes; buttons with `:disabled` don't change on hover |
| 5 | Review layout | At 1440 the video box is ≥ 70% of the content width; at 820 the side panel sits below the video |
| 6 | Rotate hint | Text "Alt + drag" and "Option + drag" are visible on Author (Editor view) and the viewport pill is hidden in Camera view |
| 7 | Dry run flow | Author → Generate → Shoot (dry) → Review shows take tabs, and switching a tab changes the side-panel seed |
| 8 | Reduced motion | With `reducedMotion: 'reduce'`, no element has a running animation |

Plus `pnpm -r test && uv run pytest verifier` stays green.

---

## 10. Build order (Step X of 5)

| Step | Do | Done when |
|---|---|---|
| 1 of 5 | Fonts + tokens + primitives in `styles.css`; brand string | App builds; nothing looks broken; check 3 passes |
| 2 of 5 | Shell + Author | Checks 2 and 6 pass for Author |
| 3 of 5 | Generate (+ ContactSheet) | Check 7 passes up to Shoot |
| 4 of 5 | Review new layout | Checks 5 and 7 pass |
| 5 of 5 | Responsive pass + states + motion + all Playwright checks | Checks 1–8 green; screenshots sent to the owner |

Steps 2–4 can run as parallel worktree lanes once step 1 is merged: they share `styles.css`, so **only step 1 edits the primitives**, and lanes add room-scoped rules in clearly marked blocks (`/* === author === */` etc.).

---

## 11. How the drafts were made (for context)

1. **Canvas:** one Design canvas, "Comfy-Dial Bryce UI Drafts", with 4 artboards: Author, Generate, Review (interactive, linked to each other) and a Palette + control sheet. Each artboard is a self-contained `.dc.html` (HTML + a small state class for the toggles, take switching and the repair demo). Copies are in `docs/design/drafts/`.
2. **Round 1, dark stone and brass Bryce skeuomorphism:** rejected as too far from the original.
3. **Round 2, original Bryce palette** (silver chrome, peach spheres, teal, red) with Bricolage Grotesque: rejected on palette and type. Also: nothing may suggest a material editor; the output look comes only from the prompt.
4. **Round 3, current.** Reference board: a VHS/VCR menu, a retro OS UI kit, Win98 Display Properties and Paint, and a "programmatic brutalism" poster. Multiple-choice answers from the owner:
   - Base texture: **programmatic brutalist** (likes the VCR font, prefers the brutalist texture).
   - VCR on-screen display: **nowhere**.
   - Type: **condensed serif** for the ComfyDial name and room tabs; **classic UI sans + pixel mono** for everything else.
   - Review controls: **narrow side panel**, video dominant, take tabs on top.
5. **Kept across all rounds:** the 3-room layout, Alt/Option + drag rotate hint, red/orange = spends credits, yellow authored vs cyan recovered paths on dark screens only.

---

**Parking Lot**
- Real move-preset thumbnails (rendered path glyphs) and a draggable wireframe orbit sphere that drives the camera.
- A shareable "score card" export in this style (Most Viral idea from SPEC).

**Quick next move:** Copy this file to the repo root, then tell Claude Code: "Read DESIGN.md and do Step 1 of 5 only."
