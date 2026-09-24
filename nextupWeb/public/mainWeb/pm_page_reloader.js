(function () {
  // Pages that need a fresh load when the active project changes.
  // Order matters — they reload top to bottom, 500 ms apart.
  const DATA_PAGES = [
    { id: "page1", src: () => `http://localhost:${port}/pointPlanning` },
    { id: "page2", src: () => `http://localhost:${port}/pathPlanning` },
    { id: "page3", src: () => `http://localhost:3003/` },
    { id: "page5", src: () => `http://localhost:${port}/doDiWeb` },
    { id: "page7", src: () => `http://localhost:${port}/mainTree` },
    { id: "page8", src: () => `http://localhost:${port}/clientControl` },
    { id: "page6", src: () => `http://localhost:${port}/error-handling` },
  ];

  const RELOAD_GAP_MS = 500;

  /**
   * Reload each data iframe in sequence, RELOAD_GAP_MS apart.
   * Re-assigning .src forces a full page reload even if the URL
   * hasn't changed, which is exactly what we need.
   */
  function reloadDataPages() {
    DATA_PAGES.forEach(({ id, src }, index) => {
      setTimeout(() => {
        const frame = document.getElementById(id);
        if (!frame) return;
        frame.src = src();          // reassign → triggers reload
        console.log(`[project reload] refreshed ${id} (${src()})`);
      }, index * RELOAD_GAP_MS);
    });
  }

  // Listen for the postMessage sent by the project manager iframe
  window.addEventListener("message", (event) => {
    // Security: only act on our own message type.
    // If you want to lock it to a specific origin replace "*" with
    // `http://localhost:${port}` in both ends.
    if (event.data?.type !== "projectLoaded") return;

    console.log(`[project reload] active project → "${event.data.name}", reloading pages…`);
    reloadDataPages();
  });
})();


 
