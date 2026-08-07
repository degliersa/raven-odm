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
const orderSchema = z.object({ status: z.enum(['pending', 'paid']), total: z.number() })

type AppDatabase = RavenDatabase<{
  users: Collection<typeof userSchema>
  order: Collection<typeof orderSchema>
}>

describe('Collection CRUD', () => {
  let testDatabase: TestDatabase
  let db: AppDatabase

  beforeEach(async () => {
    testDatabase = await withDatabase()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        users: defineCollection({
          name: 'Users',
          schema: userSchema,
          idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
        }),
        order: defineCollection({ name: 'Order', schema: orderSchema }),
      },
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('creates with a custom id and exact collection metadata', async () => {
    const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
    expect(user).toEqual({ name: 'Maria', email: 'maria@example.com', id: 'user_maria' })

    const metadata = await db.users.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>(user.id)
      return entity?.['@metadata']
    })
    expect(metadata).toMatchObject({ '@collection': 'Users' })

    const order = await db.order.create({ status: 'pending', total: 12 })
    const orderMetadata = await db.order.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>(order.id)
      return entity?.['@metadata']
    })
    expect(orderMetadata).toMatchObject({ '@collection': 'Order' })
  })

  it('rejects invalid create before writing', async () => {
    await expect(db.users.create({ name: '', email: 'nope' })).rejects.toMatchObject({
      code: 'validation_failed',
      issues: { length: 2 },
    })
    expect(await db.users.findMany()).toEqual([])
  })

  it('reads a flat schema copy and returns null for missing ids', async () => {
    const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
    expect(Object.keys((await db.users.findById(user.id)) ?? {}).sort()).toEqual([
      'email',
      'id',
      'name',
    ])
    expect(await db.users.findById('user_missing')).toBeNull()
  })

  it('merges updates, validates the result, and reports missing documents', async () => {
    const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
    await expect(db.users.update(user.id, { name: 'Maria Silva' })).resolves.toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      id: user.id,
    })
    await expect(db.users.findById(user.id)).resolves.toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      id: user.id,
    })
    await expect(db.users.update(user.id, { email: 'bad' })).rejects.toBeInstanceOf(ValidationError)
    await expect(db.users.update('user_missing', { name: 'Nobody' })).rejects.toMatchObject({
      code: 'document_not_found',
    })
  })

  it('finds by filters, limits, and returns all rows without a take', async () => {
    await db.users.create({ name: 'Alice', email: 'alice@example.com' })
    await db.users.create({ name: 'Bob', email: 'bob@example.com' })
    await db.users.create({ name: 'Carol', email: 'carol@example.com' })
    expect((await db.users.findMany({ where: { name: 'Bob' } })).map(({ name }) => name)).toEqual([
      'Bob',
    ])
    expect((await db.users.findMany({ orderBy: { field: 'name' }, take: 2 })).length).toBe(2)
    expect((await db.users.findMany()).length).toBe(3)
  })

  it('sees writes made after the auto-index exists when waiting for non-stale results', async () => {
    // Create the auto-index first. RavenDB waits for an index it creates for the
    // query at hand, so a query that both creates and uses the index would prove
    // nothing about staleness.
    expect(await db.users.findMany({ where: { name: 'nobody' } })).toEqual([])

    await db.users.create({ name: 'Fresh', email: 'fresh@example.com' })
    const waited = await db.users.findMany({
      where: { name: 'Fresh' },
      waitForNonStaleResults: true,
    })
    expect(waited.map(({ name }) => name)).toEqual(['Fresh'])

    await db.users.create({ name: 'Fresher', email: 'fresher@example.com' })
    const withTimeout = await db.users.findMany({
      orderBy: { field: 'name' },
      waitForNonStaleResults: 15_000,
    })
    expect(withTimeout.map(({ name }) => name)).toEqual(['Fresh', 'Fresher'])
  })

  it('deletes documents', async () => {
    const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
    await db.users.delete(user.id)
    expect(await db.users.findById(user.id)).toBeNull()
  })

  it('validates legacy documents when validateOnRead is enabled', async () => {
    await db.dispose()
    const strict = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        users: defineCollection({
          name: 'Users',
          schema: userSchema,
          validateOnRead: true,
        }),
      },
    })
    await strict.connect()
    try {
      await strict.users.raw(async (session) => {
        const payload = { name: 'Legacy', email: 'legacy@example.com' }
        await session.store(payload, 'Users/legacy')
        await session.saveChanges()
      })
      await strict.users.raw(async (session) => {
        const entity = await session.load<Record<string, unknown>>('Users/legacy')
        if (!entity) throw new Error('legacy document was not created')
        entity.email = 'invalid'
        await session.saveChanges()
      })
      await expect(strict.users.findById('Users/legacy')).rejects.toBeInstanceOf(ValidationError)
    } finally {
      await strict.dispose()
    }
  })

  it('rejects CRUD before connect', async () => {
    const pending = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: { disconnected: defineCollection({ name: 'Disconnected', schema: userSchema }) },
    })
    await expect(pending.disconnected.findMany()).rejects.toMatchObject({ code: 'not_connected' })
  })
})
