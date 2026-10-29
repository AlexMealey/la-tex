# syntax=docker/dockerfile:1

# ---- TeX Live: a small, curated install pinned to one repository snapshot ----
FROM node:24-trixie-slim AS texlive
ARG TL_YEAR=2026
# A frozen snapshot, so packages installed later from the UI match this release exactly.
ARG TL_REPO=https://www.texlive.info/tlnet-archive/2026/10/15/tlnet
ENV TL_YEAR=${TL_YEAR} \
    TL_REPO=${TL_REPO} \
    TL_ROOT=/usr/local/texlive/${TL_YEAR}

RUN apt-get update \
 && apt-get install -y --no-install-recommends perl wget xz-utils ca-certificates fontconfig \
 && rm -rf /var/lib/apt/lists/*

COPY docker/texlive.profile docker/tl-packages.txt /tmp/tl/
RUN set -eux; \
    cd /tmp/tl; \
    wget -q "${TL_REPO}/install-tl-unx.tar.gz"; \
    tar -xzf install-tl-unx.tar.gz --strip-components=1; \
    sed -i "s/@TL_YEAR@/${TL_YEAR}/g" texlive.profile; \
    perl install-tl --profile=texlive.profile --repository="${TL_REPO}"; \
    tlmgr option repository "${TL_REPO}"; \
    grep -v '^\s*#' tl-packages.txt | xargs tlmgr install; \
    tlmgr path add; \
    tlmgr paper a4; \
    if [ -f "${TL_ROOT}/texmf-var/fonts/conf/texlive-fontconfig.conf" ]; then \
      cp "${TL_ROOT}/texmf-var/fonts/conf/texlive-fontconfig.conf" /etc/fonts/conf.d/09-texlive.conf; \
    fi; \
    printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>/data/texmf/%s/fonts</dir></fontconfig>\n' \
      "${TL_YEAR}" > /etc/fonts/conf.d/10-texmf-user.conf; \
    fc-cache -fs; \
    rm -rf /tmp/tl

# User-installed packages live on the host mount (one folder per release); caches stay in the container.
ENV TEXMF_USER_DIR=/data/texmf \
    TEXMFHOME=/data/texmf/${TL_YEAR} \
    TEXMFVAR=/var/lib/texmf/var \
    TEXMFCONFIG=/var/lib/texmf/config
RUN luaotfload-tool -u

# ---- Build the React app and the server ----
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix server && npm ci --prefix web
COPY server server
COPY web web
RUN npm run build --prefix web \
 && npm run build --prefix server \
 && npm prune --omit=dev --prefix server

# ---- Runtime ----
FROM texlive
WORKDIR /app
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist server/public
COPY server/templates server/templates
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# DATA_DIR holds app.db (accounts) and users/ (encrypted projects). PROJECTS_DIR is only read once,
# to import projects from before accounts existed. BUILDS_DIR should be a tmpfs (see docker-compose.yml).
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PROJECTS_DIR=/data/projects \
    BUILDS_DIR=/var/lib/latex-editor/builds
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/server/dist/index.js"]
