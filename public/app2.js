(() => {
  const CLIP_MS = 15_000;
  const grid = document.getElementById('grid');
  const btnOpen = document.getElementById('btnOpen');
  const btnStart = document.getElementById('btnStart');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnPause = document.getElementById('btnPause');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnAudio = document.getElementById('btnAudio');
  const layoutSel = document.getElementById('layout');
  const params = new URLSearchParams(location.search);
  const dirPicker = document.getElementById('dirPicker');
  const dropHint = document.getElementById('dropHint');
  let hasAnyVideos = false;

  function markHasVideos() {
    if (!hasAnyVideos) {
      hasAnyVideos = true;
      try { dropHint?.remove(); } catch {}
    }
  }

  const layoutParam = params.get('layout') || '3x2';
  if (layoutSel) layoutSel.value = layoutParam;
  applyLayout(layoutParam);

  layoutSel?.addEventListener('change', () => {
    params.set('layout', layoutSel.value);
    history.replaceState(null, '', `?${params.toString()}`);
    applyLayout(layoutSel.value);
    rebuildGrid();
  });

  function pickRandom(list, excludeSet) {
    if (!list || list.length === 0) return null;
    let attempt = 0;
    let chosen = null;
    do {
      chosen = list[Math.floor(Math.random() * list.length)];
      attempt += 1;
    } while (excludeSet && (excludeSet.has(chosen.relPath || chosen.name)) && attempt < 24);
    return chosen;
  }

  function createCell() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cell';
    const video = document.createElement('video');
    video.className = 'vid';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    const corner = document.createElement('div');
    corner.className = 'corner';
    corner.textContent = 'muted';
    wrapper.appendChild(video);
    wrapper.appendChild(corner);
    grid.appendChild(wrapper);
    return { wrapper, video };
  }

  function setVideoServer(videoEl, meta) {
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
        videoEl.removeEventListener('loadedmetadata', onLoadedMeta);
        videoEl.removeEventListener('error', onError);
      };
      videoEl.addEventListener('loadedmetadata', onLoadedMeta, { once: true });
      videoEl.addEventListener('error', onError, { once: true });
      videoEl.load();
    });
  }

  let cells = [];
  function rebuildGrid() {
    grid.innerHTML = '';
    const { cols, rows } = getLayoutNumbers();
    const total = cols * rows;
    cells = [];
    for (let i = 0; i < total; i += 1) {
      cells.push(createCell());
    }
  }

  function applyLayout(key) {
    const { cols, rows } = parseLayoutKey(key);
    grid.style.setProperty('--cols', String(cols));
    grid.style.setProperty('--rows', String(rows));
    grid.dataset.cols = String(cols);
    grid.dataset.rows = String(rows);
  }

  function parseLayoutKey(key) {
    const m = String(key || '3x2').match(/^(\d+)x(\d+)$/);
    const cols = m ? Math.max(1, Math.min(6, parseInt(m[1], 10))) : 3;
    const rows = m ? Math.max(1, Math.min(6, parseInt(m[2], 10))) : 2;
    return { cols, rows };
  }

  function getLayoutNumbers() {
    return parseLayoutKey(layoutSel?.value || layoutParam);
  }

  async function main() {
    const serverVideos = await fetchServerVideos();
    if (!serverVideos.length) {
      grid.innerHTML = '<div class="empty">No videos found. Use "Add Folders" or set VIDEO_ROOT on the server.</div>';
    }
    rebuildGrid();
    await fillAllFromList(serverVideos);

    setInterval(async () => {
      const active = currentSourceList;
      await rotateAll(active);
    }, CLIP_MS);
  }

  main().catch((e) => {
    console.error(e);
  });

  // Data sources
  let currentSourceList = [];
  async function fetchServerVideos() {
    try {
      const resp = await fetch('/api/videos');
      const data = await resp.json();
      const list = (data.videos || []).map(v => ({ type: 'server', relPath: v.relPath, name: v.name }));
      currentSourceList = list;
      return list;
    } catch {
      currentSourceList = [];
      return [];
    }
  }

  // Local multi-folder picking without uploads: uses hidden input that supports multiple directories
  btnOpen?.addEventListener('click', () => {
    dirPicker?.click();
  });

  dirPicker?.addEventListener('change', async () => {
    const files = Array.from(dirPicker.files || []);
    const videoFiles = files.filter((f) => /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)$/i.test(f.name));
    if (videoFiles.length === 0) return;
    const additions = videoFiles.map((f) => ({ type: 'fs', file: f, name: f.name }));
    currentSourceList = mergeFsIntoList(currentSourceList, additions);
    rebuildGrid();
    await fillAllFromList(currentSourceList);
    dirPicker.value = '';
    markHasVideos();
  });

  // Drag-and-drop folders support (Finder multiple folders)
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!hasAnyVideos) dropHint?.removeAttribute('hidden');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.target === document || e.target === document.body) {
      dropHint?.setAttribute('hidden', '');
    }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropHint?.setAttribute('hidden', '');
    const items = Array.from(e.dataTransfer?.items || []);
    const entries = await getEntriesFromDataTransferItems(items);
    const files = [];
    for (const entry of entries) {
      await traverseEntry(entry, files);
    }
    const videoFiles = files.filter((f) => /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)$/i.test(f.name));
    if (videoFiles.length === 0) return;
    const additions = videoFiles.map((f) => ({ type: 'fs', file: f, name: f.name }));
    currentSourceList = mergeFsIntoList(currentSourceList, additions);
    rebuildGrid();
    await fillAllFromList(currentSourceList);
    markHasVideos();
  });

  async function getEntriesFromDataTransferItems(items) {
    const entries = [];
    for (const it of items) {
      const entry = it.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async function traverseEntry(entry, outFiles) {
    if (entry.isFile) {
      await new Promise((resolve) => entry.file((file) => { outFiles.push(file); resolve(); }));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      await new Promise((resolve) => {
        const acc = [];
        const readBatch = () => {
          reader.readEntries(async (ents) => {
            if (!ents.length) {
              resolve();
              return;
            }
            for (const e of ents) {
              await traverseEntry(e, outFiles);
            }
            readBatch();
          });
        };
        readBatch();
      });
    }
  }

  function fileKey(file) {
    return `${file.name}::${file.size}::${file.lastModified}`;
  }

  function itemKey(item) {
    if (item.type === 'fs' && item.file) return `fs:${fileKey(item.file)}`;
    if (item.type === 'server') return `server:${item.relPath}`;
    return Math.random().toString(36);
  }

  function mergeFsIntoList(existing, additions) {
    const order = [];
    const seen = new Set();
    for (const it of existing || []) {
      const k = itemKey(it);
      if (!seen.has(k)) { seen.add(k); order.push(it); }
    }
    for (const it of additions || []) {
      const k = itemKey(it);
      if (!seen.has(k)) { seen.add(k); order.push(it); }
    }
    return order;
  }

  // No local file collection; server handles recursive discovery

  async function fillAllFromList(list) {
    await Promise.all(cells.map(async (c) => {
      const meta = pickRandom(list, null);
      if (meta) await setVideoFromSource(c.video, meta);
    }));
  }

  async function rotateAll(list) {
    const used = new Set();
    for (const c of cells) {
      const meta = pickRandom(list, used);
      if (meta) used.add(meta.name || meta.relPath);
      await setVideoFromSource(c.video, meta);
    }
  }

  async function setVideoFromSource(videoEl, meta) {
    if (!meta) return;
    if (meta.type === 'server') {
      return setVideoServer(videoEl, meta);
    } else if (meta.type === 'fs') {
      const oldUrl = videoEl.dataset.blobUrl;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      const blobUrl = URL.createObjectURL(meta.file);
      videoEl.dataset.blobUrl = blobUrl;
      videoEl.src = blobUrl;
      return new Promise((resolve) => {
        const onLoadedMeta = () => {
          const duration = isFinite(videoEl.duration) ? videoEl.duration : 0;
          const clip = 15;
          const maxStart = Math.max(0, duration - clip - 0.25);
          const start = maxStart > 0 ? Math.random() * maxStart : 0;
          try { videoEl.currentTime = start; } catch {}
          videoEl.play().catch(() => {});
          cleanup();
          resolve();
        };
        const onError = () => { cleanup(); resolve(); };
        const cleanup = () => {
          videoEl.removeEventListener('loadedmetadata', onLoadedMeta);
          videoEl.removeEventListener('error', onError);
        };
        videoEl.addEventListener('loadedmetadata', onLoadedMeta, { once: true });
        videoEl.addEventListener('error', onError, { once: true });
        videoEl.load();
      });
    }
  }

  btnShuffle?.addEventListener('click', async () => {
    const list = currentSourceList;
    await rotateAll(list);
  });

  btnStart?.addEventListener('click', async () => {
    const vids = Array.from(document.querySelectorAll('video'));
    await Promise.all(vids.map(v => v.play().catch(() => {})));
  });

  btnPause?.addEventListener('click', () => {
    const vids = Array.from(document.querySelectorAll('video'));
    vids.forEach(v => v.pause());
  });

  btnFullscreen?.addEventListener('click', async () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      await (el.requestFullscreen?.call(el));
    } else {
      await (document.exitFullscreen?.call(document));
    }
  });

  btnAudio?.addEventListener('click', () => {
    const vids = Array.from(document.querySelectorAll('video'));
    const anyMuted = vids.some(v => v.muted);
    vids.forEach(v => { v.muted = !anyMuted; });
  });
})();


