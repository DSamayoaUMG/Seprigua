document.addEventListener("DOMContentLoaded",()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  if(window.lucide) lucide.createIcons();

  const header=$("#header"), menuBtn=$("#mobileMenuButton"), navMenu=$("#navMenu"), scrollTopBtn=$("#scrollTop");
  const navLinks=$$(".nav-link"), sections=$$("main section[id]");
  const closeMenu=()=>{navMenu?.classList.remove("open");menuBtn?.classList.remove("active");document.body.classList.remove("menu-open");menuBtn?.setAttribute("aria-expanded","false")};
  const updateChrome=()=>{header?.classList.toggle("scrolled",scrollY>35);scrollTopBtn?.classList.toggle("visible",scrollY>500)};
  addEventListener("scroll",updateChrome,{passive:true}); updateChrome();
  menuBtn?.addEventListener("click",()=>{const open=!navMenu?.classList.contains("open");if(open){navMenu?.classList.add("open");menuBtn.classList.add("active");document.body.classList.add("menu-open");menuBtn.setAttribute("aria-expanded","true")}else closeMenu()});
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
  const emailButton = $("#contactEmailButton");

  const getContactData = () => {
    if (!form) return null;

    const data = new FormData(form);
    const value = (name) =>
      String(data.get(name) || "").trim();

    return {
      nombre: value("nombre"),
      correo: value("correo"),
      telefono: value("telefono"),
      empresa: value("empresa"),
      asunto: value("asunto"),
      mensaje: value("mensaje")
    };
  };

  const validateContactForm = () => {
    if (!form) return false;

    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }

    return true;
  };

  const buildContactMessage = (data) => {
    const lines = [
      "Hola SEPRIGUA, deseo solicitar atención.",
      "",
      `Nombre: ${data.nombre}`,
      `Correo: ${data.correo}`,
      data.telefono
        ? `Teléfono: ${data.telefono}`
        : null,
      data.empresa
        ? `Empresa: ${data.empresa}`
        : null,
      `Asunto: ${data.asunto}`,
      "",
      "Mensaje:",
      data.mensaje
    ];

    return lines.filter(Boolean).join("\n");
  };

  const showContactMessage = (text) => {
    if (!msg) return;

    msg.style.display = "block";
    msg.style.color = "#078343";
    msg.textContent = text;

    window.setTimeout(() => {
      msg.style.display = "none";
    }, 5000);
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateContactForm()) return;

    const data = getContactData();
    if (!data) return;

    const text = buildContactMessage(data);
    const whatsappUrl =
      "https://wa.me/50254108947?text=" +
      encodeURIComponent(text);

    window.open(
      whatsappUrl,
      "_blank",
      "noopener,noreferrer"
    );

    showContactMessage(
      "Se abrió WhatsApp con tu solicitud preparada."
    );
  });

  emailButton?.addEventListener("click", () => {
    if (!validateContactForm()) return;

    const data = getContactData();
    if (!data) return;

    const body = buildContactMessage(data);
    const subject =
      data.asunto || "Solicitud de atención SEPRIGUA";

    const gmailUrl =
      "https://mail.google.com/mail/?view=cm&fs=1" +
      "&to=gadministracion%40turamgt.com" +
      "&su=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    window.open(
      gmailUrl,
      "_blank",
      "noopener,noreferrer"
    );

    showContactMessage(
      "Se abrió Gmail con tu solicitud preparada."
    );
  });

  $("#chatButton")?.addEventListener("click",()=>{}); scrollTopBtn?.addEventListener("click",()=>scrollTo({top:0,behavior:"smooth"}));
});