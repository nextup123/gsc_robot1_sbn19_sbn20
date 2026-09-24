const thumb = document.getElementById('thumb');
const trackFill = document.getElementById('track-fill');
const valDisplay = document.getElementById('val-display');
const pubDot = document.getElementById('pub-dot');
const pubStatus = document.getElementById('pub-status');
const sliderArea = document.getElementById('slider-area');
 
const MIN = 0, MAX = 100;
let currentVal = 100;
let dragging = false;
let lastPublishedVal = null;
let animationTimeout = null;

function getTrackRect() {
  const ar = sliderArea.getBoundingClientRect();
  const R = 13;
  return { left: ar.left + R, width: ar.width - R * 2 };
}
 
function updateUI(v) {
  currentVal = Math.round(Math.min(MAX, Math.max(MIN, v)));
  const pct = (currentVal - MIN) / (MAX - MIN) * 100;
  thumb.style.left = pct + '%';
  trackFill.style.width = pct + '%';
  valDisplay.textContent = currentVal;
  thumb.setAttribute('aria-valuenow', currentVal);
}
 
function publish(v) {
  v = Math.round(Math.min(MAX, Math.max(MIN, v)));
 
  if (lastPublishedVal === v) return;
 
  if (lastPublishedVal !== null) {
    const step = v > lastPublishedVal ? 1 : -1;
    // Loop from lastPublishedVal+step to v inclusive (i !== v + step stops at v)
    for (let i = lastPublishedVal + step; i !== v + step; i += step) {
      updateUI(i);
      window.parent.postMessage({ type: 'SET_SPEED_INT8', payload: { value: i } }, '*');
    }
  } else {
    // No previous value — publish v directly
    updateUI(v);

    window.parent.postMessage({ type: 'SET_SPEED_INT8', payload: { value: v } }, '*');
  }
 
  lastPublishedVal = v;
}

// NEW: Smooth transition function
function smoothTransitionTo(targetValue, duration = 1500) {
  // Cancel any ongoing animation
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
  
  const startVal = currentVal;
  const target = Math.round(Math.min(MAX, Math.max(MIN, targetValue)));
  const totalSteps = Math.abs(target - startVal);
  
  if (totalSteps === 0) return;
  
  // Calculate step interval based on duration
  const stepInterval = Math.max(10, Math.min(50, duration / totalSteps));
  const totalDuration = stepInterval * totalSteps;
  const startTime = Date.now();
  
  function animateStep() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1, elapsed / totalDuration);
    
    // Ease in-out function for smoother motion
    const eased = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    const currentValue = Math.round(startVal + (target - startVal) * eased);
    
    // Publish the current value
    lastPublishedVal = null; // Reset to allow smooth publishing
    publish(currentValue);
    lastPublishedVal = currentValue;
    
    if (progress < 1) {
      // Continue animation
      animationTimeout = setTimeout(animateStep, stepInterval);
    } else {
      // Ensure we end exactly at target
      lastPublishedVal = null;
      publish(target);
      lastPublishedVal = target;
      animationTimeout = null;
    }
  }
  
  animateStep();
}

function clientXToVal(clientX) {
  const { left, width } = getTrackRect();
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round(MIN + ratio * (MAX - MIN));
}
 
// Mouse
thumb.addEventListener('mousedown', e => {
  e.preventDefault();
  dragging = true;
  lastPublishedVal = null;
  thumb.classList.add('dragging');
  // Cancel any ongoing animation when user starts dragging
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
});
 
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  e.preventDefault();
  publish(clientXToVal(e.clientX));
});
 
document.addEventListener('mouseup', () => {
  dragging = false;
  lastPublishedVal = null;
  thumb.classList.remove('dragging');
});
 
// Touch
thumb.addEventListener('touchstart', e => {
  e.preventDefault();
  dragging = true;
  lastPublishedVal = null;
  thumb.classList.add('dragging');
  // Cancel any ongoing animation when user starts dragging
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
}, { passive: false });
 
document.addEventListener('touchmove', e => {
  if (!dragging) return;
  e.preventDefault();
  publish(clientXToVal(e.touches[0].clientX));
}, { passive: false });
 
document.addEventListener('touchend', () => {
  dragging = false;
  lastPublishedVal = null;
  thumb.classList.remove('dragging');
});
 
// Keyboard
thumb.addEventListener('keydown', e => {
  let v = currentVal;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(MAX, v + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(MIN, v - 1);
  else return;
  e.preventDefault();
  lastPublishedVal = currentVal;
  publish(v);
  lastPublishedVal = null;
  // Cancel any ongoing animation when using keyboard
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
});
 
// Block track clicks
sliderArea.addEventListener('mousedown', e => {
  if (e.target !== thumb) { e.preventDefault(); e.stopPropagation(); }
});
sliderArea.addEventListener('touchstart', e => {
  if (e.target !== thumb) { e.preventDefault(); e.stopPropagation(); }
}, { passive: false });
 
// Initialize with smooth transition to 40 over 1.5 seconds
updateUI(100);
// Start the smooth transition after a small delay to ensure UI is ready
setTimeout(() => {
  smoothTransitionTo(40, 1500); // 40 over 1500ms (1.5 seconds)
}, 100);