# Setup

Everything below runs from the repo root unless a `cd src` is shown.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node | 22 | the pnpm workspace |
| pnpm | 11 | `pnpm install`, `pnpm -r test` |
| uv | recent | the Python project (`uv sync`, `uv run pytest`) |
| Python | 3.11 | the verifier (uv installs it if missing) |
| **ffmpeg** | any recent build, on `PATH` | rendering the golden clips (`render:golden`) only. Tests do not need it. |

### Install ffmpeg

| OS | Command |
|---|---|
| macOS | `brew install ffmpeg` |
| Debian / Ubuntu | `sudo apt install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |

Check it with `ffmpeg -version`. If it is missing, `render:golden` stops with a one-line install hint.

## Install and test

```bash
cd src
cp .env.example .env      # fill COMFY_API_KEY / COMFY_BASE_URL
pnpm install && uv sync
pnpm -r test && uv run pytest verifier
```

## Golden clips

The golden clips are generated, not committed. Only each clip's `.meta.json` is tracked; the `.rgb.mp4` and `.depth.mp4` files are git-ignored.

```bash
cd src
pnpm --filter @comfy-dial/rig-core render:golden   # about 1 minute, needs ffmpeg
```

Output goes to `src/tests/golden/clips/`.
