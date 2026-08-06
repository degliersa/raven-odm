import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  ValidationError,
  type Database,
  defineCollection,
} from '../../src/index'
import { withInMemoryDatabase } from '../helpers'

const userSchema = z.object({ name: z.string().min(1), email: z.email() })
const legacySchema = z.object({ name: z.string(), email: z.email(), role: z.string().optional() })

describe('Collection unit behavior with the in-memory adapter', () => {
  let db: Database
  let Users: Collection<typeof userSchema>
  let LegacyUsers: Collection<typeof legacySchema>
  let helper: ReturnType<typeof withInMemoryDatabase>

  beforeEach(async () => {
    Users = defineCollection({ name: 'Users', schema: userSchema })
    LegacyUsers = defineCollection({
      name: 'LegacyUsers',
      schema: legacySchema,
      validateOnRead: true,
    })
    helper = withInMemoryDatabase({
      database: 'unit-tests',
      collections: [Users, LegacyUsers],
    })
    db = helper.db
    await db.connect()
  })

  afterEach(async () => {
    await helper.dispose()
  })

  it('validates before write and leaves storage untouched', async () => {
    await expect(Users.create({ name: '', email: 'nope' })).rejects.toBeInstanceOf(ValidationError)
    expect(await Users.findMany()).toEqual([])
  })

  it('hydrates flat documents, strips metadata, and keeps exact ids', async () => {
    helper.adapter.seed('Users/manual', 'Users', {
      name: 'Maria',
      email: 'maria@example.com',
      role: 'admin',
    })

    await expect(Users.findById('Users/manual')).resolves.toEqual({
      name: 'Maria',
      email: 'maria@example.com',
      id: 'Users/manual',
      role: 'admin',
    })
  })

  it('merges updates, deletes removed fields, and reports missing documents', async () => {
    helper.adapter.seed('LegacyUsers/1-A', 'LegacyUsers', {
      name: 'Maria',
      email: 'maria@example.com',
      role: 'admin',
    })

    await expect(LegacyUsers.update('LegacyUsers/1-A', { name: 'Maria Silva' })).resolves.toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      id: 'LegacyUsers/1-A',
      role: 'admin',
    })

    const next = defineCollection({
      name: 'LegacyUsers',
      schema: userSchema,
    })
    const rebound = withInMemoryDatabase({
      database: 'rebound',
      collections: [next],
    })
    try {
      rebound.adapter.seed('LegacyUsers/2-A', 'LegacyUsers', {
        name: 'Maria',
        email: 'maria@example.com',
        role: 'admin',
      })
      await rebound.db.connect()
      await next.update('LegacyUsers/2-A', { name: 'Maria Silva' })
      expect(rebound.adapter.documents.get('LegacyUsers/2-A')?.entity.role).toBeUndefined()
      await expect(next.update('LegacyUsers/missing', { name: 'Nobody' })).rejects.toMatchObject({
        code: 'document_not_found',
      })
    } finally {
      await rebound.dispose()
    }
  })

  it('supports explicit session ownership and saveChanges semantics', async () => {
    const session = db.openSession()
    const created = await Users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
    await expect(Users.findById(created.id)).resolves.toBeNull()
    await expect(Users.findById(created.id, { session })).resolves.toEqual(created)
    session.dispose()
    await expect(Users.findById(created.id)).resolves.toBeNull()

    const committed = await db.transaction(async (tx) =>
      Users.create({ name: 'Nina', email: 'nina@example.com' }, { session: tx }),
    )
    await expect(Users.findById(committed.id)).resolves.toEqual(committed)
  })

  it('returns null for missing ids and validates on read', async () => {
    expect(await Users.findById('Users/missing')).toBeNull()
    helper.adapter.seed('LegacyUsers/invalid', 'LegacyUsers', {
      name: 'Legacy',
      email: 'invalid',
    })
    await expect(LegacyUsers.findById('LegacyUsers/invalid')).rejects.toBeInstanceOf(ValidationError)
  })

  it('can open a second adapter-backed database without RavenDB', async () => {
    const People = defineCollection({ name: 'People', schema: z.object({ name: z.string() }) })
    const secondary = withInMemoryDatabase({
      database: 'second-db',
      collections: [People],
    })
    try {
      await secondary.db.connect()
      const created = await People.create({ name: 'Ada' })
      await expect(People.findById(created.id)).resolves.toEqual(created)
    } finally {
      await secondary.dispose()
    }
  })
})
