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

// ── Lyrics ───────────────────────────────────────────────────────────────────
let lyrics = [];
let lyricsMode = "none";
let currentTrackKey = null;

// ── Romanization ─────────────────────────────────────────────────────────────
function hasNonLatin(text) {
  return /[\u0400-\u04FF\u0600-\u06FF\u0590-\u05FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0900-\u097F\u0E00-\u0E7F\u0370-\u03FF]/.test(
    text
  );
}

function isJapanese(text) {
  return /[\u3040-\u30FF]/.test(text);
}

function isKorean(text) {
  return /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text);
}

function isChinese(text) {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
}

function romanizeText(text) {
  try {
    if (isKorean(text) && window.hangulRomanization) {
      return window.hangulRomanization.convert(text);
    }
    if (isJapanese(text) && window.wanakana) {
      return window.wanakana.toRomaji(text);
    }
    if (isChinese(text) && window.pinyinPro) {
      return window.pinyinPro.convert(text);
    }
    return window.transliteration?.transliterate(text) ?? null;
  } catch {
    return null;
  }
}

function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split("\n")) {
    const match = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const ms = parseInt(match[3].padEnd(3, "0"), 10);
    const text = match[4].trim();
    if (text) lines.push({ start: mins * 60 + secs + ms / 1000, text });
  }
  return lines;
}

async function lrcLibSearch(artist, title) {
  try {
    const params = new URLSearchParams({ q: `${artist} ${title}`.trim() });
    console.log("[Lyrics] LrcLib search:", params.toString());
    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return null;
    const results = await res.json();
    console.log("[Lyrics] LrcLib search:", results.length, "results,", results.filter((r) => r.syncedLyrics).length, "synced");
    const synced = results.find((r) => r.syncedLyrics);
    if (synced) return { lines: parseLrc(synced.syncedLyrics), synced: true };
    const plain = results.find((r) => r.plainLyrics);
    if (plain) {
      return { lines: plain.plainLyrics.split("\n").map((t) => ({ text: t, start: null })), synced: false };
    }
  } catch (e) {
    console.warn("[Lyrics] LrcLib search error:", e);
  }
  return null;
}

async function fetchLyrics(track) {
  const artist = track.artists[0]?.name || "";
  const title = track.name;
  const album = track.album?.name || "";
  const duration = Math.round(track.duration_ms / 1000);

  // 1. Try lrclib exact match (fastest)
  try {
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      album_name: album,
      duration,
    });
    console.log("[Lyrics] LrcLib get:", `${params}`);
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics)
        return { lines: parseLrc(data.syncedLyrics), synced: true };
      console.log("[Lyrics] LrcLib get: no synced lyrics in response");
    } else {
      console.log("[Lyrics] LrcLib get:", res.status);
    }
  } catch (e) {
    console.warn("[Lyrics] LrcLib get error:", e);
  }

  // 2. Try lrclib search with artist + title
  const lrcSearchResult = await lrcLibSearch(artist, title);
  if (lrcSearchResult) return lrcSearchResult;

  // 3. Try lrclib with cleaned/simplified title (strip parentheses, featured artists, etc.)
  const cleanTitle = title
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/\s*[-–—]\s*.*(feat|ft|remix|mix|version|edit).*$/i, "")
    .trim();
  if (cleanTitle !== title) {
    console.log("[Lyrics] Retrying with cleaned title:", cleanTitle);
    const cleanResult = await lrcLibSearch(artist, cleanTitle);
    if (cleanResult) return cleanResult;
  }

  // 4. Try lrclib with just the title (no artist — handles wrong artist from MediaRemote)
  if (artist) {
    const noArtistResult = await lrcLibSearch("", title);
    if (noArtistResult) return noArtistResult;
  }

  // 5. Fallback: Genius
  try {
    console.log("[Lyrics] Trying Genius for:", artist, "-", title);
    const text = await window.genius.fetchLyrics(artist, title);
    if (text) {
      const lines = text.split("\n").map((t) => ({ text: t, start: null }));
      return { lines, synced: false };
    }
    // Try Genius with clean title too
    if (cleanTitle !== title) {
      const text2 = await window.genius.fetchLyrics(artist, cleanTitle);
      if (text2) {
        const lines = text2.split("\n").map((t) => ({ text: t, start: null }));
        return { lines, synced: false };
      }
    }
    console.log("[Lyrics] Genius returned nothing");
  } catch (e) {
    console.warn("[Lyrics] Genius error:", e);
  }

  return null;
}

async function preRomanizeJapanese(lines) {
  if (!window.kuroshiro) return;
  const japanese = lines.filter((l) => l.text && isJapanese(l.text));
  if (!japanese.length) return;
  await Promise.all(
    japanese.map(async (line) => {
      try {
        const roma = await window.kuroshiro.convert(line.text);
        if (roma && roma !== line.text) line.romanized = roma;
      } catch {}
    })
  );
}

let activeLineIndex = -1;
let lyricsTopSpacer = null;
let lyricsBottomSpacer = null;

function updateLyricsSpacers() {
  // Spacers allow first/last lines to scroll to center
  const h = lyricsEl.clientHeight;
  const spacerH = Math.max(0, h * 0.45);
  if (lyricsTopSpacer) lyricsTopSpacer.style.height = `${spacerH}px`;
  if (lyricsBottomSpacer) lyricsBottomSpacer.style.height = `${spacerH}px`;
}

new ResizeObserver(updateLyricsSpacers).observe(lyricsEl);

function renderLyrics(message) {
  lyricsEl.innerHTML = "";
  activeLineIndex = -1;

  lyricsTopSpacer = document.createElement("div");
  lyricsTopSpacer.className = "lyrics-spacer";
  lyricsEl.appendChild(lyricsTopSpacer);

  if (message || !lyrics.length) {
    const msg = document.createElement("div");
    msg.className = "line is-upcoming lyrics-message";
    msg.textContent = message || "No lyrics found";
    lyricsEl.appendChild(msg);
  } else {
    if (lyricsMode === "static") {
      const notice = document.createElement("div");
      notice.className = "line is-upcoming lyrics-sync-notice";
      notice.textContent = "Timestamp sync not available";
      lyricsEl.appendChild(notice);
    }

    lyrics.forEach((line, index) => {
      const lineEl = document.createElement("div");
      lineEl.className = "line is-upcoming";
      lineEl.dataset.index = index;
      if (lyricsMode === "synced") lineEl.dataset.start = line.start;
      if (hasNonLatin(line.text)) {
        const roma = line.romanized ?? romanizeText(line.text);
        if (roma && roma !== line.text) {
          lineEl.appendChild(document.createTextNode(line.text));
          const romaSpan = document.createElement("span");
          romaSpan.className = "line-romanized";
          romaSpan.textContent = roma;
          lineEl.appendChild(romaSpan);
        } else {
          lineEl.textContent = line.text;
        }
      } else {
        lineEl.textContent = line.text;
      }
      if (lyricsMode === "synced") {
        lineEl.style.cursor = "pointer";
        lineEl.addEventListener("click", () => {
          const posSec = line.start;
          window.nowPlaying.seek(posSec);
          syncPosition(posSec * 1000, isPlaying);
        });
      }
      lyricsEl.appendChild(lineEl);
    });
  }

  lyricsBottomSpacer = document.createElement("div");
  lyricsBottomSpacer.className = "lyrics-spacer";
  lyricsEl.appendChild(lyricsBottomSpacer);

  updateLyricsSpacers();
  lyricsEl.scrollTo({ top: 0, behavior: "instant" });
}

function updateLyrics() {
  if (lyricsMode !== "synced") return;
  const t = getSimulatedPosition() / 1000;
  const dur = simulatedDuration / 1000 || 1;
  const lines = Array.from(lyricsEl.querySelectorAll(".line"));
  let newActiveIndex = -1;

  lines.forEach((lineEl, index) => {
    const start = Number(lineEl.dataset.start);
    const end = lyrics[index + 1] ? lyrics[index + 1].start : dur;

    if (t >= start && t < end) {
      lineEl.classList.remove("is-past", "is-upcoming");
      lineEl.classList.add("is-active");
      newActiveIndex = index;
    } else if (t >= end) {
      lineEl.classList.remove("is-active", "is-upcoming");
      lineEl.classList.add("is-past");
    } else {
      lineEl.classList.remove("is-active", "is-past");
      lineEl.classList.add("is-upcoming");
    }
  });

  if (newActiveIndex !== activeLineIndex) {
    activeLineIndex = newActiveIndex;
    if (newActiveIndex >= 0) {
      lines[newActiveIndex].scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }



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

    const avgImgL = samples.reduce((a, p) => a + p.l, 0) / samples.length;

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
    const upcoming = `hsl(${h},${sP}%,62%)`;

    const upcomingOpacity = avgImgL > 0.6 ? 0.7 : 1;

    contentArea.style.setProperty("--art-color-light", light);
    contentArea.style.setProperty("--art-color-dark", dark);
    contentArea.style.setProperty("--art-color-mid", mid);
    contentArea.style.setProperty("--art-color-upcoming", upcoming);
    contentArea.style.setProperty("--upcoming-lyric-opacity", upcomingOpacity);
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

  // Fetch album art via iTunes Search API
  if (data.artist && data.title) {
    const artUrl = await window.albumArt.fetch(data.artist, data.title);
    if (artUrl) setArtUrl(artUrl);
  }

  // Fetch lyrics
  lyrics = [];
  lyricsMode = "none";
  renderLyrics("Loading lyrics\u2026");

  const track = {
    name: data.title,
    artists: [{ name: data.artist || "" }],
    album: { name: data.album || "" },
    duration_ms: (data.duration || 0) * 1000,
  };

  const fetched = await fetchLyrics(track);
  if (fetched) await preRomanizeJapanese(fetched.lines);
  lyrics = fetched?.lines || [];
  lyricsMode = fetched ? (fetched.synced ? "synced" : "static") : "none";
  renderLyrics(fetched ? null : "No lyrics found for this track");
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
      lyrics = [];
      lyricsMode = "none";
      renderLyrics("Play a song in any music app");
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
  if (on) {
    activeLineIndex = -1;
    updateLyricsSpacers();
    lyricsEl.scrollTop = 0;
  }
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
    pipWindow.addEventListener("pagehide", () => {
      appEl.appendChild(stage);
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isFullscreen) {
    window.electronWindow.exitFullscreen();
    isFullscreen = false;
    playerCard.classList.remove("is-fullscreen");
    playerCard.classList.remove("fs-controls-visible");
  }
});

// Auto-hide controls in fullscreen — show on mouse move, hide after 3s idle
let fsIdleTimer = null;
document.addEventListener("mousemove", () => {
  if (!isFullscreen) return;
  playerCard.classList.add("fs-controls-visible");
  clearTimeout(fsIdleTimer);
  fsIdleTimer = setTimeout(() => {
    playerCard.classList.remove("fs-controls-visible");
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
renderLyrics("Play a song in any music app");
updateProgress();
