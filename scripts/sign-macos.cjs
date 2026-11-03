const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { access } = require('node:fs/promises');
const { signAsync } = require('@electron/osx-sign');

const execute = promisify(execFile);
const appId = 'com.supercmd.app';

async function verifyBundle(app) {
  const hyperKeyMonitor = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'dist', 'native', 'hyper-key-monitor');
  await access(hyperKeyMonitor);
  await execute('lipo', [hyperKeyMonitor, '-verify_arch', 'arm64']);
  await execute('codesign', ['--verify', '--deep', '--strict', app]);
  const { stderr } = await execute('codesign', ['--display', '--verbose=2', app]);
  if (!stderr.split('\n').includes(`Identifier=${appId}`)
      || !stderr.includes('Signature=adhoc')
      || stderr.includes('Info.plist=not bound')
      || stderr.includes('Sealed Resources=none')) {
    throw new Error('The app must have a valid ad-hoc bundle signature bound to com.supercmd.app and its resources.');
  }
  console.log(`Verified ad-hoc bundle identity: ${appId}`);
}

async function signBundle(app) {
  await signAsync({
    app,
    platform: 'darwin',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      entitlements: path.join(__dirname, '..', 'entitlements.mac.plist'),
      hardenedRuntime: true,
      timestamp: 'none',
    }),
  });
  await verifyBundle(app);
}

// electron-builder 24 skips certificate signing when mac.identity is null.
// Seal the complete prepared bundle before DMG creation instead of leaving
// Electron's linker signature and Identifier=Electron on the renamed app.
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await signBundle(app);
};

if (require.main === module) {
  const [mode, app] = process.argv.slice(2);
  if (!app || !['--sign', '--verify'].includes(mode)) {
    console.error('Usage: node scripts/sign-macos.cjs --sign|--verify <SuperCmd.app>');
    process.exitCode = 1;
  } else {
    (mode === '--sign' ? signBundle(app) : verifyBundle(app)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
