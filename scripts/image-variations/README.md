# image-variations

Generate several variations of one reference image with Grok (xAI), randomly
sampling a pose / hairstyle / outfit / background from your own prompt option
patterns.

One reference image in, N images out - each with a different randomly drawn
combination, a manifest recording exactly which options produced which file,
and a fixed seed so any run can be reproduced.

Two front ends over the same engine: a CLI, and an installable web UI (PWA)
served by a small local server - see [Web UI](#web-ui-pwa).

## Requirements

- Node.js >= 18 (uses the built-in `fetch`; no dependencies)
- An xAI API key

```bash
export XAI_API_KEY="xai-your-real-key"
```

Every command below is run from the repository root.

## Usage

```bash
# 8 variations from one reference image
node scripts/image-variations/cli.js --image ./ref.png --count 8

# See the prompts and the request body without spending anything
node scripts/image-variations/cli.js --image ./ref.png --count 8 --dry-run

# Vary only the background, keep pose / hair / outfit fixed
node scripts/image-variations/cli.js --image ./ref.png -n 6 --only background

# Reproduce an earlier run exactly
node scripts/image-variations/cli.js --image ./ref.png -n 6 --seed 3f9a1c2b7d04
```

### Options

| Flag | Meaning |
|------|---------|
| `-i, --image <path\|url>` | Reference image. Repeat for up to 5. |
| `-n, --count <number>` | How many variations (default 4) |
| `-c, --config <path>` | Your prompt-pattern config (default: bundled preset) |
| `-o, --out <dir>` | Output directory (default `./out/image-variations/<timestamp>`) |
| `-s, --seed <string>` | Seed for reproducible sampling |
| `--lock <a,b>` | Sample these categories once and reuse them |
| `--only <a,b>` | Vary only these; lock everything else |
| `--concurrency <n>` | Parallel requests (default 2) |
| `--model <id>` | Override the model |
| `--endpoint <url>` | Override the endpoint |
| `--dry-run` | Print prompts and the request body, call no API |
| `--json` | Print the run manifest as JSON |

## Bundled presets

| Preset | Categories | Combinations | For |
|--------|-----------|--------------|-----|
| `selfie-amateur` | pose 15, angle 10, setting 10 | 1,500 | An amateur phone selfie of the person in the reference |
| `edit-all` | pose 10, background 10, outfit 10, color 10 | 10,000 | Change pose, background, outfit and outfit colour at once |
| `edit-pose` | pose 10 | 10 | Change only the pose, keep the rest of the photo |
| `edit-background` | background 10 | 10 | Change only the background |
| `edit-outfit` | outfit 10 | 10 | Change only the outfit |
| `edit-outfit-color` | color 10 | 10 | Recolour the outfit, keep its shape and fabric |
| `character-variations` | pose 8, hair 6, outfit 7, background 7 | 2,352 | The original sample set |

The `edit-*` presets share a preamble that holds the person's identity, keeps
an obscured face obscured, and forbids added text or watermarks. The
single-axis ones exist because "change only the pose" and "change the pose,
the background and the outfit" are different instructions: combining the
single-axis wordings into one prompt would contradict itself.

Only `character-variations` carries a `wire` block; the rest inherit the
defaults in `lib/config.js`, so a wire-format correction is a one-place edit.

## Your prompt patterns

Everything that varies lives in a JSON config. Copy the bundled preset and
replace the option lists with your own:

```bash
cp scripts/image-variations/presets/character-variations.json ./my-patterns.json
node scripts/image-variations/cli.js -i ./ref.png -c ./my-patterns.json -n 8
```

```json
{
  "name": "my-patterns",
  "base": "the same character as the reference image, preserving facial features and identity exactly",
  "template": "{base}, {pose}, {hair}, {outfit}, {background}, {style}",
  "fixed": {
    "style": "high quality illustration, soft natural lighting"
  },
  "categories": {
    "pose": ["standing with arms crossed", "sitting on a chair"],
    "hair": ["long straight hair", { "text": "high ponytail", "weight": 3 }],
    "outfit": ["casual blouse and jeans", "navy school uniform"],
    "background": ["plain grey studio backdrop", "sunlit city street"]
  }
}
```

- **Category names are free.** Add `expression`, `camera_angle`, `lighting` -
  anything - then reference it as `{expression}` in `template`.
- **Options** are plain strings, or `{ "text": "...", "weight": 3 }` to make an
  option appear more often. An optional `"label"` gives it a shorter name in
  output filenames.
- **`template`** controls the final prompt. A placeholder that matches no
  category, `fixed` entry, or `base` is rejected at load time rather than
  silently rendering as literal text.
- **`fixed`** holds values that never vary (style, quality wording).

### Naming a category for the reader

Template placeholders are ASCII (`{pose}`), but a category can show a
different name in the web UI:

```json
{
  "categories": { "pose": ["..."], "angle": ["..."] },
  "labels": { "pose": "ポーズ", "angle": "画角" }
}
```

Output filenames come from each option's `label`, so give the options an
ASCII slug when their text is not ASCII:

```json
{ "label": "cheek-touch", "text": "片手を頬に軽く添える" }
```

Without a label the slug is derived from the text, which for non-ASCII text
collapses to `na`.

## Output

```text
out/image-variations/2026-09-19T10-12-33/
  001_background-sunlit-city__pose-arms-crossed.png
  002_background-quiet-cafe__pose-sitting-on-a-ch.png
  ...
  manifest.json   which options produced which file, plus seed and model
  prompts.md      the same thing as a readable sheet
```

Filenames show only the categories that actually varied, so a `--only pose`
run reads as `001_pose-...`.

The sampler avoids repeating a combination while distinct ones remain. If you
ask for more variations than your patterns can produce, it says so and lets
prompts repeat.

## Adjusting the API wire format

The request shape lives in `wire`, so a change on xAI's side is a config edit
rather than a code change:

```json
"wire": {
  "model": "grok-imagine-image-2.0",
  "generateEndpoint": "https://api.x.ai/v1/images/generations",
  "editEndpoint": "https://api.x.ai/v1/images/edits",
  "imageField": "image",
  "imageStyle": "object",
  "responseFormat": "b64_json"
}
```

- `editEndpoint` is used whenever `--image` is given; `generateEndpoint`
  otherwise.
- `imageStyle: "object"` sends `[{ "type": "image_url", "url": "data:..." }]`;
  `"url"` sends bare strings instead.
- Anything under `request` (for example `"quality"`, `"aspect_ratio"`) is
  merged verbatim into the body.

Run `--dry-run` to see the exact body before sending anything.

## Web UI (PWA)

The same engine behind a browser UI, for running it from a phone or without a
terminal. A small local server holds the key and talks to xAI; the page never
sees a credential.

Run it from the repository root, with your own key in place of the
placeholder:

```bash
cd /path/to/everything-claude-code
export XAI_API_KEY="xai-your-real-key"
node scripts/image-variations/web/server.js
# -> http://127.0.0.1:8787/
```

Open that URL and the browser offers to install it as an app (Chrome: *Install*
in the address bar; Safari: *Share -> Add to Home Screen*). Installed, it keeps
the reference image, the settings and the last run in IndexedDB, and the shell
loads offline - generating still needs the server running.

| Option | Meaning |
|--------|---------|
| `-p, --port <n>` | Port to listen on (default `8787`) |
| `--host <addr>` | Address to bind (default `127.0.0.1`, loopback only) |
| `--presets <dir>` | Directory of preset JSON files (default `../presets`) |
| `--token <value>` | Fixed access token for non-loopback binds (default: random) |

### Reaching it from a phone

```bash
node scripts/image-variations/web/server.js --host 0.0.0.0
```

Binding beyond loopback puts an API-key-holding proxy on the network, so the
server then mints an access token and prints the URL carrying it
(`http://<lan-ip>:8787/?t=...`). The page adopts the token on first load,
stores it per origin and strips it from the address bar; `/api/*` rejects
requests without it. The static shell stays open, since it holds nothing.

Two things to expect over a LAN address:

- **It will not install as an app.** Service workers need a secure context, and
  `http://192.168.x.x` is not one. The page itself works normally; only the
  install and offline shell are unavailable. Put it behind HTTPS (a tunnel such
  as Tailscale or cloudflared) to get those back.
- **Anyone on that network who has the token can spend your API budget.** Stop
  the server when you are done.

### Language

The UI ships in Japanese and English and follows the browser, so a Japanese
browser opens in Japanese with no setup. The switch in the header overrides
that and the choice is remembered per origin.

Only the interface is translated. Text quoted from the image API is passed
through verbatim, because a diagnostic is more useful unmangled than
translated - as are your own category names, which read exactly as you spell
them in the preset. To add a language, add a block to `DICTIONARIES` in
`web/public/i18n.js`; `tests/image-variations/web-i18n.test.js` fails if a
key or a `{placeholder}` is missing from it.

### What the UI does

- Reads the reference images in the browser and sends them as data URIs only
  when you generate; `/api/generate-one` accepts nothing but `data:image/*`, so
  a request can never name a path on disk.
- **Preview prompts** runs the sampler only - no API call, no cost.
- Switching a category off holds it fixed, the UI equivalent of `--only`.
- Generates two at a time, filling each tile as it arrives, and reports a
  failed variation on its own tile instead of losing the run.
- Shows the seed of every run so it can be typed back in to reproduce it.

To change the icons, edit and re-run `node scripts/image-variations/web/make-icons.js`.

## Notes

- The API key is read from `XAI_API_KEY` (or `GROK_API_KEY`) and is never
  written to the manifest or the logs.
- Failures are per-image: one rejected prompt does not abort the run, and the
  reason is recorded in the manifest. The exit code is 1 only if every
  variation failed.
- Requests retry with exponential backoff on 429 and 5xx responses.
- Use reference images you have the rights to.

## Tests

```bash
node tests/image-variations/sampler.test.js
node tests/image-variations/config.test.js
node tests/image-variations/prompt.test.js
node tests/image-variations/xai.test.js
node tests/image-variations/io.test.js
node tests/image-variations/cli.test.js
node tests/image-variations/web-api.test.js
node tests/image-variations/web-server.test.js
node tests/image-variations/web-i18n.test.js
```

They all run as part of `node tests/run-all.js`; no test makes a network call.
