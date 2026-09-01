# Collection Handles Per Database

- **Date:** 2026-09-01
- **Status:** Approved design
- **Source:** Roadmap issue #14, residual scope issue #40, original API proposal #15

## Problem

`defineCollection()` currently returns an operational `Collection` whose mutable binding is changed by `Database.connect()`. A declaration can therefore belong to only one database at a time. Reusing it in a second database raises `already_bound`, and disposing a database must mutate the declaration again before it can be reused.

The package is still on `0.x` (`0.4.0`), so this is the last safe point to remove that observable ownership model before a stable API is published.

## Decision

Separate collection declarations from database-owned collection handles.

- `defineCollection()` returns a `Collection<S>` declaration. It contains the exact RavenDB collection name, schema, ID strategy, descriptor, and other immutable definition data. It has no database binding and no CRUD methods.
- Each `Database` owns one bound `BoundCollection<S>` handle per configured collection key. `db.users` and `db.orders` are the only operational entry points.
- A declaration can back any number of databases. Each handle captures the database-specific session policy, document-ID generation, bulk-insert factory, and current store lifecycle.
- Handles remain available after `dispose()`, but operations fail with `not_connected` until that same database reconnects. Reconnecting reuses the database-owned handles and re-registers the declarations for the new store.
- The public `already_bound` behavior is retired. The mutable `Collection.bind()` / `unbind()` ownership model is removed rather than kept as a compatibility path.

This is a clean `0.x` cutover. Supporting both standalone collection operations and `db.<key>` would preserve two ownership models and leave the original ambiguity in place.

## Public API

### Declarations and handles

`Collection<S>` remains the declaration type returned by `defineCollection()`. Its public state is definition-only. A new exported `BoundCollection<S>` type/class owns the existing operational surface:

- `create`, `createMany`, `update`
- `findById`, `findMany`, `findOne`, `findPage`
- `count`, `exists`
- `increment`, `bulkInsert`, `raw`

`Doc<S>` inference and all method option types remain unchanged on `BoundCollection<S>`.

`RavenDatabase<TCollections>` maps each declaration in the named `collections` record to its corresponding `BoundCollection` while retaining the existing `db.users` property inference. `DatabaseOptions.collections` continues to be a named record; the object key is only the accessor and never changes the RavenDB collection name.

### Binding and lifecycle

`Database` creates per-instance handles for its configured declarations. Handle binding is private state owned by that database, never state on the shared declaration. The handle's database closures route through the database's current store, so the existing lifecycle remains observable:

- access before `connect()` raises `not_connected` when an operation needs the store;
- `connect()` is idempotent and registers that database's descriptors;
- `dispose()` closes only that database's store and does not affect another database using the same declaration;
- reconnecting the disposed database restores its handles without mutating any declaration shared with another database.

The reserved database keys and their compile-time/runtime guards remain unchanged.

### Unchanged contracts

This change does not alter:

- exact collection naming;
- ID strategies or generated ID formats;
- validation ordering, hydrated document shape, or error normalization;
- sessions, `transaction()`, optimistic concurrency, or `raw()` semantics;
- query staleness behavior;
- `createMany`, `findPage`, `increment`, or bulk-import behavior;
- the native RavenDB escape hatch.

## Internal design

The declaration owns its descriptor and immutable options. `Database` keeps a per-instance registry from declaration descriptor to exact RavenDB collection name. During connection it registers each declaration descriptor with that database's store and installs the existing per-database collection-name resolver.

A `BoundCollection` receives a `CollectionBinding` constructed for its owning database. The binding supplies:

- the database name and descriptor;
- the database's `runInSession` policy;
- document-ID generation against the current store;
- bulk-insert creation against the current store.

No global map or declaration mutation is used. The same descriptor may be registered by independent stores because name resolution is held in each database's registry.

The existing `#registered` / release path changes from unbinding shared declarations to clearing only the disposed database's store registry. `already_bound` is removed from the public error-code union, implementation branches, tests, and documentation.

## Migration

The supported form becomes:

```ts
const users = defineCollection({ name: 'Users', schema: userSchema })

const db = createDatabase({
  urls,
  database: 'app',
  collections: { users },
})

await db.connect()
await db.users.create({ name: 'Maria' })
```

Existing declarations still pass through `collections: { users }`, but calls such as `users.create(...)` are no longer supported. All repository examples, tests, and README recipes use the database-owned handle.

## Verification

Add or migrate real-server coverage for:

1. one declaration used by two connected databases;
2. writes through each handle reaching only its own database;
3. disposing one database leaving the other handle operational;
4. reconnecting one database restoring its own handle;
5. `Doc<S>` and method option inference through `db.<key>`;
6. reserved-key rejection at compile time and runtime;
7. exact RavenDB collection names remaining unchanged;
8. sessions and transactions working through the bound handles;
9. all existing CRUD, validation, query, bulk, increment, and error tests after migration.

Update `README.md`, `README.pt-BR.md`, every example, and a user-facing Changeset. The full integration suite and example typecheck must pass.

## Non-goals

- lazy connection or serverless lifecycle changes from issue #43;
- comparison operators from issue #26;
- timestamps from issue #19;
- `upsert()` from issue #65;
- cross-database transactions;
- relations, joins, includes, or collection-name derivation;
- keeping standalone operational collections as a compatibility alias.

## Rejected alternatives

- **Keep mutable bindings and clone declarations:** still exposes the ambiguous standalone API and leaves lifecycle ownership implicit.
- **Prefix database lifecycle methods:** larger unrelated breaking change; the current reserved-key list is short and already documented.
- **Support both standalone and database-owned calls indefinitely:** preserves the root problem and complicates every session/lifecycle guarantee.
