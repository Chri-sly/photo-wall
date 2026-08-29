# Party Photo Wall (self-hosted)

A live, QR-code-driven photo wall for events. Guests scan a code, upload a
photo from their phone, and it shows up in a randomized slideshow on a big
screen — singles, pairs, and triples mixed in automatically. English/German
toggle included.

Backend: Node.js + Express. Storage: PostgreSQL, with photos stored as
`BYTEA` blobs directly in the database (no separate file storage to manage —
back up the database and you have every photo).

## Quick start

```bash
cp .env.example .env
# edit .env and set real values for ADMIN_PASSWORD and POSTGRES_PASSWORD

docker compose up --build -d
```

This starts two containers: `db` (Postgres) and `photowall` (the app). The
app waits for Postgres to report healthy before starting, and retries the
connection on its own if the database takes a moment to come up.

The app is now running at `http://localhost:3000`.

To stop it: `docker compose down` (your data stays in the `pgdata` Docker
volume). To wipe everything and start fresh: `docker compose down -v`.

## The one thing that actually matters: network reachability

The QR code encodes whatever URL is in the browser's address bar when you
open the QR tab. For guests to actually be able to scan and upload, **that
URL has to be reachable from their phones** — usually over the venue's WiFi,
not just from the machine running Docker. A few ways to handle this:

- **Same WiFi network**: find the host machine's LAN IP (e.g. `192.168.1.42`)
  and open `http://192.168.1.42:3000` on the machine you'll show the QR code
  from, so the QR encodes that LAN address instead of `localhost`.
- **Guests on cellular data / no shared WiFi**: put the container behind a
  tunnel like Cloudflare Tunnel or ngrok so it gets a real public URL, and
  open the app through that URL instead.
- **Proper deployment**: run it on a small VPS or home server with a domain
  and reverse proxy (Caddy/Nginx) in front for HTTPS — camera capture on iOS
  in particular can be pickier over plain HTTP from a non-localhost address.

Test the whole flow (scan → upload → see it on the slideshow) from a phone
on the actual network you'll be using, before the event.

## Configuration

Environment variables (set in `.env`):

| Variable            | Default    | Purpose                                        |
|----------------------|------------|-------------------------------------------------|
| `ADMIN_PASSWORD`     | `changeme` | Required to clear photos. Change this.          |
| `POSTGRES_USER`      | `photowall`| Postgres username.                              |
| `POSTGRES_PASSWORD`  | `photowall`| Postgres password. Change this.                 |
| `POSTGRES_DB`        | `photowall`| Postgres database name.                         |
| `PORT`               | `3000`     | Port the app listens on.                        |
| `MAX_UPLOAD_MB`      | `15`       | Max size per uploaded photo (after compression).|

If you already run your own PostgreSQL instance and don't want the bundled
`db` container, delete the `db` service from `docker-compose.yml`, remove
`depends_on` from `photowall`, and set `DATABASE_URL` yourself, e.g.
`postgres://user:pass@your-host:5432/yourdb`.

## API (if you want to extend it)

- `GET /api/health` — liveness check (also verifies the DB connection)
- `GET /api/photos` — list of `{id, name, ts}` (no image bytes)
- `GET /api/photos/:id/image` — raw image bytes for one photo
- `POST /api/photos` — multipart form, fields `photo` (file) and `name`
- `DELETE /api/photos/:id` — delete one photo (needs `x-admin-password` header)
- `DELETE /api/photos` — delete everything (needs `x-admin-password` header)

## Backing up / resetting

```bash
# Backup
docker exec party-photo-wall-db pg_dump -U photowall photowall > backup.sql

# Restore into a fresh instance
cat backup.sql | docker exec -i party-photo-wall-db psql -U photowall photowall
```
