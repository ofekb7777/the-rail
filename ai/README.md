# The smart cut-out model

Nothing in here is downloaded unless you turn *Smart cut-out* on in Settings.
The app itself is unaffected by it: without it the install is around 330 KB and
makes no request for any of this.

| File | Size | What it is | Licence |
|---|---|---|---|
| `u2netp.onnx` | 4.6 MB | U²-Net (small), salient-object segmentation | Apache 2.0 — `LICENSE-u2net.txt` |
| `ort-wasm-simd-threaded.wasm` | 13.5 MB | ONNX Runtime Web, the thing that runs the model | MIT — `LICENSE-onnxruntime.txt` |
| `ort.wasm.bundle.min.mjs` | 73 KB | its JavaScript entry point | MIT |
| `ort-wasm-simd-threaded.mjs` | 24 KB | its WASM loader | MIT |

## Why these, and not something better

Measured against the app's own cut-out on two real photographs:

- a black shirt on a bed — the flood fill leaves a strip of bedding down one
  side and fragments along the bottom; the model does not
- a white trainer held up in a lit room — the flood fill **refuses outright**,
  because a white shoe and a cream desk are the same colour with no edge
  between them; the model cuts the shoe and takes the hand holding it off too

The second one is the case that no amount of tuning fixed. It is why this is
here.

`u2netp` is the small variant, 4.6 MB against the full model's 176 MB. A
prompted model (SAM and its descendants) would cut more precisely still and
could use the box you already draw, but the weights live on Hugging Face, which
this project's build environment cannot reach, and it is two to three times the
download.

Nothing was trained here. These are published weights, used as published.
