# financeiro — technical portfolio notes

Source reviewed: `6d69ed40d7c83752cb67bfdbda61d5908e03d8c5` · 2026-11-04. These notes distinguish implemented behavior from next steps; they do not certify a production deployment.

## Purpose

Personal-finance application with a native Node HTTP API and Supabase/PostgREST persistence.

**Stack:** Node.js 24, Supabase/PostgreSQL, React/Vite, integer cents.

**AI scope:** Financial software; no ML or LLM implementation found.

## Evidence in this repository

- [server.js](../server.js): Supabase configuration, HTTP API, integer-cent calculations, scrypt PIN hashing and sessions.
- [supabase/functions.sql](../supabase/functions.sql): Database-side calculations.
- [supabase/schema.sql](../supabase/schema.sql): Persistence schema.
- [package.json](../package.json): Node runtime and application scripts.

## Validation

```text
node --check server.js (syntax only; no Supabase access)
```

Use an isolated environment and synthetic data. Never run operational ingestion, scheduled jobs or live provider calls merely to demonstrate the project. Test presence is not the same as a successful test run.

## Known limits and next steps

- LEIA-ME.md describes an older SQLite version; the current server requires SUPABASE_URL and SUPABASE_SECRET_KEY.
- No automated test suite or CI was found.
- PIN setup is optional in code; review access control and rate limiting before hosting financial data.
- public-novo contains committed generated assets; document the build process before removing them.

## Portfolio positioning

Secondary application project; reconcile the documentation and add isolated calculation tests.

A reproducible AI evaluation should document a synthetic or anonymized dataset, baseline, expected outputs, failure cases, quality metrics, latency and cost. Training and evaluating a predictive model would be separate work; it is not claimed here.
