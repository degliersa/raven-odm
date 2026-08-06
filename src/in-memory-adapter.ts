import type { IDocumentSession, IDocumentStore } from 'ravendb'
import type {
  CollectionDescriptor,
  DatabaseAdapter,
  DatabaseAdapterOptions,
  RavenQueryPort,
  RavenSessionPort,
} from './persistence'

const METADATA_KEY = '@metadata'

interface StoredDocument {
  readonly entity: Record<string, unknown>
  readonly version: number
}

function cloneEntity(entity: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(entity)
}

function collectionNameOf(entity: Record<string, unknown>): string | undefined {
  const metadata = entity[METADATA_KEY]
  if (typeof metadata !== 'object' || metadata === null) return undefined
  const collection = (metadata as Record<string, unknown>)['@collection']
  return typeof collection === 'string' ? collection : undefined
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

class InMemoryQuery implements RavenQueryPort {
  readonly #session: InMemorySessionAdapter
  readonly #collection: string
  readonly #filters: ReadonlyArray<readonly [string, unknown]>
  readonly #ordering: { readonly field: string; readonly descending: boolean } | undefined
  readonly #skip: number
  readonly #take: number | undefined

  constructor(
    session: InMemorySessionAdapter,
    collection: string,
    filters: ReadonlyArray<readonly [string, unknown]> = [],
    ordering: { readonly field: string; readonly descending: boolean } | undefined = undefined,
    skip = 0,
    take: number | undefined = undefined,
  ) {
    this.#session = session
    this.#collection = collection
    this.#filters = filters
    this.#ordering = ordering
    this.#skip = skip
    this.#take = take
  }

  andAlso(): RavenQueryPort {
    return this
  }

  whereEquals(field: string, value: unknown): RavenQueryPort {
    return new InMemoryQuery(this.#session, this.#collection, [...this.#filters, [field, value]])
  }

  orderBy(field: string): RavenQueryPort {
    return new InMemoryQuery(this.#session, this.#collection, this.#filters, {
      field,
      descending: false,
    })
  }

  orderByDescending(field: string): RavenQueryPort {
    return new InMemoryQuery(this.#session, this.#collection, this.#filters, {
      field,
      descending: true,
    })
  }

  skip(count: number): RavenQueryPort {
    return new InMemoryQuery(
      this.#session,
      this.#collection,
      this.#filters,
      this.#ordering,
      count,
      this.#take,
    )
  }

  take(count: number): RavenQueryPort {
    return new InMemoryQuery(
      this.#session,
      this.#collection,
      this.#filters,
      this.#ordering,
      this.#skip,
      count,
    )
  }

  async all(): Promise<Record<string, unknown>[]> {
    let rows = this.#session.queryCollection(this.#collection)
    for (const [field, value] of this.#filters) {
      rows = rows.filter((row) => row[field] === value)
    }
    if (this.#ordering) {
      const ordering = this.#ordering
      rows = [...rows].sort((left, right) => {
        const order = compareValues(left[ordering.field], right[ordering.field])
        return ordering.descending ? -order : order
      })
    }
    if (this.#skip > 0) rows = rows.slice(this.#skip)
    if (this.#take !== undefined) rows = rows.slice(0, this.#take)
    return rows.map(cloneEntity)
  }
}

class InMemorySessionAdapter implements RavenSessionPort<IDocumentSession> {
  readonly raw: IDocumentSession
  readonly #adapter: InMemoryDatabaseAdapter
  readonly #tracked = new Map<string, Record<string, unknown>>()
  readonly #deleted = new Set<string>()
  readonly #documentIds = new WeakMap<object, string>()

  constructor(adapter: InMemoryDatabaseAdapter) {
    this.#adapter = adapter
    this.raw = {
      load: (id: string) =>
        this.load(id, { name: '', isType: () => true, construct: (dto) => dto }),
      store: (entity: Record<string, unknown>, id?: string) =>
        this.store(entity, id, {
          name: String(id?.split('/')[0] ?? ''),
          isType: () => true,
          construct: (dto) => dto,
        }),
      delete: (id: string) => this.delete(id),
      query: ({ collection }: { collection: string }) =>
        new InMemoryQuery(this, collection) as unknown,
      saveChanges: () => this.saveChanges(),
      dispose: () => this.dispose(),
      advanced: {
        getDocumentId: (entity: object) => this.getDocumentId(entity),
      },
    } as unknown as IDocumentSession
  }

  store(
    entity: Record<string, unknown>,
    id: string | undefined,
    descriptor: CollectionDescriptor,
  ): void {
    const resolvedId = this.#adapter.resolveId(id, descriptor)
    const tracked = {
      ...cloneEntity(entity),
      id: resolvedId,
      [METADATA_KEY]: { '@collection': descriptor.name },
    }
    this.#tracked.set(resolvedId, tracked)
    this.#deleted.delete(resolvedId)
    this.#documentIds.set(entity, resolvedId)
    this.#documentIds.set(tracked, resolvedId)
  }

  async load(
    id: string,
    descriptor: CollectionDescriptor,
  ): Promise<Record<string, unknown> | null> {
    if (this.#deleted.has(id)) return null
    const tracked = this.#tracked.get(id)
    if (tracked) return tracked
    const stored = this.#adapter.documents.get(id)
    if (!stored) return null
    if (descriptor.name && collectionNameOf(stored.entity) !== descriptor.name) {
      return null
    }
    const entity = cloneEntity(stored.entity)
    this.#tracked.set(id, entity)
    this.#documentIds.set(entity, id)
    return entity
  }

  query(_descriptor: CollectionDescriptor, collection: string): RavenQueryPort {
    return new InMemoryQuery(this, collection)
  }

  delete(id: string): void {
    this.#tracked.delete(id)
    this.#deleted.add(id)
  }

  getDocumentId(entity: object): string | undefined {
    return this.#documentIds.get(entity)
  }

  queryCollection(collection: string): Record<string, unknown>[] {
    const ids = new Set<string>()
    const rows: Record<string, unknown>[] = []

    for (const [id, stored] of this.#adapter.documents) {
      ids.add(id)
      if (this.#deleted.has(id)) continue
      const tracked = this.#tracked.get(id)
      if (tracked) {
        if (collectionNameOf(tracked) === collection) rows.push(tracked)
        continue
      }
      if (collectionNameOf(stored.entity) === collection) {
        rows.push(cloneEntity(stored.entity))
      }
    }

    for (const [id, tracked] of this.#tracked) {
      if (ids.has(id) || this.#deleted.has(id)) continue
      if (collectionNameOf(tracked) === collection) rows.push(tracked)
    }

    return rows
  }

  async saveChanges(): Promise<void> {
    for (const id of this.#deleted) {
      this.#adapter.documents.delete(id)
    }
    for (const [id, entity] of this.#tracked) {
      if (this.#deleted.has(id)) continue
      const current = this.#adapter.documents.get(id)
      this.#adapter.documents.set(id, {
        entity: cloneEntity(entity),
        version: (current?.version ?? 0) + 1,
      })
    }
  }

  dispose(): void {
    this.#tracked.clear()
    this.#deleted.clear()
  }
}

export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly raw: IDocumentStore
  readonly documents = new Map<string, StoredDocument>()
  readonly #counters = new Map<string, number>()

  constructor(_options: DatabaseAdapterOptions) {
    this.raw = {} as IDocumentStore
  }

  register(_descriptor: CollectionDescriptor, _name: string): void {}

  openSession(): RavenSessionPort<IDocumentSession> {
    return new InMemorySessionAdapter(this)
  }

  async generateDocumentId(
    _database: string,
    _document: object,
    descriptor: CollectionDescriptor,
  ): Promise<string> {
    return this.resolveId(`${descriptor.name}/`, descriptor)
  }

  resolveId(id: string | undefined, descriptor: CollectionDescriptor): string {
    if (id && !id.endsWith('/')) return id
    const next = (this.#counters.get(descriptor.name) ?? 0) + 1
    this.#counters.set(descriptor.name, next)
    return `${descriptor.name}/${next}-A`
  }

  seed(id: string, collection: string, entity: Record<string, unknown>): void {
    this.documents.set(id, {
      entity: {
        ...cloneEntity(entity),
        id,
        [METADATA_KEY]: { '@collection': collection },
      },
      version: 1,
    })
  }

  dispose(): void {
    this.documents.clear()
  }
}

export function createInMemoryDatabaseAdapter(options: DatabaseAdapterOptions): DatabaseAdapter {
  return new InMemoryDatabaseAdapter(options)
}
