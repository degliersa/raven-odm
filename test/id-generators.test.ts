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

  it('keeps HiLo ids off the stored document and out of its shape', async () => {
    const created = await HiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' })

    const stored = await HiloUsers.raw(async (session) => {
      return session.load<Record<string, unknown>>(created.id)
    })
    if (!stored) throw new Error('HiLo document was not created')
    expect(Object.getOwnPropertySymbols(stored)).toEqual([])
    expect(stored['@metadata']).toMatchObject({ '@collection': 'HiloUsers' })
  })

  it('gives each HiLo collection its own id prefix', async () => {
    const otherDatabase = await withDatabase()
    const first = defineCollection({ name: 'AlphaDocs', schema: userSchema, idStrategy: 'hilo' })
    const second = defineCollection({ name: 'BetaDocs', schema: userSchema, idStrategy: 'hilo' })
    const otherDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: otherDatabase.name,
      collections: [first, second],
    })
    await otherDb.connect()
    try {
      const alpha = await first.create({ name: 'Alpha', email: 'alpha@example.com' })
      const beta = await second.create({ name: 'Beta', email: 'beta@example.com' })
      expect(alpha.id).toMatch(/^AlphaDocs\/\d+-A$/)
      expect(beta.id).toMatch(/^BetaDocs\/\d+-A$/)
    } finally {
      await otherDb.dispose()
      await otherDatabase.dispose()
    }
  })

  it('resolves the descriptor only from itself, never from a document', () => {
    expect(HiloUsers.descriptor.isType(HiloUsers.descriptor)).toBe(true)
    expect(HiloUsers.descriptor.isType(UuidUsers.descriptor)).toBe(false)
    expect(HiloUsers.descriptor.isType({ name: 'HiLo', email: 'hilo@example.com' })).toBe(false)
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
})
