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
- Accounts by invite link, with each user's projects encrypted on disk under a key only their password unlocks

## Run

```sh
docker compose up --build -d
```

The port is only bound to `127.0.0.1`, so the editor isn't reachable from other machines. Use a
different port with `HOST_PORT=9000 docker compose up -d`, or put `HOST_PORT=9000` in a `.env` file.

### First run: create the admin account

With no accounts yet, the server prints a one-time setup link:

```sh
docker compose logs latex-editor | grep "First-run setup"
```

Open that path on the editor, e.g. <http://localhost:14738/#/register?invite=…>, choose a username and
password, and **save the recovery code** it shows you. The link works once and expires after 24 hours;
restart the container for a new one.

Projects from before accounts existed (`./data/projects`) are encrypted into this first admin's account.
The plaintext originals are then moved to `./data/legacy-plaintext-<date>/`. Check that your projects
open, then delete that folder yourself.

## Offline deployment

The running app needs no internet connection. Only building the image does, and so does installing
packages from the UI. To deploy to an offline machine, build on a connected machine and copy the
image across.

On the connected machine:

1. Add any extra packages you need to [`docker/tl-packages.txt`](docker/tl-packages.txt).
2. Build and export the image (a few hundred MB):

   ```sh
   docker compose build
   docker save latex-editor:local | gzip > latex-editor.tar.gz
   ```

3. Copy `latex-editor.tar.gz` and `docker-compose.yml` to the offline machine. Copy `./data` as well
   if you want your existing projects and the packages you installed from the UI.

On the offline machine:

```sh
docker load -i latex-editor.tar.gz
docker compose up -d --no-build --pull never
```

Then open <http://localhost:14738>.

- The image must match the offline machine's CPU architecture. To build an x86 image on an ARM
  machine, use `docker buildx build --platform linux/amd64 -t latex-editor:local --load .`
- Offline, the **Packages** dialog and the **Install** buttons next to missing files show an error.
  Editing, compiling and downloads all work as normal.

## Where things are stored

`./data` on the host is mounted at `/data` in the container.

| Host path | Contents |
|---|---|
| `./data/app.db` | Accounts, sessions and invites (SQLite). Passwords are stored only as salted scrypt hashes. |
| `./data/users/<user>/<project>/` | One encrypted project: `manifest.enc` (names, folders, settings) and `blobs/` (file contents). Nothing in here is readable without the owner's password. |
| `./data/texmf/<year>/` | Packages installed from the UI (a TeX Live user tree), shared by all users. |
| `./data/texmf/packages.json` | The packages that were asked for, used to reinstall them after a TeX Live upgrade. |
| `./data/texmf/cache/` | Cached TeX Live package index. |

Compiling needs the files in plaintext, so each compile decrypts the project into
`/var/lib/latex-editor/builds`, a `tmpfs` (memory, never disk) inside the container. That copy, the aux
files and `output.pdf` are deleted when you log out, after an hour without use, and when the container
restarts. Opening a project compiles it again. Use **Clear cache** to start a compile from scratch.

### Backups

Back up `./data/app.db` and `./data/users/` **together**, ideally with the container stopped. A project
can only be decrypted with the matching `app.db` entry, so a backup of one without the other is useless.
The backup is encrypted at rest, just like the live data.

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

## Accounts

Accounts are invite-only. An admin opens **(username) → Users and invites**, clicks **Create invite
link** (optionally as an admin account) and sends the link privately. Each link works once and expires
after 7 days. The person who opens it chooses their own username and password. The same page lists
pending invites (revoke them there) and users, who can be disabled (logged out and blocked) or deleted
together with all their projects.

Everyone can change their password from the same menu. That logs out their other sessions and replaces
their recovery code.

**Forgotten passwords.** Projects are encrypted with a key that only the user's password, or the
recovery code shown at sign-up, can unlock, so an admin **cannot** reset a password. Use **Forgot your
password? Use your recovery code** on the login page to choose a new one. Someone who has lost both their
password and their recovery code has lost their projects; an admin can only delete the account and
invite them again.

Only admins can install or remove TeX Live packages, because all users share one package tree. Everyone
can search the catalogue.

## Hosting on a server

Keep the container bound to `127.0.0.1` and put an HTTPS reverse proxy in front of it. With
[Caddy](https://caddyserver.com/), which fetches and renews certificates by itself, the whole
`Caddyfile` is:

```
latex.example.com {
	reverse_proxy 127.0.0.1:14738
}
```

Settings (environment variables in `docker-compose.yml`, or a `.env` file next to it):

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY` | `1` | Trust one proxy hop for the client IP (login throttling) and HTTPS detection (HSTS). Set to `false` if the port is reachable without the proxy. |
| `COOKIE_SECURE` | `true` | HTTPS-only session cookies. Only set `false` to serve plain HTTP to other machines, which sends passwords unencrypted. |
| `COMPILE_CONCURRENCY` | `2` | Compiles running at once; more wait their turn. |
| `SESSION_IDLE_DAYS` / `SESSION_MAX_DAYS` | `7` / `30` | Log out after this long unused / this long in total. |

## Security

**What is protected.**
- Passwords are hashed with scrypt and a random salt per user.
- Each user has a random 256-bit data key. It is stored only in encrypted form: under a key derived
  from their password, under one derived from their recovery code, and under one per login session
  (from a random token kept only in the browser's cookie).
- Projects are encrypted with AES-256-GCM: contents, file and folder names, and project names. On disk
  a project is just random ids.
- Copying `./data`, a backup or the disk gives nothing readable. The server can only decrypt a user's
  projects while they are logged in.
- Sessions are `HttpOnly`, `SameSite=Strict` cookies. Cross-site write requests are rejected.
- Failed logins are throttled per IP address and per username (5 per username per 15 minutes).

**What is not.**
- **Not hidden on disk:** the number of projects and files, their approximate sizes, and when they
  change. Installed packages and `app.db` usernames are not encrypted either.
- **The server operator can read logged-in users' files.** Someone who controls the running server
  (root on the host, or a modified image) could capture passwords or session keys as people use it.
  The encryption protects data at rest, not against the server itself.
- **Users should trust each other.** TeX runs as the same Unix user as the server. pdfLaTeX and XeLaTeX
  can't open absolute paths or `..` (`openin_any=p`). LuaLaTeX can't be restricted that way without
  breaking its font loading, so a malicious LuaLaTeX document could read server files. That includes
  `app.db`, whose password hashes could then be attacked offline, and another user's project while it
  is being compiled. Only invite people you trust, and on the host keep the kernel default
  `kernel.yama.ptrace_scope` of 1 or more.

**Compiling.**
- A project's `latexmkrc` is **ignored** (`latexmk -norc`), because it is Perl code that would run on
  every compile.
- Shell escape stays at TeX Live's restricted default, so `minted` and other packages that need full
  `-shell-escape` won't work.
- Compiles are killed after `COMPILE_TIMEOUT_MS` (60 s by default). TeX gets none of the server's
  environment variables.

## Development

The web app can run with hot reload against a server listening on port 8080. For example, start the
container with `HOST_PORT=8080` and then run:

```sh
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :8080
```

The server is TypeScript under `server/src`. Build it with `npm run build` in `server/`.
