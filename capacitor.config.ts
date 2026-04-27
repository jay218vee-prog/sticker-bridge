import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.d8849c32cd124dbf9c424ea39de5d6d2',
  appName: 'Sticker Bridge',
  webDir: 'dist',
  server: {
    url: 'https://d8849c32-cd12-4dbf-9c42-4ea39de5d6d2.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for printers…',
        cancel: 'Cancel',
        availableDevices: 'Available printers',
        noDeviceFound: 'No printers found',
      },
    },
  },
};

export default config;
