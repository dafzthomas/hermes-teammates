const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function buildNative(arch = process.arch) {
  if (process.platform !== 'darwin') return;
  if (!['arm64', 'x64', 'universal'].includes(arch))
    throw new Error(`Unsupported Mac architecture: ${arch}`);
  if (arch === 'universal') {
    const files = [buildNative('arm64'), buildNative('x64')];
    const output = path.join(
      root,
      'test-artifacts/native-macos/universal/HermesNativeControls.node',
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync('xcrun', ['lipo', '-create', ...files, '-output', output], { stdio: 'inherit' });
    return output;
  }
  const cache = path.join(root, 'test-artifacts/native-node-headers');
  const headers =
    process.env.HERMES_NODE_HEADERS || path.join(cache, process.versions.node, 'include/node');
  if (!fs.existsSync(path.join(headers, 'node_api.h'))) {
    if (process.env.HERMES_NODE_HEADERS)
      throw new Error('HERMES_NODE_HEADERS must contain node_api.h');
    execFileSync(
      process.execPath,
      [
        require.resolve('node-gyp/bin/node-gyp.js'),
        'install',
        `--target=${process.versions.node}`,
        `--devdir=${cache}`,
      ],
      { stdio: 'inherit' },
    );
  }
  const output = path.join(root, 'test-artifacts/native-macos', arch, 'HermesNativeControls.node');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Node-API 8 is ABI stable across the supported Node/Electron hosts. No V8 symbols are used.
  execFileSync(
    'xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-fmodules',
      '-DNAPI_VERSION=8',
      '-DNODE_GYP_MODULE_NAME=hermes_native_controls',
      '-arch',
      arch === 'x64' ? 'x86_64' : 'arm64',
      '-mmacosx-version-min=12.0',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-framework',
      'AppKit',
      '-I',
      headers,
      path.join(__dirname, 'native/NativeControls.mm'),
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  );
  return output;
}
module.exports = { buildNative };
if (require.main === module) buildNative(process.argv[2] || process.arch);
