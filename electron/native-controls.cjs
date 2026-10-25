const { ipcMain, app } = require('electron');
const path = require('node:path');
const { presentation, action } = require('./native-controls-schema.cjs');

function installNativeControls(win, origin) {
  if (process.platform !== 'darwin') return;
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'native/HermesNativeControls.node')
    : path.join(
        __dirname,
        '..',
        'test-artifacts/native-macos',
        process.arch,
        'HermesNativeControls.node',
      );
  const native = require(binary);
  const attached = native.attach(win.getNativeWindowHandle(), (json) => {
    let parsed;
    try {
      parsed = action.safeParse(JSON.parse(json));
    } catch {
      return;
    }
    if (parsed.success && !win.isDestroyed())
      win.webContents.send('hermes-native:action', parsed.data);
  });
  if (!attached) throw new Error('Could not attach native AppKit controls to the desktop window.');
  const trusted = (event) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      return false;
    try {
      return new URL(event.senderFrame.url).origin === origin;
    } catch {
      return false;
    }
  };
  ipcMain.handle('hermes-native:present', (event, state) => {
    if (!trusted(event)) throw new Error('Untrusted native controls sender');
    const result = presentation.safeParse(state);
    if (!result.success) throw new Error('Invalid native controls presentation');
    return { active: native.present(JSON.stringify(result.data)) };
  });
  ipcMain.handle('hermes-native:hide', (event) => {
    if (!trusted(event)) throw new Error('Untrusted native controls sender');
    native.hide();
  });
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) native.hide();
  });
  win.webContents.on('render-process-gone', () => native.hide());
  win.once('closed', () => {
    ipcMain.removeHandler('hermes-native:present');
    ipcMain.removeHandler('hermes-native:hide');
    native.detach();
  });
}
module.exports = { installNativeControls };
