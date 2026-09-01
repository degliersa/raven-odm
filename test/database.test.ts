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

    expect(db.users).not.toBe(users)
    const person = await db.users.create({ name: 'Maria' })
    await expect(db.users.findById(person.id)).resolves.toEqual(person)
    // The key names the accessor; the RavenDB collection name is untouched.
    expect(db.users.name).toBe('People')
  })

  it('gives each database an independent handle for one shared declaration', async () => {
    const firstDatabase = await withDatabase()
    const secondDatabase = await withDatabase()
    databases.push(firstDatabase, secondDatabase)

    const people = defineCollection({ name: 'People', schema })
    const first = createDatabase({
      urls: [ravenUrl()],
      database: firstDatabase.name,
      collections: { people },
    })
    const second = createDatabase({
      urls: [ravenUrl()],
      database: secondDatabase.name,
      collections: { people },
    })
    connections.push(first, second)

    await Promise.all([first.connect(), second.connect()])

    expect(first.people).not.toBe(people)
    expect(second.people).not.toBe(people)
    expect(first.people).not.toBe(second.people)

    const firstPerson = await first.people.create({ name: 'Maria' })
    const secondPerson = await second.people.create({ name: 'Joana' })
    await expect(first.people.findById(firstPerson.id)).resolves.toEqual(firstPerson)
    await expect(second.people.findById(secondPerson.id)).resolves.toEqual(secondPerson)
    await expect(first.people.findById(secondPerson.id)).resolves.toBeNull()
    await expect(second.people.findById(firstPerson.id)).resolves.toBeNull()

    await first.dispose()
    await expect(second.people.findById(secondPerson.id)).resolves.toEqual(secondPerson)
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

  it('reconnects after dispose and keeps serving the same collections', async () => {
    const database = await withDatabase()
    databases.push(database)
    const people = defineCollection({ name: 'People', schema })
    const db = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: { people },
    })
    connections.push(db)

    await db.connect()
    const before = await db.people.create({ name: 'Maria' })
    await db.dispose()

    await expect(db.people.findById(before.id)).rejects.toMatchObject({ code: 'not_connected' })

    await db.connect()
    await expect(db.people.findById(before.id)).resolves.toEqual(before)
    const after = await db.people.create({ name: 'Joana' })
    await expect(db.people.findById(after.id)).resolves.toEqual(after)
  })

  it('isolates disposal between databases sharing a declaration', async () => {
    const firstDatabase = await withDatabase()
    const secondDatabase = await withDatabase()
    databases.push(firstDatabase, secondDatabase)
    const collection = defineCollection({ name: 'People', schema })

    const first = createDatabase({
      urls: [ravenUrl()],
      database: firstDatabase.name,
      collections: { people: collection },
    })
    const second = createDatabase({
      urls: [ravenUrl()],
      database: secondDatabase.name,
      collections: { people: collection },
    })
    connections.push(first, second)
    await Promise.all([first.connect(), second.connect()])

    const firstPerson = await first.people.create({ name: 'Maria' })
    const secondPerson = await second.people.create({ name: 'Joana' })
    await second.dispose()

    await expect(first.people.findById(firstPerson.id)).resolves.toEqual(firstPerson)
    await expect(second.people.findById(secondPerson.id)).rejects.toMatchObject({
      code: 'not_connected',
    })
  })

  it('recovers from a failed connect once the configuration is fixed', async () => {
    const database = await withDatabase()
    databases.push(database)
    const first = defineCollection({ name: 'People', schema })
    const duplicate = defineCollection({ name: 'People', schema })
    const broken = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: { first, duplicate },
    })
    connections.push(broken)
    await expect(broken.connect()).rejects.toMatchObject({ code: 'invalid_configuration' })

    const fixed = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: { first },
    })
    connections.push(fixed)
    await fixed.connect()
    const person = await fixed.first.create({ name: 'Maria' })
    await expect(fixed.first.findById(person.id)).resolves.toEqual(person)
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
