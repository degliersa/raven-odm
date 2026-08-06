import type { StandardSchemaV1 } from '@standard-schema/spec'
import { ValidationError } from './errors'

export async function validate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  ctx: { collection: string; documentId?: string | undefined },
): Promise<StandardSchemaV1.InferOutput<S>> {
  let result = schema['~standard'].validate(value)
  if (result instanceof Promise) result = await result
  if (result.issues) throw new ValidationError(result.issues, ctx)
  return result.value as StandardSchemaV1.InferOutput<S>
}
