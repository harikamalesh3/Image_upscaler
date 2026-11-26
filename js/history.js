/* =====================================================================
   PixelForge AI — js/history.js
   "My Enhancements" — kept in sessionStorage for the current tab only.
   Survives a refresh, but clears automatically when the tab is closed.
   ===================================================================== */
(function (global) {
  'use strict';

  const KEY = 'pixelforge_history_session_v1';
  const LEGACY_KEY = 'pixelforge_history_v1'; // old localStorage key, removed once
  const MAX_ITEMS = 24;

  // One-time cleanup: drop the old persistent history so stale entries
  // from previous days don't linger or eat quota.
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}

  function store() {
    try {
      if (typeof sessionStorage !== 'undefined') return sessionStorage;
    } catch (e) {}
    return null;
  }

  function readAll() {
    try {
      const s = store();
      if (!s) return [];
      return JSON.parse(s.getItem(KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function writeAll(list) {
    try {
      const s = store();
      if (!s) return false;
      s.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // entry: { id, name, origW, origH, enhW, enhH, scale, date, origThumb, enhThumb, enhanced }
  // Returns true (stored fully), 'partial' (stored without the full-size
  // image — thumbnails + metadata only), or false (nothing stored).
  function add(entry) {
    const list = readAll();
    list.unshift(entry); // newest first
    if (writeAll(list)) return true;
    // Quota hit (full-size PNGs are heavy): retry keeping the card with
    // thumbnails + metadata. The caller keeps the full image in a
    // tab-session stash so View/Download still work until refresh.
    const slim = Object.assign({}, entry, { enhanced: '' });
    const slimList = readAll();
    slimList.unshift(slim);
    return writeAll(slimList) ? 'partial' : false;
  }

  function remove(id) {
    writeAll(readAll().filter((e) => e.id !== id));
  }

  function clear() {
    try { const s = store(); if (s) s.removeItem(KEY); } catch (e) {}
  }

  function uid() {
    return 'pf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  const History = { readAll, writeAll, add, remove, clear, uid };
  if (typeof module !== 'undefined' && module.exports) module.exports = History;
  global.PixelForge = global.PixelForge || {};
  global.PixelForge.History = History;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : global));