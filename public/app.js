(() => {
  const CLIP_SECONDS = 15_000;
  const DEFAULT_CELLS = 4;

  const grid = document.getElementById("grid");
  const cellsInput = document.getElementById("cellsInput");
  const applyBtn = document.getElementById("applyCells");
  const params = new URLSearchParams(location.search);

  const initialCells = (() => {
    const n = parseInt(params.get("cells") || "", 10);
    return Number.isFinite(n) && n > 0 ? Math.min(16, n) : DEFAULT_CELLS;
  })();

  if (cellsInput && applyBtn) {
    cellsInput.value = String(initialCells);
    applyBtn.addEventListener("click", () => {
      const n = parseInt(cellsInput.value || "", 10);
      const safe = Number.isFinite(n) && n > 0 ? Math.min(16, n) : DEFAULT_CELLS;
      params.set("cells", String(safe));
      location.search = params.toString();
    });
  }

  function pickRandom(videos, excludeSet) {
    if (!videos.length) return null;
    let attempt = 0;
    let chosen = null;
    do {
      chosen = videos[Math.floor(Math.random() * videos.length)];
      attempt += 1;
    } while (excludeSet && excludeSet.has(chosen.relPath) && attempt < 24);
    return chosen;
  }

  function createCell() {
    const wrapper = document.createElement("div");
    wrapper.className = "cell";
    const video = document.createElement("video");
    video.className = "vid";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = "auto";
    wrapper.appendChild(video);
    grid.appendChild(wrapper);
    return { wrapper, video };
  }

  function setVideo(videoEl, meta) {
    return new Promise((resolve) => {
      const src = `/stream?p=${encodeURIComponent(meta.relPath)}`;
      videoEl.src = src;

      const onLoadedMeta = () => {
        const duration = isFinite(videoEl.duration) ? videoEl.duration : 0;
        const clip = 15;
        const maxStart = Math.max(0, duration - clip - 0.25);
        const start = maxStart > 0 ? Math.random() * maxStart : 0;
        try { videoEl.currentTime = start; } catch (e) {}
        videoEl.play().catch(() => {});
        cleanup();
        resolve();
      };
      const onError = () => { cleanup(); resolve(); };
      const cleanup = () => {
        videoEl.removeEventListener("loadedmetadata", onLoadedMeta);
        videoEl.removeEventListener("error", onError);
      };
      videoEl.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
      videoEl.addEventListener("error", onError, { once: true });
      videoEl.load();
    });
  }

  function updateGrid(n) {
    grid.innerHTML = "";
    const cells = [];
    for (let i = 0; i < n; i += 1) {
      cells.push(createCell());
    }
    return cells;
  }

  async function main() {
    const resp = await fetch("/api/videos");
    const data = await resp.json();
    const videos = data.videos || [];

    if (!videos.length) {
      grid.innerHTML = "<div class="empty">No videos found. Set VIDEO_ROOT in .env or put files in ~/Videos</div>";
      return;
    }

    let cells = updateGrid(initialCells);

    async function fillAll() {
      const used = new Set();
      await Promise.all(
        cells.map(async (c) => {
          const meta = pickRandom(videos, used);
          if (meta) used.add(meta.relPath);
          await setVideo(c.video, meta);
        })
      );
    }

    await fillAll();

    setInterval(async () => {
      const used = new Set();
      for (const c of cells) {
        const meta = pickRandom(videos, used);
        if (meta) used.add(meta.relPath);
        await setVideo(c.video, meta);
      }
    }, CLIP_SECONDS);
  }

  main().catch((e) => {
    console.error(e);
  });
})();
