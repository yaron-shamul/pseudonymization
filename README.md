# Pseudonymization Service

REST API + portal UI that replaces sensitive fields in JSON records with deterministic,
identity-scoped tokens — and restores them on demand. The caller chooses which fields to
protect on every request; nothing is hard-coded on the server.

## Quick start

Requires Docker with Compose v2.

```bash
docker compose up --build -d
docker compose ps          # all services should be Up / healthy
```

| Service | URL |
|---------|-----|
| Portal UI | http://localhost:4173 |
| API | http://localhost:3000 |
| RabbitMQ management | http://localhost:15673 (guest/guest) |

```bash
docker compose logs -f api   # follow API logs
docker compose down          # stop
docker compose down -v       # stop and delete volumes
```

Host ports can be changed with `API_PORT`, `UI_PORT` and `RABBITMQ_UI_PORT`
(env vars or a `.env` file next to `docker-compose.yml`). Postgres and AMQP stay inside the compose network.

**Production:** set a real `HMAC_SECRET` (`HMAC_SECRET=... docker compose up -d`). Tokens depend on it,
so changing the secret invalidates existing tokens.

## Architecture

```
Portal UI (React + nginx :4173) ──/api──▶ API (NestJS :3000) ◀── Worker ◀── RabbitMQ
                                                │
                                         in-memory store   (Postgres: planned, see below)
```

| Folder | Contents |
|--------|----------|
| `nest-pseudonymization/` | NestJS API (`src/`), RabbitMQ worker (`workers/`), Prisma schema for the planned DB store (`prisma/`) |
| `portal-ui/` | React dashboard, served by nginx which proxies `/api` to the API |
| `docker-compose.yml` | The full stack |

## API

`POST /pseudonymization/anonymize` and `POST /pseudonymization/deanonymize`

| Property | Required | Description |
|----------|----------|-------------|
| `data` | yes | One JSON object, or an array of objects (batch) |
| `fields` | anonymize: yes · deanonymize: optional | `["name","email"]`, or `{ "name": { "prefix": "USER_" }, "email": true }` |
| `idField` | no | Field that identifies the record; tokens are scoped to its value. Default `"id"` |

If `data` is an array, the response is an array of results in the same order.

```bash
curl -X POST http://localhost:3000/pseudonymization/anonymize \
  -H "Content-Type: application/json" \
  -d '{ "data": { "id": "A001", "name": "John Smith", "email": "john@example.com", "phone": "+1234567890" },
        "fields": ["name", "email"] }'
```

```json
{
  "anonymized_object": { "id": "A001", "name": "NAME_8FA4C91", "email": "EMAIL_3D2F15A", "phone": "+1234567890" },
  "identity_hash": "…",
  "mappings": { "name": { "token": "NAME_8FA4C91", … }, "email": { … } }
}
```

```bash
curl -X POST http://localhost:3000/pseudonymization/deanonymize \
  -H "Content-Type: application/json" \
  -d '{ "data": { "id": "A001", "name": "NAME_8FA4C91", "email": "EMAIL_3D2F15A" } }'
```

Deanonymize needs the same record ID: a token only resolves under the ID it was issued for.
Without `fields` every token in the record is restored; with `fields`, only those.

Errors: missing `data` or `fields` → `400`. Request bodies up to 10 MB are accepted.

**Via RabbitMQ:** publish the same JSON body to the `ANONYMIZE` or `DEANONYMIZE` queue; the worker forwards
it to the API. Failures are retried up to 3 times; bad requests go straight to `<QUEUE>_DLQ`.

**Admin:**

```bash
curl http://localhost:3000/admin/health
curl http://localhost:3000/admin/stats
curl "http://localhost:3000/admin/usage?range=24h"   # 1h | 24h | 7d — time series of usage counters
curl http://localhost:3000/admin/demo
curl -X POST http://localhost:3000/admin/demo-seed -H "Content-Type: application/json" -d '{}'
```

## Portal UI

- **Overview**: live stats, how a request is processed, recent activity
- **API Playground**: paste JSON or **upload a CSV/JSON file** (drag & drop), pick fields (auto-detected), send to
  anonymize/deanonymize and view the result as a before/after table, JSON or cURL. Large files are sent in batches of
  500 records with a progress bar; **download the result** as CSV or JSON in the same column order.
- **Field presets**: save a field selection (+ prefixes and identity field) under a name and apply it in one click.
  Stored in the browser (per user) until the DB store lands.
- **Token Lookup**: paste one or more tokens with their record ID to see the original values.
- **Usage**: records anonymized/deanonymized over the last hour / 24 hours / 7 days, field values processed and error
  rate, as a chart or table. Counters live in the API's memory and reset on restart.
- **Token Mappings**: sample records and their tokens
- **Activity**: requests sent from this browser tab
- **Admin**: seed demo data, raw health/stats

## How tokens work

1. `identity_hash = sha256(record[idField])`
2. `token = PREFIX + first 7 hex chars of HMAC-SHA256(secret, identity_hash | field | value)`
3. The original value is stored encrypted with AES-256-GCM (key derived once from the secret via PBKDF2).

Tokens are unique per identity, so two users may share a token suffix without conflict.

## Current limitations

- **Storage is in memory**: mappings are lost on restart, and one process holds at most ~16.7M mappings.
  `prisma/schema.prisma` and the Postgres container are in place for the planned DB-backed store.
- **Single API instance**: state is per process, so it can't be scaled horizontally yet.
- **No auth or rate limiting** on the API.

## Development (without Docker)

```bash
# API
cd nest-pseudonymization
pnpm install
pnpm start:dev        # http://localhost:3000
pnpm worker           # RabbitMQ worker (needs RabbitMQ, RABBIT_URL / API_BASE env)

# UI
cd portal-ui
npm install
npm run dev           # http://localhost:4173, proxies /api to localhost:3000
```

Environment variables (API): `PORT`, `HMAC_SECRET`, `DATABASE_URL` (unused until the DB store lands).
Worker: `RABBIT_URL`, `API_BASE`.
