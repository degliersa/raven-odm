import {
  DocumentStore,
  type IAuthOptions,
  type IDocumentSession,
  type IDocumentStore,
} from 'ravendb'
import type { CollectionBinding, CollectionDescriptor, OdmSession } from './collection'
import { normalizeRavenError, RavenOdmError } from './errors'

/** What a database needs from a collection, kept structural. */
export interface BindableCollection {
  readonly name: string
  readonly descriptor: CollectionDescriptor
  bind(binding: CollectionBinding): void
}

/** Collections keyed by the name you will reach them under: `db.users`. */
export type CollectionMap = Readonly<Record<string, BindableCollection>>

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

/** A connected database, with its collections reachable as properties. */
export type RavenDatabase<TCollections extends CollectionMap> = Database<TCollections> &
  TCollections
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

    // Attached before connect() so `db.users` is the only way anyone needs to
    // reach a collection. Using one early still fails with not_connected, which
    // the collection itself reports.
    for (const [key, collection] of Object.entries(options.collections)) {
      if (RESERVED_COLLECTION_KEYS.has(key)) {
        throw new RavenOdmError(
          'invalid_configuration',
          `Collection key "${key}" is reserved by Database. Rename it, ` +
            `for example to "${key}Collection".`,
          { collection: collection.name },
        )
      }
      Object.defineProperty(this, key, { value: collection, enumerable: true })
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

    for (const collection of Object.values(this.#options.collections)) {
      this.#register(store, collection)
    }

    try {
      store.initialize()
    } catch (err) {
      store.dispose()
      throw normalizeRavenError(err, {})
    }
    this.#store = store
    return this
  }

  #register(store: IDocumentStore, collection: BindableCollection): void {
    if ([...this.#registry.values()].includes(collection.name)) {
      throw new RavenOdmError(
        'invalid_configuration',
        `Duplicate collection name "${collection.name}"`,
        { collection: collection.name },
      )
    }
    this.#registry.set(collection.descriptor, collection.name)
    store.conventions.registerEntityType(collection.descriptor as never)
    collection.bind({
      database: this.database,
      descriptor: collection.descriptor,
      openSession: () => this.openSession(),
      // The descriptor, not the document: RavenDB resolves the collection from
      // whatever it is handed, and the descriptor answers isType() for itself.
      // Passing the payload would require marking it so RavenDB could recognise
      // it, which is a private property on a document the caller owns.
      generateDocumentId: () =>
        store.conventions.generateDocumentId(this.database, collection.descriptor),
    })
  }

  openSession(): OdmSession {
    const raw = this.store.openSession()
    if (this.#optimistic) raw.advanced.useOptimisticConcurrency = true
    return new Session(raw)
  }

  async transaction<T>(fn: (session: OdmSession) => Promise<T>): Promise<T> {
    const session = this.openSession()
    try {
      const result = await fn(session)
      await session.saveChanges()
      return result
    } finally {
      session.dispose()
    }
  }

  async dispose(): Promise<void> {
    this.#store?.dispose()
    this.#store = undefined
  }
}

export function createDatabase<TCollections extends CollectionMap>(
  options: DatabaseOptions<TCollections>,
): RavenDatabase<TCollections> {
  return new Database(options) as RavenDatabase<TCollections>
}
