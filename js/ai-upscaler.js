/* =====================================================================
   PixelForge AI — js/ai-upscaler.js
   Real AI upscaler via onnxruntime-web (WebGPU -> WASM fallback).
   Tiled inference + overlap blending so large images don't OOM.
   Falls back to classic canvas engine if model/ORT unavailable.
   ===================================================================== */
(function (global) {
  'use strict';

  // onnxruntime-web 1.19: the old monolithic `ort.web.min.js` no longer
  // exists (removed after 1.17) — the full script-tag bundle (global
  // `ort`, WebGPU + WASM EPs) is `ort.all.min.js`. jsDelivr first, unpkg
  // fallback.
  var ORT_CDNS = [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/ort.all.min.js',
    'https://unpkg.com/onnxruntime-web@1.19.0/dist/ort.all.min.js'
  ];

  // Default model: realesr-general-x4v3 compact (SRVGGNetCompact, ~4.7MB,
  // RGB NCHW 0-1 in, 0-1 out). Tried in order — jsDelivr first (best CORS
  // reliability), then Hugging Face mirrors. Override by dropping a file
  // into ./models/ and adding its URL at the front of `urls`.
  var MODELS = {
    general_x4: {
      label: 'General x4 (fast, recommended)',
      scale: 4,
      urls: [
        'https://cdn.jsdelivr.net/gh/Rahmanvai/upscaler-model@main/realesr-general-x4v3.onnx',
        'https://huggingface.co/Samo629/real-esrgan-onnx/resolve/main/realesr-general-x4v3.onnx?download=1',
        'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx?download=1'
      ]
    }
  };

  var state = {
    ortLoaded: false,
    ortLoading: null,
    session: null,
    sessionKey: null,
    modelProgress: 0,
    engine: 'ai', // 'ai' | 'classic'
    lastError: null
  };

  function getEngine() {
    try { return localStorage.getItem('pf_engine') || 'ai'; } catch (e) { return state.engine; }
  }
  function setEngine(v) {
    state.engine = v;
    try { localStorage.setItem('pf_engine', v); } catch (e) {}
  }
  state.engine = getEngine();

  function loadScript(srcs) {
    if (global.ort) return Promise.resolve();
    if (state.ortLoading) return state.ortLoading;
    if (!Array.isArray(srcs)) srcs = [srcs];
    function tryOne(i) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = srcs[i];
        s.async = true;
        s.onload = function () { state.ortLoaded = !!global.ort; resolve(); };
        s.onerror = function () { reject(new Error('HTTP failed: ' + srcs[i])); };
        document.head.appendChild(s);
      }).catch(function (e) {
        if (i + 1 < srcs.length) return tryOne(i + 1);
        state.ortLoading = null; // don't cache failure — allow retry
        throw new Error('Could not load ONNX Runtime from CDN (' + e.message + '). Check connection/ad-blocker.');
      });
    }
    state.ortLoading = tryOne(0);
    return state.ortLoading;
  }

  function fetchWithProgress(url, onProgress) {
    return fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('Model download failed: HTTP ' + res.status);
      var total = parseInt(res.headers.get('content-length') || '0', 10);
      if (!res.body || !res.body.getReader) return res.arrayBuffer();
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var len = received;
            var buf = new Uint8Array(len);
            var off = 0;
            chunks.forEach(function (c) { buf.set(c, off); off += c.length; });
            return buf.buffer;
          }
          chunks.push(r.value);
          received += r.value.length;
          if (total && onProgress) onProgress(received / total);
          return pump();
        });
      }
      return pump();
    });
  }

  // forceEP: null (WebGPU, WASM fallback) or 'wasm' (skip WebGPU entirely —
  // used after a WebGPU *run* failure, which session creation can't catch).
  function ensureSession(modelKey, onProgress, forceEP) {
    modelKey = modelKey || 'general_x4';
    var def = MODELS[modelKey];
    if (!def) return Promise.reject(new Error('Unknown model.'));
    var wantKey = modelKey + '|' + (forceEP || 'auto');
    if (state.session && state.sessionKey === wantKey) return Promise.resolve(state.session);
    state.lastError = null;
    return loadScript(ORT_CDNS).then(function () {
      var ort = global.ort;
      if (!ort) throw new Error('ONNX Runtime failed to initialise.');
      var urls = def.urls || (def.url ? [def.url] : []);
      if (!urls.length) throw new Error('No model URL configured.');
      // Try each mirror in order; report which one worked/failed.
      var attempt = Promise.reject(new Error('No mirrors to try.'));
      urls.forEach(function (url, i) {
        attempt = attempt.catch(function (prevErr) {
          if (i > 0 && onProgress) onProgress(0); // reset bar for next mirror
          return fetchWithProgress(url, onProgress).then(function (buf) {
            if (!buf || buf.byteLength < 1024 * 1024)
              throw new Error('Mirror ' + (i + 1) + ' returned ' +
                (buf ? Math.round(buf.byteLength / 1024) + 'KB' : 'nothing') +
                ' (HTTP ' + (buf ? '200, truncated/blocked' : 'failed') + ').');
            var wasmOnly = function () {
              return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
            };
            if (forceEP === 'wasm') return wasmOnly();
            // WebGPU first, WASM fallback — per mirror download.
            return ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
              .catch(wasmOnly);
          }).catch(function (e) {
            var msg = (e && e.message) || String(e);
            // Keep the deepest error; annotate which mirror failed.
            throw new Error('Mirror ' + (i + 1) + '/' + urls.length + ': ' + msg);
          });
        });
      });
      return attempt.then(function (sess) {
        state.session = sess;
        state.sessionKey = wantKey;
        return sess;
      }).catch(function (e) {
        state.lastError = (e && e.message) || String(e);
        throw new Error('AI engine could not start (' + state.lastError + ').');
      });
    }).catch(function (e) {
      if (!state.lastError) state.lastError = (e && e.message) || String(e);
      throw e;
    });
  }

  // WebGPU sessions can *create* fine and then fail at *run* time (e.g. the
  // Clip kernel choking on large tile outputs). Probe with one tiny tile;
  // on a WebGPU run error, rebuild the session with WASM and continue.
  function withRunnableSession(modelKey, img, onProgress) {
    return ensureSession(modelKey, function (f) { onProgress(f); }).then(function (session) {
      var ort = global.ort;
      var pw = 64, ph = 64;
      var c = document.createElement('canvas');
      c.width = pw; c.height = ph;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, pw, ph);
      var cd = ctx.getImageData(0, 0, pw, ph).data;
      var n = pw * ph;
      var inp = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        inp[i] = cd[i * 4] / 255;
        inp[n + i] = cd[i * 4 + 1] / 255;
        inp[n * 2 + i] = cd[i * 4 + 2] / 255;
      }
      return runTile(session, inp, pw, ph).then(function () {
        return session; // WebGPU runs fine
      }).catch(function (e) {
        var msg = (e && e.message) || String(e);
        if (!/webgpu/i.test(msg)) throw e; // non-GPU error: don't mask it
        state.session = null; state.sessionKey = null;
        return ensureSession(modelKey, function (f) { onProgress(f); }, 'wasm');
      });
    });
  }

  // Image -> Float32 NCHW 0..1
  function imageToTensor(img, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    var n = w * h;
    var out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      out[i] = d[i * 4] / 255;
      out[n + i] = d[i * 4 + 1] / 255;
      out[n * 2 + i] = d[i * 4 + 2] / 255;
    }
    return { data: out, canvas: c, ctx: ctx };
  }

  function runTile(session, tileData, tw, th) {
    var ort = global.ort;
    var inputName = session.inputNames[0];
    var t = new ort.Tensor('float32', tileData, [1, 3, th, tw]);
    var feeds = {};
    feeds[inputName] = t;
    return session.run(feeds);
  }

  function outputToCanvas(outTensor, outW, outH) {
    var arr = outTensor.data || outTensor.cpuData;
    var c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(outW, outH);
    var n = outW * outH;
    var channels = arr.length / n;
    for (var i = 0; i < n; i++) {
      var r, g, b;
      if (channels >= 3) { r = arr[i]; g = arr[n + i]; b = arr[n * 2 + i]; }
      else { r = g = b = arr[i]; }
      img.data[i * 4] = Math.max(0, Math.min(255, Math.round(r * 255)));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Tiled x4 upscale. onTile(frac) for progress.
  function upscaleImage(img, opts) {
    opts = opts || {};
    var modelKey = opts.model || 'general_x4';
    var modelScale = (MODELS[modelKey] || {}).scale || 4;
    var targetScale = opts.targetScale || 4;
    var onProgress = opts.onProgress || function () {};
    var TILE = Math.max(64, Math.min(192, opts.tileSize || 128));
    var OVERLAP = 16;

    return withRunnableSession(modelKey, img, function (f) { onProgress(f * 0.25); }).then(function (session) {
      var W = img.naturalWidth || img.width;
      var H = img.naturalHeight || img.height;
      // Downscale huge inputs so tiles stay sane; AI does the detail work.
      var maxSide = opts.maxInputSide || 512;
      var pre = Math.min(1, maxSide / Math.max(W, H));
      var iw = Math.max(32, Math.round(W * pre));
      var ih = Math.max(32, Math.round(H * pre));

      var prep = imageToTensor(img, iw, ih);
      var ow = iw * modelScale, oh = ih * modelScale;
      var acc = document.createElement('canvas');
      acc.width = ow; acc.height = oh;
      var actx = acc.getContext('2d');

      var xs = [];
      for (var x = 0; x < iw; x += TILE - OVERLAP) xs.push(x);
      var ys = [];
      for (var y = 0; y < ih; y += TILE - OVERLAP) ys.push(y);
      var total = xs.length * ys.length;
      var done = 0;

      var chain = Promise.resolve();
      xs.forEach(function (tx) {
        ys.forEach(function (ty) {
          chain = chain.then(function () {
            var tw = Math.min(TILE, iw - tx);
            var th = Math.min(TILE, ih - ty);
            // pad tile to full TILE where possible for model stability
            var cw = document.createElement('canvas');
            cw.width = tw; cw.height = th;
            cw.getContext('2d').drawImage(prep.canvas, tx, ty, tw, th, 0, 0, tw, th);
            var cd = cw.getContext('2d').getImageData(0, 0, tw, th).data;
            var n = tw * th;
            var inp = new Float32Array(n * 3);
            for (var i = 0; i < n; i++) {
              inp[i] = cd[i * 4] / 255;
              inp[n + i] = cd[i * 4 + 1] / 255;
              inp[n * 2 + i] = cd[i * 4 + 2] / 255;
            }
            return runTile(session, inp, tw, th).then(function (res) {
              var outName = session.outputNames[0];
              var outT = res[outName] || res[Object.keys(res)[0]];
              var dims = outT.dims; // [1,3,oh,ow]
              var oW = dims[3], oH = dims[2];
              var tileCanvas = outputToCanvas(outT, oW, oH);
              // Paste only the tile CENTER (crop half the overlap on sides
              // that have neighbours) so seams can't form where tiles meet.
              var m = Math.round((OVERLAP / 2) * modelScale);
              var sx = tx > 0 ? Math.min(m, oW - 1) : 0;
              var sy = ty > 0 ? Math.min(m, oH - 1) : 0;
              var ex = (tx + tw < iw) ? Math.min(m, oW - sx - 1) : 0;
              var ey = (ty + th < ih) ? Math.min(m, oH - sy - 1) : 0;
              var ox = Math.round(tx * modelScale), oy = Math.round(ty * modelScale);
              actx.drawImage(tileCanvas, sx, sy, oW - sx - ex, oH - sy - ey,
                ox + sx, oy + sy, oW - sx - ex, oH - sy - ey);
              done++;
              onProgress(0.25 + 0.7 * (done / total));
              // Yield between tiles; long inference chains otherwise starve the UI.
              return new Promise(function (resolve) { setTimeout(resolve, 0); });
            });
          });
        });
      });

      return chain.then(function () {
        onProgress(0.97);
        // Resize AI output to exact requested target scale.
        var wantW = Math.round(W * targetScale), wantH = Math.round(H * targetScale);
        if (!Number.isFinite(wantW) || !Number.isFinite(wantH) || wantW * wantH > 32000000) {
          throw new Error('Requested output is too large for this browser. Choose 2× or use a smaller image.');
        }
        var final = document.createElement('canvas');
        final.width = wantW; final.height = wantH;
        var fctx = final.getContext('2d', { willReadFrequently: true });
        fctx.imageSmoothingEnabled = true;
        fctx.imageSmoothingQuality = 'high';
        fctx.drawImage(acc, 0, 0, wantW, wantH);
        onProgress(1);
        return { canvas: final, ctx: fctx, outW: wantW, outH: wantH, ai: true, model: modelKey };
      });
    });
  }

  global.PixelForge = global.PixelForge || {};
  global.PixelForge.AI = {
    MODELS: MODELS, state: state,
    getEngine: getEngine, setEngine: setEngine,
    ensureSession: ensureSession, upscaleImage: upscaleImage,
    lastError: function () { return state.lastError; },
    available: function () { return state.engine !== 'classic'; }
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
