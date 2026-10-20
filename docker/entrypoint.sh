#!/bin/sh
# Prepare the mounted folders as root, then re-run this script as PUID:PGID to start the server.
set -e

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  mkdir -p "$DATA_DIR/users" "$TEXMF_USER_DIR/cache" "$TEXMFHOME" "$BUILDS_DIR" "$TEXMFVAR" "$TEXMFCONFIG" /home/app
  # Only the folders themselves on the host mount: never rewrite ownership of your files.
  chown "$PUID:$PGID" "$DATA_DIR" "$DATA_DIR/users" "$TEXMF_USER_DIR" "$TEXMF_USER_DIR/cache" "$TEXMFHOME"
  chmod 700 "$DATA_DIR/users"
  # Plaintext projects from before accounts existed: imported (and moved aside) when the first admin registers.
  if [ -d "$PROJECTS_DIR" ]; then chown "$PUID:$PGID" "$PROJECTS_DIR"; fi
  chown -R "$PUID:$PGID" "$BUILDS_DIR" /var/lib/texmf /home/app
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups env HOME=/home/app /usr/local/bin/entrypoint.sh "$@"
fi

# User package tree on the host mount (one folder per TeX Live release).
if [ ! -f "$TEXMFHOME/tlpkg/texlive.tlpdb" ]; then
  tlmgr init-usertree
fi

# Font maps for user-installed fonts are generated into the container-local TEXMFVAR,
# so rebuild them from the persisted config after the container is recreated.
if [ -f "$TEXMFHOME/web2c/updmap.cfg" ]; then
  updmap-user >/dev/null 2>&1 || echo "warning: updmap-user failed" >&2
fi

exec "$@"
