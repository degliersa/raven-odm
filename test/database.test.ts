import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDatabase, type Database, defineCollection } from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const schema = z.object({ name: z.string() })
const ravenUrl = () => process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'

describe('database configuration', () => {
  const databases: TestDatabase[] = []
  const connections: Database[] = []

  afterEach(async () => {
    for (const db of connections) await db.dispose()
    for (const database of databases) await database.dispose()
    connections.length = 0
    databases.length = 0
  })

  it('reaches each collection through the database instance', async () => {
    const database = await withDatabase()
    databases.push(database)
    const users = defineCollection({ name: 'People', schema })
    const db = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: { users },
    })
    connections.push(db)
    await db.connect()

    expect(db.users).toBe(users)
    const person = await db.users.create({ name: 'Maria' })
    await expect(db.users.findById(person.id)).resolves.toEqual(person)
    // The key names the accessor; the RavenDB collection name is untouched.
    expect(db.users.name).toBe('People')
  })

  it('rejects a collection key that would shadow the database API', async () => {
    const database = await withDatabase()
    databases.push(database)
    expect(() =>
      createDatabase({
        urls: [ravenUrl()],
        database: database.name,
        // @ts-expect-error 'transaction' is a reserved key and is rejected at compile time too
        collections: { transaction: defineCollection({ name: 'People', schema }) },
      }),
    ).toThrowError(/reserved/)
  })

  it('rejects reusing a collection in a second database', async () => {
    const firstDatabase = await withDatabase()
    const secondDatabase = await withDatabase()
    databases.push(firstDatabase, secondDatabase)
    const collection = defineCollection({ name: 'People', schema })
    const first = createDatabase({
      urls: [ravenUrl()],
      database: firstDatabase.name,
      collections: { people: collection },
    })
    connections.push(first)
    await first.connect()

    const second = createDatabase({
      urls: [ravenUrl()],
      database: secondDatabase.name,
      collections: { people: collection },
    })
    connections.push(second)
    await expect(second.connect()).rejects.toMatchObject({ code: 'already_bound' })
  })

  it('rejects duplicate collection names', async () => {
    const database = await withDatabase()
    databases.push(database)
    const db = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: {
        people: defineCollection({ name: 'People', schema }),
        peopleAgain: defineCollection({ name: 'People', schema }),
      },
    })
    connections.push(db)
    await expect(db.connect()).rejects.toMatchObject({ code: 'invalid_configuration' })
  })
})
