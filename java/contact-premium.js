(() => {
  "use strict";

  const section = document.getElementById("contacto");
  if (!section) return;

  const revealItems = section.querySelectorAll(".contact-premium-reveal");

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14 }
    );

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  // Re-render Lucide icons inserted by the premium contact markup.
  if (window.lucide?.createIcons) {
    window.lucide.createIcons();
  }
})();
