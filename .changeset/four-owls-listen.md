---
"@degliersa/raven-odm": minor
---

Add `count()`, `exists()`, and `findOne()` so a caller can ask how many documents match, whether one is present, or read a single one, without paying for a full result set.

```ts
const active = await db.users.count({ where: { status: 'active' } })
const total = await db.users.count()

const present = await db.users.exists('Users/1-A')

const user = await db.users.findOne({ where: { email: 'maria@example.com' } })
const newest = await db.users.findOne({ orderBy: { field: 'createdAt', descending: true } })
```

`count()` accepts the same `where` and `waitForNonStaleResults` as `findMany`, and inherits its staleness contract. `exists()` reads by id, so it is never stale, and answers `false` for a missing id instead of throwing `document_not_found`. `findOne()` takes the same `where`/`orderBy` as `findMany`, requests at most one document, and returns it or `null` — several matches is not an error, and `orderBy` is how a caller makes "first" deterministic.
