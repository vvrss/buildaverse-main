# Deploying Storyteller with the Community

One Node process serves everything: the app, the Community API (`/api`), published pictures (`/media`) and link-preview pages (`/s/…`, `/e/…`). All of its data sits in one folder, the **data directory**: a SQLite database and the processed pictures.

Writing never needs the server. Without one, the app works fully offline, and the Community tab says it isn't set up.

## What you need

- **Node 22.13 or newer**, or Docker. The server uses Node's built-in `node:sqlite`.
- **A persistent disk** for the data directory. If it is wiped on every deploy, every account, episode and picture is lost with it. This rules out free tiers without disks, such as Render's free web services.
- **One instance only.** SQLite, the pictures on disk and the rate limits all live with that one process. Don't scale it out.
- **HTTPS** in front of it, from your host or a reverse proxy, with `PUBLIC_ORIGIN` set to that address.

## Settings

All settings are environment variables.

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_ORIGIN` | (none) | The public address, e.g. `https://stories.example.com`. **Required in production.** Writes from any other origin are refused, and share links and session cookies use it. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | (none) | The administrator account, created or updated at every start. Set both, or neither. Nobody can register that name. |
| `DATA_DIR` | `/data` in production, `.dev-data` otherwise | Where the database and pictures live. |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where to listen. |
| `REGISTRATION_OPEN` | `true` | Set to `false` to stop new accounts, e.g. against spam. Existing accounts keep working. |
| `TRUST_PROXY` | `false` | Set to `true` behind a proxy (Fly, Render, Caddy, nginx), so rate limits see the real client address. |
| `QUOTA_MB` | `250` | Picture storage per account, counted after processing. |
| `MIN_CLIENT` | `0.3.0` | App versions older than this are asked to reload and update. |
| `NODE_ENV` | (none) | Set to `production` for real deployments. |
| `RATE_LIMITS` | `on` | `off` is for tests only and is refused in production. |

## Docker

```bash
cd storyteller
docker build -t storyteller .
docker run -d --name storyteller -p 8080:8080 \
  -v storyteller-data:/data \
  -e PUBLIC_ORIGIN=https://stories.example.com \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='a long, unique password' \
  -e TRUST_PROXY=true \
  storyteller
```

The image runs as the unprivileged `node` user, listens on 8080 and checks `/api/health`. Put your HTTPS proxy in front of port 8080.

### Fly.io

```bash
fly launch --no-deploy            # from storyteller/, keep the Dockerfile
fly volumes create storyteller_data --size 3
fly secrets set ADMIN_USERNAME=admin ADMIN_PASSWORD='a long, unique password'
```

In `fly.toml`, set the port, the volume and the settings:

```toml
[http_service]
  internal_port = 8080
  force_https = true
  min_machines_running = 1

[mounts]
  source = "storyteller_data"
  destination = "/data"

[env]
  PUBLIC_ORIGIN = "https://your-app.fly.dev"
  TRUST_PROXY = "true"
```

Then run `fly deploy`. Keep a single machine (`fly scale count 1`).

### Render

Use a **paid** web service with a **disk** mounted at `/data`. Choose "Docker" as the runtime and `storyteller` as the root directory. Set `PUBLIC_ORIGIN`, `TRUST_PROXY=true` and the admin variables. On the free tier, the data would be gone after each deploy.

## A plain server (VPS)

```bash
cd storyteller
npm ci
npm run build
NODE_ENV=production PUBLIC_ORIGIN=https://stories.example.com DATA_DIR=/var/lib/storyteller \
  ADMIN_USERNAME=admin ADMIN_PASSWORD='…' TRUST_PROXY=true PORT=8787 HOST=127.0.0.1 \
  node dist-server/main.js
```

Run it under systemd (or similar) so it restarts. A reverse proxy adds HTTPS; with Caddy that is two lines:

```
stories.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

## Backups

The database and the pictures are both needed to restore a Community.

```bash
# A consistent copy of the database, even while the server runs:
node dist-server/main.js backup /backups/storyteller-$(date +%F).db
# The pictures (files never change once written, so a sync is enough):
rsync -a "$DATA_DIR/media/" /backups/media/
```

In Docker, run the same command inside the container: `docker exec storyteller node dist-server/main.js backup /data/backup.db`, then copy `/data/backup.db` and `/data/media` off the volume. Do this nightly (cron or your host's scheduler).

To restore, stop the server, put the database file back as `storyteller.db` in the data directory and the pictures in `media/`, then start it again.

## Operator commands

Each command runs with the same environment as the server.

| Command | What it does |
|---|---|
| `node dist-server/main.js backup <file>` | Writes a consistent copy of the database. |
| `node dist-server/main.js reset-password <username>` | Sets a new password and signs the account out everywhere. Uses `NEW_PASSWORD` if set; otherwise prints a random one. There is no email, so this is how forgotten passwords are handled. |
| `node dist-server/main.js gc` | Removes pictures nothing uses any more. It also runs every 6 hours by itself. |

## Moderation

Sign in to the app with the administrator account. Then, in the Community, open a writer's page and choose **Make moderator** to appoint them.

Moderators see a shield in the Community header. Behind it are:
- the **reports** queue (hide the content, mark it handled, or dismiss it);
- a search for **writers** (to suspend or reinstate them);
- the **log** of every moderation action.

Suspended writers can still sign in and read. Their stories and comments are hidden, and they can't publish, comment or like.

## Updating

Rebuild and restart: `docker build …` and run again, `fly deploy`, or `npm ci && npm run build` and restart the service. The database upgrades itself on start. Installed apps notice the new version and offer to reload. If you raise `MIN_CLIENT`, older apps are asked to reload before they can use the Community.

## What the server stores

- **Accounts:** username, display name, color, bio and a scrypt hash of the password. Email is never asked for.
- **Sessions:** only a hash of each session token.
- **Published content:** stories, chapters and episodes, without the authors' notes or private header lines. Comments, likes, follows, reading progress, notifications, reports and the moderation log.
- **Pictures:** re-encoded copies (WebP and AVIF at a few widths), without camera or GPS data.
- **Addresses:** client IP addresses are kept only in memory, for rate limits, and are never written to disk.
