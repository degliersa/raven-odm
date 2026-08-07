import { randomUUID } from 'node:crypto'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { DocumentSchema, IdGenerator } from './collection'
import { normalizeRavenError, RavenOdmError } from './errors'

/** Everything an id strategy is allowed to know. Deliberately not the payload:
 * an id depends on the document's contents only when the caller says so, through
 * `idGenerator`. */
export interface IdResolution<S extends DocumentSchema> {
  readonly document: StandardSchemaV1.InferOutput<S>
  readonly collection: string
  readonly database: string
  readonly sessionProvided: boolean
  /** Reserves the next RavenDB HiLo id for this collection. */
  reserveId(): Promise<string>
}

/**
 * Produces the id a document will be stored under.
 *
 * Some ids are final ('uuid', 'hilo', a custom generator) and some are a
 * RavenDB identity prefix that the server expands during `saveChanges()`.
 * `create()` reads the id back from the session either way, so a strategy does
 * not have to say which kind it returned.
 */
export type IdStrategy<S extends DocumentSchema> = (ctx: IdResolution<S>) => Promise<string>

export interface IdStrategyOptions<S extends DocumentSchema> {
  readonly idStrategy: 'uuid' | 'hilo' | 'server' | undefined
  readonly idGenerator: IdGenerator<S> | undefined
}

const uuid: IdStrategy<DocumentSchema> = async ({ collection }) => `${collection}/${randomUUID()}`

const hilo: IdStrategy<DocumentSchema> = async ({ collection, reserveId }) => {
  try {
    return await reserveId()
  } catch (err) {
    throw normalizeRavenError(err, { collection })
  }
}

const server: IdStrategy<DocumentSchema> = async ({ collection, sessionProvided }) => {
  if (sessionProvided) {
    throw new RavenOdmError(
      'invalid_configuration',
      'Collection "' +
        collection +
        "\" uses idStrategy 'server', whose id is only assigned by " +
        "saveChanges(). Pass an idGenerator or use idStrategy 'uuid' to create documents inside " +
        'an external session.',
      { collection },
    )
  }
  // RavenDB identity prefix -> Users/1-A
  return `${collection}/`
}

function custom<S extends DocumentSchema>(generator: IdGenerator<S>): IdStrategy<S> {
  return async ({ document, collection, database }) => generator({ document, collection, database })
}

/** Chosen once, when the collection is defined, so `create()` never branches. */
export function selectIdStrategy<S extends DocumentSchema>(
  options: IdStrategyOptions<S>,
): IdStrategy<S> {
  if (options.idGenerator) return custom(options.idGenerator)
  if (options.idStrategy === 'hilo') return hilo
  if (options.idStrategy === 'server') return server
  return uuid
}
