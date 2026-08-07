# @degliersa/raven-odm

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
