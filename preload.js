const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotify", {
  login: () => ipcRenderer.invoke("login"),
  getToken: () => ipcRenderer.invoke("get-token"),
  onTokenReady: (cb) => ipcRenderer.on("token-ready", (_e, token) => cb(token)),
  onTokenRefreshed: (cb) => ipcRenderer.on("token-refreshed", (_e, token) => cb(token)),
});

contextBridge.exposeInMainWorld("electronWindow", {
  getPos: () => ipcRenderer.invoke("get-window-pos"),
  setPos: (x, y) => ipcRenderer.send("set-window-pos", x, y),
  getSize: () => ipcRenderer.invoke("get-window-size"),
  setSize: (w, h) => ipcRenderer.send("set-window-size", w, h),
  minimize: () => ipcRenderer.send("minimize-window"),
  setOpacity: (v) => ipcRenderer.send("set-window-opacity", v),
});
