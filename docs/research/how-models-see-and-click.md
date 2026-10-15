# Research — how well models see and click

Date: 2026-10-15 · Status: research note, not a decision · Resolves [#69](https://github.com/amitbaz/music-production-ai-mentor/issues/69), part of the map [#67](https://github.com/amitbaz/music-production-ai-mentor/issues/67) (the mentor's eyes and hands in Live)

The question, in three parts: (1) for each provider whose models can be on the supported list (a window of at least 1,000,000 tokens, [ADR 0019](../adr/0019-only-supported-models-with-a-1m-window.md)), can an image go back inside a tool result, in what format and size, and at what token cost; (2) what a provider's own computer-use tool gives over neutral tools (`screenshot`, `click(x, y)`) that any model can call, and whether the neutral path loses accuracy; (3) what is published or measurable about reading a value off a screenshot (a knob, a slider, an EQ curve), clicking a small control, and mapping between the image and a Retina screen.

The sibling note for hearing, [what-a-model-can-hear.md](https://github.com/amitbaz/music-production-ai-mentor/blob/research/model-hearing/docs/research/what-a-model-can-hear.md) (branch `research/model-hearing`), answered the same question for audio; this note follows its shape. The model is interchangeable, so a feature only one provider has cannot be the only way.

Docs were read on 2026-10-15. No paid API was called.

Markers: **[verified]** read in the linked primary source during this research · **[paper]** a published paper, reported as it states it · **[vendor]** a provider's own benchmark claim, not independently checked · **[third-party]** a secondary source · **[local]** measured on the dev machine · **[code]** read in this repo · **[inferred]** my conclusion from the facts above it · **[unverified]** could not confirm.

## Short answer

- **All three providers take an image inside a tool result**, through the API shape our adapters already use or would use: Anthropic `tool_result` with `image` blocks; OpenAI Responses `function_call_output` with an array of image objects; Gemini `functionResponse.parts[]` with `inlineData` (Gemini 3 series, which includes `gemini-3.5-flash-lite`, the model on the list today). PNG, JPEG and WebP work everywhere. **[verified]**
- **A look at a plug-in window costs about 1,100–2,100 tokens**, which is between $0.0002 and $0.02 depending on the model. A Retina capture of an 800 × 500-point window (1600 × 1000 pixels) is 2,088 tokens on Claude 5.5, 1,920 on GPT-6 Astra, and a flat 1,120 on Gemini at its default resolution. **[verified]** rules, **[inferred]** arithmetic, checked against the providers' worked examples.
- **Each provider counts and shrinks images differently**, and two of them can refuse an image instead of shrinking it. The harness should resize every capture itself, to a size it knows the model will not change, and keep the scale so a click lands where the model pointed. **[verified]** for the rules, **[inferred]** for the design.
- **The neutral path is viable and should be the main path.** OpenAI now recommends an ordinary function tool (code execution that returns screenshots) over its own `computer` tool for GPT-6 Astra. Gemini's computer-use tool lets you exclude its built-in actions and add your own. Anthropic's toolset brings a schema trained into the model, a `zoom` action and screenshot scanning for prompt injection, at a cost of about 4,500 input tokens per request. **No published comparison measures native against neutral accuracy**, so the eval must. **[verified]** for the docs, **[unverified]** for the accuracy gap.
- **The one real difference between providers is the coordinate format.** Claude "does not work well" with normalised coordinates and wants pixels in the image it sees; Gemini's computer use and bounding boxes are normalised to 0–999 or 0–1000. A neutral `click` needs the adapter to choose the coordinate format for each model. **[verified]** for both docs, **[inferred]** for the consequence.
- **Reading a printed number is much more reliable than reading where a knob points.** MeasureBench (CVPR 2026, models from 2025): the best model read digital displays at up to 80 % but dials and linear scales at about 10–32 %. No benchmark covers plug-in knobs or EQ curves, and current models publish chart-reading scores (CharXiv 86 %, Chartography 89 %) but no dial-reading scores. Prefer the value text the plug-in shows (a value label, a hover readout) and treat a value read from a knob's angle as an estimate. **[paper]** and **[vendor]**, **[inferred]** for the advice.
- **Clicking small controls in professional apps is the weak spot, and zooming in fixes much of it.** On ScreenSpot-Pro, targets average 0.07 % of the screenshot. FL Studio is one of its 23 apps. On FL Studio the best entries on the official leaderboard hit 65–67 %, and icons only 48–65 %; every top entry zooms in. The supported frontier models are not on the official leaderboard. **[paper]**, **[verified]** for the leaderboard data.
- **Retina: a capture is twice the size of the points that clicks use.** On the dev machine the screen is 1728 × 1117 points at a backing scale of 2. Map image pixel → window point → global point, with one scale per capture. **[local]** and **[verified]**.

## Part 1 — images in a tool result, by provider

Only providers with 1M-window models are in the table (ADR 0019). Prices are standard tier, per 1,000,000 input tokens, USD, on 2026-10-15.

| | Anthropic (Claude Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5; all 1M) | OpenAI (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-*`, `gpt-5.5`, `gpt-4.1`; ≈1.05M) | Google (`gemini-3.5-flash-lite` on the list today, `gemini-3.8-flash`, `gemini-4-argon` and others; 1,048,576) |
| --- | --- | --- | --- |
| Image in a tool result | Yes: `tool_result.content` may hold `image` blocks (base64, URL or Files API id) **[verified]** | Yes, in the Responses API: "For functions that return images or files, you can pass an array of image or file objects instead of a string" in `function_call_output` **[verified]**. Chat Completions not checked **[unverified]** | Yes, for "Gemini 3 series models": `FunctionResponse.parts[]` of `FunctionResponsePart`, each an `inlineData` blob with `mimeType` and base64 `data` (`generateContent`), or `image` blocks in a `function_result` (Interactions) **[verified]** |
| Formats | JPEG, PNG, GIF, WebP; animations use only the first frame **[verified]** | PNG, JPEG, WebP, non-animated GIF **[verified]** | PNG, JPEG, WebP, HEIC, HEIF **[verified]** |
| Size limits | 8000 × 8000 px; 10 MB base64 each (5 MB on Bedrock and Google Cloud); 600 images per request on 1M models; **over 20 images in one request, every image must be ≤ 2000 px a side** (counts images in earlier turns and inside `tool_result`) **[verified]** | 512 MB per request; at most 30,000 patches per image after resizing, else the request is rejected **[verified]** | 3,600 images per request; whole request with inline bytes ≤ 20 MB **[verified]** |
| How it counts | 28 × 28-px patches: `⌈w/28⌉ × ⌈h/28⌉` tokens. Claude 4.7 and later (every model above): long edge ≤ 2576 px and ≤ 4,784 tokens; older ones 1568 px and 1,568 tokens. Larger images are shrunk, then padded to a multiple of 28 **[verified]** | 32 × 32-px patches × a model multiplier (1.2 for `gpt-6-astra`, `gpt-5.6-*`, `gpt-5.5`); `detail` sets the budget: `high` up to 2,500 patches, `original` keeps the size (`gpt-6-astra`, `gpt-5.6-*`; `gpt-5.5` caps it at 10,000 patches and 6000 px). `gpt-4.1` is still tile-based: 85 + 170 per 512-px tile **[verified]** | A fixed budget per image, not per pixel, on Gemini 3 and 4: default 1,120 tokens; `low` 280, `medium` 560, `high` 1,120, `ultra_high` 2,240. `ultra_high` is "per content item only" and "recommended for … computer use" **[verified]** |
| Will it shrink or refuse? | Shrinks a normal image; **refuses** an oversized image returned to the computer-use toolset ("the API doesn't downscale for you") **[verified]** | Shrinks to the detail budget; **refuses** past 30,000 patches **[verified]** | Shrinks to the budget **[verified]**; the pixel size it shrinks to is not stated **[unverified]** |
| Price | Fable 5.1 $10; Opus 5.5 $4; Sonnet 5.5 $2; Haiku 5.5 $0.10 (prompts ≤ 100k) **[verified]** | `gpt-6-astra` $10; `gpt-6.1-sol` and `gpt-6-sol` $2; `gpt-5.6-luna` $0.20; `gpt-6-luna` $0.10 **[verified]** | `gemini-3.5-flash-lite` $0.30; `gemini-3.8-flash` $0.75 ($1.50 from 2027-01-01), as verified the same day for the hearing note **[verified]** |
| Stated limits | "very small images under 200 pixels" may be misread; "coordinate and localization outputs are approximate" **[verified]** | "struggles with tasks requiring precise spatial localization"; may "struggle to understand graphs … where colors or styles … vary" **[verified]** | none stated on the page beyond the media-resolution trade-off **[verified]** |

A Gemini detail that matters to our adapter: `media_resolution` can be set per part on a normal `Part`, but `FunctionResponsePart` has only `inlineData`, with no `mediaResolution` field. Through `generateContent`, an image inside a function response therefore gets the request-wide setting, and `ultra_high` (per item only) is out of reach. Sending the capture as a separate user `Part` next to the function response would allow it. **[verified]** for the fields, **[inferred]** for the consequence and the workaround.

### What a look costs

The token counts below follow each provider's published rule. The code reproduces the providers' own worked examples exactly: Claude's 1920 × 1080 → 1456 × 819 and 1075 × 1520 → 924 × 1307, and OpenAI's 2048² → 3,000 tokens and 1024² → 1,229. **[inferred]**

| Capture | Claude 5.5 (high-res tier) | GPT-6 Astra, `detail: original` | Gemini 3.x, default |
| --- | --- | --- | --- |
| Plug-in window 800 × 500 pt at 1× (800 × 500 px) | 522 | 480 | 1,120 |
| Same window at Retina 2× (1600 × 1000 px) | 2,088 (no shrink) | 1,920 | 1,120 (shrunk to an unstated size) |
| Live's main window, full screen at 1× (1728 × 1117 px) | 2,480 | 2,268 | 1,120 |
| Full screen at Retina 2× (3456 × 2234 px) | 4,730 after shrinking to 2383 × 1540 | 9,072 (`high`: 2,976 at 1980 × 1279) | 1,120 |
| A zoom crop of 300 × 200 pt at 2× (600 × 400 px) | 330 | 297 | 1,120 (`low`: 280) |

The 2× plug-in window per look, in dollars: Opus 5.5 $0.0084, Sonnet 5.5 $0.0042, Haiku 5.5 $0.0002; GPT-6 Astra $0.019, GPT-6.1 Sol $0.0038, GPT-6 Luna $0.0002; Gemini 3.5 Flash-Lite $0.00034, 3.8 Flash $0.00084. **[inferred]** from the verified rates.

What this means for the harness:

- **Our summariser starts at 100,000 tokens** ([ADR 0018](../adr/0018-a-long-conversation-is-summarised.md)). At about 2,000 tokens a look, about 50 looks reach it on their own. A turn that looks before and after each of many changes will summarise often unless old captures are dropped from what is sent. **[code]** for the threshold, **[inferred]** for the rest.
- **The conversation-size estimate counts characters** (`messageChars` in `packages/harness/src/conversation-size.ts`), and `Tool.run` returns a string. A base64 PNG counted as text would read as hundreds of thousands of "tokens". An image needs its own part in a tool result and an adapter-supplied token estimate (the formulas above), the same media-part change the listening map needs for audio. **[code]** and **[inferred]**
- **Claude's 20-image rule** means a long session that keeps every capture must keep each one ≤ 2000 px a side, or prune. Anthropic's own advice for computer-use loops is to prune older screenshots and cache the rest. **[verified]**

## Part 2 — provider computer-use tools versus neutral tools

| | Anthropic `computer_toolset_20260801` | OpenAI `computer` tool | Gemini `computer_use` tool | Neutral tools (`screenshot`/`look`, `zoom`, `click(x, y)`, …) |
| --- | --- | --- | --- | --- |
| Status | GA on the Claude API and Google Cloud; Claude 5.5 models accept only this version there **[verified]** | Supported; the guide's example uses `gpt-6.1-sol`; for GPT-6 Astra OpenAI "recommend[s] code execution" instead **[verified]** | "Preview"; on `gemini-4-argon`, `gemini-3.8-flash` (recommended), `gemini-3.5-flash-lite` and `gemini-3-flash-preview`; browser, mobile and desktop environments **[verified]** | Any model that takes images in a tool result, so every provider above **[inferred]** |
| Coordinates | Pixels in the screenshot you return; no display size is declared **[verified]** | Pixels in the screenshot; the guide says use `detail: "original"` and map back if you downscale **[verified]** | Normalised 0–999 for `x` and `y`; the client denormalises against its screen size **[verified]** | Whatever we choose; see below |
| What it gives | 17 member tools whose schema "is built into Claude's model and can't be modified"; a `zoom` member that returns a region at full resolution; classifiers that scan screenshots for prompt injection; batch actions **[verified]** | `click`, `double_click`, `drag`, `move`, `scroll`, `keypress`, `type`, `wait`, `screenshot` **[verified]** | Predefined actions with an `intent` field; `excluded_predefined_functions` plus your own functions; opt-in prompt-injection detection **[verified]** | One schema in our repo; captures limited to Live's windows (a map preference); a `zoom` we write ourselves |
| What it costs or limits | About 4,500 extra input tokens per request (about 410 of them for `zoom`); `screenshot` is defined as "capture the full display"; results may hold only text and images; Claude API, Google Cloud and (beta) Bedrock only **[verified]** | OpenAI only **[verified]** | Gemini only; the docs' examples use the Interactions API, while `generateContent` also has a `computerUse` tool field **[verified]** | The model has not been trained on our schema **[inferred]** |

**Does the neutral path lose accuracy?** Nothing published measures it. **[unverified]** What the docs do say:

- OpenAI, for its strongest model, recommends a plain function tool that runs PyAutoGUI or Playwright and returns text or images in `function_call_output` over its own `computer` tool. That is the neutral pattern, endorsed by the provider. **[verified]**
- Gemini's tool is built to be mixed with custom functions, and its desktop action set (`click`, `drag_and_drop`, `scroll`, `take_screenshot`, …) maps one-to-one onto neutral tools. **[verified]** Its model is trained on normalised coordinates, in computer use and in bounding boxes ("normalized to 0-1000"). **[verified]** A neutral `click` that asks Gemini for pixels may be less accurate than one that asks for 0–999. **[inferred]**
- Claude "works best with absolute pixel coordinates" and "does not work well when you ask for normalized coordinates"; its coordinates are pixels "in the image Claude sees", after any resize. **[verified]** So the same neutral `click` must ask Claude for pixels.
- Anthropic's toolset gains a trained schema, a trained habit of zooming, and injection scanning. A neutral `zoom` gives the first two in part. Prompt-injection scanning matters less here, because the eyes see only Live's windows. **[verified]** for the features, **[inferred]** for the weighing.
- Anthropic's own tips on clicks apply either way: put the instruction before the screenshot; when "clicks land in the right area but miss the target", the cause is a very small target or detail lost to downscaling, and the fix is zoom or cropping. **[verified]**

**So:** neutral tools are the path, and the coordinate format is an adapter property (pixels in the last image for Claude and OpenAI, 0–999 for Gemini), stated in the `click` description the adapter sends. That fits [ADR 0003](../adr/0003-own-neutral-message-format.md): the neutral format stays neutral, and each adapter translates. A provider's native tool stays an optional later step, if the eval shows a gap. **[inferred]**

## Part 3 — accuracy: reading values and clicking small controls

### Reading a value

| Evidence | What it says | Marker |
| --- | --- | --- |
| **MeasureBench** ([arXiv 2510.26865](https://arxiv.org/abs/2510.26865), CVPR 2026; 2,442 questions, scored by whether the reading falls in an accepted interval) | "the best model achieving only 30.2% accuracy on the real-world set and 26.3% on the synthetic set" (Gemini 2.5 Pro); units are > 90 % right, values are not; "Digital displays are much easier (e.g., up to 80.2%)", while "Dial and linear instruments remain challenging (typically 10-32%)". Errors are "one minor tick left/right". Single-needle dials with sparse ticks are the easier dials. Models tested: GPT-5, GPT-5-Mini, Claude Opus 4.1, Claude Sonnet 4, Gemini 2.5 Pro and Flash, and others | **[paper]** |
| **CharXiv Reasoning** (charts from papers) | Gemini 3.8 Flash 86.2 % with no tools, "results as of September, 2026" | **[vendor]** [model card](https://deepmind.google/models/model-cards/gemini-3-8-flash/) |
| **Chartography** ("visual chart recognition") | Claude Opus 5.5 89.0 %, Fable 5.1 88.4 %, Opus 5 83.4 %, all "with tools" | **[vendor]** [Opus 5.5 announcement](https://www.anthropic.com/news/claude-opus-5-5) |
| Provider docs | Claude: "very small images under 200 pixels" are error-prone. OpenAI: "Small text: Enlarge text within the image"; `original` detail for "small-object detection". Gemini: `high` for "chart reading" | **[verified]** |

Reading for the mentor:

- **A plug-in knob is a dial, and dials are where models were weakest** (10–32 % on 2025 models, with misses of one tick). Current models are better at charts, but no published benchmark measures dial reading on them. A value read from a knob's angle is an estimate until the eval says otherwise. **[inferred]**
- **Many plug-ins print the value**: a label under the knob, a readout while hovering or dragging, a parameter display. That is the "digital" case, which was 80 % even on 2025 models and is OCR at heart. The hands can make a readout appear (hover, or open a value field) before the eyes read it. **[inferred]**; which of the proof-case plug-ins show values this way is **[unverified]**.
- **An EQ curve is a chart with log-frequency and dB axes.** CharXiv and Chartography say current models read charts well, but both are vendor-run, and neither measures how far off a read gain or frequency is. The prototype should score the error in dB and in octaves, not just right or wrong. **[inferred]**
- **Reading is never the only source when the API has the number.** The map's standing preference (API first) already means the eyes read only what ableton-js cannot. The read-back check after a change, though, can compare the eyes against the API wherever both exist; that gives the eval free ground truth. **[inferred]**

### Clicking a small control

| Evidence | What it says | Marker |
| --- | --- | --- |
| **ScreenSpot-Pro** ([arXiv 2504.07981](https://arxiv.org/abs/2504.07981)) | 23 professional apps on 3 operating systems, among them "FruitLoops Studio (music production)"; "targets in ScreenSpot-Pro occupy 0.07% of the screenshot area on average" (2.01 % in the older ScreenSpot); at release the best model reached 18.9 %, and a search that narrows the area ("ScreenSeekeR") reached 48.1 % "without any additional training". Accuracy falls as targets shrink | **[paper]** |
| **ScreenSpot-Pro official leaderboard** ([data](https://gui-agent.github.io/grounding-leaderboard/results/screenspot_pro.json), read 2026-10-15) | Top overall 85.1 % (a cascade of grounding models with zoom). On FL Studio (57 targets: 31 icons, 26 text) the best are 64.9–66.7 %; icons 48–65 %, text up to 85 %. Every entry above 80 % overall zooms in. The general models listed are old: "Claude (Computer Use)" 17.1 %, "GPT5-minimal (resized)" 18.5 % | **[verified]** for the data, **[inferred]** for the FL Studio counts (from the fractions) |
| Vendor launch tables | Gemini 3 Pro 72.7 % on ScreenSpot-Pro (Nov 2025), as reproduced by others. None of the supported models' current cards reports ScreenSpot-Pro | **[third-party]** for the number; the absence is **[verified]** for the Gemini 3.8 Flash card and the Opus 5.5 announcement |
| **OSWorld** (whole tasks, not single clicks) | Opus 5.5 81.8 % (OSWorld 2.1, partial score); GPT-6 Astra 72.6 % (OSWorld 2.0, as reported by others); Gemini 3.8 Flash 59.0 % (OSWorld-2.0, partial score). The versions and harnesses differ, so these numbers are not comparable | **[vendor]** for Anthropic and Google, **[third-party]** for OpenAI (its launch page refused the fetch) |
| Anthropic's computer-use docs | Among the older-tool models, Sonnet 4.6 is "more mechanically precise at clicking" than Opus 4.6, and Opus 4.7 is "roughly comparable" with less downscaling needed | **[verified]** |

Reading for the mentor:

- A plug-in window is ScreenSpot-Pro's hard case: small icons, custom-drawn controls, and FL Studio, the one DAW in the set, scores below the average. **Zoom is the lever every top result uses.** The neutral tool set needs a `zoom(region)` that returns a Retina-resolution crop, and the system prompt should say to zoom before clicking anything small. **[inferred]**
- No published number covers the supported models clicking small controls, so the proof-case eval has to produce it: hits within the control's bounds, over several runs, with and without zoom. **[inferred]**
- A click that matters (a knob drag, a band toggle) should be followed by a look, or by an API read where one exists, before the mentor says it is done. This feeds the map's open question about looking before and after every change by hand. **[inferred]**

## Part 4 — image to screen, and Retina

- macOS: `NSScreen.backingScaleFactor` is "the number of backing store pixels corresponding to each linear unit in screen space". `CGDisplayBounds` gives a display "in the global display coordinate space (relative to the upper-left corner of the main display)". `SCContentFilter.pointPixelScale` is "the scaling factor used to translate screen points into pixels". **[verified]** ([backingScaleFactor](https://developer.apple.com/documentation/appkit/nsscreen/backingscalefactor), [CGDisplayBounds](https://developer.apple.com/documentation/coregraphics/cgdisplaybounds(_:)), [pointPixelScale](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/pointpixelscale))
- Anthropic, on macOS: "Retina displays capture screenshots at a device pixel ratio of 2, so the image is twice the resolution of the logical screen coordinates. Either downscale the screenshot by 2x before sending, or halve the coordinates Claude returns." **[verified]**
- Dev machine: built-in Liquid Retina XDR, 3456 × 2234 pixels, main screen 1728 × 1117 points, `backingScaleFactor` 2. A full-screen capture would be 3456 × 2234. **[local]**
- `screencapture -l <windowid>` captures one window, `-o` drops the shadow, `-r` drops the DPI metadata. **[local]** (`man screencapture`). Whether a capture with the shadow changes the window's pixel origin: **[unverified]**. Use `-o`.

The mapping a `click` tool needs, for a capture of a window whose top-left is at `(wx, wy)` points and width `ww` points, sent to the model at `iw` pixels wide (the same for y):

```
point_x = wx + x_image × (ww / iw)        // pixels in the image the model saw
point_x = wx + (x_norm / 1000) × ww       // Gemini's 0–999
```

`iw` must be the size **after our resize and before any provider padding**: Claude pads to a multiple of 28, and dividing by the padded size "scales every coordinate by a small amount". **[verified]** for the padding, **[inferred]** for the formula. Because we choose the size the model sees and make sure no provider shrinks it again, the scale is known exactly. That is the reason to resize ourselves rather than let a provider do it. **[inferred]**

Sizes to send, by default: the window at 2× only while it stays inside the model's no-shrink limit (Claude 2576 px and 4,784 tokens; OpenAI's patch budget for the `detail` sent; Gemini always a fixed budget, so smaller is no cheaper there). Otherwise the window at 1×, with `zoom` crops at 2× for small text and small controls. **[inferred]**

## What this means for the map

1. **A media part in a tool result is needed and all three providers support it.** It is the same harness change as the listening map's audio part: decide it once. Each adapter maps the part to its provider's shape (Claude `image` block, OpenAI `function_call_output` array, Gemini `functionResponse.parts[].inlineData`), and supplies a token estimate for it, so that ADR 0018's size check stays honest. **[inferred]**
2. **Neutral tools, not a provider's computer-use tool**: `look(window)` (Live's main window or one plug-in window, never the whole screen), `zoom(region)`, `click(x, y)`, `drag`, `scroll`, `type`, `key`. They reach every supported provider; OpenAI itself recommends this shape for its top model. **[inferred]**
3. **The coordinate format belongs to the adapter**: pixels in the last image for Claude and OpenAI, 0–999 for Gemini. The tool takes the coordinates and the capture's recorded scale and maps them to screen points. **[inferred]**
4. **The harness resizes every capture to a size the provider will not change**, and keeps it. On Claude this is required, not optional: an oversized image in a computer-use result is refused. **[verified]** for Claude, **[inferred]** as the rule.
5. **Cost of a look is small** (≤ $0.02, mostly ≤ $0.01). The real limit is the 100,000-token summary threshold: drop or summarise old captures rather than carrying them. **[inferred]**
6. **What the eval must measure**, since nothing published does: (a) value reads on the proof-case plug-ins, split by printed value versus knob angle, with the error size; (b) EQ-curve reads, error in dB and octaves; (c) click hits on small controls, with and without `zoom`; (d) on Claude and Gemini, neutral tools against the native tool on the same cases. Several runs each, as `AGENTS.md` asks. **[inferred]**

## Sources

Provider documentation, read 2026-10-15:

- Anthropic: [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) (formats, limits, 28-px patches, tiers, 20-image rule, limitations); [Coordinates and bounding boxes](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates) (resize rule, padding, "absolute pixel coordinates"); [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) (`computer_toolset_20260801`, members, `zoom`, sizing, Retina note, 4,500-token overhead, tips, limitations); [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) (images in `tool_result`); [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference) (client toolsets); [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) (1M windows); [Pricing](https://platform.claude.com/docs/en/about-claude/pricing); [Claude Opus 5.5 announcement](https://www.anthropic.com/news/claude-opus-5-5) (2026-09-22; OSWorld 2.1, Chartography).
- OpenAI: [Images and vision](https://platform.openai.com/docs/guides/images-vision) (formats, 30,000 patches, `detail`, sizing table, patch and tile rules, limitations); [Function calling](https://platform.openai.com/docs/guides/function-calling) (images in `function_call_output`); [Computer use](https://platform.openai.com/docs/guides/tools-computer-use) (code execution recommended for GPT-6 Astra, `computer` tool, `detail: "original"`); [Pricing](https://platform.openai.com/docs/pricing). OSWorld figure for GPT-6 Astra via [implicator.ai](https://www.implicator.ai/openai-gpt-6-astra-agi-era-launch/) **[third-party]**.
- Google: [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) (formats, 3,600 images, bounding boxes 0–1000); [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution) (tokens per level, `ultra_high` per item for computer use); [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) (multimodal function responses, Gemini 3 series); [API reference: generateContent](https://ai.google.dev/api/generate-content) (`FunctionResponse.parts`, `FunctionResponsePart`, `FunctionResponseBlob`, `Part.mediaResolution`, `Tool.computerUse`); [Computer use](https://ai.google.dev/gemini-api/docs/computer-use) (models, 0–999 coordinates, desktop actions, excluded functions); [Gemini 3.8 Flash model card](https://deepmind.google/models/model-cards/gemini-3-8-flash/) (CharXiv, OSWorld-2.0); prices as in the [hearing note](https://github.com/amitbaz/music-production-ai-mentor/blob/research/model-hearing/docs/research/what-a-model-can-hear.md), from [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Gemini 3 Pro's 72.7 % ScreenSpot-Pro via [Roboflow](https://blog.roboflow.com/gemini-3-pro/) **[third-party]**.
- Apple: [NSScreen.backingScaleFactor](https://developer.apple.com/documentation/appkit/nsscreen/backingscalefactor), [CGDisplayBounds](https://developer.apple.com/documentation/coregraphics/cgdisplaybounds(_:)), [SCContentFilter.pointPixelScale](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/pointpixelscale); `man screencapture` on macOS 27.0.1 **[local]**.

Papers and benchmarks:

- [ScreenSpot-Pro](https://arxiv.org/abs/2504.07981) (Li et al., 2025) and its [official leaderboard](https://gui-agent.github.io/grounding-leaderboard/) ([JSON](https://gui-agent.github.io/grounding-leaderboard/results/screenspot_pro.json), read 2026-10-15).
- [MeasureBench: Do Vision-Language Models Measure Up?](https://arxiv.org/abs/2510.26865) (Lin et al., 2025; CVPR 2026).

Not found, so not claimed: any published comparison of a provider's native computer-use tool against neutral function tools on the same model; any benchmark of reading plug-in knobs, sliders or EQ curves; ScreenSpot-Pro scores for Claude 5.5, GPT-6 or Gemini 3.5–3.8 on the official leaderboard; the pixel size Gemini shrinks an image to for a given `media_resolution`; whether Qwen3.8-Omni-Flash (the other 1M multimodal model in the hearing note) accepts images in a tool result.
