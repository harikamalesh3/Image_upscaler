/* =====================================================================
   PixelForge AI — js/enhancer.js
   The client-side enhancement + analysis engine.

   Core promise: make images bigger, sharper and better WITHOUT making
   them look artificial. We use hardware-accelerated canvas resampling
   plus a "restrained" unsharp-mask detail pass so textures stay natural
   and we never bloom into plastic-looking oversharpening.
   ===================================================================== */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Gives the browser a breath during multi-million-pixel loops so the tab
  // never shows "Page Unresponsive". Callers yield per row-chunk (64-128
  // rows), never per pixel, keeping the overhead to a few hundred ms.
  function yieldMain() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Loads a File/blob into an HTMLImageElement (decoded, ready to draw).
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const url = src instanceof Blob ? URL.createObjectURL(src) : src;
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        reject(new Error('Could not decode image.'));
      };
      img.src = url;
    });
  }

  // Draw an image onto a canvas and return {canvas, ctx, w, h}.
  function renderToCanvas(img, maxW, maxH) {
    const w = Math.max(1, Math.round(maxW || img.naturalWidth || img.width));
    const h = Math.max(1, Math.round(maxH || img.naturalHeight || img.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, w, h };
  }
// ------------------------------------------------------------------
  // ANALYSIS (used by Smart Mode)
  // ------------------------------------------------------------------
  function analyzeImage(img) {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;

    // Downsample to a bounded analysis canvas (fast + stable).
    const maxSide = 256;
    const scale = Math.min(1, maxSide / Math.max(W, H));
    const aw = Math.max(1, Math.round(W * scale));
    const ah = Math.max(1, Math.round(H * scale));
    const { ctx, w, h } = renderToCanvas(img, aw, ah);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Luminance + mean for brightness.
    const lum = new Float32Array(w * h);
    const rgba = new Float32Array(w * h * 4);
    let sumL = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[i] = L;
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
      sumL += L;
    }
    const meanL = sumL / lum.length;

    // --- Sharpness + per-pixel Laplacian map (for region focus) -------
    const lapMap = new Float32Array(w * h);
    let lapAcc = 0, lapN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w];
        lapMap[i] = Math.abs(lap);
        lapAcc += lapMap[i];
        lapN++;
      }
    }
    const laplacian = lapN ? lapAcc / lapN : 0;
    const sharpness = clamp(Math.round((Math.min(laplacian, 60) / 60) * 100), 0, 100);

    // --- Detail level from local contrast (3x3 deviation) ----------
    let detAcc = 0, detN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const n = (lum[i - w - 1] + lum[i - w] + lum[i - w + 1] +
                   lum[i - 1]     + lum[i]     + lum[i + 1] +
                   lum[i + w - 1] + lum[i + w] + lum[i + w + 1]) / 9;
        detAcc += Math.abs(lum[i] - n);
        detN++;
      }
    }
    const detailVal = detN ? detAcc / detN : 0;
    const detail = detailVal < 4 ? 'Low' : detailVal < 10 ? 'Medium' : 'High';

    // --- Noise: residual high-freq energy in flat areas -------------
    let noiseAcc = 0, noiseN = 0;
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const d = Math.abs(lum[i] - lum[i - w]);
        if (d < 3.5) { noiseAcc += d * d; noiseN++; }
      }
    }
    const noiseVal = noiseN ? Math.sqrt(noiseAcc / noiseN) : 0;
    const noise = noiseVal < 1.2 ? 'Low' : noiseVal < 3.2 ? 'Moderate' : 'High';

    // --- Face hint: simple skin-tone pixel ratio + centroid -------------
    let skin = 0, skinN = 0, sxSum = 0, sySum = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (r > 60 && r > g && g > b && (r - g) > 10 && mx - mn > 8) {
        skin++;
        sxSum += i % w; sySum += Math.floor(i / w);
      }
      skinN++;
    }
    const faceDetected = skinN ? skin / skinN > 0.12 : false;
    const faceCx = skin ? (sxSum / skin) / w : 0.5;
    const faceCy = skin ? (sySum / skin) / h : 0.5;
// --- Recommended enhancement from resolution + noise -------------
    const maxDimPx = Math.max(W, H);
    let recommended;
    if (maxDimPx <= 220) recommended = 8;
    else if (maxDimPx <= 900) recommended = 4;
    else if (maxDimPx <= 1800) recommended = 2;
    else recommended = 2;
    if (maxDimPx > 2200) recommended = 2; // already large -> light touch

    // Heuristic "quality" blend used to tune the detail pass.
    const quality = Math.round(clamp(sharpness * 0.7 + (100 - noiseVal * 28) * 0.3, 5, 95));

    return {
      width: W, height: H,
      sharpness, noise, detail, faceDetected,
      recommended, luminanceMean: meanL, quality,
      foci: findFoci(lum, lapMap, w, h, faceDetected, faceCx, faceCy)
    };
  }

  // Identifies region focal points (in 0..1 fractions) from the downscaled
  // analysis buffers. Produces real, computed suggestions for the workspace:
  //   regions: { full, face, detail, texture, background, text }
  function findFoci(lum, lapMap, w, h, faceDetected, faceCx, faceCy) {
    const BS = Math.max(2, Math.floor(Math.max(w, h) / 12));
    const gx = Math.max(1, Math.ceil(w / BS));
    const gy = Math.max(1, Math.ceil(h / BS));
    const energy = new Float32Array(gx * gy);   // mean |laplacian| per block
    const grad = new Float32Array(gx * gy);      // mean local gradient per block
    const cnt = new Float32Array(gx * gy);
    for (let by = 0; by < gy; by++) {
      for (let bx = 0; bx < gx; bx++) {
        let e = 0, g = 0, c = 0;
        const y0 = by * BS, x0 = bx * BS;
        const y1 = Math.min(h, y0 + BS), x1 = Math.min(w, x0 + BS);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            e += lapMap[i] || 0;
            g += Math.abs((lum[y * w + Math.min(w - 1, x + 1)] || 0) -
                          (lum[y * w + Math.max(0, x - 1)] || 0));
            c++;
          }
        }
        const n = c || 1;
        energy[by * gx + bx] = e / n;
        grad[by * gx + bx] = g / n;
        cnt[by * gx + bx] = n;
      }
    }
    const centerOf = (i) => ({ x: (i % gx + 0.5) / gx, y: (Math.floor(i / gx) + 0.5) / gy });

    let detailI = 0;
    for (let i = 1; i < gx * gy; i++) if (energy[i] > energy[detailI]) detailI = i;
    const detail = centerOf(detailI);

    let bgI = 0;
    for (let i = 1; i < gx * gy; i++) if (energy[i] < energy[bgI]) bgI = i;
    const background = centerOf(bgI);

    // Texture = a block whose energy is at the 70th percentile (representative).
    const sorted = Array.from(energy).sort((a, b) => a - b);
    const p70 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.7))];
    let texI = detailI;
    let bestDiff = Infinity;
    for (let i = 0; i < gx * gy; i++) {
      const d = Math.abs(energy[i] - p70);
      if (d < bestDiff) { bestDiff = d; texI = i; }
    }
    const texture = centerOf(texI);

    // Text = block with the strongest small-scale gradient (sharp edges).
    let txtI = 0;
    for (let i = 1; i < gx * gy; i++) if (grad[i] > grad[txtI]) txtI = i;
    const text = centerOf(txtI);

    return {
      full: { x: 0.5, y: 0.5, zoom: 1 },
      detail,
      face: faceDetected ? { x: faceCx, y: faceCy, zoom: 3.5 } : null,
      texture,
      background,
      text
    };
  }
// ------------------------------------------------------------------
  // ENHANCE — scale: 2, 4 or 8. opts.smart tunes the detail pass.
  // ------------------------------------------------------------------
  // Async + cooperative: yields to the browser between row-chunks and
  // reports real 0..1 progress via opts.onProgress, so large upscales
  // (e.g. 8x) never freeze the tab into a "Page Unresponsive" dialog.
  async function enhanceImage(img, scale, opts = {}) {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    const outW = Math.max(1, Math.round(W * scale));
    const outH = Math.max(1, Math.round(H * scale));
    const analysis = (opts.smart && opts.analysis) ? opts.analysis : null;
    const noisy = analysis ? analysis.noise !== 'Low' : false;
    const veryNoisy = analysis ? analysis.noise === 'High' : false;
    const report = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const emit = (f) => {
      if (report) { try { report(Math.max(0, Math.min(1, f))); } catch (e) {} }
    };

    // 0) REPAIR at native size (cheap) BEFORE any upscaling/sharpening.
    // Sharpening damage only amplifies scanlines, JPEG blocks and
    // color-fringing — so denoise/descreen/defringe first.
    const work = document.createElement('canvas');
    work.width = W; work.height = H;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(img, 0, 0, W, H);
    await repairPass(wctx, W, H, analysis, (f) => emit(f * 0.14));

    // 1) High-quality upscale of the *repaired* image.
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, 0, 0, outW, outH);
    emit(0.16);

    // 2) CRISP + TEXTURE — the visible "better" step.
    // Edge-masked: strong on outlines and textured zones, near-zero on
    // flat areas and skin, so crispness rises without crunch or plastic.
    // (Repair already ran; this works on the clean upscaled pixels.)
    let edgeAmt = 1.0, texAmt = 0.30, edgeT0 = 7, edgeT1 = 42;
    if (analysis) {
      if (analysis.quality < 35) { edgeAmt = 1.15; texAmt = 0.34; }
      else if (analysis.quality > 70) { edgeAmt = 0.85; texAmt = 0.24; }
      if (veryNoisy) { edgeAmt = 0.6; texAmt = 0.14; edgeT0 = 12; edgeT1 = 55; }
      else if (noisy) { edgeAmt = 0.8; texAmt = 0.22; edgeT0 = 9; }
      if (analysis.faceDetected) edgeAmt = Math.min(edgeAmt, 0.7);
      if (scale >= 8) { edgeAmt = Math.min(edgeAmt, 0.8); texAmt = Math.min(texAmt, 0.22); }
    }
    crispTexturePass(canvas, ctx, outW, outH, { edgeAmt, texAmt, edgeT0, edgeT1 },
      (f) => emit(0.16 + f * 0.69));

    // 3) Gentle natural color / luminance lift.
    await gentleColor(ctx, outW, outH, veryNoisy, (f) => emit(0.85 + f * 0.13));
    emit(1);

    return { canvas, ctx, outW, outH };
  }

  // ------------------------------------------------------------------
  // REPAIR — runs at native resolution, before upscaling:
  //   a) edge-preserving denoise (bilateral-lite 3x3),
  //   b) scanline/descreen reduction when periodic rows detected,
  //   c) color-fringe (chromatic aberration) suppression at hard edges.
  // ------------------------------------------------------------------
  async function repairPass(ctx, w, h, analysis, prog) {
    const strength = !analysis ? 1 : analysis.noise === 'High' ? 2 : analysis.noise === 'Moderate' ? 1 : 0;
    const imgData = ctx.getImageData(0, 0, w, h);
    let d = imgData.data;
    if (strength > 0) d = await bilateralDenoise(d, w, h, strength, (f) => prog && prog(f * 0.7));
    if (strength > 0 && hasScanlines(d, w, h)) d = await reduceScanlines(d, w, h, strength > 1 ? 0.6 : 0.4, (f) => prog && prog(0.7 + f * 0.15));
    // Defringe ONLY for localized lens defects. When fringing covers a big
    // share of pixels it is an intentional style (anime RGB-split, retro
    // posters) — stripping it makes the result look flatter/worse.
    // Clean images (strength 0) skip repair except localized defringe.
    const ratio = fringeRatio(d);
    if (ratio > 0 && ratio < 0.08) d = await suppressFringe(d, w, h, (f) => prog && prog(0.85 + f * 0.15));
    else if (prog) prog(1);
    ctx.putImageData(new ImageData(d, w, h), 0, 0);
  }

  // Share of pixels with strong red/blue-vs-green disagreement.
  function fringeRatio(d) {
    let n = 0;
    const total = d.length / 4;
    const step = total > 400000 ? 4 : 1; // sample huge images
    let checked = 0;
    for (let i = 0; i < d.length; i += 4 * step) {
      checked++;
      if (Math.max(d[i], d[i + 2]) - d[i + 1] > 28) n++;
    }
    return checked ? n / checked : 0;
  }

  // Edge-preserving smoothing: 3x3 weighted by color distance, so flat
  // areas (blocks, grain, scanline fuzz) smooth out but real edges survive.
  async function bilateralDenoise(data, w, h, strength, prog) {
    const range = strength > 1 ? 38 : 26; // color-distance sigma
    const out = new Uint8ClampedArray(data.length);
    const idx = (x, y) => (y * w + x) * 4;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = idx(x, y);
        const cr = data[o], cg = data[o + 1], cb = data[o + 2];
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const q = idx(xx, yy);
            const dr = data[q] - cr, dg = data[q + 1] - cg, db = data[q + 2] - cb;
            const dist2 = dr * dr + dg * dg + db * db;
            const wt = Math.exp(-dist2 / (2 * range * range));
            sr += data[q] * wt; sg += data[q + 1] * wt; sb += data[q + 2] * wt;
            sw += wt;
          }
        }
        // blend: High noise leans fully on the smoothed value
        const t = strength > 1 ? 0.85 : 0.6;
        out[o]     = cr + (sr / sw - cr) * t;
        out[o + 1] = cg + (sg / sw - cg) * t;
        out[o + 2] = cb + (sb / sw - cb) * t;
        out[o + 3] = data[o + 3];
      }
      if ((y & 63) === 0) { if (prog) prog((y + 1) / h); await yieldMain(); }
    }
    if (prog) prog(1);
    return out;
  }

  // Detects periodic horizontal artefacts (scanlines, interlacing, screen
  // moiré): rows oscillating around their vertical neighbours far more
  // than the image's overall row-to-row drift would suggest.
  function hasScanlines(d, w, h) {
    if (h < 12) return false;
    const rowMean = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      const step = Math.max(1, Math.floor(w / 128));
      for (let x = 0; x < w; x += step) {
        const o = (y * w + x) * 4;
        s += 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      }
      rowMean[y] = s / Math.ceil(w / step);
    }
    let alt = 0, drift = 0;
    for (let y = 1; y < h - 1; y++) {
      alt += Math.abs(rowMean[y] - (rowMean[y - 1] + rowMean[y + 1]) / 2);
      drift += Math.abs(rowMean[y] - rowMean[y - 1]);
    }
    const n = h - 2;
    return alt / n > 2.2 && alt > drift * 0.55;
  }

  // Softens row-periodic artefacts by blending each row toward its
  // vertical neighbours. Operates on luminance to avoid colour bleed.
  async function reduceScanlines(d, w, h, blend, prog) {
    const out = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const ou = ((y - 1) * w + x) * 4, od = ((y + 1) * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = d[o + c];
          const avg = (d[ou + c] + d[od + c]) / 2;
          out[o + c] = v + (avg - v) * blend;
        }
      }
      if ((y & 127) === 0) { if (prog) prog(y / h); await yieldMain(); }
    }
    if (prog) prog(1);
    return out;
  }

  // Pulls red/blue toward green where they disagree hard (the purple/green
  // halos in your robot photo). Only touches high-fringe pixels, and only
  // partially, so real colours survive.
  async function suppressFringe(d, w, h, prog) {
    const out = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const fringe = Math.max(r, b) - g;
      if (fringe > 28) {
        const t = Math.min(0.65, (fringe - 28) / 120);
        out[i]     = r + (g - r) * t;
        out[i + 2] = b + (g - b) * t;
      }
      if ((i & 0xFFFFF) === 0 && i > 0) { if (prog) prog(i / d.length); await yieldMain(); }
    }
    if (prog) prog(1);
    return out;
  }

  // ------------------------------------------------------------------
  // CRISP + TEXTURE — edge-masked micro-contrast in ONE pass:
  //   fine   = orig - smallBlur(r=1)  -> crisp outlines, deblurred edges
  //   tex    = orig - wideBlur        -> local texture / fabric / surface
  // Both are gated by an edge mask (Sobel gradient, smoothstepped) and a
  // per-pixel skin guard, so flats stay clean and faces stay natural.
  // wideBlur comes from a downscaled canvas (GPU) — O(1) even at 32MP.
  // ------------------------------------------------------------------
  async function crispTexturePass(canvas, ctx, w, h, o, prog) {
    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;
    const n = w * h;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      lum[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    const fine = await boxBlur(d, w, h, 1, (f) => prog && prog(f * 0.35));
    const wide = await wideBlurViaCanvas(canvas, w, h);
    if (prog) prog(0.4);
    const out = new Uint8ClampedArray(d.length);
    const t0 = o.edgeT0, t1 = o.edgeT1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4;
        const xl = lum[y * w + Math.max(0, x - 1)], xr = lum[y * w + Math.min(w - 1, x + 1)];
        const yu = lum[Math.max(0, y - 1) * w + x], yd = lum[Math.min(h - 1, y + 1) * w + x];
        const grad = Math.abs(xr - xl) + Math.abs(yd - yu);
        let edge = (grad - t0) / (t1 - t0);
        edge = edge < 0 ? 0 : edge > 1 ? 1 : edge;
        edge = edge * edge * (3 - 2 * edge); // smoothstep
        const r = d[p], g = d[p + 1], b = d[p + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const skin = (r > 60 && r > g && g > b && (r - g) > 10 && mx - mn > 8) ? 0.3 : 1;
        const m = edge * skin;
        if (m <= 0.01) { out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = d[p + 3]; continue; }
        for (let c = 0; c < 3; c++) {
          const orig = d[p + c];
          const f = orig - fine[p + c];   // high-frequency: outlines
          const t = orig - wide[p + c];   // mid-frequency: texture
          const gatedF = Math.abs(f) > 3 ? f : 0;
          const gatedT = Math.abs(t) > 28 ? 0 : t; // ignore strong halos
          out[p + c] = clamp(orig + o.edgeAmt * m * gatedF + o.texAmt * m * gatedT, 0, 255);
        }
        out[p + 3] = d[p + 3];
      }
      if ((y & 127) === 0) { if (prog) prog(0.4 + 0.6 * (y / h)); await yieldMain(); }
    }
    if (prog) prog(1);
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  // Wide blur without the O(radius) cost: downscale on the GPU, blur the
  // thumbnail with r=2, then stretch back to full size for sampling.
  async function wideBlurViaCanvas(srcCanvas, w, h) {
    const sw = Math.max(24, Math.min(320, Math.round(w / 12)));
    const sh = Math.max(24, Math.round(sw * h / w));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(srcCanvas, 0, 0, sw, sh);
    const sd = sctx.getImageData(0, 0, sw, sh).data;
    const blurred = await boxBlur(sd, sw, sh, 2);
    const bc = document.createElement('canvas');
    bc.width = sw; bc.height = sh;
    bc.getContext('2d').putImageData(new ImageData(blurred, sw, sh), 0, 0);
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(bc, 0, 0, w, h);
    return fctx.getImageData(0, 0, w, h).data;
  }

  // Unsharp-mask style detail recovery (blend of original + detail pass).
  function applyDetailRecovery(ctx, w, h, amount, threshold, radius) {
    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;
    const blur = boxBlur(d, w, h, radius);
    const out = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const orig = d[i + c];
        const fl = blur[i + c];
        const diff = orig - fl;
        const sharp = Math.abs(diff) > threshold ? diff : 0;
        out[i + c] = clamp(orig + amount * sharp, 0, 255);
      }
      out[i + 3] = d[i + 3];
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  // Light local-contrast ("clarity") pass so the enhancement is visible
  // at a glance: boosts mid-tone contrast against a wide blur.
  function applyClarity(ctx, w, h, strength) {
    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;
    const blur = boxBlur(d, w, h, Math.max(6, Math.round(Math.min(w, h) / 90)));
    const out = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const orig = d[i + c];
        const soft = blur[i + c];
        const diff = orig - soft;
        // only push mid-tone local contrast, ignore strong edges (handled above)
        const gated = Math.abs(diff) > 32 ? 0 : diff;
        out[i + c] = clamp(orig + strength * gated, 0, 255);
      }
      out[i + 3] = d[i + 3];
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  // Separable box blur (horizontal then vertical), radius passes.
  // Async: yields per 128-row chunk and reports 0..1 progress.
  async function boxBlur(data, w, h, radius, prog) {
    const r = Math.max(1, Math.round(radius));
    const tmp = new Float32Array(w * h * 4);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xs = Math.max(0, x - r), xe = Math.min(w - 1, x + r);
        const count = xe - xs + 1;
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let xx = xs; xx <= xe; xx++) {
          const o = (y * w + xx) * 4;
          sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; sa += data[o + 3];
        }
        const o = (y * w + x) * 4;
        tmp[o] = sr / count; tmp[o + 1] = sg / count;
        tmp[o + 2] = sb / count; tmp[o + 3] = sa / count;
      }
      if ((y & 127) === 0) { if (prog) prog(0.5 * (y + 1) / h); await yieldMain(); }
    }
    for (let y = 0; y < h; y++) {
      const ys = Math.max(0, y - r), ye = Math.min(h - 1, y + r);
      const count = ye - ys + 1;
      for (let x = 0; x < w; x++) {
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let yy = ys; yy <= ye; yy++) {
          const o = (yy * w + x) * 4;
          sr += tmp[o]; sg += tmp[o + 1]; sb += tmp[o + 2]; sa += tmp[o + 3];
        }
        const o = (y * w + x) * 4;
        out[o] = sr / count; out[o + 1] = sg / count;
        out[o + 2] = sb / count; out[o + 3] = sa / count;
      }
      if ((y & 127) === 0) { if (prog) prog(0.5 + 0.5 * (y + 1) / h); await yieldMain(); }
    }
    if (prog) prog(1);
    return out;
  }

  // Light luminance shadow-lift + subtle saturation (keeps skin natural).
  // veryNoisy sources get almost no saturation push (it exaggerates fringes).
  async function gentleColor(ctx, w, h, veryNoisy, prog) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const sat = veryNoisy ? 1.03 : 1.08;
    for (let y = 0; y < h; y++) {
      const rowStart = (y * w) * 4, rowEnd = rowStart + w * 4;
      for (let i = rowStart; i < rowEnd; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        let lift = 0;
        if (L < 60) lift = (60 - L) * 0.14;
        d[i]     = clamp(L + (r - L) * sat + lift, 0, 255);
        d[i + 1] = clamp(L + (g - L) * sat + lift, 0, 255);
        d[i + 2] = clamp(L + (b - L) * sat + lift, 0, 255);
      }
      if ((y & 127) === 0) { if (prog) prog((y + 1) / h); await yieldMain(); }
    }
    if (prog) prog(1);
    ctx.putImageData(imgData, 0, 0);
  }

  // convert canvas to PNG blob
  function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) =>
        blob ? resolve(blob) : reject(new Error('Export failed.')), type, quality);
    });
  }

  const Enhancer = {
    loadImage, analyzeImage, enhanceImage, canvasToBlob, clamp
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Enhancer;
  global.PixelForge = global.PixelForge || {};
  global.PixelForge.Enhancer = Enhancer;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : global));