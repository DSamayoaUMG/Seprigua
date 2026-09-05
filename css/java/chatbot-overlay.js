document.addEventListener("DOMContentLoaded", () => {
  const trigger = document.getElementById("chatButton");
  const overlay = document.getElementById("chatbotOverlay");
  const frame = document.getElementById("chatbotFrame");
  if (!trigger || !overlay || !frame) return;

  let loaded = false;
  const ensureLoaded = () => {
    if (loaded) return;
    frame.src = frame.dataset.src || "chatbot.html";
    loaded = true;
  };

  const open = () => {
    ensureLoaded();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden","false");
    document.body.classList.add("chatbot-is-open");
  };

  const close = () => {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden","true");
    document.body.classList.remove("chatbot-is-open");
  };

  trigger.addEventListener("click", e => {
    e.preventDefault();
    open();
  });

  overlay.addEventListener("click", e => {
    if (e.target.closest("[data-chatbot-close]")) close();
  });

  document.addEventListener("click", e => {
    if (e.target.closest(".chat-invite") && !e.target.closest(".chat-invite__close")) open();
  });

  window.addEventListener("message", e => {
    if (e.data?.type === "SEPRIGUA_CHATBOT_CLOSE") close();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) close();
  });
});
