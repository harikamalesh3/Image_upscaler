/* PixelForge AI local-device login. Not a substitute for server authentication. */
(function () {
  'use strict';
  var overlay = document.getElementById('pfAuthOverlay');
  if (!overlay) return;
  var form = document.getElementById('pfAuthForm');
  var title = document.getElementById('pfAuthTitle');
  var copy = document.getElementById('pfAuthCopy');
  var submit = document.getElementById('pfAuthSubmit');
  var switcher = document.getElementById('pfAuthSwitch');
  var error = document.getElementById('pfAuthError');
  var username = document.getElementById('pfAuthUser');
  var password = document.getElementById('pfAuthPassword');
  var createMode = false;
  var ACCOUNT_KEY = 'pixelforge_local_account_v1';
  var SESSION_KEY = 'pixelforge_local_session_v1';
  function account() { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch (_) { return null; } }
  function showApp() { overlay.hidden = true; document.body.classList.add('pf-authenticated'); }
  function setMode(create) {
    createMode = create; error.textContent = '';
    title.textContent = create ? 'Create your account' : 'Welcome back';
    copy.textContent = create ? 'Create a password for this browser and device.' : 'Sign in to open your image enhancement studio.';
    submit.textContent = create ? 'Create account' : 'Sign in';
    switcher.textContent = create ? 'Already registered? Sign in' : 'First time here? Create a local account';
    password.value = '';
    password.autocomplete = create ? 'new-password' : 'current-password';
  }
  function hex(bytes) { return Array.from(new Uint8Array(bytes)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function derive(pass, salt) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('Secure password storage is unavailable in this browser. Open the site through localhost (not a restricted file preview).'));
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    }).then(hex);
  }
  switcher.addEventListener('click', function () { setMode(!createMode); });
  form.addEventListener('submit', function (event) {
    event.preventDefault(); error.textContent = '';
    var user = username.value.trim().toLowerCase(); var pass = password.value;
    if (user.length < 3 || pass.length < 6) { error.textContent = 'Use a username of at least 3 characters and password of at least 6.'; return; }
    var saved = account();
    if (createMode) {
      if (saved) { error.textContent = 'An account already exists in this browser. Sign in instead.'; return; }
      var salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      derive(pass, salt).then(function (hash) {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ username: user, salt: salt, hash: hash }));
        sessionStorage.setItem(SESSION_KEY, '1'); showApp();
      }).catch(function (e) { error.textContent = e.message; });
    } else {
      if (!saved) { error.textContent = 'No local account found. Create one first.'; return; }
      if (saved.username !== user) { error.textContent = 'Username or password is incorrect.'; return; }
      derive(pass, saved.salt).then(function (hash) {
        if (hash !== saved.hash) { error.textContent = 'Username or password is incorrect.'; return; }
        sessionStorage.setItem(SESSION_KEY, '1'); showApp();
      }).catch(function (e) { error.textContent = e.message; });
    }
  });
  if (sessionStorage.getItem(SESSION_KEY) === '1') showApp();
  else setMode(!account());
})();
