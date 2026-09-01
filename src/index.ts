export type { CertificateFromBase64Options } from './certificate'
export { certificateFromBase64 } from './certificate'
export type {
  BulkInsertHandle,
  BulkInsertOptionsOdm,
  BulkInsertResult,
  CollectionDescriptor,
  CollectionOptions,
  CountOptions,
  Doc,
  DocumentSchema,
  FindManyOptions,
  FindOneOptions,
  FindPageOptions,
  FindPageResult,
  IdGenerator,
  IdGeneratorContext,
  NumericKeys,
  OdmSession,
  SessionOption,
} from './collection'
export { BoundCollection, Collection, defineCollection } from './collection'
export type {
  BoundCollectionMap,
  CollectionMap,
  DatabaseOptions,
  RavenDatabase,
  ReservedCollectionKey,
} from './database'
export { createDatabase, Database } from './database'
export type { BatchValidationFailure, RavenOdmErrorCode, RavenOdmErrorContext } from './errors'
export {
  BatchValidationError,
  ConcurrencyConflictError,
  DocumentNotFoundError,
  formatIssues,
  issuePath,
  RavenOdmError,
  ValidationError,
} from './errors'
