---
"@degliersa/raven-odm": minor
---

Settle three public behaviors ahead of a stable release.

`findMany` accepts `waitForNonStaleResults`, so a filtered or ordered query can be made to observe writes that precede it; exhausting the wait raises the new `query_timeout` error code. The default is unchanged and still matches RavenDB.

A disposed database can be connected again. `dispose()` now releases the collections it attached — and only those — so `connect()` after `dispose()` works instead of reporting the caller's own collections as duplicates. A failed `connect()` releases what it had already attached, so a corrected configuration can be retried.

`defineCollection` rejects a collection that sets both `idGenerator` and `idStrategy` with `invalid_configuration`. Previously `idGenerator` won silently.
