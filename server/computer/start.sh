#!/bin/sh
set -eu
test -n "${VNC_PASSWORD:-}"
mkdir -p "$HOME/workspace" "$HOME/.config/openbox"
rm -f /tmp/.X0-lock
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
until xdpyinfo -display :0 >/dev/null 2>&1; do sleep 0.1; done
xsetroot -solid '#222426'
dbus-run-session openbox-session &
tint2 &
chromium --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --start-maximized --user-data-dir="$HOME/.chromium" about:blank >/tmp/chromium.log 2>&1 &
# VNC's password is a random screen credential, never a provider or user credential.
x11vnc -display :0 -forever -shared -passwd "$VNC_PASSWORD" -localhost -rfbport 5900 -quiet &
exec websockify 0.0.0.0:6080 localhost:5900
