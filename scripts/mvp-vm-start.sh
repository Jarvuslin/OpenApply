#!/bin/sh
set -eu
mkdir -p /run/postgresql /var/lib/postgresql/mvp
chown -R postgres:postgres /run/postgresql /var/lib/postgresql/mvp
if [ ! -f /var/lib/postgresql/mvp/PG_VERSION ]; then
  su postgres -c 'initdb -D /var/lib/postgresql/mvp -A trust --no-locale -E UTF8' >/tmp/jobpilot-init.log
  printf "\nport=5433\nlisten_addresses='localhost'\n" >> /var/lib/postgresql/mvp/postgresql.conf
fi
if ! su postgres -c 'pg_ctl -D /var/lib/postgresql/mvp status' >/dev/null 2>&1; then
  su postgres -c 'pg_ctl -D /var/lib/postgresql/mvp -l /var/lib/postgresql/mvp/server.log start'
fi
su postgres -c 'psql -p 5433 -lqt' | grep -q jobpilot || su postgres -c 'createdb -p 5433 jobpilot'
id pilot >/dev/null 2>&1 || adduser -D pilot
if [ ! -f /home/pilot/jobpilot-tools/node_modules/@playwright/mcp/cli.js ]; then
  (cd /home/pilot && npm install --prefix /home/pilot/jobpilot-tools --ignore-scripts --no-audit --no-fund @playwright/mcp@0.0.83)
fi
mkdir -p /home/pilot/browser /home/pilot/openapply
chown -R pilot:pilot /home/pilot
pgrep Xvfb >/dev/null || (nohup Xvfb :99 -screen 0 1366x900x24 -nolisten tcp >/tmp/jobpilot-display.log 2>&1 </dev/null &)
sleep 1
pgrep x11vnc >/dev/null || (nohup env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 >/tmp/jobpilot-vnc.log 2>&1 </dev/null &)
pgrep -f 'websockify.*6080' >/dev/null || (nohup websockify --web=/usr/share/novnc 127.0.0.1:6080 localhost:5900 >/tmp/jobpilot-webvnc.log 2>&1 </dev/null &)
printf 'VM services started. Database :5433, browser CDP :9222, browser viewer :6080\n'
if ! pgrep -x chromium >/dev/null; then
  exec su pilot -s /bin/sh -c 'exec env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE DISPLAY=:99 chromium --ozone-platform=x11 --user-data-dir=/home/pilot/browser --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --no-first-run --disable-dev-shm-usage about:blank'
fi
while :; do sleep 3600; done
