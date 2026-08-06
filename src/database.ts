import type { IAuthOptions, IDocumentStore } from 'ravendb'
import type { CollectionBinding, OdmSession } from './collection'
import { RavenOdmError } from './errors'
import type {
  CollectionDescriptor,
  DatabaseAdapter,
  DatabaseAdapterFactory,
} from './persistence'
import { createRavenDatabaseAdapter } from './ravendb-adapter'

export interface DatabaseOptions {
  readonly urls: string[]
  readonly database: string
  readonly authOptions?: IAuthOptions | undefined
  /** Enables optimistic concurrency on every session raven-odm opens. Default: false. */
  readonly optimisticConcurrency?: boolean | undefined
  readonly adapterFactory?: DatabaseAdapterFactory | undefined
  readonly collections: readonly {
    readonly name: string
    readonly descriptor: CollectionDescriptor
    bind(binding: CollectionBinding): void
  }[]
}

export class Database {
  readonly database: string
  #adapter: DatabaseAdapter | undefined
  #optimistic: boolean
  #options: DatabaseOptions
  #registry = new Map<CollectionDescriptor, string>()

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
    if (!this.#adapter) {
      throw new RavenOdmError(
        'not_connected',
        'Database is not connected. Call await db.connect() first.',
      )
    }
    return this.#adapter.raw as IDocumentStore
  }

  async connect(): Promise<this> {
    if (this.#adapter) return this
    const factory = this.#options.adapterFactory ?? createRavenDatabaseAdapter
    const adapter = factory({
      urls: this.#options.urls,
      database: this.#options.database,
      authOptions: this.#options.authOptions as IAuthOptions | undefined,
      optimisticConcurrency: this.#optimistic,
    })
    try {
      for (const collection of this.#options.collections) this.#register(adapter, collection)
    } catch (err) {
      await adapter.dispose()
      throw err
    }
    this.#adapter = adapter
    return this
  }

  #register(adapter: DatabaseAdapter, collection: DatabaseOptions['collections'][number]): void {
    if ([...this.#registry.values()].includes(collection.name)) {
      throw new RavenOdmError(
        'invalid_configuration',
        `Duplicate collection name "${collection.name}"`,
        { collection: collection.name },
      )
    }
    this.#registry.set(collection.descriptor, collection.name)
    adapter.register(collection.descriptor, collection.name)
    collection.bind({
      database: this.database,
      descriptor: collection.descriptor,
      openSession: () => this.openSession(),
      generateDocumentId: (document) =>
        adapter.generateDocumentId(this.database, document, collection.descriptor),
    })
  }

  openSession(): OdmSession {
    if (!this.#adapter) {
      throw new RavenOdmError(
        'not_connected',
        'Database is not connected. Call await db.connect() first.',
      )
    }
    return this.#adapter.openSession() as OdmSession
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
    await this.#adapter?.dispose()
    this.#adapter = undefined
  }
}

export function createDatabase(options: DatabaseOptions): Database {
  return new Database(options)
}
