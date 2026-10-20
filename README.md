# Pseudonymization Service

Replaces sensitive fields in JSON records with deterministic, identity-scoped tokens, and restores them on demand.

## Run

```bash
docker compose up --build -d
```

- Portal: http://localhost:4173
- API: http://localhost:3000

## Use

```bash
curl -X POST http://localhost:3000/pseudonymization \
  -H "Content-Type: application/json" \
  -d '{ "action": "anonymize",
        "data": { "id": "A001", "name": "John Smith", "email": "john@example.com" },
        "fields": ["name", "email"] }'
```

| Property  | Required | Description                                     |
|-----------|----------|-------------------------------------------------|
| `action`  | yes      | `anonymize` or `deanonymize`                    |
| `data`    | yes      | A record or an array of records                 |
| `fields`  | yes      | Fields to act on                                |
| `idField` | no       | Field that identifies the record (default `id`) |

## Configuration

| Variable                  | Default            | Description                                        |
|---------------------------|--------------------|----------------------------------------------------|
| `HMAC_SECRET`             | `dev_dummy_secret` | Token secret. Set a real one outside development   |
| `CAPTURE_FAILED_REQUESTS` | `true`             | Keep failed requests (last 50) for troubleshooting |
| `API_PORT` / `UI_PORT`    | `3000` / `4173`    | Host ports                                         |

## Limitations

Storage is in memory, so data is lost on restart. There is no authentication yet.
