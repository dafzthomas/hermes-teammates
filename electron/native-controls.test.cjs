const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { presentation, action } = require('./native-controls-schema.cjs');

function state() {
  const rect = { x: 10, y: 10, width: 500, height: 52 };
  return {
    version: 1,
    sessionId: 'session',
    scopeId: 'bot:test',
    revision: 1,
    draftSequence: 0,
    visible: true,
    viewport: { width: 800, height: 600 },
    navigation: {
      rect,
      title: 'Test Bot',
      backVisible: true,
      detailsVisible: true,
      avatarColor: 'violet',
    },
    composer: {
      rect,
      visible: true,
      draft: 'Hello',
      placeholder: 'Message Test Bot',
      disabled: false,
      submitDisabled: false,
      submitLabel: 'Steer',
      stopVisible: true,
      stopDisabled: false,
    },
  };
}
test('presentation admits native compact controls and independent Steer / Stop states', () => {
  const value = state();
  value.composer.disabled = true;
  value.composer.submitDisabled = true;
  const parsed = presentation.parse(value);
  assert.equal(parsed.composer.stopDisabled, false);
  assert.equal(parsed.composer.rect.height, 52);
});
test('presentation refuses executable fields, arbitrary avatars, invalid bounds and oversized drafts', () => {
  for (const mutate of [
    (v) => {
      v.script = 'window.location = "https://example.test"';
    },
    (v) => {
      v.navigation.avatarColor = 'file:///private/data';
    },
    (v) => {
      v.navigation.imageURL = 'https://example.test/avatar';
    },
    (v) => {
      v.navigation.rect.width = Infinity;
    },
    (v) => {
      v.composer.rect.x = NaN;
    },
    (v) => {
      v.composer.draft = 'a'.repeat(60001);
    },
    (v) => {
      v.viewport.width = 0;
    },
    (v) => {
      v.draftSequence = -1;
    },
  ]) {
    const value = state();
    mutate(value);
    assert.equal(presentation.safeParse(value).success, false);
  }
});
test('native actions are finite and carry conversation and session identity', () => {
  const value = {
    sessionId: 'session',
    scopeId: 'bot:test',
    sequence: 1,
    type: 'submit',
    draft: 'Hello',
  };
  assert.equal(action.safeParse(value).success, true);
  assert.equal(action.safeParse({ ...value, type: 'executeJavaScript' }).success, false);
  assert.equal(action.safeParse({ ...value, url: 'file:///private' }).success, false);
});

function desktopBridge() {
  const handlers = new Map();
  const calls = [];
  const native = {
    attach: (_handle, callback) => {
      native.callback = callback;
      return true;
    },
    present: (json) => {
      calls.push(['present', JSON.parse(json)]);
      return true;
    },
    hide: () => calls.push(['hide']),
    detach: () => calls.push(['detach']),
  };
  const webContents = new EventEmitter();
  webContents.mainFrame = { url: 'http://127.0.0.1:3210/' };
  webContents.send = (...args) => calls.push(['send', ...args]);
  const win = new EventEmitter();
  Object.assign(win, {
    webContents,
    getNativeWindowHandle: () => Buffer.alloc(8),
    isDestroyed: () => false,
  });
  const electron = {
    app: { isPackaged: false },
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      removeHandler: (name) => handlers.delete(name),
    },
  };
  const context = {
    require: (name) =>
      name === 'electron'
        ? electron
        : name === './native-controls-schema.cjs'
          ? { presentation, action }
          : name.endsWith('.node')
            ? native
            : require(name),
    process: { platform: 'darwin', arch: 'arm64' },
    module: { exports: {} },
    __dirname,
    URL,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'native-controls.cjs'), 'utf8'), context);
  context.module.exports.installNativeControls(win, 'http://127.0.0.1:3210');
  return {
    handlers,
    calls,
    win,
    native,
    event: { sender: webContents, senderFrame: webContents.mainFrame },
  };
}
test('desktop IPC accepts only its own trusted main frame and exact loopback origin', () => {
  const { handlers, calls, event } = desktopBridge();
  const present = handlers.get('hermes-native:present');
  assert.equal(present(event, state()).active, true);
  assert.equal(calls[0][0], 'present');
  assert.throws(() => present({ ...event, sender: {} }, state()), /Untrusted/);
  assert.throws(
    () => present({ ...event, senderFrame: { url: event.senderFrame.url } }, state()),
    /Untrusted/,
  );
  event.senderFrame.url = 'http://127.0.0.1:3211/';
  assert.throws(() => present(event, state()), /Untrusted/);
  event.senderFrame.url = 'https://127.0.0.1:3210.attacker.test/';
  assert.throws(() => present(event, state()), /Untrusted/);
  assert.equal(calls.length, 1);
});
test('reload and renderer crash hide native controls; window close removes handlers and native references', () => {
  const { handlers, calls, win } = desktopBridge();
  win.webContents.emit('did-start-navigation', {}, 'http://127.0.0.1:3210/', false, true);
  win.webContents.emit('render-process-gone');
  win.emit('closed');
  assert.deepEqual(calls, [['hide'], ['hide'], ['detach']]);
  assert.equal(handlers.size, 0);
});
test('native-to-renderer bridge filters malformed and unknown events', () => {
  const { native, calls } = desktopBridge();
  native.callback('{');
  native.callback(JSON.stringify({ type: 'shell', command: 'bad' }));
  assert.equal(calls.length, 0);
  native.callback(
    JSON.stringify({ type: 'stop', scopeId: 'bot:test', sessionId: 'session', sequence: 0 }),
  );
  assert.equal(calls[0][1], 'hermes-native:action');
});
test('preload exposes no IPC object and strips Electron event from callbacks', async () => {
  const ipc = new EventEmitter();
  ipc.invoke = async () => ({ active: true });
  let exposed;
  const context = {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          exposed = value;
        },
      },
      ipcRenderer: ipc,
    }),
    process: { platform: 'darwin', isMainFrame: true },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), context);
  assert.deepEqual(Object.keys(exposed).sort(), ['hide', 'onAction', 'present']);
  const received = [];
  const remove = await exposed.onAction((...args) => received.push(args));
  ipc.emit('hermes-native:action', { sender: 'privileged' }, { type: 'back' });
  assert.deepEqual(received, [[{ type: 'back' }]]);
  remove();
  assert.equal(ipc.listenerCount('hermes-native:action'), 0);
});
test('non-Mac and subframe preloads expose no native bridge', () => {
  for (const process of [
    { platform: 'linux', isMainFrame: true },
    { platform: 'darwin', isMainFrame: false },
  ]) {
    let exposed = false;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
      process,
      require: () => ({
        contextBridge: {
          exposeInMainWorld: () => {
            exposed = true;
          },
        },
      }),
    });
    assert.equal(exposed, false);
  }
});
test('navigation can remain native without a composer and focus requests stay finite', () => {
  const value = state();
  value.composer.visible = false;
  value.composer.rect = { x: 0, y: 0, width: 0, height: 0 };
  value.navigation.selectedSurface = 'computer';
  value.composer.focusRequest = 3;
  const parsed = presentation.parse(value);
  assert.equal(parsed.visible, true);
  assert.equal(parsed.composer.visible, false);
  assert.equal(parsed.composer.focusRequest, 3);
  for (const token of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    value.composer.focusRequest = token;
    assert.equal(presentation.safeParse(value).success, false);
  }
  assert.equal(
    action.safeParse({ type: 'focus', sessionId: 'session', scopeId: 'bot:test', sequence: 0 })
      .success,
    false,
  );
});
