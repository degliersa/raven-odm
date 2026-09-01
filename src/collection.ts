import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  BulkInsertOperation,
  BulkInsertOptions,
  IDocumentSession,
  IMetadataDictionary,
  QueryStatistics,
} from 'ravendb'
import {
  BatchValidationError,
  type BatchValidationFailure,
  normalizeQueryError,
  normalizeRavenError,
  RavenOdmError,
  ValidationError,
} from './errors'
import { type IdStrategy, selectIdStrategy } from './id-strategy'
import { validate } from './validate'

const METADATA_KEY = '@metadata'
const COLLECTION_CONFIGURATION = Symbol('collection configuration')

type CollectionConfiguration = {
  readonly resolveId: IdStrategy<DocumentSchema>
  readonly validateOnRead: boolean
}

/** Documents are objects, so the schema's OUTPUT must be an object. */
export type DocumentSchema = StandardSchemaV1<unknown, object>

export type Doc<S extends DocumentSchema> = StandardSchemaV1.InferOutput<S> & { id: string }

export interface IdGeneratorContext<S extends DocumentSchema> {
  readonly document: StandardSchemaV1.InferOutput<S>
  readonly collection: string
  readonly database: string
}

export type IdGenerator<S extends DocumentSchema> = (
  ctx: IdGeneratorContext<S>,
) => string | Promise<string>

export interface CollectionOptions<S extends DocumentSchema> {
  /** Exact RavenDB collection name. Never pluralized or otherwise rewritten. */
  readonly name: string
  readonly schema: S
  /**
   * How to obtain a document id when `idGenerator` is absent.
   * - 'uuid'   (default): client-side `<name>/<randomUUID>`; works inside an external session.
   * - 'hilo': RavenDB HiLo `<name>/<number>-<nodeTag>`; reserves ranges and works inside
   *   an external session.
   * - 'server': RavenDB identity `<name>/1-A`; needs the save to resolve, so it is
   *   rejected when a `session` is supplied.
   *
   * Mutually exclusive with `idGenerator`.
   */
  readonly idStrategy?: 'uuid' | 'hilo' | 'server' | undefined
  /** Supplies the id itself. Mutually exclusive with `idStrategy`. */
  readonly idGenerator?: IdGenerator<S> | undefined
  /** Validate documents coming back from the server. Default: false. */
  readonly validateOnRead?: boolean | undefined
}

/** ravendb's ObjectLiteralDescriptor, kept structural to avoid importing internals. */
export interface CollectionDescriptor {
  readonly name: string
  isType(obj: object): boolean
  construct(dto: object): object
}

export interface SessionOption {
  readonly session?: OdmSession | undefined
}

export interface FindManyOptions<S extends DocumentSchema> extends SessionOption {
  readonly where?: Partial<StandardSchemaV1.InferOutput<S>> | undefined
  readonly orderBy?:
    | { readonly field: string; readonly descending?: boolean | undefined }
    | undefined
  readonly skip?: number | undefined
  readonly take?: number | undefined
  /**
   * Wait for the index answering this query to catch up with earlier writes.
   *
   * A `where` or `orderBy` query is answered by a RavenDB auto-index, which is
   * updated asynchronously, so by default it may not yet observe a document
   * written moments earlier. `true` waits with the server's default timeout, a
   * number waits that many milliseconds, and exhausting either raises
   * `query_timeout`. Default: false, matching RavenDB.
   *
   * An unfiltered, unordered `findMany()` reads the collection directly and
   * always observes prior writes, so this option is unnecessary there.
   */
  readonly waitForNonStaleResults?: boolean | number | undefined
}

/** `findOne` applies its own `take: 1`, so `skip`/`take` are rejected at the type level. */
export type FindOneOptions<S extends DocumentSchema> = Omit<FindManyOptions<S>, 'skip' | 'take'>

export interface CountOptions<S extends DocumentSchema> extends SessionOption {
  readonly where?: Partial<StandardSchemaV1.InferOutput<S>> | undefined
  /** Same staleness contract as {@link FindManyOptions.waitForNonStaleResults}. */
  readonly waitForNonStaleResults?: boolean | number | undefined
}

export interface FindPageOptions<S extends DocumentSchema> extends SessionOption {
  readonly where?: Partial<StandardSchemaV1.InferOutput<S>> | undefined
  readonly orderBy?:
    | { readonly field: string; readonly descending?: boolean | undefined }
    | undefined
  readonly skip?: number | undefined
  /** Required: pagination without a page size reintroduces the memory hazard `findMany` warns about. */
  readonly take: number
  /** Same staleness contract as {@link FindManyOptions.waitForNonStaleResults}. */
  readonly waitForNonStaleResults?: boolean | number | undefined
}

export interface FindPageResult<S extends DocumentSchema> {
  readonly data: Doc<S>[]
  /** Total matching documents, ignoring `skip`/`take` — from RavenDB's query statistics. */
  readonly total: number
}

/** Keys of the document whose value is a `number` — the only fields `increment` accepts. */
export type NumericKeys<S extends DocumentSchema> = {
  [K in keyof StandardSchemaV1.InferOutput<S>]: StandardSchemaV1.InferOutput<S>[K] extends number
    ? K
    : never
}[keyof StandardSchemaV1.InferOutput<S>]

export interface BulkInsertOptionsOdm {
  /**
   * When an item fails validation: `true` aborts the whole stream at that item,
   * `false` skips it and continues, collecting the failure to report from `finish()`.
   * Default: `true`.
   */
  readonly abortOnError?: boolean | undefined
}

export interface BulkInsertResult {
  readonly written: number
  readonly failures: ReadonlyArray<BatchValidationFailure>
}

export interface BulkInsertHandle<S extends DocumentSchema> {
  /**
   * Validates and streams one document. Under `abortOnError: true` (the default),
   * a validation failure both rejects this call and ends the stream — every
   * following `write`/`finish` call rejects with the same error. Under
   * `abortOnError: false`, a validation failure resolves silently and is recorded
   * for `finish()` to report; nothing is sent to the server for that item.
   */
  write(data: StandardSchemaV1.InferInput<S>): Promise<void>
  /** Flushes the stream and reports how many documents were written and which were skipped. */
  finish(): Promise<BulkInsertResult>
}

export interface OdmSession {
  readonly raw: IDocumentSession
  saveChanges(): Promise<void>
  dispose(): void
}

/**
 * Runs `fn` under the Unit of Work policy owned by the database: a caller-provided
 * session is reused as-is, otherwise a session is opened, saved on success and always
 * disposed. `owned` tells the callback whether the session belongs to the library, so
 * work that must read post-flush state (server identities) can flush early.
 */
export type RunInSession = <T>(
  given: OdmSession | undefined,
  fn: (session: OdmSession, owned: boolean) => Promise<T>,
) => Promise<T>

/** Binding owned by one database-owned collection handle. */
export interface CollectionBinding {
  readonly database: string
  readonly descriptor: CollectionDescriptor
  runInSession: RunInSession
  /** Reserves the next HiLo id for this collection. Takes no document: the id
   * depends on the collection, never on what is being stored. */
  generateDocumentId(): Promise<string>
  /** Opens a native bulk-insert stream against this collection's database. */
  bulkInsert(options?: BulkInsertOptions): BulkInsertOperation
}

/**
 * Declares a collection: an exact RavenDB collection name plus the schema that
 * validates its documents and gives them their TypeScript type.
 *
 * A `Collection` is a definition only. Pass it to `createDatabase`, then use
 * the database-owned `db.<key>` handle for reads and writes.
 *
 * @example
 * ```ts
 * const users = defineCollection({
 *   name: 'Users',                       // the RavenDB collection, verbatim
 *   schema: z.object({ name: z.string(), email: z.email() }),
 * })
 *
 * const db = createDatabase({ urls, database: 'app', collections: { users } })
 * await db.connect()
 * await db.users.create({ name: 'Maria', email: 'maria@example.com' })
 * ```
 *
 * @throws `RavenOdmError` with `invalid_configuration` — the name is empty, or
 * both `idGenerator` and `idStrategy` were given.
 */
export class Collection<S extends DocumentSchema> {
  readonly name: string
  readonly schema: S
  readonly descriptor: CollectionDescriptor
  readonly [COLLECTION_CONFIGURATION]: CollectionConfiguration

  constructor(options: CollectionOptions<S>) {
    if (!options.name) {
      throw new RavenOdmError(
        'invalid_configuration',
        'defineCollection requires a non-empty "name"',
      )
    }
    // Both would resolve the same id, and only one of them can win. Refusing the
    // pair keeps the winner from being a fact you can only learn by reading create().
    if (options.idGenerator && options.idStrategy) {
      throw new RavenOdmError(
        'invalid_configuration',
        `Collection "${options.name}" sets both "idGenerator" and "idStrategy". ` +
          'They are mutually exclusive: keep "idGenerator" to supply ids yourself, or ' +
          'keep "idStrategy" to let raven-odm or RavenDB assign them.',
        { collection: options.name },
      )
    }
    this.name = options.name
    this.schema = options.schema
    const resolveId = selectIdStrategy({
      idStrategy: options.idStrategy,
      idGenerator: options.idGenerator,
    }) as IdStrategy<DocumentSchema>
    const validateOnRead = options.validateOnRead ?? false
    // RavenDB calls isType() to recover a descriptor from a bare object, which
    // this ODM needs in exactly one place: resolving the collection name while
    // reserving a HiLo id. So the descriptor identifies *itself* and nothing
    // else. Recognising documents instead would be wrong twice over: object
    // literals would be shape-sniffed into a collection, and a `true` answer
    // makes convertToEntity() return the raw document, skipping the step that
    // attaches its id.
    this.descriptor = {
      name: options.name,
      isType: (obj) => obj === this.descriptor,
      construct: (dto) => dto,
    }
    this[COLLECTION_CONFIGURATION] = { resolveId, validateOnRead }
  }
}

/**
 * Operational collection handle owned by one `Database`.
 *
 * Handles are exposed as `db.<key>` and keep their database binding private.
 * The same `Collection` definition can therefore be used by multiple
 * databases without sharing clients, sessions, or lifecycle state.
 */
export class BoundCollection<S extends DocumentSchema> {
  readonly name: string
  readonly schema: S
  readonly descriptor: CollectionDescriptor

  #resolveId: IdStrategy<S>
  #validateOnRead: boolean
  #binding: CollectionBinding

  constructor(definition: Collection<S>, binding: CollectionBinding) {
    const configuration = definition[COLLECTION_CONFIGURATION]
    this.name = definition.name
    this.schema = definition.schema
    this.descriptor = definition.descriptor
    this.#resolveId = configuration.resolveId as IdStrategy<S>
    this.#validateOnRead = configuration.validateOnRead
    this.#binding = binding
  }

  #bound(): CollectionBinding {
    return this.#binding
  }

  /** Strip client/server bookkeeping so the user schema never sees it. */
  #strip(entity: Record<string, unknown>): { body: Record<string, unknown>; id: string } {
    const { [METADATA_KEY]: _meta, id, ...rest } = entity
    return { body: rest, id: String(id) }
  }

  /** Session ownership is the database's policy; the collection only supplies the work. */
  async #withSession<T>(
    given: OdmSession | undefined,
    fn: (s: OdmSession) => Promise<T>,
  ): Promise<T> {
    return this.#bound().runInSession(given, (s) => fn(s))
  }

  /**
   * Validates `data` against the schema and stores it, returning the document
   * with its `id`.
   *
   * Nothing is written if validation fails: the thrown `ValidationError` carries
   * the Standard Schema issues. Without a session the write is committed before
   * this resolves; with one it is committed by your `saveChanges()`.
   *
   * @example
   * ```ts
   * const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
   * user.id // 'Users/6f9…'
   *
   * // inside a transaction, committed once at the end
   * await db.transaction(async (session) => {
   *   await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
   *   await db.orders.create({ status: 'pending', total: 42 }, { session })
   * })
   * ```
   *
   * @throws `ValidationError` — the document does not satisfy the schema.
   * @throws `RavenOdmError` with `invalid_configuration` — `idStrategy: 'server'`
   * cannot be used with an external session, because the server assigns that id
   * during the save.
   */
  async create(data: StandardSchemaV1.InferInput<S>, opts: SessionOption = {}): Promise<Doc<S>> {
    const binding = this.#bound()
    const value = await validate(this.schema, data, { collection: this.name })
    const payload = { ...(value as Record<string, unknown>) }
    delete payload.id

    const id = await this.#resolveId({
      document: value,
      collection: this.name,
      database: binding.database,
      sessionProvided: opts.session !== undefined,
      reserveId: () => binding.generateDocumentId(),
    })

    // The identity-prefix id only exists after the flush, so an owned session is saved
    // here rather than on the way out, and the id is read back from the session instead
    // of trusting the value passed in. The trailing save done by the ownership policy
    // then has nothing left to send.
    return binding.runInSession(opts.session, async (s, owned) => {
      try {
        await s.raw.store(payload, id, binding.descriptor as never)
        if (owned) await s.saveChanges()
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name, documentId: id })
      }
      return { ...value, id: s.raw.advanced.getDocumentId(payload) ?? id } as Doc<S>
    })
  }

  /** Validates every item, collecting every failure instead of stopping at the first. */
  async #validateAll(items: readonly unknown[]): Promise<StandardSchemaV1.InferOutput<S>[]> {
    const values: StandardSchemaV1.InferOutput<S>[] = []
    const failures: BatchValidationFailure[] = []
    for (const [index, item] of items.entries()) {
      try {
        values.push(await validate(this.schema, item, { collection: this.name }))
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err
        failures.push({ index, issues: err.issues })
      }
    }
    if (failures.length > 0) {
      throw new BatchValidationError(failures, { collection: this.name })
    }
    return values
  }

  /**
   * Validates every document and stores all of them in one `saveChanges()`,
   * atomically: if any item fails validation, nothing is written and the
   * thrown `BatchValidationError` names every failing index.
   *
   * @example
   * ```ts
   * const users = await db.users.createMany([
   *   { name: 'Maria', email: 'maria@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   * ])
   * ```
   *
   * @throws `BatchValidationError` — one or more items do not satisfy the schema.
   * @throws `RavenOdmError` with `invalid_configuration` — `idStrategy: 'server'`
   * cannot be used with an external session.
   */
  async createMany(
    data: readonly StandardSchemaV1.InferInput<S>[],
    opts: SessionOption = {},
  ): Promise<Doc<S>[]> {
    const binding = this.#bound()
    const values = await this.#validateAll(data)
    const items: {
      value: StandardSchemaV1.InferOutput<S>
      payload: Record<string, unknown>
      id: string
    }[] = []
    for (const value of values) {
      const payload = { ...(value as Record<string, unknown>) }
      delete payload.id
      const id = await this.#resolveId({
        document: value,
        collection: this.name,
        database: binding.database,
        sessionProvided: opts.session !== undefined,
        reserveId: () => binding.generateDocumentId(),
      })
      items.push({ value, payload, id })
    }

    return binding.runInSession(opts.session, async (s, owned) => {
      try {
        for (const item of items) {
          await s.raw.store(item.payload, item.id, binding.descriptor as never)
        }
        if (owned) await s.saveChanges()
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name })
      }
      return items.map(
        (item) =>
          ({
            ...item.value,
            id: s.raw.advanced.getDocumentId(item.payload) ?? item.id,
          }) as Doc<S>,
      )
    })
  }

  /**
   * Loads one document by id, or `null` when it does not exist.
   *
   * Reading by id is never stale — unlike `findMany` with a filter, it does not
   * go through an index. The returned document is a flat validated copy, not a
   * tracked entity: mutating it schedules no write.
   *
   * @example
   * ```ts
   * const user = await db.users.findById('Users/1-A')
   * if (!user) return notFound()
   * user.name // typed from the schema
   * ```
   */
  async findById(id: string, opts: SessionOption = {}): Promise<Doc<S> | null> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      const entity = await s.raw.load<Record<string, unknown>>(id, binding.descriptor as never)
      if (!entity) return null
      return this.#hydrate(entity)
    })
  }

  async #hydrate(entity: Record<string, unknown>): Promise<Doc<S>> {
    const { body, id } = this.#strip(entity)
    const value = this.#validateOnRead
      ? await validate(this.schema, body, { collection: this.name, documentId: id })
      : (body as StandardSchemaV1.InferOutput<S>)
    return { ...value, id } as Doc<S>
  }

  /** Shared by every read that filters or orders: `findMany`, `findOne`, `count`. */
  #buildQuery(
    s: OdmSession,
    binding: CollectionBinding,
    opts: {
      readonly where?: Partial<StandardSchemaV1.InferOutput<S>> | undefined
      readonly orderBy?:
        | { readonly field: string; readonly descending?: boolean | undefined }
        | undefined
      readonly waitForNonStaleResults?: boolean | number | undefined
    },
  ) {
    let q = s.raw.query<Record<string, unknown>>({
      collection: this.name,
      documentType: binding.descriptor as never,
    })
    const wait = opts.waitForNonStaleResults
    if (wait === true) q = q.waitForNonStaleResults()
    else if (typeof wait === 'number') q = q.waitForNonStaleResults(wait)
    const where = opts.where as Record<string, unknown> | undefined
    if (where) {
      let first = true
      for (const [field, value] of Object.entries(where)) {
        if (!first) q = q.andAlso()
        q = q.whereEquals(field, value)
        first = false
      }
    }
    if (opts.orderBy) {
      q = opts.orderBy.descending
        ? q.orderByDescending(opts.orderBy.field)
        : q.orderBy(opts.orderBy.field)
    }
    return q
  }

  /**
   * Reads documents from the collection. Entries in `where` are combined with
   * AND and compared for equality; anything richer belongs in {@link raw}.
   *
   * Without `take` this returns **every** matching document, which is a memory
   * hazard on a large collection. With `where` or `orderBy` the query is answered
   * by an auto-index, which updates asynchronously — pass `waitForNonStaleResults`
   * when the read must observe a write that just happened.
   *
   * @example
   * ```ts
   * const page = await db.users.findMany({
   *   where: { status: 'active' },
   *   orderBy: { field: 'name' },
   *   skip: 20,
   *   take: 10,
   * })
   *
   * // read-after-write
   * await db.users.create({ name: 'Maria', email: 'maria@example.com' })
   * await db.users.findMany({ where: { name: 'Maria' }, waitForNonStaleResults: true })
   * ```
   *
   * @throws `RavenOdmError` with `query_timeout` — the wait for a non-stale index
   * ran out.
   */
  async findMany(opts: FindManyOptions<S> = {}): Promise<Doc<S>[]> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      let q = this.#buildQuery(s, binding, opts)
      if (opts.skip !== undefined) q = q.skip(opts.skip)
      if (opts.take !== undefined) q = q.take(opts.take)
      let rows: Record<string, unknown>[]
      try {
        rows = await q.all()
      } catch (err) {
        throw normalizeQueryError(err, { collection: this.name })
      }
      return Promise.all(rows.map((r) => this.#hydrate(r)))
    })
  }

  /**
   * Reads one page of documents together with the total number of matching
   * documents, in a single query — one round trip instead of a separate
   * `count()`.
   *
   * `take` is required: pagination without a page size reintroduces the memory
   * hazard an unbounded `findMany()` already warns about. `total` reflects
   * every matching document, ignoring `skip`/`take`.
   *
   * @example
   * ```ts
   * const page = await db.users.findPage({
   *   where: { status: 'active' },
   *   orderBy: { field: 'name' },
   *   skip: 20,
   *   take: 10,
   * })
   * page.data   // up to 10 documents
   * page.total  // every matching document, not just this page
   * ```
   *
   * @throws `RavenOdmError` with `query_timeout` — the wait for a non-stale index
   * ran out.
   */
  async findPage(opts: FindPageOptions<S>): Promise<FindPageResult<S>> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      let q = this.#buildQuery(s, binding, opts)
      // .statistics() hands back a live reference immediately, before the query
      // runs — totalResults is only populated on that same object once `all()`
      // resolves, so it must be read after awaiting, never inside this callback.
      let stats: QueryStatistics | undefined
      q = q.statistics((qs) => {
        stats = qs
      })
      if (opts.skip !== undefined) q = q.skip(opts.skip)
      q = q.take(opts.take)
      let rows: Record<string, unknown>[]
      try {
        rows = await q.all()
      } catch (err) {
        throw normalizeQueryError(err, { collection: this.name })
      }
      const data = await Promise.all(rows.map((r) => this.#hydrate(r)))
      return { data, total: stats?.totalResults ?? 0 }
    })
  }

  /**
   * Reads the first document matching `where`/`orderBy`, or `null` when nothing
   * matches. Requests at most one document from the server.
   *
   * Several documents matching `where` is not an error: this returns the first
   * one seen, and `orderBy` is how a caller makes "first" deterministic.
   *
   * @example
   * ```ts
   * const user = await db.users.findOne({ where: { email: 'maria@example.com' } })
   * const newest = await db.users.findOne({ orderBy: { field: 'createdAt', descending: true } })
   * ```
   *
   * @throws `RavenOdmError` with `query_timeout` — the wait for a non-stale index
   * ran out.
   */
  async findOne(opts: FindOneOptions<S> = {}): Promise<Doc<S> | null> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      const q = this.#buildQuery(s, binding, opts)
      let row: Record<string, unknown> | null
      try {
        row = await q.firstOrNull()
      } catch (err) {
        throw normalizeQueryError(err, { collection: this.name })
      }
      return row ? this.#hydrate(row) : null
    })
  }

  /**
   * Counts documents matching `where`, without loading or validating any of
   * them. Without `where` this counts the whole collection.
   *
   * `where` is answered by the same auto-index `findMany` uses, so it inherits
   * the same staleness contract: pass `waitForNonStaleResults` to observe a
   * write that just happened.
   *
   * @example
   * ```ts
   * const active = await db.users.count({ where: { status: 'active' } })
   * const total = await db.users.count()
   * ```
   *
   * @throws `RavenOdmError` with `query_timeout` — the wait for a non-stale index
   * ran out.
   */
  async count(opts: CountOptions<S> = {}): Promise<number> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      const q = this.#buildQuery(s, binding, opts)
      try {
        return await q.count()
      } catch (err) {
        throw normalizeQueryError(err, { collection: this.name })
      }
    })
  }

  /**
   * Reports whether a document with this id exists, without loading it.
   *
   * Reading by id is never stale, unlike a `count()` with `where`. A missing
   * id answers `false` rather than throwing `document_not_found`.
   *
   * @example
   * ```ts
   * const present = await db.users.exists('Users/1-A')
   * ```
   */
  async exists(id: string, opts: SessionOption = {}): Promise<boolean> {
    this.#bound()
    return this.#withSession(opts.session, async (s) => {
      try {
        return await s.raw.advanced.exists(id)
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name, documentId: id })
      }
    })
  }

  /**
   * Merges `patch` into the stored document and writes it back.
   *
   * This is a read-modify-write: the document is loaded, merged, and re-validated
   * **as a whole**, so what is stored always satisfies the schema — a patch that
   * makes the merged document invalid is rejected and nothing is written. Fields
   * absent from the merged result are removed from the document.
   *
   * Being read-modify-write also makes it racy for a value derived from its own
   * previous value, such as a counter; enable `optimisticConcurrency` on the
   * database if a lost update matters.
   *
   * @example
   * ```ts
   * const updated = await db.users.update('Users/1-A', { name: 'Maria Silva' })
   * updated.email // untouched fields are preserved
   * ```
   *
   * @throws `RavenOdmError` with `document_not_found` — no document has that id.
   * @throws `ValidationError` — the merged document does not satisfy the schema.
   */
  async update(
    id: string,
    patch: Partial<StandardSchemaV1.InferInput<S>>,
    opts: SessionOption = {},
  ): Promise<Doc<S>> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      const entity = await s.raw.load<Record<string, unknown>>(id, binding.descriptor as never)
      if (!entity) {
        throw new RavenOdmError('document_not_found', `Document "${id}" was not found`, {
          collection: this.name,
          documentId: id,
        })
      }
      const { body } = this.#strip(entity)
      // Full re-validation of the merged document keeps the stored doc always schema-valid.
      const value = await validate(
        this.schema,
        { ...body, ...patch },
        { collection: this.name, documentId: id },
      )
      const next = { ...(value as Record<string, unknown>) }
      delete next.id
      // mutate the TRACKED entity so the unit of work emits a PUT
      for (const key of Object.keys(body)) {
        if (!(key in next)) delete entity[key]
      }
      Object.assign(entity, next)
      return { ...value, id } as Doc<S>
    })
  }

  /**
   * Adds `delta` to a numeric field on the server, atomically — no read, no
   * merge, no re-validation, and no lost update under concurrent writers.
   *
   * The command is deferred like `store()`: with no session it is sent on the
   * trailing `saveChanges()`; with an external session it is sent whenever you
   * call `saveChanges()`. Either way, this resolves to `void` — reload with
   * `findById()` if you need the new value.
   *
   * Incrementing a missing document's field is not an error, the same way
   * `delete()` treats a missing id as already satisfied: RavenDB's patch
   * silently does nothing when there is no document to apply it to. Nothing
   * is created and nothing is signaled back.
   *
   * @example
   * ```ts
   * await db.orders.increment('Orders/1-A', 'total', 5)
   * ```
   */
  async increment(
    id: string,
    field: NumericKeys<S>,
    delta: number,
    opts: SessionOption = {},
  ): Promise<void> {
    const binding = this.#bound()
    await binding.runInSession(opts.session, async (s, owned) => {
      try {
        s.raw.advanced.increment(id, field as string, delta)
        if (owned) await s.saveChanges()
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name, documentId: id })
      }
    })
  }

  /**
   * Deletes the document with this id.
   *
   * Deleting an id that does not exist is not an error — RavenDB treats the
   * delete as satisfied either way.
   *
   * @example
   * ```ts
   * await db.users.delete('Users/1-A')
   * ```
   */
  async delete(id: string, opts: SessionOption = {}): Promise<void> {
    this.#bound()
    await this.#withSession(opts.session, async (s) => {
      try {
        await s.raw.delete(id)
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name, documentId: id })
      }
    })
  }

  /**
   * Streams documents into this collection outside a session, for a dataset too
   * large for `createMany`'s single-transaction round trip.
   *
   * Not atomic: RavenDB commits internally in chunks, so an interruption
   * partway through can leave some documents written and others not. Each
   * `write()` validates before sending, so nothing invalid ever reaches the
   * server, but `abortOnError` decides what happens to the stream itself:
   * `true` (the default) stops it at the first invalid item, `false` skips
   * that item and continues, reporting it from `finish()` instead.
   *
   * `idStrategy: 'server'` is rejected — like an external session, this never
   * calls `saveChanges()`, so the server-assigned id could never be read back.
   *
   * @example
   * ```ts
   * const bulk = await db.users.bulkInsert()
   * for (const row of csvRows) {
   *   await bulk.write(parseRow(row))
   * }
   * const result = await bulk.finish()
   * result.written   // documents actually stored
   * result.failures  // skipped items, only when abortOnError is false
   * ```
   *
   * @throws `ValidationError` — a document fails validation while `abortOnError`
   * is `true`.
   * @throws `RavenOdmError` with `invalid_configuration` — this collection uses
   * `idStrategy: 'server'`.
   */
  async bulkInsert(opts: BulkInsertOptionsOdm = {}): Promise<BulkInsertHandle<S>> {
    const binding = this.#bound()
    const abortOnError = opts.abortOnError ?? true
    const op = binding.bulkInsert()
    const failures: BatchValidationFailure[] = []
    let index = 0
    let written = 0
    let stopped: unknown

    const write = async (data: StandardSchemaV1.InferInput<S>): Promise<void> => {
      if (stopped !== undefined) throw stopped
      const current = index++

      let value: StandardSchemaV1.InferOutput<S>
      try {
        value = await validate(this.schema, data, { collection: this.name })
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err
        failures.push({ index: current, issues: err.issues })
        if (!abortOnError) return
        stopped = err
        await op.abort().catch(() => {})
        throw err
      }

      const payload = { ...(value as Record<string, unknown>) }
      delete payload.id
      // Never flushes through this call, the same reason an external session
      // can't use idStrategy 'server' either — see id-strategy.ts.
      const id = await this.#resolveId({
        document: value,
        collection: this.name,
        database: binding.database,
        sessionProvided: true,
        reserveId: () => binding.generateDocumentId(),
      })

      try {
        await op.store(payload, id, { '@collection': this.name } as IMetadataDictionary)
        written++
      } catch (err) {
        const normalized = normalizeRavenError(err, { collection: this.name, documentId: id })
        stopped = normalized
        throw normalized
      }
    }

    const finish = async (): Promise<BulkInsertResult> => {
      if (stopped !== undefined) throw stopped
      try {
        await op.finish()
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name })
      }
      return { written, failures }
    }

    return { write, finish }
  }

  /**
   * Escape hatch: runs your callback with the native RavenDB `IDocumentSession`,
   * nothing hidden and nothing wrapped.
   *
   * Use it for anything this ODM deliberately does not model — richer queries,
   * patches, attachments, counters. Entities you load here are raw RavenDB
   * documents: no schema validation, no metadata stripping, no `id` attached.
   *
   * The session follows the usual policy: one opened here is saved and disposed
   * for you, and a session you pass in is left alone.
   *
   * @example
   * ```ts
   * const recent = await db.orders.raw(async (session) =>
   *   session
   *     .query({ collection: 'Orders' })
   *     .whereGreaterThan('total', 100)
   *     .all(),
   * )
   * ```
   */
  async raw<T>(
    fn: (session: IDocumentSession) => Promise<T>,
    opts: SessionOption = {},
  ): Promise<T> {
    return this.#withSession(opts.session, (s) => fn(s.raw))
  }
}

/** @internal */
export function createBoundCollection<S extends DocumentSchema>(
  definition: Collection<S>,
  binding: CollectionBinding,
): BoundCollection<S> {
  return new BoundCollection(definition, binding)
}

/**
 * Creates a collection definition with an exact RavenDB name and schema.
 *
 * Pass the definition to `createDatabase`; use the resulting `db.<key>` handle
 * for collection operations.
 *
 * @example
 * ```ts
 * const users = defineCollection({
 *   name: 'Users',                       // the RavenDB collection, verbatim
 *   schema: z.object({ name: z.string(), email: z.email() }),
 * })
 *
 * const db = createDatabase({ urls, database: 'app', collections: { users } })
 * await db.connect()
 * await db.users.create({ name: 'Maria', email: 'maria@example.com' })
 * ```
 *
 * @throws `RavenOdmError` with `invalid_configuration` — the name is empty, or
 * both `idGenerator` and `idStrategy` were given.
 */
export function defineCollection<S extends DocumentSchema>(
  options: CollectionOptions<S>,
): Collection<S> {
  return new Collection(options)
}
