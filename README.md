# LaTeX Editor

A small self-hosted, Overleaf-style LaTeX editor: React front end, Node/Express back end and a curated
TeX Live 2026, all in one Docker container.

- Multi-file projects: file tree, uploads (drag and drop), rename and move, and a choice of main file
- CodeMirror editor with LaTeX highlighting. Changes autosave after 1 s; `Ctrl/⌘+S` saves straight away and `Ctrl/⌘+Enter` compiles
- Compiles with pdfLaTeX (the default), XeLaTeX or LuaLaTeX through `latexmk`
- PDF preview with a page-size badge (A4 / Letter / …), plus **Download PDF** and **Source ZIP**
- Import an Overleaf "Download Source" ZIP as a new project
- Clickable errors and warnings; a missing `.sty` / `.cls` offers a one-click package install
- **Packages** dialog to search and install TeX Live packages at runtime

## Run

```sh
docker compose up --build -d
```

Then open <http://localhost:8090>. The port is only bound to `127.0.0.1`, so the editor isn't reachable
from other machines. There is no login. Use a different port with `HOST_PORT=9000 docker compose up -d`,
or put `HOST_PORT=9000` in a `.env` file.

## Where things are stored

`./data` on the host is mounted at `/data` in the container.

| Host path | Contents |
|---|---|
| `./data/projects/<id>/` | Your project files. Metadata is in a hidden `.editor.json`. |
| `./data/texmf/<year>/` | Packages installed from the UI (a TeX Live user tree). |
| `./data/texmf/packages.json` | The packages you asked for, used to reinstall them after a TeX Live upgrade. |
| `./data/texmf/cache/` | Cached TeX Live package index. |

Compile output (aux files and `output.pdf`) lives inside the container under
`/var/lib/latex-editor/builds`. It can be rebuilt at any time; use **Clear cache** to start a compile
from scratch.

The server runs as `PUID:PGID`, which defaults to `1000:1000`, so files in `./data` are owned by your
user. Set `PUID` / `PGID` in the environment or in a `.env` file if your uid is different.

## Paper size

New projects start from A4 templates, and TeX Live's default paper is A4. What the document says still
wins: `\documentclass[letterpaper]{article}` produces Letter pages. The badge above the PDF preview shows
the actual size of page 1.

## Packages

The image contains only `scheme-basic` plus the packages listed in
[`docker/tl-packages.txt`](docker/tl-packages.txt). That list covers the resume template: fontawesome5,
FiraMono, TeX Gyre Heros, contour, ulem, titlesec, enumitem, fullpage and marvosym, plus the
XeLaTeX/LuaLaTeX engines. The image is about 600 MB.

There are two ways to add more:

- **From the UI.** Use the **Packages** dialog, or the **Install** button next to a "`foo.sty` was not
  found" message. Packages are installed with `tlmgr --usermode` into `./data/texmf/<year>`, so they
  survive container rebuilds.
- **In the image.** Packages that contain programs (for example `biber`), collections and hyphenation
  patterns can't be installed in user mode. The dialog marks these "Needs image rebuild". Add them to
  `docker/tl-packages.txt` and run `docker compose up --build -d`.

If T1-encoded serif text looks blurry (bitmap fonts), install `cm-super` from the Packages dialog.

### Upgrading TeX Live

`TL_YEAR` and `TL_REPO` are build arguments in the `Dockerfile`. `TL_REPO` points at a frozen snapshot,
so packages installed later always match the release in the image. To move to a new release:

1. Change both arguments to the new year and a snapshot URL from <https://www.texlive.info/tlnet-archive/>.
2. Rebuild the image.
3. Open **Packages → Installed** and click **Reinstall all** to install your packages from the previous
   release into the new year's folder.

## Security notes

- A project's `latexmkrc` is **ignored** (`latexmk -norc`), because it is Perl code that would run on
  every compile.
- Shell escape stays at TeX Live's restricted default, so `minted` and other packages that need full
  `-shell-escape` won't work.
- Compiles are killed after `COMPILE_TIMEOUT_MS` (60 s by default).

## Development

The web app can run with hot reload against a server listening on port 8080. For example, start the
container with `HOST_PORT=8080` and then run:

```sh
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :8080
```

The server is TypeScript under `server/src`. Build it with `npm run build` in `server/`.
