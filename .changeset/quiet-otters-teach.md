---
"@degliersa/raven-odm": patch
---

Ship documentation that reaches you where you work. Every public entry point — `create`, `findById`, `findMany`, `update`, `delete`, `raw`, `connect`, `openSession`, `transaction`, `dispose`, `defineCollection`, and `createDatabase` — now carries a description, a runnable example, and the errors it can raise, visible on hover in your editor. The text states what a signature cannot: `update` re-validates the merged document as a whole, `findMany` without `take` returns every match, `connect` does not reach the server, and `dispose` is what lets a process exit.

The README's index-staleness examples called a standalone collection, a form that stopped working when collections moved behind the database instance; they now read `db.users.findMany(...)`. Both READMEs also gained a Deployment section with a long-lived server recipe and a serverless one, including the traps: never dispose per request, and keep one database across hot reloads.
