#!/usr/bin/env bash
# Builds the sandbox image (ADR 0025): macOS in a Tart VM with Ableton Live installed, authorized and
# paired, that opens Patience at login. Every eval sandbox is a copy of it. Run it by hand:
#
#     scripts/build-sandbox-image.sh <live-installer.dmg> <licence.auz> [image-name]
#
# The image name defaults to mentor-sandbox. Neither file is copied into the repo, and the image is never
# pushed (no `tart push`): it holds a Live authorization and stays on this Mac.
#
# What it leaves on this Mac, in ~/.mentor/sandbox/ (the sandbox of #110 reads them):
#     pairing-password   the password pairing wrote into the image's Remote Script
#     id_ed25519         the SSH key (public half in the image's authorized_keys), user admin
#     <image-name>.mac   the MAC address Live was authorized under; every sandbox copy gets it, as Live's
#                        authorization is tied to it. Never start the image itself while a copy runs:
#                        Tart then gives the image a new MAC and saves it.
#
# Environment:
#     TART=/path/to/tart      the tart binary to use (default: `tart` on PATH)
#     SANDBOX_BASE=...        base image to copy (default ghcr.io/cirruslabs/macos-tahoe-base:latest)
#     SANDBOX_GUI=1           boot with a window and wait for you at the steps that need a hand (see below)
#     SANDBOX_AUDIO=1         boot with Tart's audio on (the default is --no-audio, as the sandbox runs)
#     SANDBOX_DELETE_ON_FAIL=1  delete the half-built image after a failure (the default is to keep it)
#     SANDBOX_DISK_GB=100     the image's disk size
#
# A failed build keeps its VM, and a rerun of the same command resumes: the steps already done (listed in
# ~/.mentor/sandbox/<image-name>.done) are skipped, and the VM is reused. To start over, tart delete the
# image and remove that file.
#
# The pairing is the mentor's own: installRemoteScript() from @mentor/tools runs on this Mac into a
# staging folder, and the folder is copied into the VM, because the VM has no Node and no repo. It is
# the same install, with the same random password, that `pnpm pair ableton` makes.
#
# Live's Settings → Control Surface choice cannot be made from a script (Live draws its own dialogs, so
# System Events cannot see inside them). With SANDBOX_GUI=1 the script stops after launching Live and you
# choose MusicMentor there, and answer any first-launch dialog. Without it, a missing choice fails the
# final check, and the message says so.
# shellcheck disable=SC2016,SC2029  # single quotes are deliberate: those commands expand in the VM
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX_HOME=$HOME/.mentor/sandbox
KEY=$SANDBOX_HOME/id_ed25519
PASSWORD_FILE=$SANDBOX_HOME/pairing-password
BASE=${SANDBOX_BASE:-ghcr.io/cirruslabs/macos-tahoe-base:latest}
# GUEST_USER, LIVE_APP, PATIENCE and REMOTE_SCRIPT_PORT are also in evals/src/sandbox.ts: change them together.
GUEST_USER="admin"
# The Cirrus base images ship with this user and password, and ssh on.
GUEST_PASSWORD="admin"
LIVE_APP="/Applications/Ableton Live 12 Suite.app"
# The base Set: Ableton's demo song, inside the app (evals/sets/patience/README.md).
PATIENCE="$LIVE_APP/Contents/App-Resources/Core Library/Lessons/Demo Songs/Chuck Sutton - Patience (Live 12 Suite Demo).als"
REMOTE_SCRIPT_PORT=39031
# Patience has 15 tracks and two returns; fewer read back means another Set is open.
MIN_TRACKS=15

die() {
    echo "build-sandbox-image: $*" >&2
    exit 1
}
say() { echo "==> $*"; }

# ---- Fail early, before anything is created -------------------------------------------------------------

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || die "usage: scripts/build-sandbox-image.sh <live-installer.dmg> <licence.auz> [image-name]"
INSTALLER=$1
LICENCE=$2
NAME=${3:-mentor-sandbox}

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] ||
    die "this needs an Apple Silicon Mac: Tart runs macOS VMs only on Apple Silicon."

if [ -n "${TART:-}" ] && [ -x "$TART" ]; then
    TART_BIN=$TART
elif command -v tart >/dev/null 2>&1; then
    TART_BIN=$(command -v tart)
else
    die "Tart is not installed. Install it (brew install cirruslabs/cli/tart), or set TART to the path of the tart binary."
fi
tart() { "$TART_BIN" "$@"; }

for tool in ssh ssh-keygen nc tar node; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH."
done
[ -d "$REPO/evals/node_modules" ] || die "run pnpm install in $REPO first: the pairing runs from the repo's own packages."

[ -f "$INSTALLER" ] || die "the Live installer is not a file: $INSTALLER"
[ -f "$LICENCE" ] || die "the licence file is not a file: $LICENCE"
case "$INSTALLER" in *.dmg) ;; *) die "the Live installer should be a .dmg, got: $INSTALLER" ;; esac
case "$NAME" in *[!A-Za-z0-9._-]* | "") die "the image name may hold only letters, digits, . _ -, got: $NAME" ;; esac
# Neither file may sit in the repo, where a commit could pick it up.
for file in "$INSTALLER" "$LICENCE"; do
    abs=$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")
    case "$abs" in "$REPO"/*) die "$file is inside the repo. Keep it outside, so it can never be committed." ;; esac
done
STATE=$SANDBOX_HOME/$NAME.done
RESUME=0
if tart get "$NAME" >/dev/null 2>&1; then
    [ -f "$STATE" ] ||
        die "an image named $NAME already exists and is not a half-built one of this script. Delete it first (tart delete $NAME) or pass another name."
    RESUME=1
fi

GUI=${SANDBOX_GUI:-0}

# ---- State, and cleanup on any exit -------------------------------------------------------------------

is_done() { grep -qx "$1" "$STATE" 2>/dev/null; }
mark() { echo "$1" >>"$STATE"; }

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/sandbox-image.XXXXXX")
CREATED=0
VM_PID=""
TUNNEL_PID=""
IP=""
PORT=""
TRACKS=""

stop_tunnel() {
    if [ -n "$TUNNEL_PID" ]; then
        kill "$TUNNEL_PID" 2>/dev/null || true
        wait "$TUNNEL_PID" 2>/dev/null || true
    fi
    TUNNEL_PID=""
}

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    stop_tunnel
    if [ -n "$VM_PID" ]; then
        tart stop "$NAME" >/dev/null 2>&1 || true
        wait "$VM_PID" 2>/dev/null || true
    fi
    if [ "$status" -ne 0 ] && [ "$CREATED" = 1 ]; then
        if ! is_done clone || [ "${SANDBOX_DELETE_ON_FAIL:-0}" = 1 ]; then
            tart delete "$NAME" >/dev/null 2>&1 || true
            rm -f "$STATE" "$PASSWORD_FILE.new"
            echo "build failed; deleted the half-built image $NAME." >&2
        else
            echo "build failed; the VM $NAME is kept with its progress. Run the same command again to resume," >&2
            echo "or look at it: tart run $NAME. To start over: tart delete $NAME; rm $STATE" >&2
        fi
    elif [ "$status" -ne 0 ]; then
        rm -f "$PASSWORD_FILE.new"
    fi
    rm -rf "$STAGE"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 -o ServerAliveInterval=15)
# Runs a command in the VM without reading stdin; vm_in lets stdin through, for a heredoc or a pipe.
vm() { ssh -n "${SSH_OPTS[@]}" "$GUEST_USER@$IP" "$@"; }
vm_in() { ssh "${SSH_OPTS[@]}" "$GUEST_USER@$IP" "$@"; }

alive() {
    if [ -n "$VM_PID" ] && kill -0 "$VM_PID" 2>/dev/null; then return 0; fi
    die "the VM stopped: $(tail -n 3 "$STAGE/tart.log" 2>/dev/null | tr '\n' ' ')
macOS allows at most two macOS VMs at once. Look with tart list; stop another with tart stop <name>."
}

# wait_for <what> <seconds> <command...>: retries the command every 2 s.
wait_for() {
    local what=$1 limit=$((SECONDS + $2))
    shift 2
    until "$@"; do
        alive
        [ "$SECONDS" -lt "$limit" ] || die "timed out waiting for $what."
        sleep 2
    done
}

console_ready() { [ "$(vm stat -f %Su /dev/console 2>/dev/null)" = "$GUEST_USER" ]; }
live_up() { [ -n "$(vm pgrep -x Live 2>/dev/null || true)" ]; }
live_gone() { [ -z "$(vm pgrep -x Live 2>/dev/null || true)" ]; }

# ---- Boot, SSH ----------------------------------------------------------------------------------------

# The first login: puts the SSH key in the VM, with the guest agent if the base has one, else by typing
# the base's known password with expect. Fails (to be retried) while sshd is not up yet.
bootstrap_key() {
    local home=/Users/$GUEST_USER pub cmd
    pub=$(cat "$KEY.pub")
    cmd="mkdir -p $home/.ssh && chmod 700 $home/.ssh && echo '$pub' >> $home/.ssh/authorized_keys && chmod 600 $home/.ssh/authorized_keys && chown -R $GUEST_USER $home/.ssh"
    if tart exec "$NAME" /bin/sh -c "$cmd" >/dev/null 2>&1; then return 0; fi
    command -v expect >/dev/null 2>&1 || die "the VM has no guest agent (tart exec) and expect is not installed to type its password."
    CMD=$cmd IP=$IP USER_NAME=$GUEST_USER PASSWORD=$GUEST_PASSWORD expect -c '
        set timeout 30
        spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
            -o PubkeyAuthentication=no $env(USER_NAME)@$env(IP) $env(CMD)
        expect {
            "assword:" { send "$env(PASSWORD)\r"; exp_continue }
            eof
        }
        catch wait result
        exit [lindex $result 3]
    ' >/dev/null 2>&1
}

# start_vm [first]: boots the VM and waits until ssh works and the desktop is up. "first" is the first
# boot of a fresh copy, which has no key yet.
start_vm() {
    local flags=""
    [ "${SANDBOX_AUDIO:-0}" = 1 ] || flags="$flags --no-audio"
    [ "$GUI" = 1 ] || flags="$flags --no-graphics"
    : >"$STAGE/tart.log"
    # shellcheck disable=SC2086  # the flags hold no spaces; an array would be empty on bash 3.2 with set -u
    tart run $flags "$NAME" >"$STAGE/tart.log" 2>&1 &
    VM_PID=$!
    IP=$(tart ip "$NAME" --wait 180) || { alive; die "the VM got no IP address."; }
    if [ "${1:-}" = first ]; then wait_for "the VM to take the SSH key" 180 bootstrap_key; fi
    wait_for "ssh in the VM" 180 vm true
    # Auto-login puts the user at the desktop; open, osascript and System Events need that session.
    wait_for "the desktop session" 180 console_ready
}

# Quits Live, then shuts macOS down, so the disk is flushed before the next boot or the end.
shutdown_vm() {
    stop_tunnel
    vm 'osascript -e "tell application \"Ableton Live 12 Suite\" to quit"' >/dev/null 2>&1 || true
    wait_for "Live to quit (is a dialog open? build with SANDBOX_GUI=1)" 60 live_gone
    vm 'sudo -n shutdown -h now' >/dev/null 2>&1 || true
    local limit=$((SECONDS + 120))
    while kill -0 "$VM_PID" 2>/dev/null && [ "$SECONDS" -lt "$limit" ]; do sleep 2; done
    tart stop "$NAME" >/dev/null 2>&1 || true
    wait "$VM_PID" 2>/dev/null || true
    VM_PID=""
}

# ---- Checks --------------------------------------------------------------------------------------------

# Whether osascript may drive System Events on Live, which is what clicking "Don't Save" needs: the
# Automation grant (Apple events to System Events) and the Accessibility grant. Says which is missing.
check_tcc() {
    local out
    if out=$(vm_in osascript - 2>&1 <<'AS'
tell application "System Events" to tell process "Live" to get name of every window
AS
    ); then return 0; fi
    case "$out" in
        *-1743*) echo "  missing: Automation. ssh/osascript may not send Apple events to System Events." ;;
        *-25211* | *-1719* | *assistive*) echo "  missing: Accessibility. ssh/osascript may not use the UI (System Settings → Privacy & Security → Accessibility)." ;;
        *) echo "  osascript failed: $out" ;;
    esac
    return 1
}

# Prints "<number of tracks> <names>" read through the tunnel, or fails. This is the mentor's own client
# and read_set tool, with the saved password: what a sandbox does.
read_tracks() {
    (cd "$REPO/evals" && PORT=$PORT PASSWORD=$(cat "$PASSWORD_FILE.new") node --input-type=module -e '
        import { createAbleton } from "@mentor/tools/daws/ableton";
        const tools = createAbleton({ address: `ws://127.0.0.1:${process.env.PORT}`, password: process.env.PASSWORD });
        try {
            const set = JSON.parse(await tools.find((tool) => tool.name === "read_set").run({}));
            console.log(set.tracks.length, set.tracks.map((track) => track.name).join(", "));
        } catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
        process.exit();
    ')
}

open_tunnel() {
    PORT=39100
    while [ "$PORT" = "$REMOTE_SCRIPT_PORT" ] || nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; do PORT=$((PORT + 1)); done
    ssh -N "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:$REMOTE_SCRIPT_PORT" "$GUEST_USER@$IP" &
    TUNNEL_PID=$!
}

patience_open() {
    local out
    out=$(read_tracks 2>&1) || return 1
    [ "${out%% *}" -ge "$MIN_TRACKS" ] 2>/dev/null || return 1
    TRACKS=$out
}

# ---- Build ---------------------------------------------------------------------------------------------

mkdir -p "$SANDBOX_HOME"
chmod 700 "$SANDBOX_HOME"
# A state file with no VM behind it is left over from a build whose VM was deleted.
[ "$RESUME" = 1 ] || rm -f "$STATE"
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "mentor-sandbox" -f "$KEY"

if [ "$RESUME" = 1 ] && is_done remote_script && [ -f "$PASSWORD_FILE.new" ]; then
    say "Pairing: kept from the earlier run"
else
    say "Pairing, on this Mac, into a staging folder"
    # The password stays in $PASSWORD_FILE.new until the image works, so a failed build never overwrites the
    # password a good image needs.
    # ponytail: one password file for all images; two images under different names share the latest one.
    PASSWORD=$(cd "$REPO/evals" && node --input-type=module -e '
        import { installRemoteScript } from "@mentor/tools/daws/ableton";
        console.log((await installRemoteScript(process.argv[1])).password);
    ' "$STAGE/remote-scripts")
    [ -n "$PASSWORD" ] || die "pairing gave no password."
    (umask 077 && printf '%s\n' "$PASSWORD" >"$PASSWORD_FILE.new")
    unset PASSWORD
    # A new password means the Remote Script in the VM has to be installed again.
    if [ -f "$STATE" ]; then sed -i '' '/^remote_script$/d' "$STATE"; fi
fi

CREATED=1
if ! is_done clone; then
    say "Copying the base image $BASE as $NAME (the first copy downloads it)"
    tart clone "$BASE" "$NAME"
    # the base disk has only ~13 GB free; the guest grows its disk on boot (checked on macOS 26.6.2)
    tart set "$NAME" --disk-size "${SANDBOX_DISK_GB:-100}"
    mark clone
else
    say "Resuming the half-built image $NAME (steps done: $(tr '\n' ' ' <"$STATE"))"
fi

say "Booting $NAME (graphics: $([ "$GUI" = 1 ] && echo window || echo none), audio: $([ "${SANDBOX_AUDIO:-0}" = 1 ] && echo on || echo none))"
if is_done key; then
    start_vm
else
    start_vm first
    mark key
fi

say "Checking the VM has room for Live"
need_kb=$(($(wc -c <"$INSTALLER") * 3 / 1024))
has_room() {
    local free
    free=$(vm "df -k / | awk 'NR==2 {print \$4}'" 2>/dev/null || true)
    [ -n "$free" ] && [ "$free" -gt "$need_kb" ] 2>/dev/null
}
wait_for "the disk to grow to hold Live (needs about $((need_kb / 1024)) MB)" 120 has_room

say "Installing Live from $(basename "$INSTALLER")"
if ! is_done install_live; then
    vm_in 'cat > /private/tmp/live-installer.dmg' <"$INSTALLER"
    {
        printf 'app=%q\n' "$LIVE_APP"
        cat <<'GUEST'
set -euo pipefail
mnt=$(mktemp -d /private/tmp/live-dmg.XXXXXX)
# Echo Y answers a licence-agreement prompt, if the dmg has one.
echo Y | hdiutil attach -nobrowse -readonly -noverify -mountpoint "$mnt" /private/tmp/live-installer.dmg >/dev/null
src=$(find "$mnt" -maxdepth 2 -name 'Ableton Live*.app' -print -quit)
[ -n "$src" ] || { echo "no Ableton Live .app on the installer" >&2; exit 1; }
rm -rf "$app"
ditto "$src" "$app"
hdiutil detach "$mnt" >/dev/null
rm -f /private/tmp/live-installer.dmg
GUEST
    } | vm_in bash -s
    vm "test -f '$PATIENCE'" || die "Patience is not where evals/sets/patience/README.md says. Is the installer Live 12 Suite?"

    mark install_live
fi

say "Installing the Remote Script"
if ! is_done remote_script; then
    COPYFILE_DISABLE=1 tar -C "$STAGE/remote-scripts" -cf - MusicMentor |
        vm_in 'mkdir -p "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -C "$HOME/Music/Ableton/User Library/Remote Scripts" -xf -'

    mark remote_script
fi

say "Setting up auto-login and Patience at login"
if ! is_done login; then
    {
        printf 'user=%q\npassword=%q\napp=%q\npatience=%q\n' "$GUEST_USER" "$GUEST_PASSWORD" "$LIVE_APP" "$PATIENCE"
        cat <<'GUEST'
set -euo pipefail
autologin() { defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true; }
[ "$(autologin)" = "$user" ] || sudo -n sysadminctl -autologin set -userName "$user" -password "$password" >/dev/null
[ "$(autologin)" = "$user" ] || { echo "auto-login is not set for $user" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"
cat >"$HOME/Library/LaunchAgents/com.mentor.open-patience.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.mentor.open-patience</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>$app</string>
        <string>$patience</string>
    </array>
    <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$HOME/Library/LaunchAgents/com.mentor.open-patience.plist" >/dev/null
GUEST
    } | vm_in bash -s

    mark login
fi

say "Opening Live with the licence file, to authorize it"
if ! is_done authorize; then
    vm_in 'cat > /private/tmp/licence.auz' <"$LICENCE"
    vm "open -a '$LIVE_APP'"
    wait_for "Live to start" 120 live_up
    sleep 10
    vm "open -a '$LIVE_APP' /private/tmp/licence.auz"
    sleep 5
    if [ "$GUI" = 1 ]; then
        echo
        echo "Live is open in the VM window. By hand: dismiss any first-launch dialog, confirm Live is"
        echo "authorized (Settings → Licenses & Updates), and choose MusicMentor as a Control Surface in"
        echo "Settings → Link, Tempo & MIDI. Then press Enter here."
        read -r
    fi
    vm 'rm -f /private/tmp/licence.auz'
    # Whether Live took the licence is checked after the reboot below, from its log.

    mark authorize
fi

say "Checking the System Events permission the \"Don't Save\" click needs"
if ! is_done tcc; then
    until check_tcc; do
        [ "$GUI" = 1 ] ||
            die "System Events access is not granted in the base image. Build with SANDBOX_GUI=1 and allow it in the VM when macOS asks, or grant it in System Settings → Privacy & Security."
        echo "Grant it in the VM window, then press Enter (Ctrl-C to give up)."
        read -r
    done
    # The runner's screenshot of a stuck VM. Without Screen Recording it shows little, so say so.
    if ! vm 'screencapture -x /private/tmp/check.png && test -s /private/tmp/check.png; r=$?; rm -f /private/tmp/check.png; exit $r'; then
        echo "warning: screencapture failed in the VM; the stuck-VM screenshot of #110 will not work." >&2
    fi

    mark tcc
fi

say "Stopping the VM, then booting it again to check Patience opens by itself"
shutdown_vm
BOOT_START=$SECONDS
start_vm
open_tunnel
wait_for "Patience to open and the Remote Script to answer through the tunnel on port $PORT (is MusicMentor chosen as a Control Surface? build with SANDBOX_GUI=1)" 300 patience_open
BOOT_SECONDS=$((SECONDS - BOOT_START))
# An authorized Live logs IsUnlocked?=true as it starts; an unauthorized one logs nothing about it. An Unlock
# file alone proves nothing: Live ignores one made for another MAC address.
vm 'awk "/Started: Live/ { s = \"\" } { s = s \$0 \"\\n\" } END { printf \"%s\", s }" "$HOME/Library/Preferences/Ableton/"Live*/Log.txt | grep -q "IsUnlocked?=true"' ||
    die "Live is not authorized after the reboot: its log has no IsUnlocked?=true since it started. Build with SANDBOX_GUI=1 and check Settings → Licenses & Updates in the VM."
MAC=$(tart get "$NAME" --format json | sed -n 's/.*"MACAddress" *: *"\([^"]*\)".*/\1/p')
[ -n "$MAC" ] || die "could not read the MAC address of $NAME from tart get."
echo "$MAC" >"$SANDBOX_HOME/$NAME.mac"
mv "$PASSWORD_FILE.new" "$PASSWORD_FILE"

say "Stopping the VM"
shutdown_vm

rm -f "$STATE"

SIZE=$(du -sh "${TART_HOME:-$HOME/.tart}/vms/$NAME" 2>/dev/null | cut -f1 || true)
echo
echo "Sandbox image: $NAME"
echo "Size on disk:  ${SIZE:-unknown}"
echo "Boot to Patience open and the Remote Script answering through the tunnel: ${BOOT_SECONDS}s"
echo "Tracks read through the tunnel on port $PORT: $TRACKS"
echo "Authorization: Live logged IsUnlocked?=true after the reboot, under MAC $MAC ($SANDBOX_HOME/$NAME.mac)"
echo "Pairing password: $PASSWORD_FILE (SSH key: $KEY)"
