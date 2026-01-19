(function() {
  const showcase = document.getElementById('product-showcase');
  if (!showcase) return;
  
  let current = 0;
  const total = 3;
  let autoplayInterval;
  let isPaused = false;
  
  // Get all elements
  const slides = showcase.querySelectorAll('[data-slide]');
  const bgs = showcase.querySelectorAll('[data-bg]');
  const bgImages = showcase.querySelectorAll('[data-bg-img]');
  const indicators = showcase.querySelectorAll('[data-indicator]');
  const dots = showcase.querySelectorAll('[data-goto]');
  const arrows = showcase.querySelectorAll('[data-dir]');
  
  function goTo(index) {
    // Normalize index
    current = ((index % total) + total) % total;
    
    // Update all elements
    [slides, bgs, bgImages, indicators].forEach(group => {
      group.forEach((el, i) => {
        el.classList.toggle('is-active', i === current);
      });
    });
    
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === current);
    });
  }
  
  function next() {
    goTo(current + 1);
  }
  
  function prev() {
    goTo(current - 1);
  }
  
  function startAutoplay() {
    stopAutoplay();
    autoplayInterval = setInterval(() => {
      if (!isPaused) next();
    }, 6000);
  }
  
  function stopAutoplay() {
    if (autoplayInterval) {
      clearInterval(autoplayInterval);
    }
  }
  
  // Event listeners
  arrows.forEach(arrow => {
    arrow.addEventListener('click', () => {
      const dir = parseInt(arrow.dataset.dir);
      goTo(current + dir);
      startAutoplay(); // Reset autoplay on interaction
    });
  });
  
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      goTo(parseInt(dot.dataset.goto));
      startAutoplay();
    });
  });
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  });
  
  // Touch/swipe support
  let touchStartX = 0;
  let touchStartY = 0;
  
  showcase.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  
  showcase.addEventListener('touchend', (e) => {
    const diffX = touchStartX - e.changedTouches[0].clientX;
    const diffY = touchStartY - e.changedTouches[0].clientY;
    
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
      if (diffX > 0) next();
      else prev();
      startAutoplay();
    }
  }, { passive: true });
  
  // Pause on hover/focus
  showcase.addEventListener('mouseenter', () => { isPaused = true; });
  showcase.addEventListener('mouseleave', () => { isPaused = false; });
  showcase.addEventListener('focusin', () => { isPaused = true; });
  showcase.addEventListener('focusout', () => { isPaused = false; });
  
  // Initialize
  goTo(0);
  startAutoplay();
})();