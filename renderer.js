// ── DOM References ──────────────────────────────────────────────────────────
const playBtn = document.getElementById("playBtn");
const progressFill = document.getElementById("progressFill");
const progressBar = document.getElementById("progressBar");
const progressPreview = document.getElementById("progressPreview");
const progressTooltip = document.getElementById("progressTooltip");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const karaokeToggle = document.getElementById("karaokeToggle");
const contentArea = document.getElementById("contentArea");
const playerCard = document.getElementById("playerCard");
const lyricsEl = document.getElementById("lyrics");
const lyricsMessageEl = document.getElementById("lyricsMessage");
const stage = document.getElementById("stage");
const dragHandle = document.getElementById("dragHandle");
const sourceEl = document.getElementById("sourceApp");

const APP_ICONS = {
  "com.tidal.desktop":  "tidal",
  "com.tidal.tidal":    "tidal",
  "com.spotify.client": "spotify",
  "com.apple.Music":    "applemusic",
  "com.apple.iTunes":   "applemusic",
  "tv.plex.plexamp":    "plex",
  "com.amazon.music":   "amazonmusic",
  "com.youtube.music":  "youtubemusic",
};

// ── Marquee title ─────────────────────────────────────────────────────────────
const titleEl = document.querySelector(".meta h1");
let currentTitleText = "";
let marqueeTextWidth = 0;

function updateMarquee() {
  const isMarquee = titleEl.classList.contains("is-marquee");
  const containerW = titleEl.clientWidth;

  if (isMarquee) {
    if (marqueeTextWidth <= containerW + 1) {
      titleEl.classList.remove("is-marquee");
      titleEl.style.removeProperty("--marquee-duration");
      titleEl.style.removeProperty("--marquee-offset");
      titleEl.textContent = currentTitleText;
    }
    return;
  }

  if (titleEl.scrollWidth <= containerW + 1) return;

  marqueeTextWidth = titleEl.scrollWidth;
  const duration = Math.max(8, marqueeTextWidth / 35);

  titleEl.innerHTML =
    `<span class="marquee-inner">` +
    `<span class="marquee-text">${currentTitleText}</span>` +
    `<span class="marquee-text" aria-hidden="true">${currentTitleText}</span>` +
    `</span>`;
  titleEl.classList.add("is-marquee");

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const inner = titleEl.querySelector(".marquee-inner");
      const firstSpan = titleEl.querySelector(".marquee-text");
      if (!inner || !firstSpan) return;
      const oneUnit = firstSpan.getBoundingClientRect().width;
      titleEl.style.setProperty("--marquee-offset", `-${oneUnit}px`);
      titleEl.style.setProperty("--marquee-duration", `${duration}s`);
      inner.style.animation = "none";
      void inner.offsetWidth;
      inner.style.animation = "";
    })
  );
}

function setTitle(text) {
  currentTitleText = text;
  marqueeTextWidth = 0;
  titleEl.classList.remove("is-marquee");
  titleEl.style.removeProperty("--marquee-duration");
  titleEl.style.removeProperty("--marquee-offset");
  titleEl.textContent = text;
  requestAnimationFrame(() => requestAnimationFrame(updateMarquee));
}

new ResizeObserver(updateMarquee).observe(titleEl);

// ── Playback State ──────────────────────────────────────────────────────────
let progressRafId = null;
let positionAtLastSync = 0;
let lastSyncedAt = 0;
let isPlaying = false;
let simulatedDuration = 0;

function getSimulatedPosition() {
  if (!isPlaying) return positionAtLastSync;
  return Math.min(
    simulatedDuration,
    positionAtLastSync + (Date.now() - lastSyncedAt)
  );
}

function syncPosition(posMs, playing) {
  positionAtLastSync = posMs;
  lastSyncedAt = Date.now();
  isPlaying = playing;
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ── Lyrics (rendered by <am-lyrics>) ─────────────────────────────────────────
let amLyricsEl = null; // current <am-lyrics> element, one per track
let lyricsRequestId = 0;
let currentTrackKey = null;
let lyricsAnimationsPaused = false;
const pausedLyricAnimations = new Set();

const LYRICS_FONT = getComputedStyle(document.documentElement)
  .getPropertyValue("--font-sf")
  .trim();

// Adjustments applied inside am-lyrics' shadow root
const LYRICS_SHADOW_CSS = `
  .lyrics-header {
    display: var(--ok-lyrics-header-display, flex);
    justify-content: flex-end; opacity: 0; transition: opacity 0.25s ease;
  }
  :host(:hover) .lyrics-header { opacity: 1; }
  .lyrics-header .download-controls { display: none; }
  .lyrics-footer .version-info { display: none; }
`;

// am-lyrics' styles are constructed stylesheets, which Chromium drops when the
// element moves to another document (the PiP window) and never re-applies.
// Keep the originals and re-adopt them, rebuilt for the PiP document if needed.
let lyricsSheets = [];

function restoreLyricsStyles() {
  const root = amLyricsEl?.shadowRoot;
  if (!root || !lyricsSheets.length) return;
  const doc = amLyricsEl.ownerDocument;
  if (doc === document) {
    root.adoptedStyleSheets = lyricsSheets;
    return;
  }
  const View = doc.defaultView;
  root.adoptedStyleSheets = lyricsSheets.map((sheet) => {
    const copy = new View.CSSStyleSheet();
    copy.replaceSync([...sheet.cssRules].map((r) => r.cssText).join("\n"));
    return copy;
  });
}

function showLyricsMessage(message) {
  lyricsRequestId++;
  removeLyricsElement();
  lyricsEl.dataset.state = "message";
  lyricsMessageEl.textContent = message;
}

function removeLyricsElement() {
  pausedLyricAnimations.clear();
  lyricsAnimationsPaused = false;
  if (amLyricsEl) {
    amLyricsEl.remove();
    amLyricsEl = null;
  }
}

function mountLyrics(result) {
  removeLyricsElement();
  const el = document.createElement("am-lyrics");
  // Set ttml before connecting so am-lyrics never runs its own provider search
  el.ttml = result.ttml;
  el.highlightColor = "#ffffff";
  el.fontFamily = LYRICS_FONT;
  el.autoScroll = true;
  el.interpolate = true;
  el.currentTime = getSimulatedPosition();
  // am-lyrics labels TTML passed in directly as "Local"; pin the real source
  Object.defineProperty(el, "lyricsSource", { get: () => result.source, set() {} });
  el.addEventListener("line-click", (e) => {
    const posMs = e.detail.timestamp;
    window.nowPlaying.seek(posMs / 1000);
    syncPosition(posMs, isPlaying);
    seekLockUntil = Date.now() + 1500;
  });

  lyricsEl.appendChild(el);
  amLyricsEl = el;
  lyricsEl.dataset.state = "lyrics";
  lyricsEl.dataset.sync = result.sync;

  const style = document.createElement("style");
  style.textContent = LYRICS_SHADOW_CSS;
  el.shadowRoot?.prepend(style);
  lyricsSheets = el.shadowRoot ? [...el.shadowRoot.adoptedStyleSheets] : [];
  restoreLyricsStyles();

  if (result.romanized) el.showRomanization = true;
}

async function loadLyrics(data) {
  const requestId = ++lyricsRequestId;
  removeLyricsElement();
  lyricsEl.dataset.state = "message";
  lyricsMessageEl.textContent = "Loading lyrics\u2026";

  const result = await window.lyricsSources.findLyrics({
    title: data.title,
    artist: data.artist || "",
    album: data.album || "",
    duration: data.duration || 0,
  });
  if (requestId !== lyricsRequestId) return;

  if (result) mountLyrics(result);
  else showLyricsMessage("No lyrics found for this track");
}

function lyricsVisible() {
  return contentArea.classList.contains("karaoke-on");
}

// am-lyrics drives word wipes with CSS/Web Animations that keep running on
// their own, so freeze them while playback is paused or the panel is hidden.
function setLyricAnimationsPaused(paused) {
  const root = amLyricsEl?.shadowRoot;
  if (!root) return;
  if (paused) {
    for (const anim of root.getAnimations()) {
      if (anim.playState === "running") {
        anim.pause();
        pausedLyricAnimations.add(anim);
      }
    }
  } else if (lyricsAnimationsPaused) {
    for (const anim of pausedLyricAnimations) {
      if (anim.playState === "paused") anim.play();
    }
    pausedLyricAnimations.clear();
  }
  lyricsAnimationsPaused = paused;
}

function updateLyrics() {
  if (!amLyricsEl) return;
  const active = isPlaying && lyricsVisible();
  if (!active) {
    if (!lyricsAnimationsPaused) setLyricAnimationsPaused(true);
    // Keep position in sync for seeks while paused, then re-freeze
    const pos = getSimulatedPosition();
    if (lyricsVisible() && amLyricsEl.currentTime !== pos) {
      amLyricsEl.currentTime = pos;
      setLyricAnimationsPaused(true);
    }
    return;
  }
  if (lyricsAnimationsPaused) setLyricAnimationsPaused(false);
  amLyricsEl.currentTime = getSimulatedPosition();
}

// ── Progress ─────────────────────────────────────────────────────────────────
function updateProgress() {
  const posMs = getSimulatedPosition();
  const t = posMs / 1000;
  const dur = simulatedDuration / 1000;
  const percent = dur ? (t / dur) * 100 : 0;
  progressFill.style.width = `${percent}%`;
  currentTimeEl.textContent = formatTime(t);
  durationEl.textContent = formatTime(dur);
  // Fullscreen progress bar
  if (fsBarFill) fsBarFill.style.width = `${percent}%`;
  if (fsCurrentTime) fsCurrentTime.textContent = formatTime(t);
  if (fsDuration) fsDuration.textContent = formatTime(dur);
  updateLyrics();
}

function startProgressTick() {
  if (progressRafId) cancelAnimationFrame(progressRafId);
  function tick() {
    updateProgress();
    progressRafId = requestAnimationFrame(tick);
  }
  progressRafId = requestAnimationFrame(tick);
}

// ── Album art + color extraction ────────────────────────────────────────────
const artImg = document.querySelector(".art-panel img");

function extractAndApplyColor(imgEl) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(imgEl, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    const samples = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255,
        g = data[i + 1] / 255,
        b = data[i + 2] / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      let h = 0,
        s = 0;
      if (d > 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      samples.push({ h, s, l, chroma: s * (1 - Math.abs(2 * l - 1)) });
    }

    samples.sort((a, b) => b.chroma - a.chroma);
    const top = samples.slice(0, Math.max(1, Math.floor(samples.length * 0.2)));

    let sinSum = 0,
      cosSum = 0,
      sSum = 0;
    for (const p of top) {
      const rad = (p.h * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      sSum += p.s;
    }
    const h = Math.round(
      ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360
    );
    const s = Math.min(1, (sSum / top.length) * 1.3);

    const sP = Math.round(s * 100);
    const light = `hsl(${h},${sP}%,55%)`;
    const dark = `hsl(${h},${Math.round(s * 90)}%,18%)`;
    const mid = `hsl(${h},${Math.round(s * 95)}%,30%)`;

    contentArea.style.setProperty("--art-color-light", light);
    contentArea.style.setProperty("--art-color-dark", dark);
    contentArea.style.setProperty("--art-color-mid", mid);
  } catch (e) {
    /* cross-origin guard */
  }
}

function setArtUrl(url) {
  if (!url || artImg.src === url) return;
  artImg.crossOrigin = "anonymous";
  artImg.style.display = "";
  artImg.src = url;
  artImg.onload = () => extractAndApplyColor(artImg);
  // Fullscreen thumbnail
  const thumb = document.getElementById("fsThumb");
  if (thumb) { thumb.src = url; thumb.style.display = ""; }
}

// ── Now-Playing Observer ────────────────────────────────────────────────────
async function onTrackChange(data) {
  setTitle(data.title);
  document.querySelector(".meta p").textContent = data.artist || "";

  const iconSlug = APP_ICONS[data.bundleId];
  if (sourceEl) {
    if (iconSlug) {
      sourceEl.innerHTML = `<img src="https://cdn.simpleicons.org/${iconSlug}/white" alt="" />`;
      sourceEl.style.display = "";
    } else {
      sourceEl.style.display = "none";
    }
  }

  loadLyrics(data);

  // Fetch album art via iTunes Search API
  if (data.artist && data.title) {
    const trackKey = currentTrackKey;
    const artUrl = await window.albumArt.fetch(data.artist, data.title);
    if (artUrl && trackKey === currentTrackKey) setArtUrl(artUrl);
  }
}

window.nowPlaying.onUpdate((data) => {
  if (!data || !data.title) {
    console.log("[NowPlaying] No data:", data);
    // Nothing playing
    if (currentTrackKey !== null) {
      currentTrackKey = null;
      setTitle("OpenKaraoke");
      document.querySelector(".meta p").textContent = "Play a song in any app";
      if (sourceEl) sourceEl.style.display = "none";
      artImg.removeAttribute("src");
      artImg.style.display = "none";
      syncPosition(0, false);
      simulatedDuration = 0;
      showLyricsMessage("Play a song in any music app");
    }
    return;
  }

  // Update position and play state from MediaRemote
  const elapsedMs = (data.elapsedTime || 0) * 1000;
  const playing = data.playbackRate > 0 && data.playing;
  simulatedDuration = (data.duration || 0) * 1000;
  playBtn.classList.toggle("is-paused", playing);

  // Skip position update if we just seeked (prevents snap-back)
  if (Date.now() < seekLockUntil || progressDragging) {
    // keep our optimistic position
  } else if (playing && data.timestampEpoch) {
    const tsMs = data.timestampEpoch * 1000;
    const currentMs = elapsedMs + (Date.now() - tsMs) * data.playbackRate;
    syncPosition(Math.max(0, currentMs), true);
  } else {
    syncPosition(elapsedMs, false);
  }

  // Detect track change
  const trackKey = `${data.artist || ""}|${data.title}`;
  if (trackKey !== currentTrackKey) {
    currentTrackKey = trackKey;
    onTrackChange(data);
  }
});

startProgressTick();

// ── Playback controls (sends system media key events) ───────────────────────
playBtn.addEventListener("click", () => window.nowPlaying.playPause());
document.getElementById("prevBtn").addEventListener("click", () => window.nowPlaying.prev());
document.getElementById("nextBtn").addEventListener("click", () => window.nowPlaying.next());

// ── Progress bar seeking (drag + click) ──────────────────────────────────────
let progressDragging = false;
let seekTimer = null;
let seekLockUntil = 0; // ignore poll updates until this timestamp

function progressFromEvent(e) {
  const rect = progressBar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

function scrubTo(pct) {
  const posMs = pct * simulatedDuration;
  syncPosition(posMs, isPlaying);
  progressFill.style.transition = "none";
  progressFill.style.width = `${pct * 100}%`;
  // Lock out poll updates so bar doesn't snap back to old position
  seekLockUntil = Date.now() + 1500;
  // Debounce the actual seek command so we don't spam during drag
  clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    window.nowPlaying.seek(posMs / 1000);
    progressFill.style.transition = "";
  }, 80);
}

progressBar.addEventListener("mousedown", (e) => {
  if (!simulatedDuration) return;
  progressDragging = true;
  scrubTo(progressFromEvent(e));
  document.addEventListener("mousemove", onProgressDrag);
  document.addEventListener("mouseup", onProgressUp);
});

function onProgressDrag(e) {
  if (!progressDragging) return;
  scrubTo(progressFromEvent(e));
}

function onProgressUp(e) {
  if (!progressDragging) return;
  progressDragging = false;
  scrubTo(progressFromEvent(e));
  document.removeEventListener("mousemove", onProgressDrag);
  document.removeEventListener("mouseup", onProgressUp);
}

progressBar.addEventListener("mousemove", (e) => {
  if (progressDragging) return;
  const rect = progressBar.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const fraction = x / rect.width;
  const hoverTime = fraction * (simulatedDuration / 1000 || 0);
  progressTooltip.textContent = formatTime(hoverTime);
  progressTooltip.style.left = `${x}px`;
  const currentFraction = simulatedDuration > 0 ? getSimulatedPosition() / simulatedDuration : 0;
  progressPreview.style.width = fraction > currentFraction ? `${fraction * 100}%` : "0%";
});

progressBar.addEventListener("mouseleave", () => {
  if (!progressDragging) progressPreview.style.width = "0%";
});

// ── Volume slider ────────────────────────────────────────────────────────────
const volTrack = document.getElementById("volTrack");
const volFill = document.getElementById("volFill");
const volPreview = document.getElementById("volPreview");
const volThumb = document.getElementById("volThumb");
const volumeBtn = document.getElementById("volumeBtn");
let currentVolume = 0.8;

function applyVolume(v) {
  currentVolume = Math.max(0, Math.min(1, v));
  const pct = currentVolume * 100;
  volFill.style.height = `${pct}%`;
  volThumb.style.bottom = `${pct}%`;
  volumeBtn.classList.toggle("is-muted", currentVolume === 0);
}

applyVolume(0.8);

function volumeFromEvent(e) {
  const rect = volTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
}

let volDragging = false;

volTrack.addEventListener("mousemove", (e) => {
  if (volDragging) return;
  const hoverV = volumeFromEvent(e);
  volPreview.style.height = hoverV > currentVolume ? `${hoverV * 100}%` : "0%";
});
volTrack.addEventListener("mouseleave", () => { volPreview.style.height = "0%"; });
volTrack.addEventListener("mousedown", (e) => {
  volDragging = true;
  const v = volumeFromEvent(e);
  applyVolume(v);
  document.addEventListener("mousemove", onVolMove);
  document.addEventListener("mouseup", onVolUp);
});

function onVolMove(e) {
  if (!volDragging) return;
  applyVolume(volumeFromEvent(e));
}

function onVolUp(e) {
  if (!volDragging) return;
  volDragging = false;
  applyVolume(volumeFromEvent(e));
  document.removeEventListener("mousemove", onVolMove);
  document.removeEventListener("mouseup", onVolUp);
}

// ── Share / copy track info ──────────────────────────────────────────────────
const shareTooltip = document.getElementById("shareTooltip");
let shareTooltipTimer = null;

document.getElementById("shareBtn").addEventListener("click", () => {
  const title = currentTitleText;
  const artist = document.querySelector(".meta p").textContent;
  if (!title || title === "OpenKaraoke") return;
  navigator.clipboard.writeText(`${artist} - ${title}`);
  shareTooltip.classList.add("visible");
  clearTimeout(shareTooltipTimer);
  shareTooltipTimer = setTimeout(() => shareTooltip.classList.remove("visible"), 1000);
});

// ── Karaoke toggle ──────────────────────────────────────────────────────────
function setKaraoke(on) {
  contentArea.classList.toggle("karaoke-on", on);
  playerCard.classList.toggle("karaoke-on", on);
  karaokeToggle.setAttribute("aria-expanded", on.toString());
}

karaokeToggle.addEventListener("click", () =>
  setKaraoke(!contentArea.classList.contains("karaoke-on"))
);
document
  .getElementById("exitKaraokeBtn")
  .addEventListener("click", () => setKaraoke(false));

// ── Drag to move window ─────────────────────────────────────────────────────
let isDragging = false;
let dragScreenStartX = 0,
  dragScreenStartY = 0;
let dragWinStartX = 0,
  dragWinStartY = 0;

dragHandle.addEventListener("mousedown", async (e) => {
  isDragging = true;
  dragScreenStartX = e.screenX;
  dragScreenStartY = e.screenY;
  const [wx, wy] = await window.electronWindow.getPos();
  dragWinStartX = wx;
  dragWinStartY = wy;
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
});

function onDragMove(e) {
  if (!isDragging) return;
  const dx = e.screenX - dragScreenStartX;
  const dy = e.screenY - dragScreenStartY;
  window.electronWindow.setPos(dragWinStartX + dx, dragWinStartY + dy);
}

function onDragEnd() {
  isDragging = false;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}

// ── Resize window ────────────────────────────────────────────────────────────
const MIN_W = 280,
  MIN_H = 380;
let isResizing = false,
  resizeDir = "";
let resizeStartX = 0,
  resizeStartY = 0;
let resizeStartW = 0,
  resizeStartH = 0;
let resizeWinStartX = 0,
  resizeWinStartY = 0;

document.querySelectorAll(".resize-edge").forEach((edge) => {
  edge.addEventListener("mousedown", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeDir = edge.dataset.dir;
    resizeStartX = e.screenX;
    resizeStartY = e.screenY;
    const [w, h] = await window.electronWindow.getSize();
    const [wx, wy] = await window.electronWindow.getPos();
    resizeStartW = w;
    resizeStartH = h;
    resizeWinStartX = wx;
    resizeWinStartY = wy;
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  });
});

function onResizeMove(e) {
  if (!isResizing) return;
  const dx = e.screenX - resizeStartX;
  const dy = e.screenY - resizeStartY;

  let newW = resizeStartW;
  let newH = resizeStartH;
  let newX = resizeWinStartX;
  let newY = resizeWinStartY;

  if (resizeDir.includes("e")) newW = Math.max(MIN_W, resizeStartW + dx);
  if (resizeDir.includes("w")) {
    newW = Math.max(MIN_W, resizeStartW - dx);
    newX = resizeWinStartX + (resizeStartW - newW);
  }
  if (resizeDir.includes("s")) newH = Math.max(MIN_H, resizeStartH + dy);
  if (resizeDir.includes("n")) {
    newH = Math.max(MIN_H, resizeStartH - dy);
    newY = resizeWinStartY + (resizeStartH - newH);
  }

  window.electronWindow.setSize(newW, newH);
  window.electronWindow.setPos(newX, newY);
}

function onResizeEnd() {
  isResizing = false;
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", onResizeEnd);
}

// ── Picture-in-Picture ──────────────────────────────────────────────────────
const appEl = document.querySelector(".app");
const stylesheetHref = document.querySelector("link[rel='stylesheet']").href;

async function openPiP() {
  if (!window.documentPictureInPicture) return;
  if (window.documentPictureInPicture.window) return;
  try {
    const w = stage.offsetWidth;
    const h = playerCard.offsetHeight;
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: w + 24,
      height: h + 24,
      disallowReturnToOpener: false,
    });
    const link = pipWindow.document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheetHref;
    pipWindow.document.head.appendChild(link);
    pipWindow.document.body.style.cssText =
      "margin:0;padding:12px;background:#000;display:flex;" +
      "align-items:center;justify-content:flex-end;min-height:100vh;box-sizing:border-box;";
    pipWindow.document.body.appendChild(stage);
    restoreLyricsStyles();
    pipWindow.addEventListener("pagehide", () => {
      appEl.appendChild(stage);
      restoreLyricsStyles();
    });
  } catch (e) {
    console.warn("PiP unavailable:", e);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) openPiP();
});

let isDimmed = false;
document.getElementById("opacityBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  isDimmed = !isDimmed;
  window.electronWindow.setOpacity(isDimmed ? 0.5 : 1);
});

document.getElementById("minimizeBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  window.electronWindow.minimize();
});

// ── Traffic lights: subtle press-and-drag give ───────────────────────────────
// A pressed light leans toward the pointer and springs back on release.
// Deliberately restrained: ~2px of travel and under 1px of stretch.
const LIGHT_DOT = 12;
const LIGHT_MAX_STRETCH = 0.8;
const LIGHT_OFFSET_MAX = 2;
const LIGHT_OFFSET_SOFTNESS = 60;
const LIGHT_STRETCH_SOFTNESS = 40;
const LIGHT_FOLLOW = { stiffness: 420, damping: 34 };
const LIGHT_RELEASE = { stiffness: 400, damping: 32 };
const LIGHT_AXES = ["x", "y", "stretchX", "stretchY"];
const LIGHT_REST = { x: 0, y: 0, stretchX: 0, stretchY: 0 };

function lightPose(dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) return { ...LIGHT_REST };
  const offset = LIGHT_OFFSET_MAX * Math.tanh(dist / LIGHT_OFFSET_SOFTNESS);
  const stretch = LIGHT_MAX_STRETCH * Math.tanh(dist / LIGHT_STRETCH_SOFTNESS);
  const px = Math.sqrt(Math.abs(dx));
  const py = Math.sqrt(Math.abs(dy));
  const wx = px / (px + py);
  const wy = py / (px + py);
  const minStretch = -(LIGHT_DOT * 0.1);
  return {
    x: (dx / dist) * offset,
    y: (dy / dist) * offset,
    // Preserve area: stretching along one axis squeezes the other
    stretchX: Math.max(minStretch, stretch * wx - stretch * wy),
    stretchY: Math.max(minStretch, stretch * wy - stretch * wx),
  };
}

function mountTrafficLight(hit) {
  const light = hit.querySelector(".light");
  let mode = "idle"; // idle | drag | release
  let origin = { x: 0, y: 0 };
  let current = { ...LIGHT_REST };
  let velocity = { ...LIGHT_REST };
  let target = { ...LIGHT_REST };
  let pointerId = null;
  let raf = 0;

  const write = () => {
    light.style.setProperty("--x", `${current.x}px`);
    light.style.setProperty("--y", `${current.y}px`);
    light.style.setProperty("--stretch-x", `${current.stretchX}px`);
    light.style.setProperty("--stretch-y", `${current.stretchY}px`);
  };

  const animate = () => {
    if (raf) return;
    let prev = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - prev) / 1000, 0.032);
      prev = now;
      const goal = mode === "release" ? LIGHT_REST : target;
      const { stiffness, damping } = mode === "release" ? LIGHT_RELEASE : LIGHT_FOLLOW;
      for (const axis of LIGHT_AXES) {
        velocity[axis] += (-stiffness * (current[axis] - goal[axis]) - damping * velocity[axis]) * dt;
        current[axis] += velocity[axis] * dt;
      }
      const err = Math.hypot(...LIGHT_AXES.map((a) => current[a] - goal[a]));
      const speed = Math.hypot(...LIGHT_AXES.map((a) => velocity[a]));
      const settled = err < 0.02 && speed < 0.2;
      if (mode === "release" && settled) {
        current = { ...LIGHT_REST };
        velocity = { ...LIGHT_REST };
        mode = "idle";
      }
      write();
      raf = mode === "drag" || !settled ? requestAnimationFrame(tick) : 0;
    };
    raf = requestAnimationFrame(tick);
  };

  hit.addEventListener("mousedown", (e) => e.stopPropagation()); // don't drag the window
  hit.addEventListener("pointerdown", (e) => {
    pointerId = e.pointerId;
    mode = "drag";
    origin = { x: e.clientX, y: e.clientY };
    target = { ...LIGHT_REST };
    animate();
  });
  window.addEventListener("pointermove", (e) => {
    if (mode !== "drag" || e.pointerId !== pointerId) return;
    target = lightPose(e.clientX - origin.x, e.clientY - origin.y);
    animate();
  });
  const release = (e) => {
    if (mode !== "drag" || e.pointerId !== pointerId) return;
    pointerId = null;
    mode = "release";
    animate();
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

document.querySelectorAll(".light-hit").forEach(mountTrafficLight);

// ── Fullscreen mode ──────────────────────────────────────────────────────────
const fsThumb = document.getElementById("fsThumb");
const fsBarFill = document.getElementById("fsBarFill");
const fsCurrentTime = document.getElementById("fsCurrentTime");
const fsDuration = document.getElementById("fsDuration");
const fsBar = document.getElementById("fsBar");
let isFullscreen = false;

document.getElementById("fullscreenBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  window.electronWindow.toggleFullscreen();
  isFullscreen = !isFullscreen;
  playerCard.classList.toggle("is-fullscreen", isFullscreen);
  // In fullscreen, force karaoke-on so lyrics panel is visible
  if (isFullscreen) {
    contentArea.classList.add("karaoke-on");
    playerCard.classList.add("karaoke-on");
  }
});

function exitFullscreen() {
  window.electronWindow.exitFullscreen();
  isFullscreen = false;
  playerCard.classList.remove("is-fullscreen");
  playerCard.classList.remove("fs-controls-visible");
  document.body.style.cursor = "";
}

document.getElementById("fsExitBtn").addEventListener("click", exitFullscreen);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isFullscreen) exitFullscreen();
});

// Auto-hide controls + cursor in fullscreen
let fsIdleTimer = null;
document.addEventListener("mousemove", () => {
  if (!isFullscreen) return;
  playerCard.classList.add("fs-controls-visible");
  document.body.style.cursor = "";
  clearTimeout(fsIdleTimer);
  fsIdleTimer = setTimeout(() => {
    playerCard.classList.remove("fs-controls-visible");
    document.body.style.cursor = "none";
  }, 3000);
});

// Seek from fullscreen progress bar
if (fsBar) {
  fsBar.addEventListener("click", (ev) => {
    if (!simulatedDuration) return;
    const rect = fsBar.getBoundingClientRect();
    const pct = (ev.clientX - rect.left) / rect.width;
    const posSec = pct * (simulatedDuration / 1000);
    window.nowPlaying.seek(posSec);
    syncPosition(posSec * 1000, isPlaying);
  });
}

// ── Timing helper ────────────────────────────────────────────────────────────
const TIMING_LYRICS = [
  "Again, had to call it off again",
  "Again, guess we're better off as friends",
  'Wait, give me space, I said, "Boy, get out my face"',
  "It's okay, you can't relate, yeah, had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "(Had to call it off again)",
  "It's like you're tongue-tied, tied, tied",
  "And you act out of your mind",
  "'Cause your vision of us shattered right in front of your eyes",
  "Speak your truth, don't hold back",
  "Long as it ain't behind my back",
  "I know it's hard being sincere when it feels like it's all bad (like it's all bad)",
  "Just smile, the world is watching",
  "They seem so concerned",
  "But they can't tell me nothin'",
  "I might just let it burn",
  "You lost that fire for me (for me)",
  "I know I let you go (you go)",
  "Still at the same old place",
  "I'm just a call away",
  "Again, had to call it off again",
  "Again, guess we're better off as friends",
  'Wait, give me space, I said, "Boy, get out my face"',
  "It's okay, you can't relate, yeah, had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "(Had to call it off again)",
  "You've been on my mind",
  "It's a kind reminder to let you know (I'm gonna let you know)",
  "If I compromised, would you press rewind and just take it slow?",
  "I couldn't count the times, how many times did we lose control?",
  "Maybe this time we'll be cautious (aright), just tell me it's alright",
  "My heart's gettin' heavy (whoo!)",
  "Your attitude's cold, but I like when you check me",
  "I'm keen for your lovin'",
  "And every time you trip, it just happens in public",
  "Girl, you have this habit where you call me out my name",
  "It's like you're the final boss, and I'm just tryna beat these games",
  "Again, had to call it off again",
  "Again, guess we better off as friends",
  'Wait, give me space, I said, "Boy, get out my face"',
  "It's okay, you can't relate, yeah, had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "Had to call it off again",
  "(Had to call it off again)",
  "Ooh-ooh-ooh-hoo (call it off)",
  "Ooh-ooh-hoo (again), ooh-ooh-ooh, ooh",
  "Ooh-ooh-ooh-hoo (call it off)",
  "Ooh-ooh-hoo (again), ooh-ooh-ooh, ooh",
];

const timerOverlay = document.getElementById("timerOverlay");
const timerScreen = document.getElementById("timerScreen");
const timerResults = document.getElementById("timerResults");
const timerProgress = document.getElementById("timerProgress");
const timerTimestamp = document.getElementById("timerTimestamp");
const timerCurrent = document.getElementById("timerCurrent");
const timerNext = document.getElementById("timerNext");
const timerOutput = document.getElementById("timerOutput");
const timerCopyBtn = document.getElementById("timerCopyBtn");
const timerCloseBtn = document.getElementById("timerCloseBtn");

let timingMode = false;
let timingIndex = 0;
let timingMarks = [];
let timingRaf = null;

function timerTick() {
  if (!timingMode) return;
  timerTimestamp.textContent = formatTime(getSimulatedPosition() / 1000);
  timingRaf = requestAnimationFrame(timerTick);
}

function openTimingMode() {
  timingMode = true;
  timingIndex = 0;
  timingMarks = [];
  timerScreen.classList.remove("hidden");
  timerResults.classList.add("hidden");
  timerOverlay.classList.remove("hidden");
  refreshTimerUI();
  timingRaf = requestAnimationFrame(timerTick);
}

function closeTimingMode() {
  timingMode = false;
  cancelAnimationFrame(timingRaf);
  timerOverlay.classList.add("hidden");
}

function refreshTimerUI() {
  const total = TIMING_LYRICS.length;
  timerProgress.textContent = `Line ${timingIndex + 1} of ${total}`;
  timerCurrent.textContent = TIMING_LYRICS[timingIndex] ?? "";
  timerNext.textContent = TIMING_LYRICS[timingIndex + 1] ?? "\u2014";
}

function markLine() {
  if (timingIndex >= TIMING_LYRICS.length) return;
  timingMarks.push({
    start: parseFloat((getSimulatedPosition() / 1000).toFixed(2)),
    text: TIMING_LYRICS[timingIndex],
  });
  timingIndex++;
  if (timingIndex >= TIMING_LYRICS.length) {
    finishTiming();
  } else {
    refreshTimerUI();
  }
}

function redoLastLine() {
  if (timingIndex === 0) return;
  timingIndex--;
  timingMarks.pop();
  refreshTimerUI();
}

function finishTiming() {
  cancelAnimationFrame(timingRaf);
  const lines = timingMarks
    .map(
      (m) =>
        `  { start: ${m.start.toFixed(2)}, text: "${m.text.replace(/"/g, '\\"')}" }`
    )
    .join(",\n");
  const output = `const lyrics = [\n${lines}\n];`;
  timerOutput.textContent = output;
  timerScreen.classList.add("hidden");
  timerResults.classList.remove("hidden");
}

timerCopyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(timerOutput.textContent).then(() => {
    timerCopyBtn.textContent = "Copied!";
    setTimeout(() => (timerCopyBtn.textContent = "Copy to clipboard"), 2000);
  });
});

timerCloseBtn.addEventListener("click", closeTimingMode);

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if (!timingMode) {
    if (e.key === "t" || e.key === "T") openTimingMode();
    return;
  }

  if (e.key === "Escape") {
    closeTimingMode();
  } else if (e.key === " ") {
    e.preventDefault();
    markLine();
  } else if (e.key === "r" || e.key === "R") {
    redoLastLine();
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
showLyricsMessage("Play a song in any music app");
updateProgress();
