import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDatabase, defineCollection } from '../src/index'
import { withDatabase } from './helpers'

const zodSchema = z.object({ name: z.string(), email: z.email() })
const valibotSchema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) })

async function exerciseSchema<S extends typeof zodSchema | typeof valibotSchema>(
  schema: S,
  input: { name: string; email: string },
): Promise<void> {
  const testDatabase = await withDatabase()
  const collection = defineCollection({ name: 'People', schema })
  const db = createDatabase({
    urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
    database: testDatabase.name,
    collections: [collection],
  })
  try {
    await db.connect()
    const created = await collection.create(input)
    await expect(collection.findById(created.id)).resolves.toEqual({ ...input, id: created.id })
  } finally {
    await db.dispose()
    await testDatabase.dispose()
  }
}

describe('schema compatibility', () => {
  it('supports Zod', async () => {
    await exerciseSchema(zodSchema, { name: 'Zoe', email: 'zoe@example.com' })
  })

  it('supports Valibot', async () => {
    await exerciseSchema(valibotSchema, { name: 'Val', email: 'val@example.com' })
  })
})
