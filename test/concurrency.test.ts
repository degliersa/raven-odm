import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  ConcurrencyConflictError,
  createDatabase,
  defineCollection,
  type RavenDatabase,
} from '../src/index'
import { type TestDatabase, withDatabase } from './helpers'

const userSchema = z.object({ name: z.string(), email: z.email() })

type UsersDatabase = RavenDatabase<{ users: Collection<typeof userSchema> }>

describe('optimistic concurrency', () => {
  let testDatabase: TestDatabase
  let db: UsersDatabase

  beforeEach(async () => {
    testDatabase = await withDatabase()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: { users: defineCollection({ name: 'Users', schema: userSchema }) },
      optimisticConcurrency: true,
    })
    await db.connect()
  })

  afterEach(async () => {
    await db.dispose()
    await testDatabase.dispose()
  })

  it('normalizes the losing optimistic write as a concurrency conflict', async () => {
    const created = await db.users.create({ name: 'Initial', email: 'initial@example.com' })
    const first = db.openSession()
    const second = db.openSession()
    try {
      await db.users.findById(created.id, { session: first })
      await db.users.findById(created.id, { session: second })
      await db.users.update(created.id, { name: 'First' }, { session: first })
      await first.saveChanges()
      await db.users.update(created.id, { name: 'Second' }, { session: second })
      await expect(second.saveChanges()).rejects.toBeInstanceOf(ConcurrencyConflictError)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('keeps last-write-wins when optimistic concurrency is disabled', async () => {
    await db.dispose()
    db = createDatabase({
      urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'],
      database: testDatabase.name,
      collections: { users: defineCollection({ name: 'Users', schema: userSchema }) },
      optimisticConcurrency: false,
    })
    await db.connect()

    const created = await db.users.create({ name: 'Initial', email: 'initial@example.com' })
    const first = db.openSession()
    const second = db.openSession()
    try {
      await db.users.findById(created.id, { session: first })
      await db.users.findById(created.id, { session: second })
      await db.users.update(created.id, { name: 'First' }, { session: first })
      await first.saveChanges()
      await db.users.update(created.id, { name: 'Second' }, { session: second })
      await expect(second.saveChanges()).resolves.toBeUndefined()
      await expect(db.users.findById(created.id)).resolves.toMatchObject({ name: 'Second' })
    } finally {
      first.dispose()
      second.dispose()
    }
  })
})
