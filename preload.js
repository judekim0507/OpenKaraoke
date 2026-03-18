const { contextBridge, ipcRenderer } = require("electron");
const { convert: hangulConvert } = require("hangul-romanization");
const { pinyin } = require("pinyin-pro");
const Kuroshiro = require("kuroshiro").default;
const KuromojiAnalyzer = require("kuroshiro-analyzer-kuromoji");

const kuroshiro = new Kuroshiro();
const kuroshiroReady = kuroshiro.init(new KuromojiAnalyzer());

contextBridge.exposeInMainWorld("nowPlaying", {
  onUpdate: (cb) => ipcRenderer.on("now-playing", (_e, data) => cb(data)),
  playPause: () => ipcRenderer.send("media-play-pause"),
  next: () => ipcRenderer.send("media-next"),
  prev: () => ipcRenderer.send("media-prev"),
  seek: (positionSec) => ipcRenderer.send("media-seek", positionSec),
});

contextBridge.exposeInMainWorld("albumArt", {
  fetch: (artist, title) =>
    ipcRenderer.invoke("fetch-album-art", artist, title),
});

contextBridge.exposeInMainWorld("kuroshiro", {
  convert: async (text) => {
    await kuroshiroReady;
    return kuroshiro.convert(text, { to: "romaji", mode: "spaced" });
  },
});

contextBridge.exposeInMainWorld("hangulRomanization", {
  convert: (text) => hangulConvert(text),
});

contextBridge.exposeInMainWorld("pinyinPro", {
  convert: (text) => pinyin(text, { toneType: "symbol", type: "string" }),
});

contextBridge.exposeInMainWorld("genius", {
  fetchLyrics: (artist, title) =>
    ipcRenderer.invoke("fetch-genius-lyrics", artist, title),
});

contextBridge.exposeInMainWorld("electronWindow", {
  getPos: () => ipcRenderer.invoke("get-window-pos"),
  setPos: (x, y) => ipcRenderer.send("set-window-pos", x, y),
  getSize: () => ipcRenderer.invoke("get-window-size"),
  setSize: (w, h) => ipcRenderer.send("set-window-size", w, h),
  minimize: () => ipcRenderer.send("minimize-window"),
  toggleFullscreen: () => ipcRenderer.send("toggle-fullscreen"),
  exitFullscreen: () => ipcRenderer.send("exit-fullscreen"),
  setOpacity: (v) => ipcRenderer.send("set-window-opacity", v),
});
