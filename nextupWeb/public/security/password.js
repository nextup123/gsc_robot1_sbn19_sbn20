(function () {
    let PASSWORD = '1234'; // fallback

    // 🔁 CHANGE THIS PER PAGE
    const protectedElement = document.getElementById('path-testing-body');

    const btn = document.getElementById('secure-toggle-btn');
    const icon = document.getElementById('secure-toggle-icon');

    const overlay = document.getElementById('secure-lock-overlay');
    const input = document.getElementById('secure-lock-input');
    const error = document.getElementById('secure-lock-error');
    const submitBtn = document.getElementById('secure-lock-submit');
    const cancelBtn = document.getElementById('secure-lock-cancel');

    let unlocked = false;

    // ===============================
    // Load password from backend
    // ===============================
    async function loadPassword() {
        try {
            const res = await fetch(`${window.location.origin}/security/visualizer-password`, {
                cache: 'no-store'
            });

            if (!res.ok) throw new Error();

            const data = await res.json();
            if (data?.password) PASSWORD = String(data.password);
        } catch {
            console.warn('Secure lock: using fallback password');
        }
    }

    // ===============================
    // Lock / Unlock
    // ===============================
    function lock() {
        unlocked = false;
        protectedElement.style.display = 'none';

        btn.classList.remove('unlocked');
        btn.title = 'Locked';
        icon.textContent = '🔒';

        if (window.stopPathAnimator) {
            window.stopPathAnimator();
        }
    }

    function unlock() {
        unlocked = true;
        protectedElement.style.display = 'block';

        btn.classList.add('unlocked');
        btn.title = 'Unlocked';
        icon.textContent = '🔓';

        hideModal();
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }

    // ===============================
    // Modal
    // ===============================
    function showModal() {
        overlay.hidden = false;
        error.textContent = '';
        input.value = '';
        requestAnimationFrame(() => input.focus());
    }

    function hideModal() {
        overlay.hidden = true;
        input.blur();
    }

    function tryUnlock() {
        if (input.value === PASSWORD) {
            unlock();
        } else {
            error.textContent = '❌ Incorrect password';
            input.select();
        }
    }

    // ===============================
    // Events
    // ===============================
    btn.addEventListener('click', () => {
        unlocked ? lock() : showModal();
    });

    submitBtn.addEventListener('click', tryUnlock);
    cancelBtn.addEventListener('click', hideModal);

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') tryUnlock();
        if (e.key === 'Escape') hideModal();
    });

    // ===============================
    // Init
    // ===============================
    lock();
    loadPassword();
})();
