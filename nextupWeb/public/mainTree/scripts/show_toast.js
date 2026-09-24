//show_toast.js

function showToast(message, type = "success", time = 3) {
  const container = document.getElementById("tree-toast");
  if (!container) return console.warn("Toast container not found!");

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" title="Close">×</button>
  `;

  container.appendChild(toast);

  // Manual close button
  const close = () => {
    toast.style.animation = "toastSlideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector(".toast-close").onclick = close;

  // Auto remove after timeout
  if (time > 0) {
    setTimeout(close, time * 1000);
  }
}





function showConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const msgElem = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");

    msgElem.textContent = message;

    modal.classList.remove("hidden");

    const cleanup = () => {
      modal.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = null;
      document.removeEventListener("keydown", keyHandler);
    };

    okBtn.textContent = options.okText || "OK";
    cancelBtn.textContent = options.cancelText || "Cancel";

    okBtn.onclick = () => { cleanup(); resolve(true); };
    cancelBtn.onclick = () => { cleanup(); resolve(false); };

    // Keyboard: Enter = OK, Escape = Cancel
    function keyHandler(e) {
      if (e.key === "Enter")  { e.preventDefault(); cleanup(); resolve(true); }
      if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(false); }
    }
    document.addEventListener("keydown", keyHandler);
  });
}