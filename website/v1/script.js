/* Gzowo Builders landing page interactions */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const header = document.querySelector('[data-header]');
const rig = document.querySelector('[data-rig]');
const rigParts = rig ? [...rig.querySelectorAll('[data-part]')] : [];
const rigProgress = rig?.querySelector('[data-progress]');
const stressStage = document.querySelector('[data-stress]');
const rigNote = rig?.querySelector('.rig-note');

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const updateHeader = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 30);
};

const updateRig = () => {
  if (!rig || reducedMotion) return;
  const rect = rig.getBoundingClientRect();
  const viewport = window.innerHeight;
  const progress = clamp((viewport * 0.88 - rect.top) / (viewport * 0.82));
  rig.style.setProperty('--assembly', progress.toFixed(3));
  if (rigProgress) rigProgress.textContent = `${Math.round(progress * 100).toString().padStart(2, '0')}%`;
  rigParts.forEach((part, index) => {
    const delay = index * 0.055;
    const localProgress = clamp((progress - delay) / (1 - delay));
    const eased = 1 - Math.pow(1 - localProgress, 3);
    const startX = Number.parseFloat(part.style.getPropertyValue('--start-x')) || 0;
    const startY = Number.parseFloat(part.style.getPropertyValue('--start-y')) || 0;
    const startRotation = Number.parseFloat(part.style.getPropertyValue('--start-r')) || 0;
    part.style.setProperty('--tx', `${startX * (1 - eased)}px`);
    part.style.setProperty('--ty', `${startY * (1 - eased)}px`);
    part.style.setProperty('--r', `${startRotation * (1 - eased)}deg`);
  });
};

const updatePage = () => {
  updateHeader();
  updateRig();
};

if (rig && reducedMotion) {
  rigParts.forEach((part) => {
    part.style.setProperty('--tx', '0px');
    part.style.setProperty('--ty', '0px');
    part.style.setProperty('--r', '0deg');
  });
  if (rigProgress) rigProgress.textContent = '100%';
  if (rigNote) rigNote.textContent = 'Assembly complete';
}

if (rig && !reducedMotion) {
  rig.addEventListener('pointermove', (event) => {
    const rect = rig.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    rigParts.forEach((part, index) => {
      const depth = 1 + (index % 3) * 0.55;
      part.style.translate = `${x * depth * 4}px ${y * depth * 4}px`;
    });
  });
  rig.addEventListener('pointerleave', () => {
    rigParts.forEach((part) => { part.style.translate = '0 0'; });
  });
}

if (stressStage) {
  let stressValue = 35;

  const setStress = (value) => {
    stressValue = clamp(value, 0, 100);
    const stress = stressValue / 100;
    const roundedValue = Math.round(stressValue);
    const state = stressValue > 74 ? 'joint failure' : stressValue > 60 ? 'high stress' : 'joints holding';
    stressStage.setAttribute('aria-valuenow', String(roundedValue));
    stressStage.setAttribute('aria-valuetext', `${roundedValue} percent load, ${state}`);
    stressStage.style.setProperty('--stress', `${12 + stress * 88}%`);
    const bend = stress > 0.72 ? (stress - 0.72) * 23 : 0;
    stressStage.style.setProperty('--stress-rotation-a', `${bend * 0.35}deg`);
    stressStage.style.setProperty('--stress-rotation-b', `${bend * 0.6}deg`);
    stressStage.style.setProperty('--load-rotation', `${-2 + stress * 7}deg`);
    stressStage.style.setProperty('--crack', stress > 0.74 ? '1' : '0');
  };

  const updateStressFromPointer = (event) => {
    if (reducedMotion) return;
    const rect = stressStage.getBoundingClientRect();
    setStress(((event.clientX - rect.left) / rect.width) * 100);
  };

  stressStage.addEventListener('pointermove', updateStressFromPointer);
  stressStage.addEventListener('keydown', (event) => {
    const changes = {
      ArrowLeft: stressValue - 5,
      ArrowDown: stressValue - 5,
      ArrowRight: stressValue + 5,
      ArrowUp: stressValue + 5,
      Home: 0,
      End: 100
    };
    if (!(event.key in changes)) return;
    event.preventDefault();
    setStress(changes[event.key]);
  });
  setStress(stressValue);
}

document.querySelectorAll('[data-shot]').forEach((image) => {
  const markMissing = () => image.classList.add('is-missing');
  image.addEventListener('error', markMissing);
  if (image.complete && image.naturalWidth === 0) markMissing();
});

const revealItems = document.querySelectorAll('.reveal');
if (reducedMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach((item) => item.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  revealItems.forEach((item) => observer.observe(item));
}

document.querySelector('[data-year]').textContent = new Date().getFullYear();
window.addEventListener('scroll', updatePage, { passive: true });
window.addEventListener('resize', updateRig, { passive: true });
updatePage();
