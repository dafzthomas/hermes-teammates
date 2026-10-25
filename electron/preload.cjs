const { contextBridge, ipcRenderer } = require('electron');
if (process.platform === 'darwin' && process.isMainFrame) {
  contextBridge.exposeInMainWorld('hermesNativeControls', {
    present: (state) => ipcRenderer.invoke('hermes-native:present', state),
    hide: () => ipcRenderer.invoke('hermes-native:hide'),
    onAction: async (listener) => {
      const receive = (_event, action) => listener(action);
      ipcRenderer.on('hermes-native:action', receive);
      return () => ipcRenderer.removeListener('hermes-native:action', receive);
    },
  });
}
