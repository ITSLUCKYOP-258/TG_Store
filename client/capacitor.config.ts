import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tgstore.app',
  appName: 'TGStore',
  // Points to the Vite build output — `npx cap sync` copies it into the Android project
  webDir: 'dist',
  plugins: {
    // Allow the WebView to make HTTP requests in debug builds
    // (production should always use HTTPS)
    CapacitorHttp: {
      enabled: true,
    },
  },
  android: {
    // Allow cleartext HTTP in debug mode (remove for production with HTTPS)
    allowMixedContent: true,
  },
};

export default config;
