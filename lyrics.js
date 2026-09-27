// ── Lyrics sources ───────────────────────────────────────────────────────────
// Every source is normalised to a TTML string so <am-lyrics> can render it:
//   1. Unison (unison.boidu.dev) — community TTML, often syllable-synced
//   2. lrc.red — word-synced TTML with a large catalog
//   3. LrcLib — line-synced LRC (or plain text)
//   4. Genius — plain text via the main process
// Romanization for non-Latin lines is embedded as TTML transliterations.

const TTML_NS = "http://www.w3.org/ns/ttml";
const ITUNES_NS = "http://music.apple.com/lyric-ttml-internal";
const LRC_RED_NS = "http://lrc.red/lyric-ttml-internal";
const UNISON_API = "https://unison.boidu.dev";
const LRC_RED_API = "https://lrc.red";

// ── Romanization ─────────────────────────────────────────────────────────────
function hasNonLatin(text) {
  return /[Ѐ-ӿ؀-ۿ֐-׿぀-ヿ㐀-鿿가-힯ऀ-ॿ฀-๿Ͱ-Ͽ]/.test(
    text
  );
}

function isJapanese(text) {
  return /[぀-ヿ]/.test(text);
}

function isKorean(text) {
  return /[가-힯ᄀ-ᇿ㄰-㆏]/.test(text);
}

function isChinese(text) {
  return /[一-鿿㐀-䶿]/.test(text);
}

async function romanizeText(text) {
  try {
    if (isJapanese(text) && window.kuroshiro) {
      return await window.kuroshiro.convert(text);
    }
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

// ── TTML helpers ─────────────────────────────────────────────────────────────
function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTtmlTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

// lines: [{ text, start (sec) | null }]; start === null → unsynced
function linesToTtml(lines, durationSec) {
  const synced = lines.some((l) => l.start != null);
  const body = [];
  lines.forEach((line, i) => {
    const text = line.text.trim();
    if (!text) return;
    if (!synced) {
      body.push(`<p>${escapeXml(text)}</p>`);
      return;
    }
    const next = lines.slice(i + 1).find((l) => l.start != null);
    const end = next ? next.start : Math.max(line.start + 5, durationSec || 0);
    body.push(
      `<p begin="${formatTtmlTime(line.start)}" end="${formatTtmlTime(end)}">${escapeXml(text)}</p>`
    );
  });
  const timing = synced ? "Line" : "None";
  return (
    `<tt xmlns="${TTML_NS}" xmlns:itunes="${ITUNES_NS}" itunes:timing="${timing}">` +
    `<body><div>${body.join("")}</div></body></tt>`
  );
}

function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split("\n")) {
    const match = raw.match(/^\[(\d{1,3}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const ms = parseInt(match[3].padEnd(3, "0"), 10);
    // Keep blank lines so the previous line ends where the gap begins
    lines.push({ start: mins * 60 + secs + ms / 1000, text: match[4].trim() });
  }
  return lines;
}

function plainToLines(text) {
  return text.split("\n").map((t) => ({ text: t, start: null }));
}

function parseTtmlDoc(ttml) {
  const doc = new DOMParser().parseFromString(ttml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  if (!doc.getElementsByTagName("p").length) return null;
  return doc;
}

function mainLineText(p) {
  return Array.from(p.childNodes)
    .filter(
      (n) => !(n.nodeType === 1 && n.getAttribute("ttm:role") === "x-bg")
    )
    .map((n) => n.textContent || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// Adds <transliteration> entries for non-Latin lines that don't have one yet.
// Returns { ttml, romanized } where romanized says whether anything was added.
async function embedRomanization(ttml) {
  const doc = parseTtmlDoc(ttml);
  if (!doc) return { ttml, romanized: false };

  const existing = new Set();
  for (const t of doc.getElementsByTagName("transliteration")) {
    for (const text of t.getElementsByTagName("text")) {
      const key = text.getAttribute("for");
      if (key) existing.add(key);
    }
  }

  const pending = [];
  Array.from(doc.getElementsByTagName("p")).forEach((p, i) => {
    let key = p.getAttributeNS(LRC_RED_NS, "key") || p.getAttribute("itunes:key");
    if (key && existing.has(key)) return;
    const text = mainLineText(p);
    if (!text || !hasNonLatin(text)) return;
    if (!key) {
      key = `OK${i + 1}`;
      p.setAttributeNS(ITUNES_NS, "itunes:key", key);
    }
    pending.push(
      romanizeText(text).then((roma) =>
        roma && roma.trim() && roma.trim() !== text ? { key, roma: roma.trim() } : null
      )
    );
  });

  const results = (await Promise.all(pending)).filter(Boolean);
  if (!results.length) return { ttml, romanized: existing.size > 0 };

  const root = doc.documentElement;
  let head = Array.from(root.children).find((c) => c.localName === "head");
  if (!head) {
    head = doc.createElementNS(TTML_NS, "head");
    root.insertBefore(head, root.firstChild);
  }
  // am-lyrics matches these by unprefixed tag name, so keep them in the default
  // namespace (XMLSerializer would otherwise emit them as itunes:*)
  const meta = doc.createElementNS(TTML_NS, "iTunesMetadata");
  const group = doc.createElementNS(TTML_NS, "transliterations");
  const translit = doc.createElementNS(TTML_NS, "transliteration");
  for (const { key, roma } of results) {
    const text = doc.createElementNS(TTML_NS, "text");
    text.setAttribute("for", key);
    text.textContent = roma;
    translit.appendChild(text);
  }
  group.appendChild(translit);
  meta.appendChild(group);
  head.appendChild(meta);

  return { ttml: new XMLSerializer().serializeToString(doc), romanized: true };
}

// ── Unison ───────────────────────────────────────────────────────────────────
async function unisonGet(params) {
  const url = `${UNISON_API}/lyrics?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url);
    console.log("[Lyrics] Unison:", params, res.status);
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.data : null;
  } catch (e) {
    console.warn("[Lyrics] Unison error:", e);
    return null;
  }
}

function unisonToResult(data, durationSec) {
  if (!data?.lyrics) return null;
  if (data.format === "ttml") {
    if (!parseTtmlDoc(data.lyrics)) return null;
    const sync = data.syncType === "richsync" ? "syllable" : data.syncType === "plain" ? "none" : "line";
    return { ttml: data.lyrics, source: "Unison", sync };
  }
  if (data.format === "lrc") {
    const lines = parseLrc(data.lyrics);
    if (!lines.some((l) => l.text)) return null;
    return { ttml: linesToTtml(lines, durationSec), source: "Unison", sync: "line" };
  }
  if (data.format === "plain") {
    return { ttml: linesToTtml(plainToLines(data.lyrics)), source: "Unison", sync: "none" };
  }
  return null;
}

async function fetchUnison(title, artist, durationSec) {
  const attempts = [];
  if (durationSec) attempts.push({ song: title, artist, duration: durationSec });
  attempts.push({ song: title, artist });

  for (const params of attempts) {
    const data = await unisonGet(params);
    if (!data) continue;
    // Without a duration filter, reject an obviously different recording
    if (!params.duration && durationSec && data.duration && Math.abs(data.duration - durationSec) > 5) {
      console.log("[Lyrics] Unison: duration mismatch", data.duration, "vs", durationSec);
      continue;
    }
    const result = unisonToResult(data, durationSec);
    if (result) return result;
  }
  return null;
}

// ── lrc.red ──────────────────────────────────────────────────────────────────
async function fetchLrcRed(title, artist, album, durationSec) {
  try {
    const params = new URLSearchParams({ track: title, artist });
    if (album) params.set("album", album);
    if (durationSec) params.set("duration", durationSec);
    const res = await fetch(`${LRC_RED_API}/match.json?${params}`);
    console.log("[Lyrics] lrc.red match:", res.status);
    if (!res.ok) return null;
    const hits = (await res.json())?.hits || [];
    // Reject covers and other recordings (acoustic, live, sped up…)
    const norm = (t) => cleanTitle(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const wanted = norm(title);
    const hit = hits.find(
      (h) =>
        h.isrc &&
        norm(h.title) === wanted &&
        (!durationSec || !h.duration || Math.abs(h.duration - durationSec) <= 3)
    );
    if (!hit) return null;
    const ttmlRes = await fetch(`${LRC_RED_API}/s/${encodeURIComponent(hit.isrc)}.ttml`);
    if (!ttmlRes.ok) return null;
    const ttml = await ttmlRes.text();
    const doc = parseTtmlDoc(ttml);
    if (!doc) return null;
    const timing = doc.documentElement.getAttributeNS(LRC_RED_NS, "timing") || "";
    const sync = /word|syllable/i.test(timing) ? "syllable" : /line/i.test(timing) ? "line" : "none";
    return { ttml, source: "lrc.red", sync };
  } catch (e) {
    console.warn("[Lyrics] lrc.red error:", e);
    return null;
  }
}

// ── LrcLib ───────────────────────────────────────────────────────────────────
function lrcLibToResult(record, durationSec) {
  if (record?.syncedLyrics) {
    return { ttml: linesToTtml(parseLrc(record.syncedLyrics), durationSec), source: "LrcLib", sync: "line" };
  }
  return null;
}

async function lrcLibSearch(artist, title, durationSec) {
  try {
    const params = new URLSearchParams({ q: `${artist} ${title}`.trim() });
    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return null;
    const results = await res.json();
    console.log("[Lyrics] LrcLib search:", results.length, "results,", results.filter((r) => r.syncedLyrics).length, "synced");
    const synced = results.find((r) => r.syncedLyrics);
    if (synced) return lrcLibToResult(synced, durationSec);
    const plain = results.find((r) => r.plainLyrics);
    if (plain) return { ttml: linesToTtml(plainToLines(plain.plainLyrics)), source: "LrcLib", sync: "none" };
  } catch (e) {
    console.warn("[Lyrics] LrcLib search error:", e);
  }
  return null;
}

async function fetchLrcLib(title, artist, album, durationSec) {
  try {
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      album_name: album,
      duration: durationSec,
    });
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    console.log("[Lyrics] LrcLib get:", res.status);
    if (res.ok) {
      const result = lrcLibToResult(await res.json(), durationSec);
      if (result) return result;
    }
  } catch (e) {
    console.warn("[Lyrics] LrcLib get error:", e);
  }
  return lrcLibSearch(artist, title, durationSec);
}

// ── Genius ───────────────────────────────────────────────────────────────────
async function fetchGenius(title, artist) {
  try {
    const text = await window.genius.fetchLyrics(artist, title);
    if (text) return { ttml: linesToTtml(plainToLines(text)), source: "Genius", sync: "none" };
  } catch (e) {
    console.warn("[Lyrics] Genius error:", e);
  }
  return null;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
function cleanTitle(title) {
  return title
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/\s*[-–—]\s*.*(feat|ft|remix|mix|version|edit).*$/i, "")
    .trim();
}

async function findLyrics({ title, artist, album, duration }) {
  const durationSec = Math.round(duration || 0);
  const clean = cleanTitle(title);
  const titles = clean && clean !== title ? [title, clean] : [title];
  const primaryArtist = artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0] || artist;
  const artists = primaryArtist !== artist ? [artist, primaryArtist] : [artist];

  const steps = [];
  for (const t of titles) for (const a of artists) steps.push(() => fetchUnison(t, a, durationSec));
  for (const t of titles) steps.push(() => fetchLrcRed(t, artist, album, durationSec));
  for (const t of titles) steps.push(() => fetchLrcLib(t, artist, album, durationSec));
  // Title only — handles a wrong artist from MediaRemote
  if (artist) steps.push(() => lrcLibSearch("", title, durationSec));
  for (const t of titles) steps.push(() => fetchGenius(t, artist));

  for (const step of steps) {
    const result = await step();
    if (result) {
      const { ttml, romanized } = await embedRomanization(result.ttml);
      console.log("[Lyrics] Using", result.source, `(${result.sync})`);
      return { ...result, ttml, romanized };
    }
  }
  return null;
}

window.lyricsSources = { findLyrics };
