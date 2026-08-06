import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type Collection, createDatabase, type Database, defineCollection } from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })
const orderSchema = z.object({ status: z.enum(['pending', 'paid']), total: z.number() })

describe('sessions and unit of work', () => {
  let testDatabase: TestDatabase
  let db: Database
  let Users: Collection<typeof userSchema>
  let Orders: Collection<typeof orderSchema>

  beforeEach(async () => {
    testDatabase = await withDatabase()
    Users = defineCollection({ name: 'Users', schema: userSchema })
    Orders = defineCollection({ name: 'Orders', schema: orderSchema })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [Users, Orders],
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('commits multiple collections in one transaction', async () => {
    const result = await db.transaction(async (session) => {
      const user = await Users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
      const order = await Orders.create({ status: 'pending', total: 10 }, { session })
      return { user, order }
    })
    await expect(Users.findById(result.user.id)).resolves.toEqual(result.user)
    await expect(Orders.findById(result.order.id)).resolves.toEqual(result.order)
  })

  it('does not commit an external session that is disposed without saveChanges', async () => {
    const session = db.openSession()
    const user = await Users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
    session.dispose()
    expect(await Users.findById(user.id)).toBeNull()
  })

  it('commits work done in the session the library opens', async () => {
    await Users.raw(async (session) => {
      await session.store({ name: 'Maria', email: 'maria@example.com' }, 'Users/owned')
    })
    expect(await Users.findById('Users/owned')).toMatchObject({ name: 'Maria' })
  })

  it('commits nothing when work inside a library-owned session fails', async () => {
    await expect(
      Users.raw(async (session) => {
        await session.store({ name: 'Maria', email: 'maria@example.com' }, 'Users/failed')
        throw new Error('work failed')
      }),
    ).rejects.toThrow('work failed')
    expect(await Users.findById('Users/failed')).toBeNull()
  })

  it('commits nothing when a transaction callback fails', async () => {
    let createdId = ''
    await expect(
      db.transaction(async (session) => {
        const user = await Users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
        createdId = user.id
        throw new Error('transaction failed')
      }),
    ).rejects.toThrow('transaction failed')
    expect(createdId).not.toBe('')
    expect(await Users.findById(createdId)).toBeNull()
  })

  it('rejects server identities inside an external session', async () => {
    const ServerOrders = defineCollection({
      name: 'ServerOrder',
      schema: orderSchema,
      idStrategy: 'server',
    })
    const serverDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [ServerOrders],
    })
    await serverDb.connect()
    try {
      await expect(
        ServerOrders.create({ status: 'pending', total: 2 }, { session: serverDb.openSession() }),
      ).rejects.toMatchObject({ code: 'invalid_configuration' })
    } finally {
      await serverDb.dispose()
    }
  })

  it('returns RavenDB canonical identities for server strategy', async () => {
    const ServerOrders = defineCollection({
      name: 'ServerOrder',
      schema: orderSchema,
      idStrategy: 'server',
    })
    const serverDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [ServerOrders],
    })
    await serverDb.connect()
    try {
      const order = await ServerOrders.create({ status: 'pending', total: 2 })
      expect(order.id).toMatch(/^ServerOrder\/\d+-A$/)
    } finally {
      await serverDb.dispose()
    }
  })
})
