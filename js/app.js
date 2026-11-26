/* =====================================================================
   PixelForge AI — js/app.js
   UI orchestration: upload, level selection, batch enhance + progress,
   before/after slider, pixel microscope, downloads, history.
   ===================================================================== */
(function () {
  'use strict';
  const { Enhancer, History } = window.PixelForge;

  // ------------------------------------------------------------- state
  const state = {
    items: [],            // { id, fileName, img, w, h, thumbUrl,
                          //   analysis, status, progress,
                          //   enhancedCanvas, enhancedUrl }
    processing: false,
    currentLevel: 'smart'
  };

  // ------------------------------------------------------------- DOM
  const $ = (s) => document.querySelector(s);
  const fileInput = $('#fileInput');
  const dropzone = $('#dropzone');
  const chooseFilesBtn = $('#chooseFilesBtn');
  const enhanceBtn = $('#enhanceBtn');
  const clearBtn = $('#clearBtn');
  const downloadAllBtn = $('#downloadAllBtn');
  const statusHint = $('#statusHint');
  const queueEl = $('#queue');
  const expectedOut = $('#expectedOut');
  const expectedText = $('#expectedText');
  const smartAnalysis = $('#smartAnalysis');
  const smartMetrics = $('#smartMetrics');
  const smartReco = $('#smartReco');
  const enhanceAutomaticallyBtn = $('#enhanceAutomaticallyBtn');
  const resultCard = $('#resultCard');
  const reviewGrid = $('#reviewGrid');
  const resultSub = $('#resultSub');
  const levelInputs = Array.from(document.querySelectorAll('input[name="level"]'));

  // ------------------------------------------------------------- utils
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function baseName(name) {
    return String(name).split(/[\\/]/).pop();
  }

  function showToast(msg, type) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3400);
  }

  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function thumbBuffer(img, size) {
    size = size || 240;
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, size / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // ------------------------------------------------------------- level
  function effectiveScale(item) {
    if (state.currentLevel === 'smart')
      return (item.analysis && item.analysis.recommended) || 4;
    return parseInt(state.currentLevel, 10) || 2;
  }
// ------------------------------------------------------------- upload
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) =>
      (f.type || '').startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|svg)$/i.test(f.name || ''));
    if (!files.length) {
      showToast('No valid images in that selection.', 'err');
      return;
    }
    const pending = files.map(async (f) => {
      try {
        const img = await Enhancer.loadImage(f);
        const item = {
          id: History.uid(),
          fileName: baseName(f.name),
          img,
          w: img.naturalWidth,
          h: img.naturalHeight,
          thumbUrl: thumbBuffer(img).toDataURL('image/jpeg', 0.82),
          analysis: Enhancer.analyzeImage(img),
          origBytes: f.size || 0,
          status: 'pending',
          progress: 0
        };
        state.items.push(item);
      } catch (e) {
        showToast('Could not read ' + baseName(f.name), 'err');
      }
    });
    Promise.all(pending).then(() => {
      renderQueue();
      refreshActions();
      if (state.currentLevel === 'smart') showSmartAnalysis();
      else updateExpectedOutput();
      // Auto-scroll to Step 2 (Choose enhancement) once images are queued.
      if (state.items.length) {
        const step2 = document.getElementById('step2Card');
        if (step2) {
          const smooth = !window.matchMedia ||
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          step2.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        }
      }
    });
  }

  // Expected output resolution card for the selected level.
  function updateExpectedOutput() {
    const item = state.items[0];
    if (!item) { expectedOut.hidden = true; return; }
    const s = effectiveScale(item);
    expectedText.textContent = item.w + ' × ' + item.h +
      '  →  ×' + s + '  ' + (item.w * s) + ' × ' + (item.h * s);
    expectedOut.hidden = !state.items.length;
  }

  // Smart analysis panel: metrics + recommendation + auto button.
  function showSmartAnalysis() {
    if (!state.items.length) { smartAnalysis.hidden = true; updateExpectedOutput(); return; }
    const item = state.items[0];
    const a = item.analysis;
    smartMetrics.innerHTML =
      '<div class="metric"><span>Resolution</span><strong>' + a.width + ' × ' + a.height + '</strong></div>' +
      '<div class="metric"><span>Sharpness</span><strong>' + a.sharpness + '/100</strong></div>' +
      '<div class="metric"><span>Noise</span><strong>' + a.noise + '</strong></div>' +
      '<div class="metric"><span>Detail</span><strong>' + a.detail + '</strong></div>' +
      '<div class="metric"><span>Face detected</span><strong>' + (a.faceDetected ? 'Yes' : 'No') + '</strong></div>';
    smartReco.textContent = 'Smart Mode recommends ' + a.recommended + '× enhancement for ' + baseName(item.fileName) + '.';
    smartAnalysis.hidden = false;
  }
// ------------------------------------------------------------- queue UI
  function renderQueue() {
    queueEl.innerHTML = '';
    if (!state.items.length) return;
    const hdr = document.createElement('div');
    hdr.className = 'queue-head';
    const t = document.createElement('strong');
    t.textContent = 'Queue (' + state.items.length + ')';
    const clr = document.createElement('button');
    clr.className = 'btn-link';
    clr.type = 'button';
    clr.textContent = 'Clear all';
    clr.addEventListener('click', clearAll);
    hdr.appendChild(t); hdr.appendChild(clr);
    queueEl.appendChild(hdr);
    state.items.forEach((it) => queueEl.appendChild(queueItemEl(it)));
  }

  function queueItemEl(item) {
    const el = document.createElement('article');
    el.className = 'queue-item';
    el.dataset.id = item.id;

    const thumb = document.createElement('div');
    thumb.className = 'q-thumb';
    const img = document.createElement('img');
    img.src = item.thumbUrl; img.alt = item.fileName;
    thumb.appendChild(img);

    const info = document.createElement('div');
    info.className = 'q-info';
    const name = document.createElement('div');
    name.className = 'q-name'; name.title = item.fileName; name.textContent = item.fileName;
    const dims = document.createElement('div');
    dims.className = 'q-dims';
    dims.textContent = item.w + ' × ' + item.h + '  →  ' + outDims(item);
    const status = document.createElement('div');
    status.className = 'q-status ' + item.status;
    status.textContent = statusLabel(item);
    const progress = document.createElement('div');
    progress.className = 'q-progress';
    const bar = document.createElement('div');
    bar.className = 'pbar';
    const fill = document.createElement('span'); fill.className = 'pbar-fill';
    const pct = document.createElement('span'); pct.className = 'pbar-pct';
    bar.appendChild(fill); bar.appendChild(pct);
    progress.appendChild(bar);
    info.appendChild(name); info.appendChild(dims); info.appendChild(status); info.appendChild(progress);

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    addActions(actions, item);

    el.appendChild(thumb); el.appendChild(info); el.appendChild(actions);

    if (item.status === 'done' && item.enhancedUrl) {
      thumb.addEventListener('click', () => openCompare(item.id));
      thumb.classList.add('done');
      thumb.title = 'Click to compare';
    }
    return el;
  }

  function outDims(item) {
    const s = effectiveScale(item);
    return (item.w * s) + ' × ' + (item.h * s);
  }

  function statusLabel(item) {
    return item.status === 'processing' ? 'Processing…' :
      item.status === 'done' ? 'Completed ✓' :
      item.status === 'failed' ? 'Failed' : 'Ready';
  }

  function setProgressBar(item, pct) {
    const el = queueEl.querySelector('.queue-item[data-id="' + item.id + '"] .pbar');
    if (!el) return;
    el.querySelector('.pbar-fill').style.width = Math.round(pct) + '%';
    el.querySelector('.pbar-pct').textContent = Math.round(pct) + '%';
  }

  function setStatus(item, status) {
    item.status = status;
    const el = queueEl.querySelector('.queue-item[data-id="' + item.id + '"] .q-status');
    if (el) { el.className = 'q-status ' + status; el.textContent = statusLabel(item); }
  }

  function addActions(container, item) {
    container.innerHTML = '';
    const mk = (label, cls, fn, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm ' + (cls || '');
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      container.appendChild(b);
    };
    if (item.status === 'done' && item.enhancedUrl) {
      mk('⇄ Compare', 'btn-primary', () => openCompare(item.id), 'Open before/after comparison');
      mk('⬇', 'btn-ghost', () => downloadOne(item.id), 'Download enhanced image');
      mk('✕', 'btn-ghost', () => removeItem(item.id), 'Remove from queue');
    } else if (item.status === 'failed') {
      mk('↻ Retry', 'btn-primary', () => enhanceOne(item), 'Retry this image');
      mk('✕', 'btn-ghost', () => removeItem(item.id), 'Remove from queue');
    } else {
      mk('✕', 'btn-ghost', () => removeItem(item.id), 'Remove from queue');
    }
  }

  // Refresh queue action buttons after a state change (e.g. done).
  function refreshQueueActions() {
    state.items.forEach((it) => {
      const el = queueEl.querySelector('.queue-item[data-id="' + it.id + '"] .q-actions');
      if (el) addActions(el, it);
    });
  }

  function removeItem(id) {
    const it = state.items.find((x) => x.id === id);
    if (it && it.enhancedUrl) URL.revokeObjectURL(it.enhancedUrl);
    state.items = state.items.filter((x) => x.id !== id);
    renderQueue();
    refreshActions();
  }

  function clearAll() {
    state.items.forEach((it) => { if (it.enhancedUrl) URL.revokeObjectURL(it.enhancedUrl); });
    state.items = [];
    queueEl.innerHTML = '';
    smartAnalysis.hidden = true;
    refreshActions();
  }
// ------------------------------------------------------------- enhance flow
  function refreshActions() {
    const queueHas = state.items.length > 0;
    const isBusy = state.processing;
    const hasDone = state.items.some((i) => i.status === 'done' && i.enhancedUrl);
    enhanceBtn.disabled = !queueHas || isBusy;
    enhanceBtn.querySelector('.btn-spark').textContent = state.processing ? '…' : '✦';
    clearBtn.hidden = !queueHas || isBusy;
    downloadAllBtn.hidden = !hasDone;
    statusHint.textContent = !queueHas ? '' :
      state.processing ? 'Enhancing…' :
      'Ready to enhance ' + state.items.length + ' image' + (state.items.length > 1 ? 's' : '') + '.';
    if (!hasDone) compareModal.hidden = true; // nothing to compare inline
    renderReview();
    renderHistory();
  }

  async function enhanceAll() {
    if (state.processing) return;
    state.processing = true;
    refreshActions();
    // clear any stale results first
    state.items.forEach((it) => {
      if (it.enhancedUrl) { URL.revokeObjectURL(it.enhancedUrl); it.enhancedUrl = null; }
      it.enhancedCanvas = null;
      it.status = 'pending';
      it.progress = 0;
    });
    renderQueue();
    refreshActions();

    // Small reveal of smart analysis for the no-level case.
    if (state.currentLevel === 'smart') showSmartAnalysis();

    const toProcess = state.items.filter((i) => i.status !== 'failed');
    for (const item of toProcess) {
      if (!state.processing) break; // cancelled
      await enhanceOne(item);
    }
    state.processing = false;
    refreshActions();
  }

  function enhanceOne(item) {
    return new Promise((resolve) => {
      setStatus(item, 'processing');
      setProgressBar(item, 2);
      refreshActions();
      const scale = effectiveScale(item);
      const opts = { smart: state.currentLevel === 'smart', analysis: item.analysis };
      const useAI = window.PixelForge.AI && window.PixelForge.AI.getEngine() === 'ai';

      // Prewarm + start in a rAF so the status paints before heavy work.
      requestAnimationFrame(() => {
        setTimeout(async () => {
          const finishClassic = async () => {
            // Async + chunked: yields to the browser between row-chunks so
            // the tab stays responsive, with real 0..100 progress.
            const { canvas, outW, outH } = await Enhancer.enhanceImage(item.img, scale,
              Object.assign({}, opts, { onProgress: (f) => setProgressBar(item, 2 + f * 96) }));
            doneOne(item, canvas, outW, outH, 'classic');
            resolve();
          };
          try {
            // progressive visual sweep then the real work
            let prog = 8;
            const tick = setInterval(() => {
              prog = Math.min(92, prog + 12 + Math.random() * 10);
              // Fake sweep only for the short pre-delay; both AI and Classic
              // drive real progress via onProgress once the work starts.
              if (!useAI) setProgressBar(item, prog);
            }, 90);
            const finish = (canvas, outW, outH, engine) => {
              clearInterval(tick);
              doneOne(item, canvas, outW, outH, engine);
              resolve();
            };
            if (useAI) {
              try {
                statusHint.textContent = 'AI upscaling (downloading model on first run)…';
                const r = await window.PixelForge.AI.upscaleImage(item.img, {
                  targetScale: scale,
                  tileSize: 128,
                  maxInputSide: 512,
                  onProgress: (f) => setProgressBar(item, 2 + f * 96)
                });
                // light classic detail pass on top is OFF for AI — it destroys hallucinated texture.
                finish(r.canvas, r.outW, r.outH, 'ai');
              } catch (e) {
                var msg = (e && e.message) || String(e);
                showToast('AI failed (' + msg.slice(0, 140) + ') — used Classic instead.', 'err');
                var st = document.querySelector('#aiStatus');
                if (st) st.textContent = 'AI failed: ' + msg.slice(0, 120);
                clearInterval(tick);
                try { await finishClassic(); }
                catch (e2) { failOne(item, e2); resolve(); }
              }
            } else {
              setTimeout(async () => {
                clearInterval(tick);
                try { await finishClassic(); }
                catch (e) { failOne(item, e); resolve(); }
              }, 480);
            }
          } catch (e) {
            failOne(item, e);
            resolve();
          }
        }, 20);
      });
    });
  }

  function doneOne(item, canvas, outW, outH, engine) {
    item.enhancedCanvas = canvas;
    if (item.enhancedUrl) URL.revokeObjectURL(item.enhancedUrl);
    const exp = exportSmallest(canvas);
    const enhBlob = dataURLtoBlob(exp.dataUrl);
    item.enhancedUrl = URL.createObjectURL(enhBlob);
    item.enhDataUrl = exp.dataUrl;   // reuse for history (no second encode)
    item.enhMime = exp.mime;
    item.enhExt = exp.ext;
    item._wsCanvas = null;           // workspace format cache (rebuilt on open)
    item._sizeCache = null;
    item.enhAnalysis = Enhancer.analyzeImage(canvas);   // real measured metrics
    item.fileSize = { orig: (item.origBytes || 0), enh: enhBlob.size };
    item.engine = engine || 'classic';
    item.status = 'done';
    item.progress = 100;
    setProgressBar(item, 100);
    setStatus(item, 'done');
    addToHistory(item, outW, outH, effectiveScale(item));
    showWorkspace(item, false); // appear inline below Step 3 (no scroll mid-batch)
    refreshQueueActions();
  }

  function failOne(item, e) {
    item.status = 'failed';
    setStatus(item, 'failed');
    refreshQueueActions();
    showToast('Enhancement failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
  }

  function dataURLtoBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  // Export the canvas as the smallest reasonable file:
  // WebP q82 vs JPEG q82, smallest wins. PNG only when the image has
  // transparency (JPEG would destroy alpha) or neither is supported.
  // Returns { dataUrl, mime, ext }.
  function exportSmallest(canvas) {
    const hasAlpha = (() => {
      try {
        const sw = Math.max(1, Math.min(64, canvas.width));
        const sh = Math.max(1, Math.round(sw * canvas.height / canvas.width));
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0, sw, sh);
        const d = ctx.getImageData(0, 0, sw, sh).data;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] < 250) return true;
        }
        return false;
      } catch (e) { return true; } // be safe: keep PNG on failure
    })();
    if (!hasAlpha) {
      let webp = '', jpeg = '';
      try {
        webp = canvas.toDataURL('image/webp', 0.82);
        if (!/^data:image\/webp/.test(webp)) webp = '';
      } catch (e) { webp = ''; }
      try {
        jpeg = canvas.toDataURL('image/jpeg', 0.82);
        if (!/^data:image\/jpeg/.test(jpeg)) jpeg = '';
      } catch (e) { jpeg = ''; }
      if (webp && jpeg) {
        return webp.length <= jpeg.length
          ? { dataUrl: webp, mime: 'image/webp', ext: 'webp' }
          : { dataUrl: jpeg, mime: 'image/jpeg', ext: 'jpg' };
      }
      if (webp) return { dataUrl: webp, mime: 'image/webp', ext: 'webp' };
      if (jpeg) return { dataUrl: jpeg, mime: 'image/jpeg', ext: 'jpg' };
    }
    return { dataUrl: canvas.toDataURL('image/png'), mime: 'image/png', ext: 'png' };
  }

  function addToHistory(item, outW, outH, scale) {
    const enhThumb = thumbBufferEl(item.enhancedCanvas).toDataURL('image/jpeg', 0.82);
    // Store the enhanced image as a self-contained (compressed) data URL so
    // history stays downloadable/viewable after a refresh (tab-session
    // storage). Full-res data too big for the quota is kept in a
    // tab-session stash.
    let enhanced = item.enhDataUrl || '';
    try { if (!enhanced) enhanced = exportSmallest(item.enhancedCanvas).dataUrl; } catch (e) { enhanced = ''; }
    const ok = History.add({
      id: item.id,
      name: item.fileName,
      origW: item.w, origH: item.h,
      enhW: outW, enhH: outH,
      scale,
      date: new Date().getTime(),
      origThumb: item.thumbUrl,
      enhThumb: enhThumb,
      enhanced: enhanced,          // full-size compressed data URL (downloadable)
      enhMime: item.enhMime || 'image/png',
      enhExt: item.enhExt || 'png',
      enhancedUrl: item.enhancedUrl // live blob URL valid this session
    });
    if (ok === 'partial' && enhanced) {
      sessionBlobs[item.id] = enhanced;
      showToast('History card saved (full image kept for this tab session).');
    } else if (!ok && enhanced) {
      sessionBlobs[item.id] = enhanced;
      showToast('History storage is full — kept in-session only.');
    }
  }

  // Tab-session stash of full-size enhanced images (ids that stored
  // 'partial' history cards). Cleared automatically when the tab closes.
  const sessionBlobs = {};

  // Delete button in history cards (removes stored entry + session stash).
  function deleteHistory(id) {
    History.remove(id);
    try { delete sessionBlobs[id]; } catch (e) {}
    renderHistory();
    showToast('Enhancement deleted.');
  }

  function thumbBufferEl(canvas, size) {
    size = size || 240;
    const s = Math.min(1, size / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * s));
    c.height = Math.max(1, Math.round(canvas.height * s));
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }
// ------------------------------------------------------------- download
  function baseNoname(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }
  function outSuffix(item) {
    const s = effectiveScale(item);
    return 'x' + s + '_' + (item.w * s) + 'x' + (item.h * s);
  }
  function downloadOne(item) {
    if (item.enhancedUrl) {
      downloadFile(item.enhancedUrl, baseNoname(item.fileName) + '_' + outSuffix(item) + '.' + (item.enhExt || 'png'));
    }
  }

  function downloadAll() {
    const done = state.items.filter((i) => i.status === 'done' && i.enhancedUrl);
    if (!done.length) return;
    // initiate sequential downloads within the user gesture
    let i = 0;
    const next = () => {
      if (i >= done.length) { showToast('Downloaded ' + done.length + ' image' + (done.length > 1 ? 's' : '.') + ''); return; }
      const it = done[i++];
      downloadFile(it.enhancedUrl, baseNoname(it.fileName) + '_' + outSuffix(it) + '.' + (it.enhExt || 'png'));
      setTimeout(next, 320);
    };
    next();
  }

  // ------------------------------------------------------------- review
  function renderReview() {
    const done = state.items.filter((i) => i.status === 'done' && i.enhancedUrl);
    resultCard.hidden = !done.length;
    if (!done.length) return;
    resultSub.textContent = done.length + ' enhanced image' + (done.length > 1 ? 's ready' : ' ready') + '. Select one to compare.';
    reviewGrid.innerHTML = '';
    done.forEach((it) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'review-card';
      card.dataset.id = it.id;
      const thumb = document.createElement('img');
      thumb.src = it.enhancedUrl; thumb.alt = it.fileName;
      const lbl = document.createElement('div');
      lbl.className = 'review-label';
      const outW = itemOutW(it);
      lbl.innerHTML = '<span>' + esc(it.fileName) + '</span>' +
        '<em>' + it.w + '×' + it.h + ' → ' + outW + '×' + it.h * effectiveScale(it) + ' (' + effectiveScale(it) + '×)</em>';
      card.appendChild(thumb); card.appendChild(lbl);
      card.addEventListener('click', () => openCompare(it.id));
      reviewGrid.appendChild(card);
    });
  }

  function itemOutW(it) {
    return it.w * effectiveScale(it);
  }
  // ------------------------------------------------------------- comparison
  const compareModal = $('#compareModal');
  const downloadOneBtn = $('#downloadOneBtn');
  const downloadFormatSel = $('#downloadFormat');
  const downloadSizeEl = $('#downloadSize');
  const anotherBtn = $('#anotherBtn');
  const metaOrig = $('#metaOrig');
  const metaEnh = $('#metaEnh');
  const capOrigRes = $('#capOrigRes');
  const capEnhRes = $('#capEnhRes');
  const paneOrig = $('#paneOrig');
  const paneEnh = $('#paneEnh');
  const paneSlider = $('#paneSlider');
  const cviewOrig = $('#cviewOrig');
  const cviewEnh = $('#cviewEnh');
  const cimgOrig = $('#cimgOrig');
  const cimgEnh = $('#cimgEnh');
  const hudOrig = $('#hudOrig');
  const hudEnh = $('#hudEnh');
  const sessionsFocusBtns = Array.from(document.querySelectorAll('.focus-btn'));
  const imprPanel = $('#imprPanel');
  const imprGrid = $('#imprGrid');
  const cmpZoomRead = $('#cmpZoomRead');
  const zoomLabel = $('#zoomLabel');
  let activeCompareId = null;
  let downloadRef = null;
  let activeItem = null;

  // Workspace state — one synchronized viewport shared by all views.
  const ws = { view: 'slider', zoom: 1, cx: 0.5, cy: 0.5, smooth: false };
  const ZMIN = 1, ZMAX = 8;
  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function wsApply() {
    const z = ws.zoom, cx = ws.cx, cy = ws.cy;
    const trans = (ws.smooth && !reducedMotion)
      ? 'transform 0.5s cubic-bezier(.4,0,.2,1)' : 'none';
    [cviewOrig, cviewEnh].forEach((cv) => {
      if (cv.hidden) return;
      const vp = cv.getBoundingClientRect();
      const imgEl = cv.querySelector('.cimg');
      if (!vp.width || !imgEl) return;
      const tx = vp.width * (0.5 - z * cx);
      const ty = vp.height * (0.5 - z * cy);
      imgEl.style.transition = trans;
      imgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
    });
    // Slide Compare keeps the images at their original size — no zoom here.
    const pct = Math.round(z * 100);
    cmpZoomRead.textContent = pct + '%';
    cmpZoomRead.dataset.zoom = pct;
    zoomLabel.textContent = pct + '%';
  }

  function setViewMode(v) {
    ws.view = v;
    const slider = v === 'slider';
    paneOrig.classList.toggle('only', v === 'orig');
    paneEnh.classList.toggle('only', v === 'enh');
    paneOrig.hidden = v === 'enh' || slider;
    paneEnh.hidden = v === 'orig' || slider;
    if (paneSlider) paneSlider.hidden = !slider;
    document.querySelectorAll('.cmp-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === v));
    requestAnimationFrame(() => { ws.smooth = false; wsApply(); if (slider) wipeSet(wipePos); });
  }

  // ------------------------------------------------------------- wipe slider
  // Single-image before/after: Original on the left, Enhanced on the right.
  // Hold the handle (mouse / touch / arrow keys) and slide it sideways.
  const wipeView = $('#wipeView');
  const wipeOrig = $('#wipeOrig');
  const wipeEnh = $('#wipeEnh');
  const wipeHandle = $('#wipeHandle');
  const wipeLine = $('#wipeLine');
  const capSliderRes = $('#capSliderRes');
  let wipePos = 50;
  let wiping = false;

  function wipeSet(p) {
    wipePos = Math.max(2, Math.min(98, p));
    if (wipeOrig) wipeOrig.style.clipPath = 'inset(0 ' + (100 - wipePos) + '% 0 0)';
    if (wipeLine) wipeLine.style.left = wipePos + '%';
    if (wipeHandle) wipeHandle.style.left = wipePos + '%';
  }

  function wipeFromEvent(e) {
    const r = wipeView.getBoundingClientRect();
    if (!r.width) return wipePos;
    return ((e.clientX - r.left) / r.width) * 100;
  }

  function wipeStart(e) {
    wiping = true;
    try { wipeView.setPointerCapture(e.pointerId); } catch (err) { /* mouse/no-capture */ }
    wipeSet(wipeFromEvent(e));
    if (e.target !== wipeHandle) e.preventDefault();
  }

  function wipeMove(e) {
    if (!wiping) return;
    wipeSet(wipeFromEvent(e));
    e.preventDefault();
  }

  function wipeEnd() { wiping = false; }

  if (wipeView && wipeHandle) {
    wipeView.addEventListener('pointerdown', wipeStart);
    wipeView.addEventListener('pointermove', wipeMove);
    wipeView.addEventListener('pointerup', wipeEnd);
    wipeView.addEventListener('pointercancel', wipeEnd);
    wipeHandle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); wipeSet(wipePos - 3); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); wipeSet(wipePos + 3); }
      else if (e.key === 'Home') { e.preventDefault(); wipeSet(2); }
      else if (e.key === 'End') { e.preventDefault(); wipeSet(98); }
    });
  }

  function zoomApply(fromProgrammatic) {
    if (fromProgrammatic) {
      ws.smooth = true;
      wsApply();
      setTimeout(() => { ws.smooth = false; }, 560);
      return;
    }
    wsApply();
  }

  function clampZoom(z) { return Math.max(ZMIN, Math.min(ZMAX, z)); }

  function zoomBy(factor, px, py, viewport) {
    const cv = viewport || cviewOrig;
    const vp = cv.getBoundingClientRect();
    const z = ws.zoom;
    let cx = ws.cx, cy = ws.cy;
    if (px != null && vp.width) {
      const tx = vp.width * (0.5 - z * ws.cx);
      const ty = vp.height * (0.5 - z * ws.cy);
      cx = (px - tx) / (z * vp.width);
      cy = (py - ty) / (z * vp.height);
    }
    ws.zoom = clampZoom(z * factor);
    ws.cx = Math.max(0, Math.min(1, cx));
    ws.cy = Math.max(0, Math.min(1, cy));
    zoomApply();
  }

  function resetView() {
    ws.zoom = 1; ws.cx = 0.5; ws.cy = 0.5;
    setActiveFocus(null);
    updateIndicators(null);
    zoomApply(true);
  }

  // Original full-resolution image, cached as data URL per item for reuse.
  function originalSrc(item) {
    if (!item.origUrl) {
      item.origUrl = thumbBuffer(item.img, 4096).toDataURL('image/png');
    }
    return item.origUrl;
  }
function focusOn(name) {
    const item = activeItem || state.items.find((i) => i.id === activeCompareId);
    if (!item) return;
    const foci = (item.analysis) ? item.analysis.foci : null;
    const target = foci ? foci[name] : null;
    setActiveFocus(name);
    if (!target) { resetView(); return; }

    const boxW = {
      full: 1, face: 0.42, detail: 0.3, texture: 0.34, background: 0.5, text: 0.28
    }[name] || 0.3;
    ws.zoom = clampZoom(name === 'full' ? 1 : Math.max(1, 1 / boxW));
    ws.cx = (target.x != null && target.x) ? clamp01(target.x) : 0.5;
    ws.cy = (target.y != null && target.y) ? clamp01(target.y) : 0.5;
    updateIndicators(name);
    zoomApply(true);   // animated transition to the region
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function titleCase(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function setActiveFocus(name) {
    sessionsFocusBtns.forEach((b) => b.classList.toggle('active', b.dataset.focus === name));
  }

  function updateIndicators(name) {
    if (!imprPanel || !imprGrid) return; // metrics panel removed from UI
    const item = activeItem || state.items.find((i) => i.id === activeCompareId);
    if (!item || !item.enhAnalysis) { imprPanel.hidden = true; return; }
    const A = item.analysis, E = item.enhAnalysis;
    const imprTitle = $('#imprTitle');
    if (imprTitle) imprTitle.textContent = 'Quality Improvement' +
      ((name && name !== 'full') ? ' · ' + titleCase(name) : '');
    const cards = [];
    if (typeof A.quality === 'number' && typeof E.quality === 'number')
      cards.push(metricCard('Quality', A.quality + '/100', E.quality + '/100'));
    if (typeof A.sharpness === 'number' && typeof E.sharpness === 'number')
      cards.push(metricCard('Sharpness', A.sharpness + '/100', E.sharpness + '/100'));
    if (A.detail && E.detail) cards.push(metricCard('Detail', A.detail, E.detail));
    if (A.noise && E.noise && A.noise !== E.noise) cards.push(metricCard('Noise', A.noise, E.noise));
    if (!cards.length) { imprPanel.hidden = true; return; }
    imprGrid.innerHTML = '';
    cards.forEach((c) => imprGrid.appendChild(c));
    imprPanel.hidden = false;
  }

  function metricCard(name, from, to) {
    const el = document.createElement('div');
    el.className = 'impr-card';
    el.innerHTML = '<span class="impr-name">' + esc(name) + '</span>' +
      '<span class="impr-new"><b>' + esc(from) + '</b></span>' +
      '<span class="impr-arrow">→</span>' +
      '<span class="impr-old"><b>' + esc(to) + '</b></span>';
    return el;
  }

  // ------------------------------------------------------------- download format
  // Export the workspace image in the user-selected format (q82 for the
  // lossy ones). WebP unsupported → JPEG fallback; anything failing → PNG.
  function exportInFormat(canvas, fmt) {
    if (fmt === 'png') return { dataUrl: canvas.toDataURL('image/png'), mime: 'image/png', ext: 'png' };
    const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/webp';
    try {
      const url = canvas.toDataURL(mime, 0.82);
      if (url.indexOf('data:' + mime) === 0) return { dataUrl: url, mime: mime, ext: fmt };
    } catch (e) { /* fall through to fallback */ }
    if (fmt === 'webp') {
      try {
        const j = canvas.toDataURL('image/jpeg', 0.82);
        if (j.indexOf('data:image/jpeg') === 0) return { dataUrl: j, mime: 'image/jpeg', ext: 'jpg' };
      } catch (e) { /* fall through to PNG */ }
    }
    return { dataUrl: canvas.toDataURL('image/png'), mime: 'image/png', ext: 'png' };
  }

  function dataUrlBytes(u) {
    const i = u.indexOf(',');
    if (i < 0) return 0;
    return Math.round((u.length - i - 1) * 3 / 4);
  }

  function fmtLabel(f) { return f === 'jpg' ? 'JPEG' : f === 'png' ? 'PNG' : 'WebP'; }

  // Full-resolution canvas behind the workspace: the live enhanced canvas
  // for queue items, or a decoded copy of the image for history views.
  function wsCanvas(item) {
    if (item.enhancedCanvas) return Promise.resolve(item.enhancedCanvas);
    if (item._wsCanvas) return Promise.resolve(item._wsCanvas);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          item._wsCanvas = c;
          resolve(c);
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Could not load image.'));
      img.src = item.enhancedUrl;
    });
  }

  // Fill each format option with its real file size (computed once per
  // item, then cached) and show the size of the selected format.
  function refreshDlSizes() {
    const item = activeItem;
    if (!item || !downloadFormatSel) return;
    if (downloadSizeEl) downloadSizeEl.textContent = 'sizing…';
    wsCanvas(item).then((canvas) => {
      if (activeItem !== item) return; // user moved on
      item._sizeCache = item._sizeCache || {};
      ['webp', 'jpg', 'png'].forEach((f) => {
        if (!item._sizeCache[f]) {
          try { item._sizeCache[f] = dataUrlBytes(exportInFormat(canvas, f).dataUrl); } catch (e) { /* skip */ }
        }
      });
      Array.from(downloadFormatSel.options).forEach((opt) => {
        const b = item._sizeCache[opt.value];
        opt.textContent = fmtLabel(opt.value) + (b ? ' · ' + formatBytes(b) : '');
      });
      updateDlSizeLabel();
    }).catch(() => { if (downloadSizeEl) downloadSizeEl.textContent = ''; });
  }

  function updateDlSizeLabel() {
    const item = activeItem;
    if (!item || !downloadFormatSel || !downloadSizeEl) return;
    const b = item._sizeCache && item._sizeCache[downloadFormatSel.value];
    downloadSizeEl.textContent = b ? formatBytes(b) : '';
  }

  function wsDownloadName(item, ext) {
    // Measured dims (history views may have a different level selected).
    const c = item.enhancedCanvas || item._wsCanvas;
    const ew = c ? c.width : 0, eh = c ? c.height : 0;
    const s = (c && item.w) ? Math.round(ew / item.w) : (effectiveScale(item) || 1);
    return baseNoname(item.fileName) + '_x' + s + '_' +
      (ew || item.w * s) + 'x' + (eh || item.h * s) + '.' + ext;
  }
  function formatBytes(n) {
    if (!n || n <= 0) return '';
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function openCompare(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item || !item.enhancedUrl) return;
    activeCompareId = id;
    showWorkspace(item);
  }

  function showWorkspace(item, scroll) {
    activeItem = item;
    downloadRef = null;
    const aspect = item.h ? item.w / item.h : 1;
    cviewOrig.style.aspectRatio = aspect.toFixed(4);
    cviewEnh.style.aspectRatio = aspect.toFixed(4);
    // Fit the whole image on screen (desktop + mobile): cap the view width
    // so the resulting height never exceeds the viewport — no page scroll
    // needed to see the full image.
    try {
      const vh = (window.CSS && CSS.supports && CSS.supports('height: 100dvh')) ? '100dvh' : '100vh';
      const cap = 'max(240px, calc((' + vh + ' - 300px) * ' + aspect.toFixed(4) + '))';
      cviewOrig.style.maxWidth = cap;
      cviewEnh.style.maxWidth = cap;
      if (wipeView) wipeView.style.maxWidth = cap;
    } catch (e) { /* keep full-width fallback */ }
    cimgOrig.src = item.origUrl || originalSrc(item);
    cimgEnh.src = item.enhancedUrl;

    const scale = effectiveScale(item);
    const enhW = item.w * scale, enhH = item.h * scale;
    capOrigRes.textContent = item.w + '×' + item.h;
    capEnhRes.textContent = enhW + '×' + enhH;
    if (capSliderRes) capSliderRes.textContent = item.w + '×' + item.h + ' → ' + enhW + '×' + enhH;
    if (wipeView) wipeView.style.aspectRatio = aspect.toFixed(4);
    if (wipeEnh) wipeEnh.src = item.enhancedUrl;
    if (wipeOrig) wipeOrig.src = item.origUrl || originalSrc(item);
    wipeSet(50);
    metaOrig.textContent = 'Resolution ' + item.w + ' × ' + item.h +
      (item.origBytes ? ' · File ' + formatBytes(item.origBytes) : '');
    metaEnh.textContent = 'Resolution ' + enhW + ' × ' + enhH +
      (item.fileSize && item.fileSize.enh ? ' · File ' + formatBytes(item.fileSize.enh) : '');

    const noFace = !(item.analysis && item.analysis.foci && item.analysis.foci.face);
    const faceBtn = sessionsFocusBtns.find((b) => b.dataset.focus === 'face');
    if (faceBtn) { faceBtn.disabled = !!noFace; faceBtn.title = noFace ? 'No face detected in this image' : ''; }

    ws.view = 'slider'; ws.zoom = 1; ws.cx = 0.5; ws.cy = 0.5; ws.smooth = false;
    setViewMode('slider');
    if (imprPanel) imprPanel.hidden = true;
    compareModal.hidden = false;
    if (scroll !== false) {
      const smooth = !window.matchMedia ||
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      compareModal.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
    // Format picker: default to the stored format, then compute real sizes.
    if (downloadFormatSel) {
      const def = item.enhExt || 'webp';
      if (downloadFormatSel.querySelector('option[value="' + def + '"]')) downloadFormatSel.value = def;
      refreshDlSizes();
    }
    // Open zoomed into the highest-detail region so the improvement is
    // visible immediately (fit-to-screen makes 800px vs 3200px look same).
    requestAnimationFrame(() => {
      zoomApply();
      try { focusOn('detail'); } catch (e) { /* keep full view on failure */ }
    });
  }

  // ------------------------------------------------------------- history
  const historyGrid = $('#historyGrid');
  const historyEmpty = $('#historyEmpty');

  function renderHistory() {
    const list = History.readAll();
    historyEmpty.hidden = list.length > 0;
    historyGrid.innerHTML = '';
    list.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.dataset.id = entry.id;

      const thumbs = document.createElement('div');
      thumbs.className = 'h-thumbs';
      const o = document.createElement('div');
      o.className = 'h-thumb';
      const oImg = document.createElement('img'); oImg.src = entry.origThumb; oImg.alt = 'Original ' + entry.name;
      const oTag = document.createElement('i'); oTag.textContent = 'Original';
      o.appendChild(oImg); o.appendChild(oTag);
      const arrow = document.createElement('span'); arrow.className = 'h-arrow'; arrow.textContent = '→';
      const e = document.createElement('div');
      e.className = 'h-thumb';
      const eImg = document.createElement('img'); eImg.src = entry.enhThumb; eImg.alt = 'Enhanced ' + entry.name;
      const eTag = document.createElement('i'); eTag.textContent = entry.scale + '×';
      e.appendChild(eImg); e.appendChild(eTag);
      thumbs.appendChild(o); thumbs.appendChild(arrow); thumbs.appendChild(e);

      const body = document.createElement('div');
      body.className = 'h-body';
      const nm = document.createElement('div'); nm.className = 'h-name'; nm.textContent = entry.name;
      const meta = document.createElement('div'); meta.className = 'h-meta';
      meta.textContent = entry.origW + '×' + entry.origH + ' → ' + entry.enhW + '×' + entry.enhH;
      const status = document.createElement('span'); status.className = 'h-status'; status.textContent = 'Completed';
      const date = document.createElement('div'); date.className = 'h-date'; date.textContent = fmtDate(entry.date);
      body.appendChild(nm); body.appendChild(meta); body.appendChild(date);

      const acts = document.createElement('div');
      acts.className = 'h-actions';
      acts.appendChild(hBtn('View', () => viewHistory(entry), 'viewHistoryBtn'));
      acts.appendChild(hBtn('⬇', () => downloadHistory(entry), 'downloadHistoryBtn'));
      acts.appendChild(hBtn('🗑', () => deleteHistory(entry.id), 'deleteHistoryBtn'));

      card.appendChild(thumbs);
      card.appendChild(body);
      card.appendChild(acts);
      card.appendChild(status);
      historyGrid.appendChild(card);
    });
  }

  function hBtn(label, fn, key) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-ghost';
    b.textContent = label;
    b.dataset.action = key;
    b.addEventListener('click', fn);
    return b;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function viewHistory(entry) {
    // Rebuild the workspace from stored history data and recompute real metrics.
    // Full-size image resolves from the tab-session stash first (partial
    // cards), then the stored data URL, then the thumbnail.
    const fullSrc = sessionBlobs[entry.id] || entry.enhanced || entry.enhThumb || '';
    const enhImg = new Image();
    enhImg.onload = () => {
      const origImg = new Image();
      origImg.onload = () => {
        const pseudo = {
          id: entry.id,
          fileName: entry.name,
          img: origImg,
          w: entry.origW, h: entry.origH,
          enhancedUrl: fullSrc,
          enhancedCanvas: null,
          enhExt: entry.enhExt || 'png',
          origBytes: 0,
          fileSize: { enh: 0 },
          analysis: Enhancer.analyzeImage(origImg),
          enhAnalysis: Enhancer.analyzeImage(enhImg),
          origUrl: entry.origThumb
        };
        if (!pseudo.enhancedUrl) { showToast('Enhanced file unavailable.', 'err'); return; }
        showWorkspace(pseudo);
      };
      origImg.src = entry.origThumb;
    };
    enhImg.src = fullSrc;
    downloadRef = entry;
  }
  function downloadHistory(entry) {
    const fullSrc = sessionBlobs[entry.id] || entry.enhanced;
    if (!fullSrc) { showToast('File unavailable (was it cleared?).', 'err'); return; }
    downloadFile(fullSrc, entry.name + '_' + (entry.scale || entry.enhW / entry.origW) + 'x_' + entry.enhW + 'x' + entry.enhH + '.' + (entry.enhExt || 'png'));
    return;
  }

  function downloadItemInFormat(item, fmt) {
    fmt = fmt || item.enhExt || 'png';
    if (item.enhancedUrl && fmt === (item.enhExt || 'png')) {
      downloadFile(item.enhancedUrl, wsDownloadName(item, item.enhExt || 'png'));
      return;
    }
    wsCanvas(item).then((canvas) => {
      const exp = exportInFormat(canvas, fmt);
      const url = URL.createObjectURL(dataURLtoBlob(exp.dataUrl));
      downloadFile(url, wsDownloadName(item, exp.ext));
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }).catch(() => showToast('Could not prepare download.', 'err'));
  }

  function downloadHistoryInFormat(entry, fmt) {
    const fullSrc = sessionBlobs[entry.id] || entry.enhanced;
    if (!fullSrc) { showToast('File unavailable (was it cleared?).', 'err'); return; }
    fmt = fmt || entry.enhExt || 'png';
    const sc = entry.scale || Math.round(entry.enhW / entry.origW) || 1;
    const name = entry.name + '_' + sc + 'x_' + entry.enhW + 'x' + entry.enhH;
    if (fmt === (entry.enhExt || 'png')) { downloadFile(fullSrc, name + '.' + fmt); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const exp = exportInFormat(c, fmt);
        const url = URL.createObjectURL(dataURLtoBlob(exp.dataUrl));
        downloadFile(url, name + '.' + exp.ext);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) { showToast('Could not prepare download.', 'err'); }
    };
    img.onerror = () => showToast('Could not prepare download.', 'err');
    img.src = fullSrc;
  }
// ------------------------------------------------------------- events
  // Dropzone / file input
  dropzone.addEventListener('click', () => { if (!state.processing) fileInput.click(); });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  chooseFilesBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      if (state.processing) return;
      e.preventDefault(); dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => { if (e.type === 'drop') e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.processing) return;
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // Engine selection (AI vs Classic)
  document.querySelectorAll('input[name="engine"]').forEach((r) => {
    if (window.PixelForge.AI && r.value === window.PixelForge.AI.getEngine()) r.checked = true;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      window.PixelForge.AI.setEngine(r.value);
      const st = document.querySelector('#aiStatus');
      if (st) st.textContent = r.value === 'ai' ? 'AI loads on first enhance (~5MB).' : 'Classic: instant, softer.';
    });
  });

  // Level selection
  levelInputs.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.currentLevel = radio.value;
      if (radio.value === 'smart') showSmartAnalysis();
      else updateExpectedOutput();
      renderQueue();
      refreshActions();
    });
  });

  // Enhance / clear / download all
  enhanceBtn.addEventListener('click', enhanceAll);
  clearBtn.addEventListener('click', clearAll);
  downloadAllBtn.addEventListener('click', downloadAll);
  $('#enhanceAutomaticallyBtn').addEventListener('click', () => {
    const item = state.items[0];
    if (!item) return;
    // Use the recommended level from analysis.
    if (item.analysis && item.analysis.recommended) {
      levelInputs.forEach((r) => { r.checked = r.value === String(item.analysis.recommended); });
      state.currentLevel = String(item.analysis.recommended);
    }
    updateExpectedOutput();
    renderQueue();
    refreshActions();
    enhanceAll();
  });

  // Comparison workspace
  compareModal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', closeCompare));
  downloadOneBtn.addEventListener('click', () => {
    const fmt = downloadFormatSel ? downloadFormatSel.value : null;
    if (downloadRef) { downloadHistoryInFormat(downloadRef, fmt); return; }
    const item = state.items.find((i) => i.id === activeCompareId);
    if (item) downloadItemInFormat(item, fmt);
    else if (activeItem) downloadItemInFormat(activeItem, fmt);
  });
  if (downloadFormatSel) downloadFormatSel.addEventListener('change', updateDlSizeLabel);
  anotherBtn.addEventListener('click', () => {
    closeCompare();
    fileInput.click();
  });

  document.querySelectorAll('.cmp-mode').forEach((b) =>
    b.addEventListener('click', () => setViewMode(b.dataset.mode)));

  $('#zoomInBtn').addEventListener('click', () => zoomBy(1.4));
  $('#zoomOutBtn').addEventListener('click', () => zoomBy(1 / 1.4));
  $('#fitBtn').addEventListener('click', () => { ws.zoom = 1; ws.cx = 0.5; ws.cy = 0.5; zoomApply(); });
  $('#resetBtn').addEventListener('click', () => resetView());

  sessionsFocusBtns.forEach((b) =>
    b.addEventListener('click', () => focusOn(b.dataset.focus)));

  // Wheel zoom (any visible pane) — pivot at cursor.
  [cviewOrig, cviewEnh].forEach((cv) => {
    cv.addEventListener('wheel', (e) => {
      const rect = cv.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top);
      ws.smooth = false;
      e.preventDefault();
    }, { passive: false });

    // Pan via touch/mouse drag, and click/tap to zoom in to a point.
    cv.addEventListener('pointerdown', pointerPanDown);
    cv.addEventListener('pointermove', pointerPanMove);
    cv.addEventListener('pointerup', pointerPanUp);
    cv.addEventListener('pointerleave', pointerPanUp);

    // Pinch zoom on touch devices.
    cv.addEventListener('touchstart', pinchStart, { passive: false });
    cv.addEventListener('touchmove', pinchMove, { passive: false });
    cv.addEventListener('touchend', pinchEnd);
  });

  let pan = null;
  function pointerPanDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ws.smooth = false;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerPanMove(e) {
    if (!pan || pan.id !== e.pointerId) return;
    const rect = cviewOrig.getBoundingClientRect();
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    pan.moved = pan.moved || (Math.abs(dx) + Math.abs(dy) > 4);
    if (!rect.width) return;
    ws.cx = clamp01(ws.cx - dx / (ws.zoom * rect.width));
    ws.cy = clamp01(ws.cy - dy / (ws.zoom * rect.height));
    pan.x = e.clientX; pan.y = e.clientY;
    wsApply();
  }
  function pointerPanUp(e) {
    if (!pan || pan.id !== e.pointerId) return;
    const wasPan = pan;
    pan = null;
    // A tap (no drag) is a click -> zoom in to that point.
    if (!wasPan.moved && ws.zoom < ZMAX) {
      const rect = cviewOrig.getBoundingClientRect();
      zoomBy(2, e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  let pinch = null;
  function pinchStart(e) {
    if (e.touches.length === 2) {
      pinch = touchDist(e.touches);
      ws.smooth = false;
    }
  }
  function pinchMove(e) {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      const d = touchDist(e.touches);
      zoomBy(d / pinch, undefined, undefined);
      pinch = d;
    }
  }
  function pinchEnd() { pinch = null; }
  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function closeCompare() {
    compareModal.hidden = true;
    activeCompareId = null;
    activeItem = null;
    downloadRef = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCompare(); });

  // ------------------------------------------------------------- init
  function init() {
    refreshActions();
    renderHistory();
  }
  init();
})();