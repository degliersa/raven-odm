import {
  DocumentStore,
  type IAuthOptions,
  type IDocumentSession,
  type IDocumentStore,
} from 'ravendb'
import {
  createBoundCollection,
  type BoundCollection,
  type Collection,
  type CollectionBinding,
  type CollectionDescriptor,
  type DocumentSchema,
  type OdmSession,
} from './collection'
import { normalizeRavenError, RavenOdmError } from './errors'

/** Collections keyed by the name you will reach them under: `db.users`. */
export type CollectionMap = Readonly<Record<string, Collection<DocumentSchema>>>

/**
 * Keys a collection cannot use, because reaching it through the database would
 * mean shadowing the database's own API.
 */
export type ReservedCollectionKey =
  | 'database'
  | 'store'
  | 'connect'
  | 'dispose'
  | 'transaction'
  | 'openSession'

const RESERVED_COLLECTION_KEYS: ReadonlySet<string> = new Set([
  'database',
  'store',
  'connect',
  'dispose',
  'transaction',
  'openSession',
] satisfies ReservedCollectionKey[])

export interface DatabaseOptions<TCollections extends CollectionMap = CollectionMap> {
  readonly urls: string[]
  readonly database: string
  readonly authOptions?: IAuthOptions | undefined
  /** Enables optimistic concurrency on every session raven-odm opens. Default: false. */
  readonly optimisticConcurrency?: boolean | undefined
  /**
   * The object key becomes the accessor (`db.users`); the RavenDB collection
   * name stays exactly what `defineCollection({ name })` says. Nothing is
   * pluralized or otherwise rewritten.
   */
  readonly collections: TCollections & {
    readonly [K in Extract<keyof TCollections, ReservedCollectionKey>]: never
  }
}

/** Database-owned handles keyed like their collection definitions. */
export type BoundCollectionMap<TCollections extends CollectionMap> = {
  readonly [K in keyof TCollections]: TCollections[K] extends Collection<infer S>
    ? BoundCollection<S>
    : never
}

/** A connected database, with its database-owned collection handles. */
export type RavenDatabase<TCollections extends CollectionMap> = Database<TCollections> &
  BoundCollectionMap<TCollections>

class Session implements OdmSession {
  constructor(readonly raw: IDocumentSession) {}

  async saveChanges(): Promise<void> {
    try {
      await this.raw.saveChanges()
    } catch (err) {
      throw normalizeRavenError(err, {})
    }
  }

  dispose(): void {
    this.raw.dispose()
  }
}

export class Database<TCollections extends CollectionMap = CollectionMap> {
  readonly database: string
  #store: IDocumentStore | undefined
  #optimistic: boolean
  #options: DatabaseOptions<TCollections>
  /** descriptor -> exact collection name; read live by the findCollectionName override. */
  #registry = new Map<CollectionDescriptor, string>()

  constructor(options: DatabaseOptions<TCollections>) {
    if (!options.database) {
      throw new RavenOdmError(
        'invalid_configuration',
        'createDatabase requires a non-empty "database"',
      )
    }
    if (options.urls.length === 0) {
      throw new RavenOdmError(
        'invalid_configuration',
        'createDatabase requires at least one RavenDB URL',
      )
    }
    this.#options = options
    this.database = options.database
    this.#optimistic = options.optimisticConcurrency ?? false

    // Each accessor receives its own handle and binding. The definition remains
    // immutable and can be shared with another Database instance.
    for (const [key, collection] of Object.entries(options.collections)) {
      if (RESERVED_COLLECTION_KEYS.has(key)) {
        throw new RavenOdmError(
          'invalid_configuration',
          `Collection key "${key}" is reserved by Database. Rename it, ` +
            `for example to "${key}Collection".`,
          { collection: collection.name },
        )
      }
      const binding: CollectionBinding = {
        database: this.database,
        descriptor: collection.descriptor,
        runInSession: (given, fn) => this.#runInSession(given, fn),
        // These closures read the current store, so reconnecting this database
        // keeps every handle usable without changing the shared definition.
        generateDocumentId: () =>
          this.store.conventions.generateDocumentId(this.database, collection.descriptor),
        bulkInsert: (options) =>
          options
            ? this.store.bulkInsert(this.database, options)
            : this.store.bulkInsert(this.database),
      }
      Object.defineProperty(this, key, {
        value: createBoundCollection(collection, binding),
        enumerable: true,
      })
    }
  }

  get store(): IDocumentStore {
    if (!this.#store) {
      throw new RavenOdmError(
        'not_connected',
        'Database is not connected. Call await db.connect() first.',
      )
    }
    return this.#store
  }

  /**
   * Registers every configured collection definition and initializes the RavenDB client.
   * Idempotent: calling it again while connected returns immediately.
   *
   * It does **not** reach the server. The client connects on the first real
   * operation, so a wrong URL or an unreachable host surfaces at your first
   * `create()` or `findMany()`, not here.
   *
   * @example
   * ```ts
   * await db.connect()
   * process.on('SIGTERM', () => void db.dispose())
   * ```
   *
   * @throws `RavenOdmError` with `invalid_configuration` — two collections share
   * a RavenDB name.
   */
  async connect(): Promise<this> {
    if (this.#store) return this
    const store = new DocumentStore(
      this.#options.urls,
      this.#options.database,
      this.#options.authOptions as IAuthOptions,
    )

    // MUST happen before initialize(): the setter throws once conventions freeze.
    // The closure reads #registry live, so collections may register at any time.
    const fallback = store.conventions.findCollectionName
    store.conventions.findCollectionName = (descriptor) =>
      this.#registry.get(descriptor as CollectionDescriptor) ?? fallback(descriptor)

    try {
      for (const collection of Object.values(this.#options.collections)) {
        this.#register(store, collection)
      }
      store.initialize()
    } catch (err) {
      // Leave nothing half-registered: a failed connect must be recoverable by
      // fixing the configuration and calling connect() again.
      store.dispose()
      this.#clearRegistry()
      throw normalizeRavenError(err, {})
    }
    this.#store = store
    return this
  }

  #register(store: IDocumentStore, collection: Collection<DocumentSchema>): void {
    if ([...this.#registry.values()].includes(collection.name)) {
      throw new RavenOdmError(
        'invalid_configuration',
        `Duplicate collection name "${collection.name}"`,
        { collection: collection.name },
      )
    }
    this.#registry.set(collection.descriptor, collection.name)
    store.conventions.registerEntityType(collection.descriptor as never)
  }

  /**
   * Opens a session you own. Nothing is written until you call `saveChanges()`,
   * and you are responsible for `dispose()` — disposing first discards the
   * pending work.
   *
   * Prefer {@link transaction} unless you need the session to outlive one block.
   *
   * @example
   * ```ts
   * const session = db.openSession()
   * try {
   *   await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
   *   await session.saveChanges()
   * } finally {
   *   session.dispose()
   * }
   * ```
   */
  openSession(): OdmSession {
    const raw = this.store.openSession()
    if (this.#optimistic) raw.advanced.useOptimisticConcurrency = true
    return new Session(raw)
  }

  /**
   * Runs `fn` in one Unit of Work: a session is opened, your work is committed
   * once at the end, and the session is disposed either way.
   *
   * Writes across several collections land together — pass the session to each
   * call. If `fn` throws, nothing is committed.
   *
   * @example
   * ```ts
   * await db.transaction(async (session) => {
   *   const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
   *   await db.orders.create({ userId: user.id, status: 'pending', total: 42 }, { session })
   * })
   * ```
   *
   * @throws `ConcurrencyConflictError` — a stale write, when the database was
   * created with `optimisticConcurrency: true`.
   */
  async transaction<T>(fn: (session: OdmSession) => Promise<T>): Promise<T> {
    return this.#runInSession(undefined, (session) => fn(session))
  }

  /**
   * The single Unit of Work policy: a caller-owned session is reused untouched, a
   * library-owned session is saved after successful work and disposed either way.
   * Handles also require this database to be connected before using an external session.
   */
  async #runInSession<T>(
    given: OdmSession | undefined,
    fn: (session: OdmSession, owned: boolean) => Promise<T>,
  ): Promise<T> {
    if (given && !this.#store) {
      throw new RavenOdmError(
        'not_connected',
        'Database is not connected. Call await db.connect() first.',
      )
    }
    if (given) return fn(given, false)
    const session = this.openSession()
    try {
      const result = await fn(session, true)
      await session.saveChanges()
      return result
    } finally {
      session.dispose()
    }
  }

  /**
   * Closes the client and clears this database's collection registration.
   *
   * Call it on shutdown: the client holds sockets and timers, so a process that
   * finishes without disposing stays alive. Do **not** call it per request in a
   * serverless handler — that discards the cluster topology and pays the
   * handshake again on the next invocation.
   *
   * The database can be connected again afterwards, and its handles keep
   * working against the new connection.
   *
   * @example
   * ```ts
   * process.on('SIGTERM', () => void db.dispose())
   * ```
   */
  async dispose(): Promise<void> {
    this.#store?.dispose()
    this.#store = undefined
    this.#clearRegistry()
  }

  /** Clears registration metadata owned by this database instance. */
  #clearRegistry(): void {
    this.#registry.clear()
  }
}

/**
 * Creates a database over a named set of collections, typed so each key becomes
 * a property: `db.users`, `db.orders`.
 *
 * The key names the accessor only — the RavenDB collection stays exactly the
 * `name` given to `defineCollection`, never pluralized or rewritten. Nothing
 * connects until you call {@link Database.connect}.
 *
 * @example
 * ```ts
 * const db = createDatabase({
 *   urls: [process.env.RAVENDB_URL as string],
 *   database: 'app',
 *   collections: {
 *     users: defineCollection({ name: 'Users', schema: userSchema }),
 *   },
 *   optimisticConcurrency: true, // optional: stale writes raise instead of winning
 * })
 *
 * await db.connect()
 * const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
 * ```
 *
 * @throws `RavenOdmError` with `invalid_configuration` — no database name, no
 * URL, or a collection key that would shadow a `Database` member such as
 * `connect` or `transaction`.
 */
export function createDatabase<TCollections extends CollectionMap>(
  options: DatabaseOptions<TCollections>,
): RavenDatabase<TCollections> {
  return new Database(options) as RavenDatabase<TCollections>
}
