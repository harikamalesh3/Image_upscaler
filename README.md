# PixelForge AI

> **Upscale your images. Recover the details. Keep them natural.**

A fully client-side image upscaler. Bigger, sharper and better — without the
plastic, painted look. No account, no uploads, no server: your images never
leave your device.

## ✨ Core features

- **Batch upscaling** — drag & drop or select multiple images, see a thumbnail
  for each, process them individually with live progress, and download a single
  result or everything at once. Failed images are shown separately with a
  **Retry** option.
- **Natural detail enhancement** — a restrained detail-recovery pass that
  sharpens textures and fine detail without over-sharpening, fake texture,
  plastic faces, or oversaturated colour.
- **✨ Smart Mode** — one click. PixelForge analyses each image (resolution,
  sharpness, noise, detail, face hint) and picks the recommended level, then
  **Enhance Automatically**.
- **2× · 4× · 8× levels** — with live previews of the expected output
  resolution. We never claim quality the engine can't actually produce.
- **🔍 Pixel Microscope** — zoom deep into any region and compare the
  *Original ↔ Enhanced* side by side, with a **“Detail Improved”** indicator.
- **AI Image Comparison Workspace** — a three-mode viewer (`Original | Enhanced
  | Compare`) with **Synchronized Zoom** (zoom one pane, the other follows),
  **Focus Comparison** buttons (Full Image, Face, Details, Texture, Background,
  Text) that instantly jump both views to the same region, a **Zoom Controls**
  bar (− / % / + / Fit / Reset), and **AI Improvement Indicators** showing real
  measured metrics (Quality, Sharpness, Detail, Noise) — never fake data.
- **My Enhancements history** — completed results saved automatically with
  original/enhanced thumbnails, upscale level, resolutions, date and status
  (View / Download / Delete).

## 🚀 Run it

Just open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari).
No build step, no installs.

For local hosting (optional) you can serve the folder, e.g.:

```bash
python -m http.server 8080      # then open http://localhost:8080
```

## 📁 Structure

```
index.html         App shell (Studio, history, comparison modal, microscope)
css/styles.css     Dark "AI" theme
js/enhancer.js     Enhancement + analysis engine (upscale, unsharp-mask detail)
js/history.js      localStorage-backed "My Enhancements"
js/app.js          UI orchestration (upload, queue, compare, microscope…)
```

## ⚙️ How the enhancement works

1. **Upscale** — the image is rescaled with hardware canvas resampling
   (`imageSmoothingQuality: 'high'`).
2. **Detail recovery** — a blended *unsharp mask* adds back edge-local
   micro-contrast. The amount, radius and noise-threshold are tuned
   automatically in Smart Mode (noisy images get gentler handling; detected
   faces stay soft), keeping results natural.
3. **Gentle colour** — a small shadow-lift and ~6% saturation bump, no
   garish boosts.

A future version can swap the engine for a GPU AI model (e.g. Real-ESRGAN via
ONNX) while keeping the same UI.

## ℹ️ Notes & limitations

- History is stored in `localStorage`; very large images may exceed the storage
  quota and are kept “in-session only” with a toast notice.
- “Face detected” is a lightweight skin-tone heuristic, not a face detector.
- For truly lossless JPEG export you can re-run and use the PNG download.
"# image_upscaler" 
