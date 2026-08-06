import {
  DocumentStore,
  type IAuthOptions,
  type IDocumentSession,
  type IDocumentStore,
} from 'ravendb'
import type { CollectionBinding, CollectionDescriptor, OdmSession } from './collection'
import { normalizeRavenError, RavenOdmError } from './errors'

export interface DatabaseOptions {
  readonly urls: string[]
  readonly database: string
  readonly authOptions?: IAuthOptions | undefined
  /** Enables optimistic concurrency on every session raven-odm opens. Default: false. */
  readonly optimisticConcurrency?: boolean | undefined
  readonly collections: readonly {
    readonly name: string
    readonly descriptor: CollectionDescriptor
    bind(binding: CollectionBinding): void
  }[]
}
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

export class Database {
  readonly database: string
  #store: IDocumentStore | undefined
  #optimistic: boolean
  #options: DatabaseOptions
  /** descriptor -> exact collection name; read live by the findCollectionName override. */
  #registry = new Map<CollectionDescriptor, string>()
  /**
   * Entities currently undergoing HiLo id generation.
   * RavenDB resolves object-literal collection names via
   * conventions.getCollectionNameForEntity → getEntityTypeDescriptor (isType)
   * or findCollectionNameForObjectLiteral. ODM descriptors intentionally keep
   * isType() === false so plain objects are never sniffed into a collection;
   * this map is the adapter-side side-channel used only while generateDocumentId
   * runs (see connect() findCollectionNameForObjectLiteral hook).
   */
  #hiloEntities = new WeakMap<object, string>()

  constructor(options: DatabaseOptions) {
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

    // HiLo (conventions.generateDocumentId) calls getCollectionNameForEntity on a
    // plain object. With isType always false, RavenDB falls through to this hook
    // instead of matching an arbitrary registered ObjectLiteralDescriptor.
    const previousObjectLiteral = store.conventions.findCollectionNameForObjectLiteral
    store.conventions.findCollectionNameForObjectLiteral = (entity) =>
      this.#hiloEntities.get(entity) ??
      previousObjectLiteral?.(entity) ??
      (null as unknown as string)

    for (const collection of this.#options.collections) this.#register(store, collection)

    try {
      store.initialize()
    } catch (err) {
      store.dispose()
      throw normalizeRavenError(err, {})
    }
    this.#store = store
    return this
  }

  #register(store: IDocumentStore, collection: DatabaseOptions['collections'][number]): void {
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
      generateDocumentId: async (document) => {
        this.#hiloEntities.set(document, collection.name)
        try {
          return await store.conventions.generateDocumentId(this.database, document)
        } finally {
          this.#hiloEntities.delete(document)
        }
      },
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

export function createDatabase(options: DatabaseOptions): Database {
  return new Database(options)
}
