'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  kind: 'electron',
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('desktop:info'),
  serialList: () => ipcRenderer.invoke('desktop:serial-list'),
  selectSerial: id => ipcRenderer.invoke('desktop:serial-select', id),
  onNavigate: callback => subscribe('desktop:navigate', callback),
  serverAction: (action, data) => ipcRenderer.invoke('desktop:server-action', action, data),
  tcpConnect: settings => ipcRenderer.invoke('desktop:tcp-connect', settings),
  tcpSend: hex => ipcRenderer.invoke('desktop:tcp-send', hex),
  tcpDisconnect: () => ipcRenderer.invoke('desktop:tcp-disconnect'),
  onTcpData: callback => subscribe('desktop:tcp-data', callback),
  onTcpState: callback => subscribe('desktop:tcp-state', callback),
});
