import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  createDatabase,
  type Doc,
  defineCollection,
  type RavenDatabase,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })

type IdDatabase = RavenDatabase<{
  uuidUsers: Collection<typeof userSchema>
  hiloUsers: Collection<typeof userSchema>
  serverUsers: Collection<typeof userSchema>
  customUsers: Collection<typeof userSchema>
}>

describe('ID generators', () => {
  let testDatabase: TestDatabase
  let db: IdDatabase
  let customContext: { collection: string; database: string; name: string } | undefined

  beforeEach(async () => {
    testDatabase = await withDatabase()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: {
        uuidUsers: defineCollection({
          name: 'UuidUsers',
          schema: userSchema,
          idStrategy: 'uuid',
        }),
        hiloUsers: defineCollection({
          name: 'HiloUsers',
          schema: userSchema,
          idStrategy: 'hilo',
        }),
        serverUsers: defineCollection({
          name: 'ServerUsers',
          schema: userSchema,
          idStrategy: 'server',
        }),
        customUsers: defineCollection({
          name: 'CustomUsers',
          schema: userSchema,
          idGenerator: ({ document, collection, database }) => {
            customContext = { collection, database, name: document.name }
            return `custom/${document.name.toLowerCase()}`
          },
        }),
      },
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('generates a UUID ID by default and persists the document', async () => {
    const created = await db.uuidUsers.create({ name: 'UUID', email: 'uuid@example.com' })
    expect(created.id).toMatch(/^UuidUsers\/[0-9a-f-]{36}$/)
    await expect(db.uuidUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('generates a RavenDB HiLo ID before an external session is saved', async () => {
    const session = db.openSession()
    let created: Doc<typeof userSchema>
    try {
      created = await db.hiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' }, { session })
      expect(created.id).toMatch(/^HiloUsers\/\d+-A$/)
      await expect(db.hiloUsers.findById(created.id, { session })).resolves.toEqual(created)
      await session.saveChanges()
    } finally {
      session.dispose()
    }
    await expect(db.hiloUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('returns a RavenDB server identity after the automatic save', async () => {
    const created = await db.serverUsers.create({ name: 'Server', email: 'server@example.com' })
    expect(created.id).toMatch(/^ServerUsers\/\d+-A$/)
    await expect(db.serverUsers.findById(created.id)).resolves.toEqual(created)
  })

  it('keeps HiLo ids off the stored document and out of its shape', async () => {
    const created = await db.hiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' })

    const stored = await db.hiloUsers.raw(async (session) => {
      return session.load<Record<string, unknown>>(created.id)
    })
    if (!stored) throw new Error('HiLo document was not created')
    expect(Object.getOwnPropertySymbols(stored)).toEqual([])
    expect(stored['@metadata']).toMatchObject({ '@collection': 'HiloUsers' })
  })

  it('gives each HiLo collection its own id prefix', async () => {
    const otherDatabase = await withDatabase()
    const otherDb = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: otherDatabase.name,
      collections: {
        alpha: defineCollection({ name: 'AlphaDocs', schema: userSchema, idStrategy: 'hilo' }),
        beta: defineCollection({ name: 'BetaDocs', schema: userSchema, idStrategy: 'hilo' }),
      },
    })
    await otherDb.connect()
    try {
      const alpha = await otherDb.alpha.create({ name: 'Alpha', email: 'alpha@example.com' })
      const beta = await otherDb.beta.create({ name: 'Beta', email: 'beta@example.com' })
      expect(alpha.id).toMatch(/^AlphaDocs\/\d+-A$/)
      expect(beta.id).toMatch(/^BetaDocs\/\d+-A$/)
    } finally {
      await otherDb.dispose()
      await otherDatabase.dispose()
    }
  })

  it('resolves the descriptor only from itself, never from a document', () => {
    expect(db.hiloUsers.descriptor.isType(db.hiloUsers.descriptor)).toBe(true)
    expect(db.hiloUsers.descriptor.isType(db.uuidUsers.descriptor)).toBe(false)
    expect(db.hiloUsers.descriptor.isType({ name: 'HiLo', email: 'hilo@example.com' })).toBe(false)
  })

  it('uses a custom generator with the collection and database in context', async () => {
    const created = await db.customUsers.create({ name: 'Custom', email: 'custom@example.com' })
    expect(created.id).toBe('custom/custom')
    expect(customContext).toEqual({
      collection: 'CustomUsers',
      database: testDatabase.name,
      name: 'Custom',
    })
  })

  it('rejects a collection that configures both an idGenerator and an idStrategy', () => {
    let thrown: unknown
    try {
      defineCollection({
        name: 'AmbiguousUsers',
        schema: userSchema,
        idStrategy: 'hilo',
        idGenerator: () => 'ambiguous/1',
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toMatchObject({
      code: 'invalid_configuration',
      collection: 'AmbiguousUsers',
    })
  })
})
