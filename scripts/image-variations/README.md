# image-variations

Generate several variations of one reference image with Grok (xAI), randomly
sampling a pose / hairstyle / outfit / background from your own prompt option
patterns.

One reference image in, N images out - each with a different randomly drawn
combination, a manifest recording exactly which options produced which file,
and a fixed seed so any run can be reproduced.

## Requirements

- Node.js >= 18 (uses the built-in `fetch`; no dependencies)
- An xAI API key

```bash
export XAI_API_KEY="xai-..."
```

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
```

They all run as part of `node tests/run-all.js`; no test makes a network call.
