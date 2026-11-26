/* =====================================================================
   PixelForge AI — js/showcase.js
   Interactivity for the "How PixelForge AI Works" technical showcase.
   All behaviour is scoped to #tech-showcase. No dependencies.
   ===================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('tech-showcase');
  if (!root) return;

  /* ---------------------------------------------- reveal on scroll */
  const revealEls = root.querySelectorAll('.ts-reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  /* ---------------------------------------------- tech cards: click to expand */
  root.querySelectorAll('.ts-tech').forEach((card) => {
    card.addEventListener('click', () => card.classList.toggle('open'));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.classList.toggle('open'); }
    });
  });

  /* ---------------------------------------------- pipeline steps accordion */
  root.querySelectorAll('.ts-step-head').forEach((head) => {
    head.addEventListener('click', () => head.closest('.ts-step').classList.toggle('open'));
  });
  // Open the first step by default so the pipeline reads naturally.
  const firstStep = root.querySelector('.ts-step');
  if (firstStep) firstStep.classList.add('open');

  /* ---------------------------------------------- file tree: click for explanation */
  const explainPanel = document.getElementById('tsExplainPanel');
  const treeBtns = root.querySelectorAll('.ts-tree button[data-explain]');
  treeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      treeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (explainPanel) {
        explainPanel.innerHTML = '<b>' + btn.textContent.trim() + '</b> — ' + btn.dataset.explain;
      }
    });
  });
  if (treeBtns.length) treeBtns[0].click();

  /* ---------------------------------------------- modals (Explain / Interview) */
  function wireModal(openBtnId, modalId) {
    const btn = document.getElementById(openBtnId);
    const modal = document.getElementById(modalId);
    if (!btn || !modal) return;
    const close = modal.querySelector('.ts-modal-close');
    const open = () => { modal.hidden = false; document.body.style.overflow = 'hidden'; };
    const shut = () => { modal.hidden = true; document.body.style.overflow = ''; };
    btn.addEventListener('click', open);
    if (close) close.addEventListener('click', shut);
    modal.addEventListener('click', (e) => { if (e.target === modal) shut(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) shut(); });
  }
  wireModal('tsExplainBtn', 'tsExplainModal');
  wireModal('tsInterviewBtn', 'tsInterviewModal');

  /* ---------------------------------------------- interview Q&A accordion */
  root.querySelectorAll('.ts-qa > button').forEach((q) => {
    q.addEventListener('click', () => q.closest('.ts-qa').classList.toggle('open'));
  });
  // Open the first question by default.
  const firstQa = root.querySelector('.ts-qa');
  if (firstQa) firstQa.classList.add('open');
})();