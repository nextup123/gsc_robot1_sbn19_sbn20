// frontend - toast-system.js
// Toast notification manager with stacking, scrolling, and clear all

class ToastManager {
  constructor(containerId = 'bt-toast-container') {
    this.container = document.getElementById(containerId);
    this.toasts = new Map(); // toastId -> { element, timeout, duration }
    this.toastCounter = 0;
    this.initContainer();
  }

  initContainer() {
    if (!this.container) {
      console.error('Toast container not found');
      return;
    }

    // Add header with clear all button
    const header = document.createElement('div');
    header.className = 'toast-header';
    header.innerHTML = `
      <div class="toast-title">Notifications</div>
      <button class="toast-clear-all-btn" id="clearAllToasts">
        <i class="fa-solid fa-trash"></i> Clear All
      </button>
    `;
    this.container.appendChild(header);

    // Add scrollable container
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'toast-scroll-container';
    scrollContainer.id = 'toast-scroll-container';
    this.container.appendChild(scrollContainer);

    // Clear all button listener
    document.getElementById('clearAllToasts').addEventListener('click', () => {
      this.clearAll();
    });
  }

  show(message, category = 'info', duration = 5000) {
    const toastId = `toast-${this.toastCounter++}`;
    const scrollContainer = document.getElementById('toast-scroll-container');

    // Create toast element
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `toast toast-${category}`;

    const categoryIcon = this.getCategoryIcon(category);
    const durationText = duration === 0 ? '∞' : `${Math.round(duration / 1000)}s`;

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon">${categoryIcon}</div>
        <div class="toast-text">
          <div class="toast-message">${this.escapeHtml(message)}</div>
          <div class="toast-meta">
            <span class="toast-category">${category.toUpperCase()}</span>
            <span class="toast-duration">${durationText}</span>
          </div>
        </div>
      </div>
      <button class="toast-close-btn" data-toast-id="${toastId}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    scrollContainer.appendChild(toast);

    // Close button listener
    toast.querySelector('.toast-close-btn').addEventListener('click', () => {
      this.close(toastId);
    });

    // Auto-close if duration > 0
    let timeoutId = null;
    if (duration > 0) {
      timeoutId = setTimeout(() => {
        this.close(toastId);
      }, duration);
    }

    this.toasts.set(toastId, {
      element: toast,
      timeout: timeoutId,
      duration,
      category,
      message
    });

    // Fade in
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Update header visibility
    this.updateHeaderVisibility();

    return toastId;
  }

  close(toastId) {
    const toastData = this.toasts.get(toastId);
    if (!toastData) return;

    const { element, timeout } = toastData;

    // Clear timeout if exists
    if (timeout) clearTimeout(timeout);

    // Fade out
    element.classList.remove('show');

    // Remove after animation
    setTimeout(() => {
      element.remove();
      this.toasts.delete(toastId);
      this.updateHeaderVisibility();
    }, 300);
  }

  clearAll() {
    const toastIds = Array.from(this.toasts.keys());
    toastIds.forEach(id => this.close(id));
  }

  updateHeaderVisibility() {
    const header = this.container.querySelector('.toast-header');
    const scrollContainer = document.getElementById('toast-scroll-container');
    const hasToasts = scrollContainer.children.length > 0;

    if (hasToasts) {
      header.style.display = 'flex';
    } else {
      header.style.display = 'none';
    }
  }

  getCategoryIcon(category) {
    const icons = {
      'error': '<i class="fa-solid fa-circle-xmark"></i>',
      'failure': '<i class="fa-solid fa-triangle-exclamation"></i>',
      'warning': '<i class="fa-solid fa-exclamation"></i>',
      'success': '<i class="fa-solid fa-circle-check"></i>',
      'info': '<i class="fa-solid fa-circle-info"></i>',
    };
    return icons[category] || icons['info'];
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // Parse toast message format: "Message,category,duration"
  static parseToastMessage(str) {
    const parts = str.split(',');
    if (parts.length !== 3) {
      console.warn('Invalid toast format:', str);
      return null;
    }

    const message = parts[0].trim();
    const category = parts[1].trim().toLowerCase();
    const duration = parseInt(parts[2], 10);

    if (isNaN(duration)) {
      console.warn('Invalid duration:', parts[2]);
      return null;
    }

    return { message, category, duration };
  }
}

// Initialize globally
window.toastManager = new ToastManager('bt-toast-container');