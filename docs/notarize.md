# Notarizing ClearDay

ClearDay is signed locally and isn't notarized, so a DMG downloaded in a
browser opens with macOS's warning: Apple can't verify that ClearDay is free
of malware. People get past it once, from System Settings → Privacy &
Security → Open Anyway, or skip it with the one-line installer
([install.sh](../install.sh)).

Notarization is already wired into the build and switched off. This page
says what it gives and how to turn it on.

## What the Apple Developer Program gives

The [Apple Developer Program](https://developer.apple.com/programs/) costs
$99 a year. For ClearDay it brings two things:

- **A Developer ID Application certificate.** It signs the app with your
  name and team, in place of the local ad-hoc signature.
- **Apple's notary service.** Apple scans every build for malicious software
  and issues a ticket, which the build attaches to the app ("stapling").

With both, the first launch of a downloaded ClearDay shows macOS's ordinary
question instead of the warning:

> “ClearDay” is an app downloaded from the Internet. Are you sure you want
> to open it?
> Apple checked it for malicious software and none was detected.

One click on **Open** and it runs. No trip to System Settings.

Because every build carries the same Developer ID, macOS also treats each
update as the same app, so permissions such as Input Monitoring (for quick
add's ⌘ ⌘) stay granted across updates.

## What's wired up

[`scripts/after-pack.js`](../scripts/after-pack.js) runs for each
architecture after electron-builder packs the app, before the DMG is made:

- **By default** (today) it signs the app ad-hoc, or with `MAC_SIGN_IDENTITY`
  when that is set.
- **When `APPLE_TEAM_ID` is set and `MAC_SIGN_IDENTITY` is a "Developer ID
  Application" certificate**, it instead:
  1. signs every binary inside out with the hardened runtime, a secure
     timestamp and [`build/entitlements.mac.plist`](../build/entitlements.mac.plist).
     That covers the native helpers in `Contents/Resources` (`cmdtap`,
     `pointer`), then Electron's helpers and frameworks, then the app;
  2. zips the app with `ditto` and sends it to Apple with
     `xcrun notarytool submit --wait` (usually a few minutes);
  3. staples the ticket with `xcrun stapler staple`, and checks the result
     with `spctl`.

The DMG then contains the notarized, stapled app. `build.mac.identity` stays
`null` and `build.mac.notarize` stays `false` in package.json: the hook does
the signing and notarizing, so electron-builder must not sign over it.

## Turning it on

1. **Join the Apple Developer Program** as an individual, at
   [developer.apple.com/programs](https://developer.apple.com/programs/).
   Your Team ID (10 characters) is under Membership details at
   [developer.apple.com/account](https://developer.apple.com/account).

2. **Create the Developer ID Application certificate.** In Xcode: Settings →
   Accounts → your Apple ID → Manage Certificates → **+** → **Developer ID
   Application**. It goes into your login keychain. Check it's there:

   ```bash
   security find-identity -v -p codesigning
   # 1) 4A5B… "Developer ID Application: Noam Elyasim (AB12CD34EF)"
   ```

   Without Xcode: create it at Certificates, Identifiers & Profiles on
   developer.apple.com, from a certificate signing request made in Keychain
   Access (Certificate Assistant → Request a Certificate From a Certificate
   Authority), then double-click the downloaded `.cer`.

3. **Make an app-specific password** for the notary service: at
   [account.apple.com](https://account.apple.com), Sign-In and Security →
   App-Specific Passwords.

4. **Store the notary credentials in the keychain**, once:

   ```bash
   xcrun notarytool store-credentials clearday-notary \
     --apple-id you@example.com --team-id AB12CD34EF
   # it asks for the app-specific password
   ```

5. **Build with the three variables set:**

   ```bash
   export MAC_SIGN_IDENTITY="Developer ID Application: Noam Elyasim (AB12CD34EF)"
   export APPLE_TEAM_ID=AB12CD34EF
   export NOTARY_PROFILE=clearday-notary
   npm run dist:mac
   ```

   On a machine without the keychain profile (CI, say), set `APPLE_ID` and
   `APPLE_APP_PASSWORD` (the app-specific password) instead of
   `NOTARY_PROFILE`.

6. **Check the result.** The build log ends each architecture with
   `source=Notarized Developer ID`. To check again later:

   ```bash
   spctl --assess --type execute --verbose=2 dist/mac-arm64/ClearDay.app
   xcrun stapler validate dist/mac-arm64/ClearDay.app
   ```

   If Apple rejects a build, the hook prints Apple's log, which names each
   file that failed. `xcrun notarytool history --keychain-profile
   clearday-notary` lists past submissions.

Optionally, sign and notarize the DMGs as well, so the disk image itself
checks out (the app inside already does):

```bash
for dmg in dist/ClearDay-*.dmg; do
  codesign --timestamp -s "$MAC_SIGN_IDENTITY" "$dmg"
  xcrun notarytool submit "$dmg" --keychain-profile clearday-notary --wait
  xcrun stapler staple "$dmg"
done
```

## Once releases are notarized

- In the README's Install section, drop the Open Anyway steps from the DMG
  route.
- In [`tools/dmg/art.html`](../tools/dmg/art.html), drop the "First time
  opening?" note, then run `npm run dmg-art`.
- Unset `APPLE_TEAM_ID` to go back to local signing for a quick build.
