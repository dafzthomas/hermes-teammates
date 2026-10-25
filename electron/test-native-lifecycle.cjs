const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') {
  console.log('Native lifecycle compiler tests require the Apple SDKs.');
  process.exit(0);
}
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-artifacts/native-lifecycle');
fs.mkdirSync(output, { recursive: true });
const mac = path.join(output, 'mac-tests');
const ios = path.join(output, 'ios-document-tests');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
run('xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-fmodules',
  '-framework',
  'AppKit',
  'electron/native/NativeControlsLifecycleTests.mm',
  '-o',
  mac,
]);
run(mac, []);
run('xcrun', [
  'swiftc',
  'mobile/ios/App/App/NativeDocumentSession.swift',
  'mobile/ios/tests/NativeDocumentSessionTests.swift',
  '-o',
  ios,
]);
run(ios, []);
