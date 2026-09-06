document.addEventListener("DOMContentLoaded", () => {
  const chatButton = document.getElementById("chatButton");
  const inicio = document.getElementById("inicio");

  if (!chatButton || !inicio) return;

  /* Evita duplicar el efecto si Live Server recarga parcialmente */
  if (!chatButton.dataset.premiumChatReady) {
    chatButton.dataset.premiumChatReady = "true";

    /* Shine */
    const shine = document.createElement("span");
    shine.className = "chat-ai-shine";
    shine.setAttribute("aria-hidden", "true");
    chatButton.appendChild(shine);

    /* Partículas */
    const particles = document.createElement("span");
    particles.className = "chat-ai-particles";
    particles.setAttribute("aria-hidden", "true");

    const colors = [
      "#ffffff",
      "#D9ECFF",
      "#8FC4FF",
      "#4A9CFF"
    ];

    for (let i = 0; i < 16; i++) {
      const particle = document.createElement("i");

      particle.style.setProperty(
        "--particle-x",
        `${12 + Math.random() * 76}%`
      );

      particle.style.setProperty(
        "--particle-y",
        `${18 + Math.random() * 64}%`
      );

      particle.style.setProperty(
        "--particle-size",
        `${1.3 + Math.random() * 2.1}px`
      );

      particle.style.setProperty(
        "--particle-delay",
        `${Math.random() * 1.8}s`
      );

      particle.style.setProperty(
        "--particle-duration",
        `${1.45 + Math.random() * 1.25}s`
      );

      particle.style.setProperty(
        "--particle-drift-x",
        `${-20 + Math.random() * 40}px`
      );

      particle.style.setProperty(
        "--particle-drift-y",
        `${-26 - Math.random() * 28}px`
      );

      particle.style.setProperty(
        "--particle-color",
        colors[Math.floor(Math.random() * colors.length)]
      );

      particles.appendChild(particle);
    }

    chatButton.appendChild(particles);

    /* Dos mini iconos de mensaje alrededor del icono principal */
    const icon = chatButton.querySelector(".chat-icon");

    if (icon) {
      const mini = document.createElement("span");
      mini.className = "chat-mini-messages";
      mini.setAttribute("aria-hidden", "true");

      for (let i = 1; i <= 2; i++) {
        const msg = document.createElement("i");
        msg.className = `chat-mini-message chat-mini-message-${i}`;
        msg.setAttribute("data-lucide", "message-circle");
        mini.appendChild(msg);
      }

      icon.appendChild(mini);
    }
  }

  /* Invitación flotante */
  let invite = document.querySelector(".chat-invite");

  if (!invite) {
    invite = document.createElement("aside");
    invite.className = "chat-invite";
    invite.setAttribute("aria-live", "polite");

    invite.innerHTML = `
      <span class="chat-invite__icon" aria-hidden="true">
        <i data-lucide="messages-square"></i>
      </span>

      <strong>¿Necesitas ayuda? Soy Tuky</strong>

      <p>
        Pregúntale a Tuky por servicios, emergencias, cotizaciones, garantía o cobertura.
      </p>

      <button
        class="chat-invite__close"
        type="button"
        aria-label="Cerrar invitación de Tuky"
      >
        <i data-lucide="x"></i>
      </button>
    `;

    document.body.appendChild(invite);
  }

  window.lucide?.createIcons();

  let dismissed = false;

  const setInviteVisible = (visible) => {
    if (dismissed) {
      invite.classList.remove("is-visible");
      return;
    }

    invite.classList.toggle("is-visible", visible);
  };

  invite
    .querySelector(".chat-invite__close")
    ?.addEventListener("click", () => {
      dismissed = true;
      invite.classList.remove("is-visible");
    });

  /*
    Solo se muestra mientras Inicio ocupa una parte importante
    de la pantalla. Al bajar a Nosotros/Servicios desaparece.
  */
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInviteVisible(
          entry.isIntersecting &&
          entry.intersectionRatio >= 0.28
        );
      },
      {
        threshold: [0, 0.15, 0.28, 0.45, 0.7],
        rootMargin: "-5% 0px -28% 0px"
      }
    );

    observer.observe(inicio);
  } else {
    const update = () => {
      const rect = inicio.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;

      setInviteVisible(
        rect.bottom > viewport * 0.45 &&
        rect.top < viewport * 0.55
      );
    };

    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  /*
    Pequeño retraso inicial para que la página cargue primero y
    la invitación no aparezca de golpe antes del Hero.
  */
  if (window.scrollY < 250) {
    invite.classList.remove("is-visible");

    window.setTimeout(() => {
      if (!dismissed) {
        const rect = inicio.getBoundingClientRect();

        if (
          rect.top < window.innerHeight * 0.55 &&
          rect.bottom > window.innerHeight * 0.45
        ) {
          invite.classList.add("is-visible");
        }
      }
    }, 900);
  }
});
