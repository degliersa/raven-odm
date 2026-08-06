import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  ConcurrencyConflictError,
  createDatabase,
  type Database,
  defineCollection,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })

describe('optimistic concurrency', () => {
  let testDatabase: TestDatabase
  let db: Database
  let Users: Collection<typeof userSchema>

  beforeEach(async () => {
    testDatabase = await withDatabase()
    Users = defineCollection({ name: 'Users', schema: userSchema })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [Users],
      optimisticConcurrency: true,
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('normalizes the losing optimistic write as a concurrency conflict', async () => {
    const created = await Users.create({ name: 'Initial', email: 'initial@example.com' })
    const first = db.openSession()
    const second = db.openSession()
    try {
      await Users.findById(created.id, { session: first })
      await Users.findById(created.id, { session: second })
      await Users.update(created.id, { name: 'First' }, { session: first })
      await first.saveChanges()
      await Users.update(created.id, { name: 'Second' }, { session: second })
      await expect(second.saveChanges()).rejects.toBeInstanceOf(ConcurrencyConflictError)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('keeps last-write-wins when optimistic concurrency is disabled', async () => {
    await db.dispose()
    Users = defineCollection({ name: 'Users', schema: userSchema })
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: [Users],
      optimisticConcurrency: false,
    })
    await db.connect()

    const created = await Users.create({ name: 'Initial', email: 'initial@example.com' })
    const first = db.openSession()
    const second = db.openSession()
    try {
      await Users.findById(created.id, { session: first })
      await Users.findById(created.id, { session: second })
      await Users.update(created.id, { name: 'First' }, { session: first })
      await first.saveChanges()
      await Users.update(created.id, { name: 'Second' }, { session: second })
      await expect(second.saveChanges()).resolves.toBeUndefined()
      await expect(Users.findById(created.id)).resolves.toMatchObject({ name: 'Second' })
    } finally {
      first.dispose()
      second.dispose()
    }
  })
})
