import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  createDatabase,
  type Database,
  type Doc,
  defineCollection,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })

describe('ID generators', () => {
  let testDatabase: TestDatabase
  let db: Database
  let UuidUsers: Collection<typeof userSchema>
  let HiloUsers: Collection<typeof userSchema>
  let ServerUsers: Collection<typeof userSchema>
  let CustomUsers: Collection<typeof userSchema>
  let customContext: { collection: string; database: string; name: string } | undefined

  beforeEach(async () => {
    testDatabase = await withDatabase()
    UuidUsers = defineCollection({ name: 'UuidUsers', schema: userSchema, idStrategy: 'uuid' })
    HiloUsers = defineCollection({ name: 'HiloUsers', schema: userSchema, idStrategy: 'hilo' })
    ServerUsers = defineCollection({
      name: 'ServerUsers',
      schema: userSchema,
      idStrategy: 'server',
    })
    CustomUsers = defineCollection({
      name: 'CustomUsers',
      schema: userSchema,
      idStrategy: 'hilo',
      idGenerator: ({ document, collection, database }) => {
        customContext = { collection, database, name: document.name }
        return `custom/${document.name.toLowerCase()}`
      },
    })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [UuidUsers, HiloUsers, ServerUsers, CustomUsers],
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('generates a UUID ID by default and persists the document', async () => {
    const created = await UuidUsers.create({ name: 'UUID', email: 'uuid@example.com' })
    expect(created.id).toMatch(/^UuidUsers\/[0-9a-f-]{36}$/)
    await expect(UuidUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('generates a RavenDB HiLo ID before an external session is saved', async () => {
    const session = db.openSession()
    let created: Doc<typeof userSchema>
    try {
      created = await HiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' }, { session })
      expect(created.id).toMatch(/^HiloUsers\/\d+-A$/)
      await expect(HiloUsers.findById(created.id, { session })).resolves.toEqual(created)
      await session.saveChanges()
    } finally {
      session.dispose()
    }
    await expect(HiloUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('returns a RavenDB server identity after the automatic save', async () => {
    const created = await ServerUsers.create({ name: 'Server', email: 'server@example.com' })
    expect(created.id).toMatch(/^ServerUsers\/\d+-A$/)
    await expect(ServerUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('uses a custom generator before the configured strategy', async () => {
    const created = await CustomUsers.create({ name: 'Custom', email: 'custom@example.com' })
    expect(created.id).toBe('custom/custom')
    expect(customContext).toEqual({
      collection: 'CustomUsers',
      database: testDatabase.name,
      name: 'Custom',
    })
  })

  it('keeps collection descriptors strategy-independent (isType never sniffs plain objects)', () => {
    const plain = { name: 'x', email: 'x@example.com' }
    for (const collection of [UuidUsers, HiloUsers, ServerUsers, CustomUsers]) {
      expect(collection.descriptor.isType(plain)).toBe(false)
      expect(collection.descriptor.name).toBe(collection.name)
      expect(collection.descriptor.construct(plain)).toBe(plain)
    }
  })

  it('does not stamp private HiLo marker properties on create payloads', async () => {
    const created = await HiloUsers.create({ name: 'NoMarker', email: 'nomarker@example.com' })
    expect(created.id).toMatch(/^HiloUsers\/\d+-A$/)

    const ownSymbols = Object.getOwnPropertySymbols(created)
    expect(ownSymbols).toEqual([])

    const loaded = await HiloUsers.findById(created.id)
    expect(loaded).toEqual(created)
    expect(Object.getOwnPropertySymbols(loaded ?? {})).toEqual([])
  })
})

describe('HiLo multi-collection descriptor resolution', () => {
  let testDatabase: TestDatabase
  let db: Database
  let ShopOrders: Collection<typeof userSchema>
  let ShopInvoices: Collection<typeof userSchema>

  beforeEach(async () => {
    testDatabase = await withDatabase()
    // Names with multiple capitals so RavenDB's default ID-prefix transform keeps case
    // (single-capital names like "Orders" become "orders" in the HiLo id prefix).
    ShopOrders = defineCollection({ name: 'ShopOrders', schema: userSchema, idStrategy: 'hilo' })
    ShopInvoices = defineCollection({
      name: 'ShopInvoices',
      schema: userSchema,
      idStrategy: 'hilo',
    })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [ShopOrders, ShopInvoices],
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('resolves distinct HiLo id prefixes per collection without payload markers', async () => {
    const order = await ShopOrders.create({ name: 'Order', email: 'order@example.com' })
    const invoice = await ShopInvoices.create({ name: 'Invoice', email: 'invoice@example.com' })

    expect(order.id).toMatch(/^ShopOrders\/\d+-A$/)
    expect(invoice.id).toMatch(/^ShopInvoices\/\d+-A$/)
    expect(Object.getOwnPropertySymbols(order)).toEqual([])
    expect(Object.getOwnPropertySymbols(invoice)).toEqual([])

    expect(ShopOrders.descriptor.isType(order)).toBe(false)
    expect(ShopInvoices.descriptor.isType(invoice)).toBe(false)

    await expect(ShopOrders.findById(order.id)).resolves.toEqual(order)
    await expect(ShopInvoices.findById(invoice.id)).resolves.toEqual(invoice)
  })
})
