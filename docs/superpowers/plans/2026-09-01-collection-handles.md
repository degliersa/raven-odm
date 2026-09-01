# Per-Database Collection Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mutable globally bound collections with independent database-owned handles so one declaration can serve multiple connected databases before the 1.0 API freeze.

**Architecture:** Keep `Collection<S>` as an immutable definition returned by `defineCollection()`. Add `BoundCollection<S>` for the operational API; `Database` creates one handle per named collection and owns its lifecycle closures. Remove declaration mutation, standalone collection operations, and the `already_bound` error path.

**Tech Stack:** TypeScript 7, Node.js >=22, RavenDB Node client 7.x, Standard Schema, Vitest, Biome, Changesets.

**Spec:** `docs/superpowers/specs/2026-09-01-collection-handles-design.md`

## Global Constraints

- The package is still on `0.x` (`0.4.0`), so this is the last safe point to remove that observable ownership model before a stable API is published.
- `db.users` and `db.orders` are the only operational entry points.
- A declaration can back any number of databases.
- The public `already_bound` behavior is retired.
- This is a clean `0.x` cutover.
- The object key is only the accessor and never changes the RavenDB collection name.
- Exact collection naming, ID strategies, validation, sessions, transactions, query staleness, bulk behavior, increment behavior, and `raw()` semantics remain unchanged.
- The same descriptor may be registered by independent stores because name resolution is held in each database's registry.
- Do not add lazy connection, comparison operators, timestamps, upsert, cross-database transactions, relations, joins, includes, or collection-name derivation.

---

### Task 1: Implement independent database-owned handles

**Files:**

- Modify: `src/collection.ts`
- Modify: `src/database.ts`
- Modify: `src/index.ts`
- Modify: `src/errors.ts`
- Modify: `test/database.test.ts`
- Modify: `test/session-lifecycle.test.ts`
- Modify: `test/session.test.ts`
- Modify: `test/bulk-insert.test.ts`
- Modify: `test/collection.test.ts` only where its type assertions mention the old collection shape

**Interfaces:**

- Consumes: existing `CollectionOptions<S>`, `CollectionBinding`, `CollectionDescriptor`, `OdmSession`, `DatabaseOptions<TCollections>`, and all current CRUD/session methods.
- Produces: `Collection<S>` as a definition-only type, exported `BoundCollection<S>` with the current operational methods, `CollectionMap` constrained to definitions, and `RavenDatabase<TCollections>` mapped from definitions to bound handles.

- [ ] **Step 1: Write the failing multi-database contract test**

In `test/database.test.ts`, replace the single-binding expectations with a real-server test using two `withDatabase()` databases and one shared definition:

```ts
it('gives each database an independent handle for one shared declaration', async () => {
  const firstDatabase = await withDatabase()
  const secondDatabase = await withDatabase()
  databases.push(firstDatabase, secondDatabase)

  const people = defineCollection({ name: 'People', schema })
  const first = createDatabase({
    urls: [ravenUrl()],
    database: firstDatabase.name,
    collections: { people },
  })
  const second = createDatabase({
    urls: [ravenUrl()],
    database: secondDatabase.name,
    collections: { people },
  })
  connections.push(first, second)

  await Promise.all([first.connect(), second.connect()])

  expect(first.people).not.toBe(people)
  expect(second.people).not.toBe(people)
  expect(first.people).not.toBe(second.people)

  const firstPerson = await first.people.create({ name: 'Maria' })
  const secondPerson = await second.people.create({ name: 'Joana' })
  await expect(first.people.findById(firstPerson.id)).resolves.toEqual(firstPerson)
  await expect(second.people.findById(secondPerson.id)).resolves.toEqual(secondPerson)
  await expect(first.people.findById(secondPerson.id)).resolves.toBeNull()
  await expect(second.people.findById(firstPerson.id)).resolves.toBeNull()

  await first.dispose()
  await expect(second.people.findById(secondPerson.id)).resolves.toEqual(secondPerson)
})
```

Update the existing reconnect test to call `db.people` after `connect()`, after `dispose()`, and after reconnect. Replace the tests that expect `already_bound` or takeover-after-release with independent-handle and dispose-isolation assertions. Keep duplicate RavenDB names, reserved keys, and failed-connect recovery as separate tests.

Run: `npm test -- test/database.test.ts`

Expected: FAIL because the current `Database` returns the same definition object and the second `connect()` raises `already_bound`.

- [ ] **Step 2: Write the failing session-handle test**

In `test/session-lifecycle.test.ts`, remove the fake `BindableCollection` probe and the direct `CollectionBinding` capture. Keep the existing `FakeSession` assertions, but route the external-session operation through the database-owned handle:

```ts
it('leaves an external session untouched across collection operations', async () => {
  const given = new FakeSession()
  await expect(db.users.findById('Users/1-A', { session: given })).resolves.toBeNull()
  expect(given).toMatchObject({ saves: 0, disposes: 0 })
  expect(opened).toHaveLength(0)
})
```

Keep the library-owned transaction assertions and add the corresponding `db.users` operation assertion for the library-owned session path. The test must no longer require a caller-supplied object with `bind()` and `unbind()` methods.

Run: `npm test -- test/session-lifecycle.test.ts`

Expected: FAIL because the current fake probe is the only way to observe the binding and the definition is still the operational object.

- [ ] **Step 3: Split declaration and handle responsibilities**

In `src/collection.ts`:

1. Keep `CollectionOptions<S>`, `CollectionDescriptor`, `SessionOption`, `OdmSession`, and the current option/result types intact.
2. Make `Collection<S>` hold only immutable definition data required by `defineCollection()`: `name`, `schema`, the descriptor, and the selected ID strategy/configuration. Remove its mutable `#binding`, `bind()`, `unbind()`, `#bound()`, and all public CRUD/read/session methods.
3. Add `export class BoundCollection<S extends DocumentSchema>`. Move the current operational methods and their private helpers (`#strip`, `#hydrate`, `#withSession`, query construction, ID resolution, and bulk handling) into this class without changing their method signatures or observable behavior.
4. Give `BoundCollection` a constructor or internal factory that receives the definition plus one `CollectionBinding`. The binding is owned by the database that created this handle and is never written back to the shared definition.
5. Add an internal definition-to-handle factory used only by `Database`. It must preserve the descriptor identity and all schema/ID options while constructing a new handle.
6. Keep `defineCollection(options)` returning `Collection<S>` and keep `CollectionOptions` validation/error behavior unchanged.

The handle must continue to use the existing `CollectionBinding` fields for database name, descriptor, `runInSession`, document-ID generation, and bulk insert. It must not introduce a second session policy or a second RavenDB client abstraction.

- [ ] **Step 4: Make `Database` own one handle per configured key**

In `src/database.ts`:

1. Change `BindableCollection` into the definition shape consumed by the database, or remove it in favor of `Collection<DocumentSchema>` if the structural type is no longer needed. It must not require `bind()` or `unbind()`.
2. Keep `CollectionMap` as a named record of collection definitions.
3. Add a mapped bound-record type:

```ts
export type BoundCollectionMap<TCollections extends CollectionMap> = {
  readonly [K in keyof TCollections]: TCollections[K] extends Collection<infer S>
    ? BoundCollection<S>
    : never
}
```

1. Change `RavenDatabase<TCollections>` to intersect `Database<TCollections>` with `BoundCollectionMap<TCollections>`, preserving `db.users` inference and `Doc<S>` return types.
2. In the `Database` constructor, create a distinct `BoundCollection` for every configured key and expose that handle as the enumerable `db.<key>` property. Its binding closures must call this database's `#runInSession`, current `store`, ID generator, and bulk-insert factory. Calling an operation before `connect()` must still produce `not_connected` through the existing store/session guards.
3. In `connect()`, register each definition descriptor and exact collection name in this database's registry. Do not mutate a definition and do not reject a definition already used by another database.
4. In `dispose()` and failed-connect cleanup, clear only this database's store and descriptor registry. Do not detach or mutate any shared definition or handle owned by another database. Reconnect must re-register the same database's definitions and keep its handles usable.
5. Preserve the current reserved-key compile-time/runtime guard, duplicate collection-name validation, exact-name convention override, and `Database.store` lifecycle.

- [ ] **Step 5: Retire the obsolete public error path and exports**

In `src/errors.ts`, remove `already_bound` from the public error-code union. In `src/index.ts`, export `BoundCollection` and the new bound-record type if it is public, continue exporting `Collection` and `defineCollection`, and remove `BindableCollection` if it is no longer part of the public type surface.

Update source JSDoc so:

- `Collection` describes a definition rather than an operational object;
- `BoundCollection` documents `db.<key>` usage;
- `Database.connect()` no longer documents `already_bound`;
- every `not_connected` example uses `db.<key>`;
- no comment suggests that a declaration is rebound or released.

- [ ] **Step 6: Migrate existing tests to the bound surface**

Change the direct operational references in `test/database.test.ts` and `test/session-lifecycle.test.ts` to `db.<key>`. Remove the unused `type Collection` import in `test/session.test.ts` if the file does not annotate a definition. Keep declaration annotations in `test/bulk-insert.test.ts` and other tests only when they describe the value passed into `collections`; operational calls must use the corresponding `RavenDatabase` handle.

Preserve all existing behavior assertions for validation, IDs, sessions, transactions, optimistic concurrency, bulk insert, `raw()`, query staleness, and exact collection metadata. Only ownership and access-path assertions change.

- [ ] **Step 7: Run the implementation test cycle and commit**

Run the focused contract tests first:

```bash
npm test -- test/database.test.ts test/session-lifecycle.test.ts
```

Then run the type and full behavioral checks:

```bash
npm run typecheck
npm test
```

Expected: all current integration tests pass; no test expects `already_bound`; shared declarations work across two databases; external sessions are neither saved nor disposed by a bound handle.

Commit the complete source/test change:

```bash
git add src/collection.ts src/database.ts src/index.ts src/errors.ts test/database.test.ts test/session-lifecycle.test.ts test/session.test.ts test/bulk-insert.test.ts test/collection.test.ts
git commit -m "feat: own collection handles per database"
```

**Task 1 completion contract:** `db.<key>` is the only operational path, the same `defineCollection()` result works in two databases, disposal is isolated, reconnect works, public types preserve schema inference, and the full existing test suite is green.

---

### Task 2: Migrate documentation, examples, and release metadata

**Files:**

- Modify: `README.md`
- Modify: `README.pt-BR.md`
- Modify: `examples/README.md`
- Create: `.changeset/clear-collection-handles.md`

**Interfaces:**

- Consumes: the `Collection<S>` definition / `BoundCollection<S>` handle split and the working `db.<key>` API from Task 1.
- Produces: consistent user-facing migration guidance in both languages, examples guidance that names the database-owned handle, and a Changeset describing the 0.x breaking change.

- [ ] **Step 1: Add the migration examples**

In both root READMEs, make the primary recipe explicitly show a definition passed in `collections: { users }` and all operations through `db.users`. Add a multi-tenant example that reuses one definition in two database instances:

```ts
const users = defineCollection({ name: 'Users', schema: userSchema })
const tenantA = createDatabase({ urls, database: 'tenant-a', collections: { users } })
const tenantB = createDatabase({ urls, database: 'tenant-b', collections: { users } })

await Promise.all([tenantA.connect(), tenantB.connect()])
await tenantA.users.create({ name: 'Maria' })
await tenantB.users.create({ name: 'Joana' })
```

Document that the declaration is definition-only, `db.users` owns the database connection, and disposing one database does not affect another database using the same declaration. Document that `already_bound` is removed because declarations are no longer globally bound. Keep the existing exact-name, session, transaction, validation, and `raw()` guidance intact.

In `examples/README.md`, state that every executable example operates through `db.<key>` and add the shared-definition multi-database use case without changing the existing validator examples, which already use database-owned handles.

- [ ] **Step 2: Add the user-facing Changeset**

Create `.changeset/clear-collection-handles.md` with this exact metadata and message:

```md
---
'@degliersa/raven-odm': minor
---

Make collection declarations reusable across databases. `defineCollection()` now creates a definition, and CRUD operations are performed through the database-owned `db.<key>` handle. This removes the `already_bound` failure and is a breaking API change while the package remains on `0.x`.
```

- [ ] **Step 3: Verify docs and packaging**

Run:

```bash
npm run typecheck:examples
npm run lint
npm run build
npm test
```

Expected: all examples typecheck, Biome reports no issues, the package builds, and the full real-server suite remains green.

Commit the documentation and release metadata:

```bash
git add README.md README.pt-BR.md examples/README.md .changeset/clear-collection-handles.md
git commit -m "docs: document per-database collection handles"
```

**Task 2 completion contract:** both READMEs, examples guidance, and package release metadata describe only the bound-handle API, with no standalone operational recipe or `already_bound` documentation.

---

## Plan self-review

- **Spec coverage:** declaration/handle split is covered by Task 1 Steps 3–4; multi-database isolation by Steps 1, 4, and 7; lifecycle/reconnect by Step 4; `already_bound` retirement by Step 5; unchanged session/query/validation behavior by Step 6; docs and Changeset by Task 2.
- **Task dependencies:** Task 2 consumes only the exported handle API and passing tests produced by Task 1. No Task 2 interface is required by Task 1.
- **Shared files:** `src/collection.ts` and `src/database.ts` are owned by Task 1; documentation files are owned by Task 2. There is no cross-task source edit.
- **Placeholder scan:** no `TODO`, `TBD`, “implement later”, or open-ended “handle edge cases” directive appears in the task steps.
- **Type consistency:** `Collection<S>` is the definition, `BoundCollection<S>` is operational, `BoundCollectionMap<TCollections>` maps definitions to handles, and `RavenDatabase<TCollections>` exposes that mapped record throughout both tasks.
