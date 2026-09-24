// Toast notification system
const toastContainer = document.getElementById('bt-toast-container');

// Function to clear all toasts
function clearAllToasts() {
    const toasts = toastContainer.querySelectorAll('.toast'); // Changed btToastContainer to toastContainer
    toasts.forEach(toast => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 500); // Match the removal animation duration
    });
}

function showToast(message, type = 'success', timeout = 3) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; // This creates class "toast success/warn/failure"

    const messageElement = document.createElement('span');
    messageElement.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bt-toast-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    });

    toast.appendChild(messageElement);
    toast.appendChild(closeBtn);

    if (timeout > 0) {
        const progressBar = document.createElement('div');
        progressBar.className = 'bt-progress-bar';

        const progress = document.createElement('div');
        progress.className = 'bt-progress';
        progress.style.transitionDuration = `${timeout}s`;

        progressBar.appendChild(progress);
        toast.appendChild(progressBar);
    }

    toastContainer.appendChild(toast);

    // Force reflow to enable transition
    void toast.offsetWidth;

    toast.classList.add('show');

    if (timeout > 0) {
        // Start progress bar animation
        setTimeout(() => {
            const progress = toast.querySelector('.bt-progress');
            if (progress) {
                progress.style.width = '0';
            }
        }, 50);

        // Auto-remove after timeout
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, timeout * 1000);
    }
}

// Subscribe to the toast topic
const toastTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/bt_toast_popup',
    messageType: 'std_msgs/String'
});

toastTopic.subscribe((message) => {
    const content = message.data;
    const parts = content.split(',');

    if (parts.length >= 1) {
        const msg = parts[0];
        const type = parts.length >= 2 ? parts[1].toLowerCase() : 'success';
        const timeout = parts.length >= 3 ? parseFloat(parts[2]) : 3;

        // Validate type
        const validTypes = ['success', 'warn', 'failure'];
        const toastType = validTypes.includes(type) ? type : 'success';

        showToast(msg, toastType, timeout);
    }
});

// Subscribe to the start_bt topic to clear toasts
const startBtTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/start_bt',
    messageType: 'std_msgs/Bool'
});

startBtTopic.subscribe(() => {
    clearAllToasts();
});
