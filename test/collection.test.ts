import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  createDatabase,
  type Database,
  defineCollection,
  ValidationError,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string().min(1), email: z.email() })
const orderSchema = z.object({ status: z.enum(['pending', 'paid']), total: z.number() })

describe('Collection CRUD', () => {
  let testDatabase: TestDatabase
  let db: Database
  let Users: Collection<typeof userSchema>
  let Order: Collection<typeof orderSchema>

  beforeEach(async () => {
    testDatabase = await withDatabase()
    Users = defineCollection({
      name: 'Users',
      schema: userSchema,
      idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
    })
    Order = defineCollection({ name: 'Order', schema: orderSchema })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [Users, Order],
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('creates with a custom id and exact collection metadata', async () => {
    const user = await Users.create({ name: 'Maria', email: 'maria@example.com' })
    expect(user).toEqual({ name: 'Maria', email: 'maria@example.com', id: 'user_maria' })

    const metadata = await Users.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>(user.id)
      return entity?.['@metadata']
    })
    expect(metadata).toMatchObject({ '@collection': 'Users' })

    const order = await Order.create({ status: 'pending', total: 12 })
    const orderMetadata = await Order.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>(order.id)
      return entity?.['@metadata']
    })
    expect(orderMetadata).toMatchObject({ '@collection': 'Order' })
  })

  it('rejects invalid create before writing', async () => {
    await expect(Users.create({ name: '', email: 'nope' })).rejects.toMatchObject({
      code: 'validation_failed',
      issues: { length: 2 },
    })
    expect(await Users.findMany()).toEqual([])
  })

  it('reads a flat schema copy and returns null for missing ids', async () => {
    const user = await Users.create({ name: 'Maria', email: 'maria@example.com' })
    expect(Object.keys((await Users.findById(user.id)) ?? {}).sort()).toEqual([
      'email',
      'id',
      'name',
    ])
    expect(await Users.findById('user_missing')).toBeNull()
  })

  it('merges updates, validates the result, and reports missing documents', async () => {
    const user = await Users.create({ name: 'Maria', email: 'maria@example.com' })
    await expect(Users.update(user.id, { name: 'Maria Silva' })).resolves.toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      id: user.id,
    })
    await expect(Users.findById(user.id)).resolves.toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      id: user.id,
    })
    await expect(Users.update(user.id, { email: 'bad' })).rejects.toBeInstanceOf(ValidationError)
    await expect(Users.update('user_missing', { name: 'Nobody' })).rejects.toMatchObject({
      code: 'document_not_found',
    })
  })

  it('finds by filters, limits, and returns all rows without a take', async () => {
    await Users.create({ name: 'Alice', email: 'alice@example.com' })
    await Users.create({ name: 'Bob', email: 'bob@example.com' })
    await Users.create({ name: 'Carol', email: 'carol@example.com' })
    expect((await Users.findMany({ where: { name: 'Bob' } })).map(({ name }) => name)).toEqual([
      'Bob',
    ])
    expect((await Users.findMany({ orderBy: { field: 'name' }, take: 2 })).length).toBe(2)
    expect((await Users.findMany()).length).toBe(3)
  })

  it('sees writes made after the auto-index exists when waiting for non-stale results', async () => {
    // Create the auto-index first. RavenDB waits for an index it creates for the
    // query at hand, so a query that both creates and uses the index would prove
    // nothing about staleness.
    expect(await Users.findMany({ where: { name: 'nobody' } })).toEqual([])

    await Users.create({ name: 'Fresh', email: 'fresh@example.com' })
    const waited = await Users.findMany({
      where: { name: 'Fresh' },
      waitForNonStaleResults: true,
    })
    expect(waited.map(({ name }) => name)).toEqual(['Fresh'])

    await Users.create({ name: 'Fresher', email: 'fresher@example.com' })
    const withTimeout = await Users.findMany({
      orderBy: { field: 'name' },
      waitForNonStaleResults: 15_000,
    })
    expect(withTimeout.map(({ name }) => name)).toEqual(['Fresh', 'Fresher'])
  })

  it('deletes documents', async () => {
    const user = await Users.create({ name: 'Maria', email: 'maria@example.com' })
    await Users.delete(user.id)
    expect(await Users.findById(user.id)).toBeNull()
  })

  it('validates legacy documents when validateOnRead is enabled', async () => {
    await db.dispose()
    const StrictUsers = defineCollection({
      name: 'Users',
      schema: userSchema,
      validateOnRead: true,
    })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [StrictUsers],
    })
    await db.connect()
    await StrictUsers.raw(async (session) => {
      const payload = { name: 'Legacy', email: 'legacy@example.com' }
      await session.store(payload, 'Users/legacy')
      await session.saveChanges()
    })
    await StrictUsers.raw(async (session) => {
      const entity = await session.load<Record<string, unknown>>('Users/legacy')
      if (!entity) throw new Error('legacy document was not created')
      entity.email = 'invalid'
      await session.saveChanges()
    })
    await expect(StrictUsers.findById('Users/legacy')).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects CRUD before connect', async () => {
    const disconnected = defineCollection({ name: 'Disconnected', schema: userSchema })
    await expect(disconnected.findMany()).rejects.toMatchObject({ code: 'not_connected' })
  })
})
