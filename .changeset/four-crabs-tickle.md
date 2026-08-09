---
"@degliersa/raven-odm": minor
---

Add `createMany()`, `bulkInsert()`, `findPage()`, and `increment()`.

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

`increment()` adds a delta to a numeric field on the server, atomically, with no read and no lost update under concurrent writers. It resolves to `void` and requires the document to already exist, throwing `document_not_found` otherwise.
