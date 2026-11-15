const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shell', {
  state: () => ipcRenderer.invoke('shell:state'),
  switchTo: (name) => ipcRenderer.invoke('shell:switch', name),
  onActive: (fn) => ipcRenderer.on('active-tab', (_e, n) => fn(n)),
});
