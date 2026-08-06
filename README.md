# @degliersa/raven-odm

`@degliersa/raven-odm` is a thin, typed object-document mapper for the official RavenDB Node.js client. It adds a small collection API, Standard Schema validation, predictable IDs, explicit sessions, and normalized errors without hiding RavenDB.

The project is designed for applications that want:

- exact RavenDB collection names without implicit pluralization;
- schemas that are independent of Zod, Valibot, ArkType, Yup, or another Standard Schema validator;
- typed CRUD with validation before writes;
- explicit Unit of Work boundaries and optimistic concurrency;
- a native RavenDB escape hatch whenever the ODM should not get in the way.

The package is currently released from the Changesets `alpha` prerelease channel. The public API is intentionally small while the integration suite runs against a real RavenDB server.

## Installation

### Requirements

- Node.js 22 or newer;
- RavenDB 7.x or newer;
- one Standard Schema-compatible validator.

Install the ODM, RavenDB client, and a validator:

```bash
npm install @degliersa/raven-odm ravendb zod
```

The RavenDB client is a peer dependency, so your application controls its client version.

### Run RavenDB locally

The examples and integration tests can use a local Docker server:

```bash
docker run -d --name raven-odm-local -p 8080:8080 \
  -e RAVEN_Setup_Mode=None \
  -e RAVEN_License_Eula_Accepted=true \
  -e RAVEN_Security_UnsecuredAccessAllowed=PublicNetwork \
  ravendb/ravendb:latest
```

Create an application database such as `raven-odm-examples` in RavenDB Studio before running an example. Set `RAVENDB_URL` and `RAVENDB_DATABASE` when your server or database uses different values.

## Quick start

This example defines a collection, connects a database, and exercises create, read, update, query, and delete:

```ts
import { z } from 'zod'
import { createDatabase, defineCollection } from '@degliersa/raven-odm'

const Users = defineCollection({
  name: 'Users',
  schema: z.object({
    name: z.string().min(1),
    email: z.email(),
  }),
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'example',
  collections: [Users],
})

await db.connect()

try {
  const created = await Users.create({
    name: 'Maria',
    email: 'maria@example.com',
  })
  const loaded = await Users.findById(created.id)
  const updated = await Users.update(created.id, { name: 'Maria Silva' })
  const matching = await Users.findMany({
    where: { email: 'maria@example.com' },
  })

  console.log({ created, loaded, updated, matching })
  await Users.delete(created.id)
} finally {
  await db.dispose()
}
```

Collection names are exact. A collection named `Order` is stored in RavenDB's `Order` collection, not an automatically pluralized `Orders` collection.

## Validators

Any validator implementing Standard Schema can be passed as `schema`. These validators and minimum versions have been verified:

| Validator | Minimum version | Repository example |
| --- | ---: | --- |
| [Zod](https://github.com/colinhacks/zod) | 3.24.0 | [`examples/zod.ts`](examples/zod.ts) |
| [Valibot](https://github.com/fabian-hiller/valibot) | 1.0 | [`examples/valibot.ts`](examples/valibot.ts) |
| [ArkType](https://github.com/arktypeio/arktype) | 2.0 | [`examples/arktype.ts`](examples/arktype.ts) |
| [Yup](https://github.com/jquense/yup) | 1.7.0 | [`examples/yup.ts`](examples/yup.ts) |

The Zod example uses Zod 4's top-level `z.email()` API. Zod 3.24 remains supported by the ODM; use the corresponding email schema API for applications pinned to Zod 3. The validator is a dependency of your application, not a dependency of the ODM core. See [`examples/README.md`](examples/README.md) for setup and execution instructions.

## IDs

The default `idStrategy: 'uuid'` creates a known client-side ID in the form `<collection>/<uuid>`. This works when creating documents in an external session.

Use `idGenerator` for application-defined IDs. It receives the validated document, collection name, and database name; its result takes precedence over `idStrategy`:

```ts
const Users = defineCollection({
  name: 'Users',
  schema: userSchema,
  idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
})
```

Use `idStrategy: 'hilo'` for RavenDB's client-side HiLo generator. The client reserves an ID range and returns IDs such as `Orders/128-A` before `saveChanges()`, so HiLo works with external sessions. The first ID for a collection may make a server request to reserve the range, and unused values can leave gaps.

Use `idStrategy: 'server'` to request RavenDB identities such as `Orders/1-A`. RavenDB assigns that ID during `saveChanges()`, so this strategy cannot be used with `create(data, { session })`. Use a custom generator or the default UUID strategy for external sessions.

See [`examples/id-strategies.ts`](examples/id-strategies.ts) for all four generator paths in one runnable example.

## Sessions and Unit of Work

Convenience CRUD methods open, save, and dispose a session automatically. Use `transaction` to group writes across collections:

```ts
await db.transaction(async (session) => {
  await Users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
  await Orders.create({ status: 'pending', total: 42 }, { session })
})
```

`db.openSession()` returns an explicit session. Operations passed that session are not persisted until `session.saveChanges()`; disposing first discards pending changes.

## Optimistic concurrency

Set `optimisticConcurrency: true` to enable RavenDB optimistic concurrency for every session opened by the database:

```ts
const db = createDatabase({
  urls,
  database,
  collections: [Users],
  optimisticConcurrency: true,
})
```

A stale save throws `ConcurrencyConflictError` with `code === 'concurrency_conflict'`. With the default `false`, RavenDB retains last-write-wins behavior.

## Errors

RavenDB failures are normalized into `RavenOdmError` subclasses. Inspect `code`, `collection`, and `documentId` instead of matching RavenDB implementation-specific exception classes.

| Code | Meaning |
| --- | --- |
| `validation_failed` | Input or read validation failed; `ValidationError.issues` contains the Standard Schema issues. |
| `concurrency_conflict` | Optimistic concurrency rejected a stale write. |
| `document_not_found` | An update targeted a missing document. |
| `not_connected` | A database or collection was used before `connect()`. |
| `already_bound` | A collection was attached to more than one database. |
| `invalid_configuration` | Collection or database configuration is invalid. |
| `raven_error` | An unclassified RavenDB client/server failure. |

`findById` returns `null` for a missing document; it does not throw `document_not_found`.

## Native escape hatches

Use `db.store` for the native `IDocumentStore`, or run a native operation in a collection session:

```ts
await Users.raw(async (session) => {
  const raw = await session.load('Users/1-A')
  console.log(raw)
})

const nativeStore = db.store
```

## Document lifecycle

Returned documents are flat validated copies, not tracked entities. RavenDB metadata is removed before validation and the public `id` is reattached afterward. Mutating a returned object does not schedule a database write; call `update`, use an explicit session, or use the native escape hatch for persistence.

## Development

From the `raven-odm` directory:

```bash
npm ci
npm run lint
npm run typecheck
npm run typecheck:examples
npm run build
npm test
npm run check:pack
```

The integration suite uses `RAVENDB_URL` when it is set. Without that variable, Vitest starts `ravendb/ravendb:latest` on port 8099 and removes only the container it started.

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening an issue or pull request. It describes the development workflow, design principles, integration-test requirements, Changesets policy, commit conventions, and Code of Conduct.

## License

MIT © 2026 degliersa
