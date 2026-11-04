# financeiro

Personal-finance application with a native Node HTTP API and Supabase/PostgREST persistence.

**Implementation scope:** Financial software; no ML or LLM implementation found.

See [technical portfolio notes](docs/PORTFOLIO.md) for source evidence, validation and next steps.

## Current architecture

The current `server.js` uses Supabase/PostgREST, not a local SQLite database. It requires Node.js 24 or later and server-side `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Never place the secret key in frontend variables.

- `server.js`: HTTP API and static server.
- `supabase/schema.sql` and `supabase/functions.sql`: schema and calculations; review before applying to any database.
- `public/`: original interface; `frontend/`: React/Vite source; `public-novo/`: committed build output.
- `LEIA-ME.md`: legacy user guide; its SQLite/backup instructions do not describe the current server.

```text
node --check server.js
```

This only checks syntax. `npm start` uses the configured database, so use an isolated test instance and synthetic records for a demo. No automated tests are currently supplied.
