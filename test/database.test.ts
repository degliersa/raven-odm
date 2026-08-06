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

  it('rejects reusing a collection in a second database', async () => {
    const firstDatabase = await withDatabase()
    const secondDatabase = await withDatabase()
    databases.push(firstDatabase, secondDatabase)
    const collection = defineCollection({ name: 'People', schema })
    const first = createDatabase({
      urls: [ravenUrl()],
      database: firstDatabase.name,
      collections: [collection],
    })
    connections.push(first)
    await first.connect()

    const second = createDatabase({
      urls: [ravenUrl()],
      database: secondDatabase.name,
      collections: [collection],
    })
    connections.push(second)
    await expect(second.connect()).rejects.toMatchObject({ code: 'already_bound' })
  })

  it('rejects duplicate collection names', async () => {
    const database = await withDatabase()
    databases.push(database)
    const first = defineCollection({ name: 'People', schema })
    const second = defineCollection({ name: 'People', schema })
    const db = createDatabase({
      urls: [ravenUrl()],
      database: database.name,
      collections: [first, second],
    })
    connections.push(db)
    await expect(db.connect()).rejects.toMatchObject({ code: 'invalid_configuration' })
  })
})
