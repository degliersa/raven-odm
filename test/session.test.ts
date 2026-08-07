import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type Collection, createDatabase, defineCollection, type RavenDatabase } from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })
const orderSchema = z.object({ status: z.enum(['pending', 'paid']), total: z.number() })

type ShopDatabase = RavenDatabase<{
  users: Collection<typeof userSchema>
  orders: Collection<typeof orderSchema>
}>

describe('sessions and unit of work', () => {
  let testDatabase: TestDatabase
  let db: ShopDatabase

  beforeEach(async () => {
    testDatabase = await withDatabase()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        users: defineCollection({ name: 'Users', schema: userSchema }),
        orders: defineCollection({ name: 'Orders', schema: orderSchema }),
      },
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('commits multiple collections in one transaction', async () => {
    const result = await db.transaction(async (session) => {
      const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
      const order = await db.orders.create({ status: 'pending', total: 10 }, { session })
      return { user, order }
    })
    await expect(db.users.findById(result.user.id)).resolves.toEqual(result.user)
    await expect(db.orders.findById(result.order.id)).resolves.toEqual(result.order)
  })

  it('does not commit an external session that is disposed without saveChanges', async () => {
    const session = db.openSession()
    const user = await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
    session.dispose()
    expect(await db.users.findById(user.id)).toBeNull()
  })

  it('commits work done in the session the library opens', async () => {
    await db.users.raw(async (session) => {
      await session.store({ name: 'Maria', email: 'maria@example.com' }, 'Users/owned')
    })
    expect(await db.users.findById('Users/owned')).toMatchObject({ name: 'Maria' })
  })

  it('commits nothing when work inside a library-owned session fails', async () => {
    await expect(
      db.users.raw(async (session) => {
        await session.store({ name: 'Maria', email: 'maria@example.com' }, 'Users/failed')
        throw new Error('work failed')
      }),
    ).rejects.toThrow('work failed')
    expect(await db.users.findById('Users/failed')).toBeNull()
  })

  it('commits nothing when a transaction callback fails', async () => {
    let createdId = ''
    await expect(
      db.transaction(async (session) => {
        const user = await db.users.create(
          { name: 'Maria', email: 'maria@example.com' },
          { session },
        )
        createdId = user.id
        throw new Error('transaction failed')
      }),
    ).rejects.toThrow('transaction failed')
    expect(createdId).not.toBe('')
    expect(await db.users.findById(createdId)).toBeNull()
  })

  it('rejects server identities inside an external session', async () => {
    const serverDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        serverOrders: defineCollection({
          name: 'ServerOrder',
          schema: orderSchema,
          idStrategy: 'server',
        }),
      },
    })
    await serverDb.connect()
    const session = serverDb.openSession()
    try {
      await expect(
        serverDb.serverOrders.create({ status: 'pending', total: 2 }, { session }),
      ).rejects.toMatchObject({ code: 'invalid_configuration' })
    } finally {
      session.dispose()
      await serverDb.dispose()
    }
  })

  it('returns RavenDB canonical identities for server strategy', async () => {
    const serverDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        serverOrders: defineCollection({
          name: 'ServerOrder',
          schema: orderSchema,
          idStrategy: 'server',
        }),
      },
    })
    await serverDb.connect()
    try {
      const order = await serverDb.serverOrders.create({ status: 'pending', total: 2 })
      expect(order.id).toMatch(/^ServerOrder\/\d+-A$/)
    } finally {
      await serverDb.dispose()
    }
  })
})
