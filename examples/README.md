# Examples

The examples cover both validator integration and ID generation. Every executable example operates through the database-owned `db.<key>` handle; collection declarations describe the model and schema only.

## Validators

Each validator example defines a small `Users` collection with a different Standard Schema implementation:

- `zod.ts` — Zod
- `valibot.ts` — Valibot
- `arktype.ts` — ArkType
- `yup.ts` — Yup

## ID strategies

`id-strategies.ts` demonstrates the supported ID paths:

- UUID IDs generated locally;
- RavenDB HiLo IDs generated from a reserved range;
- RavenDB server identities;
- custom `idGenerator` values.

## Shared definitions across databases

The same definition can be registered in multiple database instances. Each database gets its own operational handle, so disposing one database does not affect the other:

```ts
const users = defineCollection({ name: 'Users', schema: userSchema })
const tenantA = createDatabase({ urls, database: 'tenant-a', collections: { users } })
const tenantB = createDatabase({ urls, database: 'tenant-b', collections: { users } })

await Promise.all([tenantA.connect(), tenantB.connect()])
await tenantA.users.create({ name: 'Maria' })
await tenantB.users.create({ name: 'Joana' })
```

## Run an example locally

From the repository root:

```bash
npm install
npm run build
npx tsx examples/zod.ts
```

Replace `zod.ts` with another example to try a different validator. The examples read these optional environment variables:

- `RAVENDB_URL` — RavenDB URL; defaults to `http://127.0.0.1:8080`.
- `RAVENDB_DATABASE` — existing database name; defaults to `raven-odm-examples`.

The database must already exist. For a local RavenDB server, create the database from RavenDB Studio or use the server-wide `CreateDatabaseOperation` from the RavenDB client. The examples use the built package through the package self-reference, so build the project before running them.
