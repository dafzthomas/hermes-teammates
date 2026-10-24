import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'org.hermesteammates.mobile',
  appName: 'Hermes Teammates',
  webDir: 'dist/mobile',
  loggingBehavior: 'none',
  backgroundColor: '#111111',
  ios: { path: 'mobile/ios', contentInset: 'never', preferredContentMode: 'mobile' },
  android: { path: 'mobile/android', allowMixedContent: false },
  plugins: {
    Keyboard: { resize: 'body', style: 'DARK' },
    SystemBars: { style: 'DARK' },
  },
};
export default config;
