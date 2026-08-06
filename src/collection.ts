import { randomUUID } from 'node:crypto'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { IDocumentSession } from 'ravendb'
import { normalizeRavenError, RavenOdmError } from './errors'
import { validate } from './validate'

const METADATA_KEY = '@metadata'

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
   * - 'server': RavenDB identity `<name>/1-A`; needs the save to resolve, so it is
   *   rejected when a `session` is supplied.
   */
  readonly idStrategy?: 'uuid' | 'server' | undefined
  /** Full control. Takes precedence over idStrategy. */
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
}

export interface OdmSession {
  readonly raw: IDocumentSession
  saveChanges(): Promise<void>
  dispose(): void
}

/** Set by createDatabase(); a collection is inert until then. */
export interface CollectionBinding {
  readonly database: string
  readonly descriptor: CollectionDescriptor
  openSession(): OdmSession
}

export class Collection<S extends DocumentSchema> {
  readonly name: string
  readonly schema: S
  readonly descriptor: CollectionDescriptor

  #idGenerator: IdGenerator<S> | undefined
  #idStrategy: 'uuid' | 'server'
  #validateOnRead: boolean
  #binding: CollectionBinding | undefined

  constructor(options: CollectionOptions<S>) {
    if (!options.name) {
      throw new RavenOdmError(
        'invalid_configuration',
        'defineCollection requires a non-empty "name"',
      )
    }
    this.name = options.name
    this.schema = options.schema
    this.#idGenerator = options.idGenerator
    this.#idStrategy = options.idStrategy ?? 'uuid'
    this.#validateOnRead = options.validateOnRead ?? false
    // isType always false: raven-odm passes documentType explicitly on every call,
    // so the client must never shape-sniff a plain object into the wrong collection.
    this.descriptor = { name: options.name, isType: () => false, construct: (dto) => dto }
  }

  /** @internal */
  bind(binding: CollectionBinding): void {
    if (this.#binding) {
      throw new RavenOdmError(
        'already_bound',
        `Collection "${this.name}" is already bound to a database`,
        { collection: this.name },
      )
    }
    this.#binding = binding
  }

  #bound(): CollectionBinding {
    if (!this.#binding) {
      throw new RavenOdmError(
        'not_connected',
        'Collection "' +
          this.name +
          '" is not attached to a database. ' +
          'Pass it to createDatabase({ collections: [...] }) and await db.connect().',
        { collection: this.name },
      )
    }
    return this.#binding
  }

  /** Strip client/server bookkeeping so the user schema never sees it. */
  #strip(entity: Record<string, unknown>): { body: Record<string, unknown>; id: string } {
    const { [METADATA_KEY]: _meta, id, ...rest } = entity
    return { body: rest, id: String(id) }
  }

  async #withSession<T>(
    given: OdmSession | undefined,
    fn: (s: OdmSession) => Promise<T>,
  ): Promise<T> {
    if (given) return fn(given)
    const session = this.#bound().openSession()
    try {
      const result = await fn(session)
      await session.saveChanges()
      return result
    } finally {
      session.dispose()
    }
  }

  async create(data: StandardSchemaV1.InferInput<S>, opts: SessionOption = {}): Promise<Doc<S>> {
    const binding = this.#bound()
    const value = await validate(this.schema, data, { collection: this.name })
    const payload = { ...(value as Record<string, unknown>) }
    delete payload.id

    let id: string | undefined
    if (this.#idGenerator) {
      id = await this.#idGenerator({
        document: value,
        collection: this.name,
        database: binding.database,
      })
    } else if (this.#idStrategy === 'uuid') {
      id = `${this.name}/${randomUUID()}`
    } else {
      if (opts.session) {
        throw new RavenOdmError(
          'invalid_configuration',
          'Collection "' +
            this.name +
            "\" uses idStrategy 'server', whose id is only assigned by " +
            "saveChanges(). Pass an idGenerator or use idStrategy 'uuid' to create documents inside " +
            'an external session.',
          { collection: this.name },
        )
      }
      id = `${this.name}/` // RavenDB identity prefix -> Users/1-A
    }

    // The identity-prefix id only exists after the flush, so read it back from the
    // session instead of trusting the value passed in.
    const run = async (s: OdmSession, flush: boolean): Promise<Doc<S>> => {
      try {
        await s.raw.store(payload, id, binding.descriptor as never)
        if (flush) await s.saveChanges()
      } catch (err) {
        throw normalizeRavenError(err, { collection: this.name, documentId: id })
      }
      return { ...value, id: s.raw.advanced.getDocumentId(payload) ?? id } as Doc<S>
    }

    if (opts.session) return run(opts.session, false)
    const session = this.#bound().openSession()
    try {
      return await run(session, true)
    } finally {
      session.dispose()
    }
  }

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

  async findMany(opts: FindManyOptions<S> = {}): Promise<Doc<S>[]> {
    const binding = this.#bound()
    return this.#withSession(opts.session, async (s) => {
      let q = s.raw.query<Record<string, unknown>>({
        collection: this.name,
        documentType: binding.descriptor as never,
      })
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
      if (opts.skip !== undefined) q = q.skip(opts.skip)
      if (opts.take !== undefined) q = q.take(opts.take)
      const rows = await q.all()
      return Promise.all(rows.map((r) => this.#hydrate(r)))
    })
  }

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

  /** Escape hatch: full native session, nothing hidden. */
  async raw<T>(
    fn: (session: IDocumentSession) => Promise<T>,
    opts: SessionOption = {},
  ): Promise<T> {
    return this.#withSession(opts.session, (s) => fn(s.raw))
  }
}

export function defineCollection<S extends DocumentSchema>(
  options: CollectionOptions<S>,
): Collection<S> {
  return new Collection(options)
}
