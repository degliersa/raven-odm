# @degliersa/raven-odm

## 0.3.0

### Minor Changes

- 33127ec: Add `createMany()`, `bulkInsert()`, `findPage()`, and `increment()`.

  ```ts
  const users = await db.users.createMany([
    { name: "Maria", email: "maria@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ]);

  const bulk = await db.users.bulkInsert();
  for (const row of csvRows) {
    await bulk.write(parseRow(row));
  }
  const result = await bulk.finish();

  const page = await db.users.findPage({
    where: { status: "active" },
    orderBy: { field: "name" },
    skip: 20,
    take: 10,
  });

  await db.orders.increment("Orders/1-A", "total", 5);
  ```

  `createMany()` validates every document and stores all of them in one atomic `saveChanges()` — if any item fails validation, nothing is written, and the thrown `BatchValidationError` names every failing index through `failures: { index, issues }[]`.

  `bulkInsert()` wraps RavenDB's native bulk-insert API for datasets too large for a single transaction. It is **not** atomic: `abortOnError` (default `true`) either stops the stream at the first invalid item or, set to `false`, skips it and reports every skipped item from `finish()`. A collection using `idStrategy: 'server'` rejects `bulkInsert()`, the same reason it rejects an external session — the server-assigned id could never be read back.

  `findPage()` reads one page together with the total number of matching documents in a single query, instead of a separate `count()`. `take` is required.

  `increment()` adds a delta to a numeric field on the server, atomically, with no read and no lost update under concurrent writers. It resolves to `void`. Incrementing a missing document's field is not an error — the same way `delete()` treats a missing id as already satisfied — RavenDB's patch silently does nothing when there is no document to apply it to.

## 0.2.0

### Minor Changes

- f4bf119: Add `count()`, `exists()`, and `findOne()` so a caller can ask how many documents match, whether one is present, or read a single one, without paying for a full result set.

  ```ts
  const active = await db.users.count({ where: { status: "active" } });
  const total = await db.users.count();

  const present = await db.users.exists("Users/1-A");

  const user = await db.users.findOne({
    where: { email: "maria@example.com" },
  });
  const newest = await db.users.findOne({
    orderBy: { field: "createdAt", descending: true },
  });
  ```

  `count()` accepts the same `where` and `waitForNonStaleResults` as `findMany`, and inherits its staleness contract. `exists()` reads by id, so it is never stale, and answers `false` for a missing id instead of throwing `document_not_found`. `findOne()` takes the same `where`/`orderBy` as `findMany`, requests at most one document, and returns it or `null` — several matches is not an error, and `orderBy` is how a caller makes "first" deterministic.

## 0.1.1

### Patch Changes

- 04ccac6: Ship documentation that reaches you where you work. Every public entry point — `create`, `findById`, `findMany`, `update`, `delete`, `raw`, `connect`, `openSession`, `transaction`, `dispose`, `defineCollection`, and `createDatabase` — now carries a description, a runnable example, and the errors it can raise, visible on hover in your editor. The text states what a signature cannot: `update` re-validates the merged document as a whole, `findMany` without `take` returns every match, `connect` does not reach the server, and `dispose` is what lets a process exit.

  The README's index-staleness examples called a standalone collection, a form that stopped working when collections moved behind the database instance; they now read `db.users.findMany(...)`. Both READMEs also gained a Deployment section with a long-lived server recipe and a serverless one, including the traps: never dispose per request, and keep one database across hot reloads.

## 0.1.0

### Minor Changes

- dceb6a1: Initial public alpha release of the RavenDB ODM.
- 2cbc971: Reach collections through the connected database. `createDatabase` now takes `collections` as a named record and returns a database typed over it, so `db.users.create(...)` replaces calling a module-level collection that was wired to a database invisibly.

  ```ts
  const db = createDatabase({
    urls,
    database: "app",
    collections: {
      users: defineCollection({ name: "Users", schema: userSchema }),
    },
  });

  await db.connect();
  await db.users.create({ name: "Maria", email: "maria@example.com" });
  ```

  The object key names the accessor only; the RavenDB collection name stays exactly what `defineCollection({ name })` says. A key that would shadow the database's own API — `database`, `store`, `connect`, `dispose`, `transaction`, `openSession` — is rejected at compile time and at runtime with `invalid_configuration`.

  This replaces the array form of `collections`, which is a breaking change while the package is in alpha.

- bcb961a: Settle three public behaviors ahead of a stable release.

  `findMany` accepts `waitForNonStaleResults`, so a filtered or ordered query can be made to observe writes that precede it; exhausting the wait raises the new `query_timeout` error code. The default is unchanged and still matches RavenDB.

  A disposed database can be connected again. `dispose()` now releases the collections it attached — and only those — so `connect()` after `dispose()` works instead of reporting the caller's own collections as duplicates. A failed `connect()` releases what it had already attached, so a corrected configuration can be retried.

  `defineCollection` rejects a collection that sets both `idGenerator` and `idStrategy` with `invalid_configuration`. Previously `idGenerator` won silently.

### Patch Changes

- f3fea80: Document Raven ODM motivation and add Brazilian Portuguese README
- 9be0dd0: Stop marking HiLo payloads with a private Symbol. The collection descriptor now identifies itself rather than the documents that happened to pass through the HiLo branch, and RavenDB resolves the collection for a HiLo id from the descriptor directly. Ids, collection names, and document contents are unchanged.
- c626abc: Serve every session from one Unit of Work policy, so transactions and collection operations open, save, and dispose sessions the same way

## 0.1.0-alpha.5

### Minor Changes

- 2cbc971: Reach collections through the connected database. `createDatabase` now takes `collections` as a named record and returns a database typed over it, so `db.users.create(...)` replaces calling a module-level collection that was wired to a database invisibly.

  ```ts
  const db = createDatabase({
    urls,
    database: "app",
    collections: {
      users: defineCollection({ name: "Users", schema: userSchema }),
    },
  });

  await db.connect();
  await db.users.create({ name: "Maria", email: "maria@example.com" });
  ```

  The object key names the accessor only; the RavenDB collection name stays exactly what `defineCollection({ name })` says. A key that would shadow the database's own API — `database`, `store`, `connect`, `dispose`, `transaction`, `openSession` — is rejected at compile time and at runtime with `invalid_configuration`.

  This replaces the array form of `collections`, which is a breaking change while the package is in alpha.

## 0.1.0-alpha.4

### Patch Changes

- 9be0dd0: Stop marking HiLo payloads with a private Symbol. The collection descriptor now identifies itself rather than the documents that happened to pass through the HiLo branch, and RavenDB resolves the collection for a HiLo id from the descriptor directly. Ids, collection names, and document contents are unchanged.

## 0.1.0-alpha.3

### Minor Changes

- bcb961a: Settle three public behaviors ahead of a stable release.

  `findMany` accepts `waitForNonStaleResults`, so a filtered or ordered query can be made to observe writes that precede it; exhausting the wait raises the new `query_timeout` error code. The default is unchanged and still matches RavenDB.

  A disposed database can be connected again. `dispose()` now releases the collections it attached — and only those — so `connect()` after `dispose()` works instead of reporting the caller's own collections as duplicates. A failed `connect()` releases what it had already attached, so a corrected configuration can be retried.

  `defineCollection` rejects a collection that sets both `idGenerator` and `idStrategy` with `invalid_configuration`. Previously `idGenerator` won silently.

## 0.1.0-alpha.2

### Patch Changes

- c626abc: Serve every session from one Unit of Work policy, so transactions and collection operations open, save, and dispose sessions the same way

## 0.1.0-alpha.1

### Patch Changes

- f3fea80: Document Raven ODM motivation and add Brazilian Portuguese README

## 0.1.0-alpha.0

### Minor Changes

- dceb6a1: Initial public alpha release of the RavenDB ODM.
