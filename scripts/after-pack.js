// electron-builder afterPack hook: re-signs the macOS app before it is put in
// the .dmg.
//
// There is no Apple certificate, so electron-builder leaves signing alone —
// but then the app keeps the signature Electron's own binaries shipped with,
// which Apple has since revoked for this Electron line. macOS kills a binary
// carrying a revoked signature on launch (and XProtect deletes it), so an
// unsigned build simply does not open. An ad-hoc signature replaces it.
//
// MAC_SIGN_IDENTITY picks an identity (a keychain certificate name); without
// it, the "ClearDay Signing" certificate is used when the keychain has one.
//
// Notarization is wired up but off (docs/notarize.md). It turns on only when
// APPLE_TEAM_ID is set and MAC_SIGN_IDENTITY is a "Developer ID Application"
// certificate: then every binary is signed with the hardened runtime and a
// secure timestamp, and the app is sent to Apple's notary service and stapled,
// so macOS opens it without the "can't verify" warning.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENTITLEMENTS = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const identity = process.env.MAC_SIGN_IDENTITY || defaultIdentity();
  if (process.env.APPLE_TEAM_ID && identity.includes('Developer ID Application')) {
    signForNotarization(appPath, identity);
    notarize(appPath);
    return;
  }
  // The native helpers first: --deep does not reach binaries in
  // Contents/Resources, and the app's signature seals them as they are.
  for (const helper of ['cmdtap', 'pointer']) {
    const bin = path.join(appPath, 'Contents', 'Resources', helper);
    if (fs.existsSync(bin)) execFileSync('codesign', ['--force', '-s', identity, '-i', `com.noam.clearday.${helper}`, bin], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--force', '--deep', '-s', identity, appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};

// "ClearDay Signing", a self-made certificate in the keychain, when there is
// one. Signed with it, every build is the same app to macOS, which keeps the
// permissions it was given (Input Monitoring, for quick add) across updates.
// An ad-hoc signature ties them to one exact build, so each update loses them.
const LOCAL_IDENTITY = 'ClearDay Signing';
function defaultIdentity() {
  try {
    const found = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
    if (found.includes(`"${LOCAL_IDENTITY}"`)) return LOCAL_IDENTITY;
  } catch (_) {}
  console.warn(`  • no "${LOCAL_IDENTITY}" certificate in the keychain: signing ad-hoc. Quick add will lose its permission on every update.`);
  return '-';
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

// Notarization wants every binary in the app signed with the Developer ID,
// the hardened runtime and a timestamp. codesign --deep misses binaries
// outside the usual places (the native helpers in Contents/Resources,
// Electron's dylibs), so each is signed on its own, inside out: a bundle's
// signature seals what is in it, so the contents come first. That signs
// Resources/cmdtap and Resources/pointer, then Electron's helpers and
// frameworks, and the app itself last.
function signForNotarization(appPath, identity) {
  const sign = ['--force', '--options', 'runtime', '--entitlements', ENTITLEMENTS, '--timestamp', '-s', identity];
  const depth = (p) => p.split(path.sep).length;
  const nested = codeInside(path.join(appPath, 'Contents')).sort((a, b) => depth(b) - depth(a));
  for (const p of nested) run('codesign', [...sign, p]);
  run('codesign', [...sign, appPath]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
}

// Every Mach-O file, .app and .framework under dir. Symlinks are skipped: a
// framework's Versions/Current and top-level links point at what is listed.
function codeInside(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      codeInside(p, out);
      if (/\.(app|framework)$/.test(entry.name)) out.push(p);
    } else if (entry.isFile() && isMachO(p)) {
      out.push(p);
    }
  }
  return out;
}

const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACHO_MAGIC.has(head.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

// Zips the app, sends it to Apple's notary service and waits for the verdict
// (usually a few minutes), then staples the ticket to the app so it checks
// out offline too. Credentials: NOTARY_PROFILE, a keychain profile saved with
// `xcrun notarytool store-credentials`, or APPLE_ID + APPLE_APP_PASSWORD (an
// app-specific password) with APPLE_TEAM_ID.
function notarize(appPath) {
  const { NOTARY_PROFILE, APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID } = process.env;
  let auth;
  if (NOTARY_PROFILE) auth = ['--keychain-profile', NOTARY_PROFILE];
  else if (APPLE_ID && APPLE_APP_PASSWORD) auth = ['--apple-id', APPLE_ID, '--password', APPLE_APP_PASSWORD, '--team-id', APPLE_TEAM_ID];
  else throw new Error('notarizing needs NOTARY_PROFILE, or APPLE_ID and APPLE_APP_PASSWORD: see docs/notarize.md');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-notarize-'));
  const zip = path.join(dir, `${path.basename(appPath, '.app')}.zip`);
  try {
    run('ditto', ['-c', '-k', '--keepParent', appPath, zip]);
    console.log(`  • notarizing ${appPath}, usually a few minutes`);
    let out;
    try {
      out = execFileSync('xcrun', ['notarytool', 'submit', zip, ...auth, '--wait', '--output-format', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    } catch (e) {
      // A rejected submission can exit non-zero; its JSON still says why.
      if (!e.stdout) throw e;
      out = e.stdout;
    }
    let result;
    try {
      result = JSON.parse(out);
    } catch {
      throw new Error(`notarytool said: ${out}`);
    }
    if (result.status !== 'Accepted') {
      if (result.id) run('xcrun', ['notarytool', 'log', result.id, ...auth]);
      throw new Error(`notarization ${result.status || 'failed'}: ${result.message || out}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  run('xcrun', ['stapler', 'staple', appPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
}
