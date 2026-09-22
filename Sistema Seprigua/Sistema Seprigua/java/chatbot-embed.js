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

  const openChatbot = () => {
    ensureLoaded();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("chatbot-is-open");
  };

  const closeChatbot = () => {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("chatbot-is-open");
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    openChatbot();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-chatbot-close]")) closeChatbot();
  });

  // La invitación la crea chat-effects.js; la delegación evita depender
  // del orden exacto en que el navegador ejecute ambos scripts.
  document.addEventListener("click", (event) => {
    if (event.target.closest(".chat-invite") && !event.target.closest(".chat-invite__close")) {
      openChatbot();
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type === "SEPRIGUA_CHATBOT_CLOSE") closeChatbot();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) closeChatbot();
  });
});
