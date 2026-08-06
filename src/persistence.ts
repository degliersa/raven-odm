import type { IAuthOptions, IDocumentSession, IDocumentStore } from 'ravendb'

/** ravendb's ObjectLiteralDescriptor, kept structural to avoid importing internals. */
export interface CollectionDescriptor {
  readonly name: string
  isType(obj: object): boolean
  construct(dto: object): object
}

export interface RavenQueryPort {
  andAlso(): RavenQueryPort
  whereEquals(field: string, value: unknown): RavenQueryPort
  orderBy(field: string): RavenQueryPort
  orderByDescending(field: string): RavenQueryPort
  skip(count: number): RavenQueryPort
  take(count: number): RavenQueryPort
  all(): Promise<Record<string, unknown>[]>
}

export interface RavenSessionPort<TRaw = IDocumentSession> {
  readonly raw: TRaw
  store(
    entity: Record<string, unknown>,
    id: string | undefined,
    descriptor: CollectionDescriptor,
  ): Promise<void> | void
  load(
    id: string,
    descriptor: CollectionDescriptor,
  ): Promise<Record<string, unknown> | null>
  query(descriptor: CollectionDescriptor, collection: string): RavenQueryPort
  delete(id: string): Promise<void> | void
  getDocumentId(entity: object): string | undefined
  saveChanges(): Promise<void>
  dispose(): void
}

export interface DatabaseAdapterOptions {
  readonly urls: string[]
  readonly database: string
  readonly authOptions?: IAuthOptions | undefined
  readonly optimisticConcurrency: boolean
}

export interface DatabaseAdapter<
  TRawStore = IDocumentStore,
  TRawSession = IDocumentSession,
> {
  readonly raw: TRawStore
  register(descriptor: CollectionDescriptor, name: string): void
  openSession(): RavenSessionPort<TRawSession>
  generateDocumentId(
    database: string,
    document: object,
    descriptor: CollectionDescriptor,
  ): Promise<string>
  dispose(): Promise<void> | void
}

export type DatabaseAdapterFactory = (
  options: DatabaseAdapterOptions,
) => DatabaseAdapter
