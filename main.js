const { app, BrowserWindow, ipcMain } = require("electron");
const { execFile } = require("child_process");
const path = require("path");

const GENIUS_TOKEN =
  "InCSp34L9lU9pFMV5nfL41tOthLDIXvNqk4g10P8TrQTsDI7cJwCcLegbKIBimI0";

let mainWindow;
let pollInterval;

// ── JXA script: read macOS now-playing via MediaRemote framework ─────────────
const NOW_PLAYING_SCRIPT = `
ObjC.import("Foundation");
function run() {
  const MR = $.NSBundle.bundleWithPath(
    "/System/Library/PrivateFrameworks/MediaRemote.framework/"
  );
  MR.load;
  const Req = $.NSClassFromString("MRNowPlayingRequest");
  const item = Req.localNowPlayingItem;
  if (!item) return JSON.stringify(null);
  const info = item.nowPlayingInfo;
  const pp = Req.localNowPlayingPlayerPath;
  const client = pp ? pp.client : null;
  const ts = info.valueForKey("kMRMediaRemoteNowPlayingInfoTimestamp");
  const r = {
    bundleId: client ? ObjC.unwrap(client.bundleIdentifier) : null,
    playing: Req.localIsPlaying,
    title:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoTitle")
      ) || null,
    artist:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoArtist")
      ) || null,
    album:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoAlbum")
      ) || null,
    duration:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoDuration")
      ) || 0,
    elapsedTime:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoElapsedTime")
      ) || 0,
    timestampEpoch: ts ? ts.timeIntervalSince1970 : null,
    playbackRate:
      ObjC.unwrap(
        info.valueForKey("kMRMediaRemoteNowPlayingInfoPlaybackRate")
      ) || 0,
  };
  return JSON.stringify(r);
}`;

// ── Poll now-playing ─────────────────────────────────────────────────────────
function pollNowPlaying() {
  execFile(
    "osascript",
    ["-l", "JavaScript", "-e", NOW_PLAYING_SCRIPT],
    { timeout: 2000 },
    (err, stdout) => {
      if (err || !stdout?.trim()) return;
      try {
        const info = JSON.parse(stdout.trim());
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("now-playing", info);
        }
      } catch {}
    }
  );
}

function startPolling() {
  pollNowPlaying();
  pollInterval = setInterval(pollNowPlaying, 500);
}

// ── Media remote commands (compiled Swift helper for system media keys) ───────
const mediakeyBin = path.join(__dirname, "assets", "mediakey");

ipcMain.on("media-play-pause", () => execFile(mediakeyBin, ["16"]));
ipcMain.on("media-next", () => execFile(mediakeyBin, ["17"]));
ipcMain.on("media-prev", () => execFile(mediakeyBin, ["18"]));
ipcMain.on("media-seek", (_e, positionSec) => execFile(mediakeyBin, ["seek", String(positionSec)]));

// ── Genius lyrics ────────────────────────────────────────────────────────────
ipcMain.handle("fetch-genius-lyrics", async (_e, artist, title) => {
  try {
    console.log("[Genius] searching for:", artist, "-", title);
    const searchRes = await fetch(
      `https://api.genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`,
      { headers: { Authorization: `Bearer ${GENIUS_TOKEN}` } }
    );
    const searchData = await searchRes.json();
    const hit = searchData.response?.hits?.[0]?.result;
    if (!hit) {
      console.log("[Genius] no search hit");
      return null;
    }
    console.log("[Genius] found:", hit.full_title);

    const pageRes = await fetch(hit.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await pageRes.text();

    const chunks = [];
    let searchFrom = 0;
    while (true) {
      const attrIdx = html.indexOf(
        'data-lyrics-container="true"',
        searchFrom
      );
      if (attrIdx === -1) break;
      const openEnd = html.indexOf(">", attrIdx) + 1;
      let depth = 1,
        pos = openEnd;
      while (depth > 0 && pos < html.length) {
        const nextOpen = html.indexOf("<div", pos);
        const nextClose = html.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth > 0) pos = nextClose + 6;
          else chunks.push(html.slice(openEnd, nextClose));
        }
      }
      searchFrom = openEnd;
    }
    if (!chunks.length) return null;

    const text = chunks
      .join("\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .split("\n")
      .filter(
        (line) =>
          !/^\d+\s+Contributor/i.test(line) &&
          !/Lyrics$/.test(line.trim()) &&
          !/^\[.+\]$/.test(line.trim())
      )
      .join("\n")
      .trim();

    return text || null;
  } catch (e) {
    console.log("[Genius] error:", e.message);
    return null;
  }
});

// ── Album art via iTunes Search API (free, no auth) ─────────────────────────
ipcMain.handle("fetch-album-art", async (_e, artist, title) => {
  try {
    const query = encodeURIComponent(`${artist} ${title}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.artworkUrl100) return null;
    return result.artworkUrl100
      .replace("100x100bb", "600x600bb");
  } catch {
    return null;
  }
});

// ── Window management ────────────────────────────────────────────────────────
ipcMain.on("minimize-window", () => mainWindow.minimize());
ipcMain.on("set-window-opacity", (_e, value) => mainWindow.setOpacity(value));
ipcMain.handle("get-window-pos", () => mainWindow.getPosition());
ipcMain.on("set-window-pos", (_e, x, y) =>
  mainWindow.setPosition(Math.round(x), Math.round(y))
);
ipcMain.on("set-window-size", (_e, w, h) =>
  mainWindow.setSize(Math.round(w), Math.round(h))
);
ipcMain.handle("get-window-size", () => mainWindow.getSize());

// ── Main window ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 280,
    height: 380,
    minWidth: 280,
    minHeight: 380,
    transparent: true,
    vibrancy: "under-window",
    frame: false,
    hasShadow: true,
    icon: path.join(__dirname, "assets/icon.icns"),
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.show();
  startPolling();
});

app.on("window-all-closed", () => {
  clearInterval(pollInterval);
  if (process.platform !== "darwin") app.quit();
});
