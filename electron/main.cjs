const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
let backend;
let stopping = false;
let backendStopped = false;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function open() {
  const root = path.resolve(__dirname, '..');
  const port = await freePort();
  const data = process.env.TEAMMATES_DATA_DIR || path.join(app.getPath('userData'), 'workspace');
  backend = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: app.getPath('userData'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      TEAMMATES_DATA_DIR: data,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.resume();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The local backend did not start.')), 30000);
    backend.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited (${code}).`));
    });
    backend.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 660,
    minHeight: 560,
    title: 'Hermes Teammates',
    backgroundColor: '#111111',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url) {
      event.preventDefault();
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    }
  });
  await win.loadURL(url);
}
app
  .whenReady()
  .then(open)
  .catch((error) => {
    dialog.showErrorBox('Hermes Teammates could not start', error.message);
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null || backendStopped)
    return;
  event.preventDefault();
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => {
    backendStopped = true;
    backend.kill('SIGKILL');
    app.quit();
  }, 5500);
  backend.once('exit', () => {
    clearTimeout(timer);
    backendStopped = true;
    app.quit();
  });
  backend.kill('SIGTERM');
});
