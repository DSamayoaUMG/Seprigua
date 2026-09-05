document.addEventListener("DOMContentLoaded", () => {
  const navbar = document.querySelector(".header .navbar");
  const links = [...document.querySelectorAll('.header .nav-link[href^="#"]')];
  if (!navbar || !links.length) return;

  navbar.querySelectorAll(".nav-shared-gear,.nav-shared-tuky").forEach(el => el.remove());
  links.forEach(link => link.querySelectorAll(".nav-gear-indicator").forEach(el => el.remove()));

  const holder = document.createElement("span");
  holder.className = "nav-shared-tuky";
  holder.setAttribute("aria-hidden","true");

  const video = document.createElement("video");
  video.className = "nav-tuky-walk";
  video.src = "assets/video/tuky-navbar-transparent.webm";
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.poster = "assets/img/tuky-navbar-fallback.png";
  video.setAttribute("muted","");
  video.setAttribute("playsinline","");

  const fallback = document.createElement("img");
  fallback.className = "nav-tuky-fallback";
  fallback.src = "assets/img/tuky-navbar-fallback.png";
  fallback.alt = "";
  fallback.hidden = true;

  holder.append(video,fallback);
  navbar.appendChild(holder);

  const play = () => {
    const p = video.play?.();
    if (p?.catch) p.catch(() => {});
  };

  video.addEventListener("loadeddata", () => {
    holder.classList.add("is-ready");
    play();
  }, {once:true});

  video.addEventListener("error", () => {
    video.hidden = true;
    fallback.hidden = false;
    holder.classList.add("is-ready");
  });

  let active = links.find(link => link.classList.contains("active")) || links[0];
  let moveTimer = 0;

  const moveTuky = (link, animate=true) => {
    if (!link) return;
    const navRect = navbar.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const x = Math.max(34, linkRect.left - navRect.left - 18);
    holder.style.setProperty("--tuky-x", `${x}px`);
    holder.classList.add("is-ready");
    if (animate) {
      holder.classList.add("is-moving");
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => holder.classList.remove("is-moving"), 320);
    }
  };

  const activate = (link, animate=true) => {
    if (!link) return;
    links.forEach(item => item.classList.toggle("active", item === link));
    const changed = link !== active;
    active = link;
    moveTuky(link, animate && changed);
  };

  const sections = links.map(link => ({
    link,
    section: document.getElementById(decodeURIComponent(link.hash.slice(1)))
  })).filter(item => item.section);

  links.forEach(link => link.addEventListener("click", () => activate(link)));

  let ticking = false;
  const syncFromScroll = () => {
    ticking = false;
    const markerY = Math.min(window.innerHeight * .34, 230);
    let current = sections[0]?.link;
    for (const item of sections) {
      const r = item.section.getBoundingClientRect();
      if (r.top <= markerY && r.bottom > markerY) {
        current = item.link;
        break;
      }
      if (r.top <= markerY) current = item.link;
    }
    activate(current);
  };

  const requestSync = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(syncFromScroll);
  };

  window.addEventListener("scroll", requestSync, {passive:true});
  window.addEventListener("resize", () => {
    moveTuky(active,false);
    requestSync();
  }, {passive:true});
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) play();
  });

  requestAnimationFrame(() => {
    moveTuky(active,false);
    syncFromScroll();
    play();
  });
});
