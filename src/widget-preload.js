"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shopWidget", {
  getState: () => ipcRenderer.invoke("widget:get-state"),
  setView: (viewId) => ipcRenderer.invoke("widget:set-view", viewId),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("widget:set-always-on-top", enabled),
  login: (person, pin) => ipcRenderer.invoke("widget:login", { person, pin }),
  logout: () => ipcRenderer.invoke("widget:logout"),
  refresh: () => ipcRenderer.invoke("widget:refresh"),
  sendNote: (recipient, text) =>
    ipcRenderer.invoke("widget:send-note", { recipient, text }),
  openTools: () => ipcRenderer.invoke("widget:open-tools"),
  checkUpdate: () => ipcRenderer.invoke("widget:check-update"),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("widget:state", listener);
    return () => ipcRenderer.removeListener("widget:state", listener);
  },
});
