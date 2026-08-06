# Validator examples

Each file defines the same small `Users` collection with a different Standard Schema validator:

- `zod.ts` — Zod
- `valibot.ts` — Valibot
- `arktype.ts` — ArkType
- `yup.ts` — Yup

## Run an example locally

From the `raven-odm` directory:

```bash
npm install
npm run build
npx tsx examples/zod.ts
```

Replace `zod.ts` with another example to try a different validator. The examples read these optional environment variables:

- `RAVENDB_URL` — RavenDB URL; defaults to `http://127.0.0.1:8080`.
- `RAVENDB_DATABASE` — existing database name; defaults to `raven-odm-examples`.

The database must already exist. For a local RavenDB server, create the database from RavenDB Studio or use the server-wide `CreateDatabaseOperation` from the RavenDB client. The examples use the built package through the package self-reference, so build the project before running them.
