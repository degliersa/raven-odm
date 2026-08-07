# @degliersa/raven-odm

[Leia este README em português](./README.pt-BR.md)

`@degliersa/raven-odm` is a thin, typed object-document mapper for the official RavenDB Node.js client. It adds a small collection API, Standard Schema validation, predictable IDs, explicit sessions, and normalized errors without hiding RavenDB.

## Why Raven ODM?

Creating a new RavenDB document type directly with the official client is flexible, but the application must decide where to keep the collection name, document shape, validation rules, ID behavior, session boundaries, and query code. Repeating those decisions for every document type creates infrastructure code that is easy to drift.

Raven ODM centralizes the collection definition, schema, validation, and RavenDB access in one typed object. This reduces the boilerplate needed to add documents without requiring a class, a hand-written mapping layer, and a separate validation setup for every document type. TypeScript can infer the document shape from the schema, while plain objects remain the normal data model.

### Official RavenDB client vs. Raven ODM

With the official RavenDB client, you work directly with `DocumentStore`, document sessions, `store`, `load`, `query`, and `saveChanges()`. You get the full RavenDB API and decide how your application organizes models, validation, IDs, and persistence.

With Raven ODM, you still use that same official client underneath. You define a collection with `defineCollection`, register it with `createDatabase`, and use typed methods such as `create`, `findById`, and `findMany`. The ODM validates input through Standard Schema, manages the usual session lifecycle for convenience methods, and keeps `db.store` and `raw` available when native RavenDB access is needed.

Raven ODM does not replace the RavenDB Client. It is a thin modeling and validation layer over the official client.

### A small, real example

This definition uses the current `defineCollection`, `createDatabase`, `create`, and `findMany` APIs:

```ts
import { z } from 'zod'
import { createDatabase, defineCollection } from '@degliersa/raven-odm'

const db = createDatabase({
  urls: ['http://127.0.0.1:8080'],
  database: 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
    }),
  },
})

await db.connect()

const created = await db.users.create({
  name: 'Maria',
  email: 'maria@example.com',
})

const byId = await db.users.findById(created.id)
const matching = await db.users.findMany({
  where: { email: 'maria@example.com' },
})

console.log({ created, byId, matching })
await db.dispose()
```

The `schema` is the single source for validation and inferred document types. Collections are reached through the connected database — `db.users` — and the object key names the accessor only: the RavenDB collection stays exactly the `name` you gave it. `create` returns a document with an `id`.

| Approach | New document | Validation | Typing | Repetitive code |
|-----------|----------------|-----------|---------|-------------------|
| Direct RavenDB Client | Organize manually | Organize manually | Choose and maintain manually | More application-owned plumbing |
| Raven ODM | Define a collection and schema | Standard Schema at the collection boundary | Inferred from the schema | Less repeated setup |

### Benefits

- add new document types by defining a collection and schema quickly;
- reuse schemas as ordinary TypeScript values;
- keep validation independent of a specific provider through Standard Schema;
- use the compatible validators already covered by the project: Zod, Valibot, ArkType, and Yup;
- infer document types from the schema, including the public `id`;
- reduce coupling between domain data and RavenDB infrastructure;
- use plain TypeScript objects instead of making a class mandatory for every document.

### When to use

Use Raven ODM when a TypeScript project wants explicit collection names, reusable schemas, consistent validation, typed CRUD, and conventions around sessions and document IDs while retaining access to the official RavenDB client.

### When not to use

The official RavenDB client may be sufficient when the application is built around advanced queries, highly dynamic document models, or direct use of RavenDB-specific features that should not pass through an ODM abstraction. Raven ODM keeps a native escape hatch, but it should not be added solely to hide APIs the application needs to use directly.

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

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
    }),
  },
})

await db.connect()

try {
  const created = await db.users.create({
    name: 'Maria',
    email: 'maria@example.com',
  })
  const loaded = await db.users.findById(created.id)
  const updated = await db.users.update(created.id, { name: 'Maria Silva' })
  const matching = await db.users.findMany({
    where: { email: 'maria@example.com' },
  })

  console.log({ created, loaded, updated, matching })
  await db.users.delete(created.id)
} finally {
  await db.dispose()
}
```

Collection names are exact. A collection named `Order` is stored in RavenDB's `Order` collection, not an automatically pluralized `Orders` collection. That is true of the accessor too: `collections: { orders: defineCollection({ name: 'Order', ... }) }` gives you `db.orders`, writing to the `Order` collection.

A key that would shadow the database's own API — `database`, `store`, `connect`, `dispose`, `transaction`, `openSession` — is rejected, at compile time and again at runtime.

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

The default `idStrategy: 'uuid'` intentionally creates a known client-side ID in the form `<collection>/<uuid>`. This keeps the document ID available before `saveChanges()` and works when creating documents in an external session. HiLo remains available as an explicit opt-in when RavenDB-managed ranges are preferred.
Use `idGenerator` for application-defined IDs. It receives the validated document, collection name, and database name. `idGenerator` and `idStrategy` are mutually exclusive: a collection that sets both is rejected with `invalid_configuration`, so the ID source is always visible in the definition.

```ts
const db = createDatabase({
  urls,
  database: 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: userSchema,
      idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
    }),
  },
})
```

Use `idStrategy: 'hilo'` for RavenDB's client-side HiLo generator. The client reserves an ID range and returns IDs such as `Orders/128-A` before `saveChanges()`, so HiLo works with external sessions. The first ID for a collection may make a server request to reserve the range, and unused values can leave gaps.

Use `idStrategy: 'server'` to request RavenDB identities such as `Orders/1-A`. RavenDB assigns that ID during `saveChanges()`, so this strategy cannot be used with `create(data, { session })`. Use a custom generator or the default UUID strategy for external sessions.

See [`examples/id-strategies.ts`](examples/id-strategies.ts) for all four generator paths in one runnable example.

## Queries and index staleness

`findMany()` without `where` or `orderBy` reads the collection directly and always observes earlier writes.

Adding `where` or `orderBy` sends the query to a RavenDB auto-index instead, and auto-indexes are updated asynchronously. By default the ODM does not wait for them — the same behavior as the official client — so a query can miss a document written moments earlier. Opt in per call when a read must observe a preceding write:

```ts
// wait with RavenDB's default timeout
await Users.findMany({ where: { active: true }, waitForNonStaleResults: true })

// or bound the wait explicitly, in milliseconds
await Users.findMany({ orderBy: { field: 'name' }, waitForNonStaleResults: 5_000 })
```

Exhausting the wait raises `RavenOdmError` with `code === 'query_timeout'`. Waiting costs latency and hides nothing else, so prefer it for read-after-write paths rather than as a global default.

## Sessions and Unit of Work

Convenience CRUD methods open, save, and dispose a session automatically. Use `transaction` to group writes across collections:

```ts
await db.transaction(async (session) => {
  await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
  await db.orders.create({ status: 'pending', total: 42 }, { session })
})
```

`db.openSession()` returns an explicit session. Operations passed that session are not persisted until `session.saveChanges()`; disposing first discards pending changes.

## Optimistic concurrency

Set `optimisticConcurrency: true` to enable RavenDB optimistic concurrency for every session opened by the database:

```ts
const db = createDatabase({
  urls,
  database,
  collections: { users: Users },
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
| `query_timeout` | `findMany` waited for a non-stale index and the wait ran out. |
| `raven_error` | An unclassified RavenDB client/server failure. |

`findById` returns `null` for a missing document; it does not throw `document_not_found`.

## Native escape hatches

Use `db.store` for the native `IDocumentStore`, or run a native operation in a collection session:

```ts
await db.users.raw(async (session) => {
  const raw = await session.load('Users/1-A')
  console.log(raw)
})

const nativeStore = db.store
```

## Connection lifecycle

`connect()` attaches every configured collection to the database; `dispose()` releases them again. A disposed database can be connected again, and its collections keep working against the new connection:

```ts
await db.connect()
await db.dispose()
await db.connect() // same collections, usable again
```

Between the two calls, a collection has no database, so using it raises `not_connected`. A failed `connect()` releases whatever it had already attached, so a configuration mistake can be corrected and retried.

A collection belongs to one connected database at a time. Passing the same collection to a second database while the first is still connected raises `already_bound`; disposing the first releases it for the second.

## Document lifecycle

Returned documents are flat validated copies, not tracked entities. RavenDB metadata is removed before validation and the public `id` is reattached afterward. Mutating a returned object does not schedule a database write; call `update`, use an explicit session, or use the native escape hatch for persistence.

## Development

From the repository root:

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
