import {
  DocumentStore,
  type IAuthOptions,
  type IDocumentSession,
  type IDocumentStore,
} from 'ravendb'
import { normalizeRavenError } from './errors'
import type {
  CollectionDescriptor,
  DatabaseAdapter,
  DatabaseAdapterOptions,
  RavenQueryPort,
  RavenSessionPort,
} from './persistence'

interface RavenDocumentQuery {
  andAlso(): RavenDocumentQuery
  whereEquals(field: string, value: unknown): RavenDocumentQuery
  orderBy(field: string): RavenDocumentQuery
  orderByDescending(field: string): RavenDocumentQuery
  skip(count: number): RavenDocumentQuery
  take(count: number): RavenDocumentQuery
  all(): Promise<Record<string, unknown>[]>
}

class RavenQueryAdapter implements RavenQueryPort {
  constructor(readonly raw: RavenDocumentQuery) {}

  andAlso(): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.andAlso())
  }

  whereEquals(field: string, value: unknown): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.whereEquals(field, value))
  }

  orderBy(field: string): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.orderBy(field))
  }

  orderByDescending(field: string): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.orderByDescending(field))
  }

  skip(count: number): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.skip(count))
  }

  take(count: number): RavenQueryPort {
    return new RavenQueryAdapter(this.raw.take(count))
  }

  all(): Promise<Record<string, unknown>[]> {
    return this.raw.all()
  }
}

class RavenSessionAdapter implements RavenSessionPort<IDocumentSession> {
  constructor(
    readonly raw: IDocumentSession,
    readonly optimisticConcurrency: boolean,
  ) {
    if (optimisticConcurrency) {
      this.raw.advanced.useOptimisticConcurrency = true
    }
  }

  store(
    entity: Record<string, unknown>,
    id: string | undefined,
    descriptor: CollectionDescriptor,
  ): void {
    this.raw.store(entity, id, descriptor as never)
  }

  load(
    id: string,
    descriptor: CollectionDescriptor,
  ): Promise<Record<string, unknown> | null> {
    return this.raw.load<Record<string, unknown>>(id, descriptor as never)
  }

  query(descriptor: CollectionDescriptor, collection: string): RavenQueryPort {
    const raw = this.raw.query<Record<string, unknown>>({
      collection,
      documentType: descriptor as never,
    }) as unknown as RavenDocumentQuery
    return new RavenQueryAdapter(raw)
  }

  delete(id: string): void {
    this.raw.delete(id)
  }

  getDocumentId(entity: object): string | undefined {
    return this.raw.advanced.getDocumentId(entity)
  }

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

export class RavenDatabaseAdapter implements DatabaseAdapter {
  readonly raw: IDocumentStore
  readonly #database: string
  readonly #optimisticConcurrency: boolean
  readonly #registry = new Map<CollectionDescriptor, string>()

  constructor(options: DatabaseAdapterOptions) {
    this.#database = options.database
    this.#optimisticConcurrency = options.optimisticConcurrency

    const store = new DocumentStore(
      options.urls,
      options.database,
      options.authOptions as IAuthOptions,
    )

    const fallback = store.conventions.findCollectionName
    store.conventions.findCollectionName = (descriptor) =>
      this.#registry.get(descriptor as CollectionDescriptor) ?? fallback(descriptor)

    try {
      store.initialize()
    } catch (err) {
      store.dispose()
      throw normalizeRavenError(err, {})
    }

    this.raw = store
  }

  register(descriptor: CollectionDescriptor, name: string): void {
    this.#registry.set(descriptor, name)
    this.raw.conventions.registerEntityType(descriptor as never)
  }

  openSession(): RavenSessionPort<IDocumentSession> {
    return new RavenSessionAdapter(this.raw.openSession(), this.#optimisticConcurrency)
  }

  generateDocumentId(
    database: string,
    document: object,
    _descriptor: CollectionDescriptor,
  ): Promise<string> {
    return this.raw.conventions.generateDocumentId(database || this.#database, document)
  }

  dispose(): void {
    this.raw.dispose()
  }
}

export function createRavenDatabaseAdapter(
  options: DatabaseAdapterOptions,
): DatabaseAdapter {
  return new RavenDatabaseAdapter(options)
}
