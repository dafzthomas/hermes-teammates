export function applyPlatformStyle() {
  const platform = navigator.platform.toLowerCase();
  const agent = navigator.userAgent.toLowerCase();
  const appleTouch =
    /iphone|ipad|ipod/.test(agent) || (platform === 'macintel' && navigator.maxTouchPoints > 1);
  document.documentElement.dataset.platform = appleTouch
    ? 'ios'
    : agent.includes('android')
      ? 'android'
      : platform.includes('mac')
        ? 'macos'
        : platform.includes('win')
          ? 'windows'
          : 'linux';
}
