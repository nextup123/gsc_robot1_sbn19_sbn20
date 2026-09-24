function rc_countdown() {

    // ─── CONFIG ───────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────

    const rc_overlay       = document.getElementById('rc_overlay');
    const rc_number        = document.getElementById('rc_number');
    const rc_button        = document.getElementById('start-btn');
    const rc_footer        = document.getElementById('rc_footer');
    const rc_dotsContainer = document.querySelector('.rc_dots');
    const rc_ringPath      = document.getElementById('rc_ringPath');

    const rc_totalSeconds = Math.round(rc_countdownTime / 1000);
    const rc_stepMs = rc_countdownTime / rc_totalSeconds;

    // Ring circumference for r=186
    const rc_circumference = 2 * Math.PI * 186;
    rc_ringPath.style.strokeDasharray = rc_circumference;
    rc_ringPath.style.strokeDashoffset = rc_circumference;

    // Build values array: [3, 2, 1, GO]
    const rc_values = [];
    for (let i = rc_totalSeconds; i >= 1; i--) {
        rc_values.push(String(i));
    }
    rc_values.push("GO");

    rc_number.textContent = rc_values[0];

    // Clear previous dots (important if function is called multiple times)
    rc_dotsContainer.innerHTML = "";

    // Build dots dynamically
    const rc_dotCount = Math.min(rc_totalSeconds, 8);
    const rc_dots = Array.from({ length: rc_dotCount }, () => {
        const d = document.createElement("div");
        d.className = "rc_dot";
        rc_dotsContainer.appendChild(d);
        return d;
    });

    if (rc_dotCount > 5) {
        rc_dotsContainer.style.gap = "5px";
    }

    function rc_setRing(rc_fraction) {
        rc_ringPath.style.strokeDashoffset =
            rc_circumference * (1 - rc_fraction);
    }

    function rc_setDot(rc_stepIndex) {
        const rc_dotIndex = Math.round(
            (rc_stepIndex / rc_totalSeconds) * rc_dotCount
        );

        rc_dots.forEach((d, i) => {
            d.classList.remove("rc_active", "rc_done");
            if (i < rc_dotIndex) d.classList.add("rc_done");
            if (i === rc_dotIndex) d.classList.add("rc_active");
        });
    }

    function rc_markAllDone() {
        rc_dots.forEach((d) => {
            d.classList.remove("rc_active");
            d.classList.add("rc_done");
        });
    }

    function rc_reset() {
        rc_number.textContent = rc_values[0];
        rc_number.classList.remove("rc_go", "rc_animate");

        rc_footer.textContent = "Please stand clear";
        rc_footer.classList.remove("rc_go_text");

        rc_dots.forEach((d) =>
            d.classList.remove("rc_active", "rc_done")
        );

        rc_ringPath.style.transition = "none";
        rc_setRing(0);
        rc_ringPath.style.stroke = "#3b82f6";

        // NOTE: button enable/disable is now owned entirely by
        // window.setStartButtonsEnabled (driven by ACTION_RESULT / the
        // safety timer in script.js). The countdown is purely visual and
        // must not re-enable the button on its own, since the server-side
        // change_mode -> overspeed -> start_bt sequence can still be
        // in-flight after the ~3s countdown finishes.
    }

    rc_overlay.classList.add("rc_show");

    let rc_index = 0;

    function rc_next() {
        const rc_val = rc_values[rc_index];
        const rc_isGo = rc_val === "GO";

        rc_number.classList.remove("rc_animate");
        void rc_number.offsetWidth;
        rc_number.classList.add("rc_animate");

        rc_number.textContent = rc_val;
        rc_number.classList.toggle("rc_go", rc_isGo);

        if (rc_isGo) {
            rc_ringPath.style.transition =
                `stroke-dashoffset ${rc_stepMs * 0.6}ms linear, stroke 0.3s`;
            rc_ringPath.style.stroke = "#4ade80";
            rc_setRing(1);
        } else {
            const rc_fillFraction = (rc_index + 1) / rc_totalSeconds;
            rc_ringPath.style.transition =
                `stroke-dashoffset ${rc_stepMs * 0.85}ms linear`;
            rc_setRing(rc_fillFraction);
        }

        if (rc_isGo) {
            rc_footer.textContent = "Activated!";
            rc_footer.classList.add("rc_go_text");
        } else {
            const rc_remaining = rc_totalSeconds - rc_index;

            rc_footer.textContent =
                rc_remaining > 2
                    ? "Please stand clear"
                    : rc_remaining === 2
                    ? "Almost ready…"
                    : "Brace yourself…";

            rc_footer.classList.remove("rc_go_text");
        }

        rc_isGo ? rc_markAllDone() : rc_setDot(rc_index);

        rc_index++;

        if (rc_index < rc_values.length) {
            setTimeout(rc_next, rc_stepMs);
        } else {
            setTimeout(() => {
                rc_overlay.classList.remove("rc_show");
                setTimeout(rc_reset, 380);
            }, 1000);
        }
    }

    rc_next();
}