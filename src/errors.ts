import type { StandardSchemaV1 } from '@standard-schema/spec'

export type RavenOdmErrorCode =
  | 'validation_failed'
  | 'batch_validation_failed'
  | 'concurrency_conflict'
  | 'document_not_found'
  | 'not_connected'
  | 'already_bound'
  | 'invalid_configuration'
  | 'query_timeout'
  | 'raven_error'

export interface RavenOdmErrorContext {
  readonly collection?: string | undefined
  readonly documentId?: string | undefined
  readonly cause?: unknown
}

export class RavenOdmError extends Error {
  override readonly name: string = 'RavenOdmError'
  readonly code: RavenOdmErrorCode
  readonly collection: string | undefined
  readonly documentId: string | undefined

  constructor(code: RavenOdmErrorCode, message: string, ctx: RavenOdmErrorContext = {}) {
    super(message, ctx.cause === undefined ? undefined : { cause: ctx.cause })
    this.code = code
    this.collection = ctx.collection
    this.documentId = ctx.documentId
  }
}

export function issuePath(issue: StandardSchemaV1.Issue): string {
  if (!issue.path) return ''
  return issue.path
    .map((seg) => (typeof seg === 'object' ? seg.key : seg))
    .map(String)
    .join('.')
}

export function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((i) => {
      const p = issuePath(i)
      return p ? `${p}: ${i.message}` : i.message
    })
    .join('; ')
}

export class ValidationError extends RavenOdmError {
  override readonly name = 'ValidationError'
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>, ctx: RavenOdmErrorContext = {}) {
    super(
      'validation_failed',
      `Validation failed for collection "${ctx.collection ?? '?'}": ${formatIssues(issues)}`,
      ctx,
    )
    this.issues = issues
  }
}

export interface BatchValidationFailure {
  readonly index: number
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>
}

/** Thrown by `createMany` when one or more items fail validation; nothing is written. */
export class BatchValidationError extends RavenOdmError {
  override readonly name = 'BatchValidationError'
  readonly failures: ReadonlyArray<BatchValidationFailure>

  constructor(failures: ReadonlyArray<BatchValidationFailure>, ctx: RavenOdmErrorContext = {}) {
    const detail = failures.map((f) => `[${f.index}] ${formatIssues(f.issues)}`).join('; ')
    super(
      'batch_validation_failed',
      `Validation failed for ${failures.length} item(s) in collection "${ctx.collection ?? '?'}": ${detail}`,
      ctx,
    )
    this.failures = failures
  }
}

export class ConcurrencyConflictError extends RavenOdmError {
  override readonly name = 'ConcurrencyConflictError'
  constructor(message: string, ctx: RavenOdmErrorContext = {}) {
    super('concurrency_conflict', message, ctx)
  }
}

export class DocumentNotFoundError extends RavenOdmError {
  override readonly name = 'DocumentNotFoundError'
  constructor(ctx: RavenOdmErrorContext & { documentId: string }) {
    super('document_not_found', `Document "${ctx.documentId}" was not found`, ctx)
  }
}

export function normalizeRavenError(err: unknown, ctx: RavenOdmErrorContext): RavenOdmError {
  if (err instanceof RavenOdmError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'ConcurrencyException' || name === 'ClusterTransactionConcurrencyException') {
    return new ConcurrencyConflictError(message, { ...ctx, cause: err })
  }
  // The client's own type declarations list both spellings; map either defensively.
  if (
    (name === 'DocumentDoesNotExistException' || name === 'DocumentDoesNotExistsException') &&
    ctx.documentId
  ) {
    return new DocumentNotFoundError({ ...ctx, documentId: ctx.documentId, cause: err })
  }
  return new RavenOdmError('raven_error', message, { ...ctx, cause: err })
}

/**
 * Queries add one failure the other operations cannot produce: RavenDB gives up
 * waiting for a stale auto-index. That is a caller-tunable timeout, not a
 * provider fault, so it gets its own code instead of `raven_error`.
 */
export function normalizeQueryError(err: unknown, ctx: RavenOdmErrorContext): RavenOdmError {
  if (err instanceof RavenOdmError) return err
  if (err instanceof Error && err.name === 'TimeoutException') {
    return new RavenOdmError('query_timeout', err.message, { ...ctx, cause: err })
  }
  return normalizeRavenError(err, ctx)
}
