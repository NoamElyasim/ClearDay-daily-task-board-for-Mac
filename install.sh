#!/bin/bash
# Installs ClearDay, or updates it, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/NoamElyasim/ClearDay-daily-task-board-for-Mac/main/install.sh | bash
#
# It downloads the latest release's DMG for this Mac (Apple Silicon or Intel),
# copies ClearDay.app into /Applications (or ~/Applications when /Applications
# isn't writable) and opens it. A file downloaded by curl isn't flagged as
# coming from the internet the way a browser download is, so macOS opens the
# app straight away, without the "can't verify" warning. No sudo, and nothing
# else is installed.
#
#   CLEARDAY_INSTALL_DIR=/some/folder   install there instead
#   CLEARDAY_NO_OPEN=1                  install only: don't open the app, and
#                                       leave a running copy elsewhere alone
#                                       (for tests)
#
# Everything is inside main(), which runs on the last line: bash reads this
# script from curl's pipe, and a download cut short then runs nothing at all.
set -euo pipefail

REPO="NoamElyasim/ClearDay-daily-task-board-for-Mac"
APP="ClearDay"
# The app's own process. Claude's MCP servers run this same binary with
# server.mjs after it, so the pattern ends at the binary's name: quitting the
# app must not cut Claude off.
APP_PROCESS="/$APP.app/Contents/MacOS/$APP\$"

TMP=""
MOUNT=""

say() {
  if [ -t 1 ]; then printf '\033[1m==>\033[0m %s\n' "$*"; else printf '==> %s\n' "$*"; fi
}

fail() {
  printf 'ClearDay installer: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$MOUNT" ]; then
    if ! hdiutil detach -quiet "$MOUNT" 2>/dev/null && ! hdiutil detach -quiet -force "$MOUNT" 2>/dev/null; then
      # Removing the folder now would reach into the mounted image.
      printf 'ClearDay installer: the disk image is still mounted at %s\n' "$MOUNT" >&2
      return
    fi
  fi
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
}

# Quits ClearDay before its app is replaced. Opening the new copy while the
# old one is still quitting fails (LaunchServices -609), hence the wait.
#
# The running app is found with ps, not pgrep: when ClearDay's own updater
# runs this script, the script is a child of the app it has to quit, and
# macOS's pgrep leaves its own ancestors out of what it finds. The update
# then went in underneath an app that was never told to quit.
quit_clearday() {
  local dest=$1 pids="" pid cmd alive
  while read -r pid cmd; do
    # The app itself: its binary alone, or with flags. Claude's MCP servers
    # run the same binary with server.mjs after it, and are left alone.
    case "$cmd" in
      *"/$APP.app/Contents/MacOS/$APP" | *"/$APP.app/Contents/MacOS/$APP --"*) ;;
      *) continue ;;
    esac
    # An install-only run touches nothing but the copy it replaces.
    if [ "${CLEARDAY_NO_OPEN:-}" = 1 ]; then
      case "$cmd" in
        "$dest/Contents/MacOS/$APP" | "$dest/Contents/MacOS/$APP --"*) ;;
        *) continue ;;
      esac
    fi
    pids="$pids $pid"
  done < <(ps -axo pid=,command=)
  if [ -z "$pids" ]; then return 0; fi
  say "Quitting the running ClearDay"
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  for _ in $(seq 40); do
    alive=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done
    if [ -z "$alive" ]; then return 0; fi
    sleep 0.25
  done
  # Still there after ten seconds: it is not going to quit by being asked.
  for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
  sleep 0.5
}

main() {
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [ "$(uname -s)" = Darwin ] || fail "ClearDay is a Mac app: run this on macOS 13 or later."
  local macos major
  macos=$(sw_vers -productVersion)
  major=${macos%%.*}
  case $major in
    '' | *[!0-9]*) fail "couldn't read the macOS version ($macos)." ;;
  esac
  [ "$major" -ge 13 ] || fail "ClearDay needs macOS 13 or later; this Mac has macOS $macos."

  local arch chip
  case $(uname -m) in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) fail "unsupported processor: $(uname -m)." ;;
  esac
  # A Terminal running under Rosetta reports x86_64 on Apple Silicon.
  if [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = 1 ]; then arch=arm64; fi
  if [ "$arch" = arm64 ]; then chip="Apple Silicon"; else chip="Intel"; fi

  say "Finding the latest ClearDay for $chip"
  local release url
  release=$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/releases/latest" </dev/null) ||
    fail "couldn't reach GitHub to find the latest release. Check the connection and try again, or download the DMG from https://github.com/$REPO/releases/latest"
  url=$(printf '%s\n' "$release" |
    grep -o '"browser_download_url": *"[^"]*"' |
    sed 's/^.*"\(https:[^"]*\)"$/\1/' |
    grep "/$APP-[^/]*-$arch\.dmg\$" |
    head -n 1) || true
  [ -n "$url" ] || fail "the latest release has no $arch DMG. See https://github.com/$REPO/releases"

  local dmg version
  dmg=${url##*/}
  version=${dmg#"$APP-"}
  version=${version%"-$arch.dmg"}

  TMP=$(mktemp -d -t clearday-install)
  say "Downloading ClearDay $version ($dmg)"
  curl -fL --retry 3 --progress-bar -o "$TMP/$dmg" "$url" </dev/null ||
    fail "the download failed. Check the connection and try again."

  say "Opening the disk image"
  mkdir "$TMP/mnt"
  # Its notes (newer macOS warns that this form of the command is
  # deprecated) are shown only if it fails.
  if ! hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$TMP/mnt" "$TMP/$dmg" </dev/null >/dev/null 2>"$TMP/attach.log"; then
    cat "$TMP/attach.log" >&2
    fail "couldn't open $dmg."
  fi
  MOUNT="$TMP/mnt"
  local src="$MOUNT/$APP.app"
  if [ ! -d "$src" ]; then
    src=$(find "$MOUNT" -maxdepth 2 -type d -name "$APP.app" | head -n 1) || true
    [ -n "$src" ] || fail "$dmg has no $APP.app inside."
  fi
  codesign --verify --deep --strict "$src" 2>/dev/null ||
    fail "the downloaded app failed its signature check, so it wasn't installed. Try again."

  local dir
  if [ -n "${CLEARDAY_INSTALL_DIR:-}" ]; then
    dir=$CLEARDAY_INSTALL_DIR
  elif [ -w /Applications ]; then
    dir=/Applications
  else
    dir="$HOME/Applications"
  fi
  mkdir -p "$dir" 2>/dev/null || fail "couldn't create $dir."
  dir=$(cd "$dir" && pwd -P)
  [ -w "$dir" ] || fail "can't write to $dir."
  local dest="$dir/$APP.app"

  quit_clearday "$dest"

  say "Installing into $dir"
  if [ -e "$dest" ]; then
    rm -rf "$dest" 2>/dev/null || fail "couldn't remove the old $dest. Move it to the Trash, then run this again."
  fi
  ditto "$src" "$dest"
  # curl sets no quarantine flag, so there should be none; this is in case
  # something else on the Mac added one.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

  if [ "$dir" != /Applications ] && [ -z "${CLEARDAY_INSTALL_DIR:-}" ] && [ -d "/Applications/$APP.app" ]; then
    say "Note: an older ClearDay is still in /Applications. Move it to the Trash so Spotlight opens this one."
  fi

  if [ "${CLEARDAY_NO_OPEN:-}" = 1 ]; then
    say "ClearDay $version is installed in $dir."
  elif open "$dest"; then
    say "ClearDay $version is installed in $dir, and opening now."
  else
    say "ClearDay $version is installed in $dir. Open it from there."
  fi
}

main "$@"
