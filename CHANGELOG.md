# @degliersa/raven-odm

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
