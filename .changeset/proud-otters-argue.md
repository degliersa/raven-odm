---
"@degliersa/raven-odm": minor
---

Reach collections through the connected database. `createDatabase` now takes `collections` as a named record and returns a database typed over it, so `db.users.create(...)` replaces calling a module-level collection that was wired to a database invisibly.

```ts
const db = createDatabase({
  urls,
  database: 'app',
  collections: { users: defineCollection({ name: 'Users', schema: userSchema }) },
})

await db.connect()
await db.users.create({ name: 'Maria', email: 'maria@example.com' })
```

The object key names the accessor only; the RavenDB collection name stays exactly what `defineCollection({ name })` says. A key that would shadow the database's own API — `database`, `store`, `connect`, `dispose`, `transaction`, `openSession` — is rejected at compile time and at runtime with `invalid_configuration`.

This replaces the array form of `collections`, which is a breaking change while the package is in alpha.
