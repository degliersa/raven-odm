import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  createDatabase,
  defineCollection,
  type RavenDatabase,
  ValidationError,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string().min(1), email: z.email() })

type BulkDatabase = RavenDatabase<{
  users: Collection<typeof userSchema>
  serverUsers: Collection<typeof userSchema>
}>

describe('bulkInsert', () => {
  let testDatabase: TestDatabase
  let db: BulkDatabase

  beforeEach(async () => {
    testDatabase = await withDatabase()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        users: defineCollection({ name: 'Users', schema: userSchema }),
        serverUsers: defineCollection({
          name: 'ServerUsers',
          schema: userSchema,
          idStrategy: 'server',
        }),
      },
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('streams validated documents with the right collection metadata', async () => {
    const bulk = await db.users.bulkInsert()
    await bulk.write({ name: 'Alice', email: 'alice@example.com' })
    await bulk.write({ name: 'Bob', email: 'bob@example.com' })
    const result = await bulk.finish()

    expect(result).toEqual({ written: 2, failures: [] })
    const stored = await db.users.findMany({ orderBy: { field: 'name' } })
    expect(stored.map(({ name }) => name)).toEqual(['Alice', 'Bob'])

    const metadata = await db.users.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>(stored[0]?.id ?? '')
      return entity?.['@metadata']
    })
    expect(metadata).toMatchObject({ '@collection': 'Users' })
  })

  it('aborts the stream on the first invalid item by default', async () => {
    const bulk = await db.users.bulkInsert()
    await bulk.write({ name: 'Alice', email: 'alice@example.com' })
    await expect(bulk.write({ name: '', email: 'nope' })).rejects.toBeInstanceOf(ValidationError)
    await expect(bulk.write({ name: 'Carol', email: 'carol@example.com' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(bulk.finish()).rejects.toBeInstanceOf(ValidationError)
  })

  it('skips invalid items and continues when abortOnError is false', async () => {
    const bulk = await db.users.bulkInsert({ abortOnError: false })
    await bulk.write({ name: 'Alice', email: 'alice@example.com' })
    await bulk.write({ name: '', email: 'nope' })
    await bulk.write({ name: 'Carol', email: 'carol@example.com' })
    const result = await bulk.finish()

    expect(result.written).toBe(2)
    expect(result.failures).toMatchObject([{ index: 1, issues: { length: 2 } }])
    const stored = await db.users.findMany({ orderBy: { field: 'name' } })
    expect(stored.map(({ name }) => name)).toEqual(['Alice', 'Carol'])
  })

  it('rejects idStrategy "server", the same reason an external session rejects it', async () => {
    const bulk = await db.serverUsers.bulkInsert()
    await expect(bulk.write({ name: 'Server', email: 'server@example.com' })).rejects.toMatchObject(
      { code: 'invalid_configuration' },
    )
  })
})
