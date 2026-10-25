const { buildNative } = require('./build-native.cjs');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = { 1: 'x64', 3: 'arm64', 4: 'universal' }[context.arch];
  if (!arch) throw new Error(`Unsupported Mac build architecture: ${context.arch}`);
  buildNative(arch);
};
