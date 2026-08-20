const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qx', {
  minimize: () => ipcRenderer.send('win-minimize'),
  close: () => ipcRenderer.send('win-close'),
  getInfo: () => ipcRenderer.invoke('get-info'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  install: (opts) => ipcRenderer.invoke('install', opts),
  finish: (opts) => ipcRenderer.invoke('finish', opts),
  onProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('install-progress', h);
    return () => ipcRenderer.removeListener('install-progress', h);
  }
});
