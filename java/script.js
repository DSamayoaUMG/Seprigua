document.addEventListener("DOMContentLoaded",()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  if(window.lucide) lucide.createIcons();

  const header=$("#header"), menuBtn=$("#mobileMenuButton"), navMenu=$("#navMenu"), scrollTopBtn=$("#scrollTop");
  const navLinks=$$(".nav-link"), sections=$$("main section[id]");
  const closeMenu = () => {
    navMenu?.classList.remove("open");
    menuBtn?.classList.remove("active");
    document.body.classList.remove("menu-open");
    menuBtn?.setAttribute("aria-expanded", "false");
    menuBtn?.setAttribute("aria-label", "Abrir menú");
  };
  const updateChrome=()=>{header?.classList.toggle("scrolled",scrollY>35);scrollTopBtn?.classList.toggle("visible",scrollY>500)};
  addEventListener("scroll",updateChrome,{passive:true}); updateChrome();
  if (menuBtn && navMenu) {
    menuBtn.addEventListener("click", () => {
      if (navMenu.classList.contains("open")) {
        closeMenu();
        return;
      }
      navMenu.classList.add("open");
      menuBtn.classList.add("active");
      document.body.classList.add("menu-open");
      menuBtn.setAttribute("aria-expanded", "true");
      menuBtn.setAttribute("aria-label", "Cerrar menú");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && navMenu.classList.contains("open")) {
        closeMenu();
        menuBtn.focus();
      }
    });
    document.addEventListener("click", event => {
      if (navMenu.classList.contains("open") &&
          !navMenu.contains(event.target) && !menuBtn.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    }, true);
  }
  navLinks.forEach(a=>a.addEventListener("click",closeMenu));
  addEventListener("resize",()=>{if(innerWidth>820)closeMenu()},{passive:true});

  /*
    V78:
    El estado activo del navbar lo controla exclusivamente
    navbar-gear-indicator.js. Antes había DOS sistemas distintos
    cambiando .active y por eso Cobertura podía quedarse marcada
    al entrar a Trabajos o Contacto.
  */
  if("IntersectionObserver" in window){
    const revealObs=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");revealObs.unobserve(e.target)}}),{threshold:.08,rootMargin:"0px 0px -45px"}); $$(".reveal").forEach(el=>revealObs.observe(el));
  }else $$(".reveal").forEach(el=>el.classList.add("visible"));

  const counters=$$("[data-counter]"), stats=$(".stats-panel"); let countersRun=false;
  const runCounters=()=>counters.forEach(el=>{const target=Number(el.dataset.counter)||0,start=performance.now(),duration=target>100?1400:1000;const tick=now=>{const p=Math.min((now-start)/duration,1);el.textContent=Math.floor(target*(1-Math.pow(1-p,3))).toLocaleString("es-GT");if(p<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)});
  if(stats&&"IntersectionObserver" in window)new IntersectionObserver(([e],obs)=>{if(e.isIntersecting&&!countersRun){countersRun=true;runCounters();obs.disconnect()}},{threshold:.35}).observe(stats);else runCounters();

  const track=$("#servicesTrack"), slides=$$(".service-slide"), prev=$("#servicePrev"), next=$("#serviceNext"), dotsWrap=$("#serviceDots"), carousel=$(".services-carousel"); let current=0,timer=null,touchX=0;
  if(track&&slides.length){
    slides.forEach((slide,i)=>{const dot=document.createElement("button");dot.type="button";dot.className="carousel-dot"+(i===0?" active":"");dot.setAttribute("aria-label",`Mostrar servicio ${i+1}`);dot.addEventListener("click",()=>{go(i);restart()});dotsWrap?.appendChild(dot);slide.classList.toggle("active",i===0)});
    const dots=$$(".carousel-dot");
    function go(i){current=(i+slides.length)%slides.length;track.style.transform=`translateX(-${current*100}%)`;slides.forEach((s,n)=>s.classList.toggle("active",n===current));dots.forEach((d,n)=>d.classList.toggle("active",n===current))}
    const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    function start(){if(reduced||document.hidden)return;clearInterval(timer);timer=setInterval(()=>go(current+1),6000)} function stop(){clearInterval(timer)} function restart(){stop();start()}
    prev?.addEventListener("click",()=>{go(current-1);restart()}); next?.addEventListener("click",()=>{go(current+1);restart()}); carousel?.addEventListener("mouseenter",stop); carousel?.addEventListener("mouseleave",start);
    carousel?.addEventListener("touchstart",e=>touchX=e.changedTouches[0].clientX,{passive:true}); carousel?.addEventListener("touchend",e=>{const dx=touchX-e.changedTouches[0].clientX;if(Math.abs(dx)>45){go(current+(dx>0?1:-1));restart()}},{passive:true}); document.addEventListener("visibilitychange",()=>document.hidden?stop():start()); start();
  }

  const form = $("#contactForm");
  const msg = $("#formMessage");
  const submitButton = form?.querySelector('button[type="submit"]');
  const turnstileContainer = $("#contactTurnstile");
  let turnstileWidgetId = null;
  let turnstileToken = "";
  let turnstileRequired = false;
  let contactSending = false;

  const loadExternalScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.turnstile) resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  async function initContactTurnstile() {
    if (!form || !turnstileContainer) return;
    try {
      const response = await fetch("/api/public/security-config", { credentials: "same-origin" });
      const config = await response.json().catch(() => ({}));
      const siteKey = String(config.turnstile_site_key || "").trim();
      turnstileRequired = Boolean(config.turnstile_required);
      if (!siteKey) return;

      await loadExternalScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
      if (!window.turnstile) throw new Error("Turnstile no disponible");
      turnstileContainer.hidden = false;
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: siteKey,
        theme: "light",
        action: "contact",
        size: turnstileContainer.clientWidth < 300 ? "compact" : "flexible",
        callback: token => { turnstileToken = token || ""; },
        "expired-callback": () => { turnstileToken = ""; },
        "error-callback": () => { turnstileToken = ""; }
      });
    } catch (_error) {
      if (turnstileRequired) {
        showFormMessage("La verificación anti-bot no pudo cargarse. Actualiza la página.", false);
      }
    }
  }

  const showFormMessage = (text, ok = true) => {
    if (!msg) return;

    msg.style.display = "block";
    msg.style.color = ok ? "#078343" : "#c92a43";
    msg.textContent = text;
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (contactSending) return;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (turnstileRequired && !turnstileToken) {
      showFormMessage("Completa la verificación anti-bot antes de enviar.", false);
      return;
    }

    contactSending = true;
    const originalButton = submitButton?.innerHTML || "";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      submitButton.textContent = "Enviando solicitud…";
    }

    showFormMessage("Enviando tu solicitud a SEPRIGUA…", true);

    try {
      const formData = new FormData(form);
      if (turnstileToken) formData.set("turnstile_token", turnstileToken);

      const response = await fetch(
        "/api/contacto",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json",
            "X-SEPRIGUA-Request": "1"
          },
          body: formData
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.ok !== true) {
        showFormMessage(
          data?.message || "No pudimos confirmar el envío. Intenta nuevamente en unos minutos.",
          false
        );
        return;
      }

      showFormMessage(
        "✓ Solicitud enviada correctamente. Nuestro equipo se pondrá en contacto contigo.",
        true
      );

      form.reset();
    } catch {
      showFormMessage(
        "Se interrumpió la conexión. Comprueba tu conexión e inténtalo nuevamente.",
        false
      );
    } finally {
      contactSending = false;
      turnstileToken = "";
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
        submitButton.innerHTML = originalButton;

        if (window.lucide) {
          lucide.createIcons();
        }
      }
      if (turnstileWidgetId !== null && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId);
      }
    }
  });

  initContactTurnstile();
  $("#chatButton")?.addEventListener("click",()=>{}); scrollTopBtn?.addEventListener("click",()=>scrollTo({top:0,behavior:"smooth"}));
});