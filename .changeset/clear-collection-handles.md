---
'@degliersa/raven-odm': minor
---

Make collection declarations reusable across databases. `defineCollection()` now creates a definition, and CRUD operations are performed through the database-owned `db.<key>` handle. This removes the `already_bound` failure and is a breaking API change while the package remains on `0.x`.
