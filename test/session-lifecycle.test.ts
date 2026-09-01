import type { IDocumentSession } from 'ravendb'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type Collection,
  createDatabase,
  defineCollection,
  type OdmSession,
  type RavenDatabase,
} from '../src/index'

/**
 * These tests pin the Unit of Work policy itself, so they use fake sessions instead of a
 * RavenDB server: what matters is who saves and who disposes, not what is persisted.
 */
class FakeSession implements OdmSession {
  saves = 0
  disposes = 0
  saveError: Error | undefined
  readonly raw = { load: async () => null } as unknown as IDocumentSession

  async saveChanges(): Promise<void> {
    this.saves++
    if (this.saveError) throw this.saveError
  }

  dispose(): void {
    this.disposes++
  }
}

const userSchema = z.object({ name: z.string() })

describe('session lifecycle policy', () => {
  let db: RavenDatabase<{ users: Collection<typeof userSchema> }>
  let opened: FakeSession[]

  beforeEach(async () => {
    const users = defineCollection({ name: 'Users', schema: userSchema })
    db = createDatabase({
      urls: ['http://127.0.0.1:8099'],
      database: 'session-lifecycle',
      collections: { users },
    })
    await db.connect()

    opened = []
    db.openSession = () => {
      const session = new FakeSession()
      opened.push(session)
      return session
    }
  })

  describe('library-owned sessions', () => {
    it('saves once after successful work and disposes', async () => {
      await expect(db.transaction(async () => 'done')).resolves.toBe('done')
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatchObject({ saves: 1, disposes: 1 })
    })

    it('propagates callback failures and still disposes without saving', async () => {
      await expect(db.transaction(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
        'boom',
      )
      expect(opened[0]).toMatchObject({ saves: 0, disposes: 1 })
    })

    it('disposes when saveChanges fails', async () => {
      db.openSession = () => {
        const session = new FakeSession()
        session.saveError = new Error('save failed')
        opened.push(session)
        return session
      }
      await expect(db.transaction(async () => 'unused')).rejects.toThrow('save failed')
      expect(opened[0]).toMatchObject({ saves: 1, disposes: 1 })
    })
  })

  describe('caller-owned sessions', () => {
    it('leaves an external session untouched across collection operations', async () => {
      const given = new FakeSession()
      await expect(db.users.findById('Users/1-A', { session: given })).resolves.toBeNull()
      expect(given).toMatchObject({ saves: 0, disposes: 0 })
      expect(opened).toHaveLength(0)
    })
  })

  it('applies the same policy to transactions and collection operations', async () => {
    await expect(db.users.findById('Users/1-A')).resolves.toBeNull()
    await db.transaction(async () => undefined)

    expect(opened).toHaveLength(2)
    expect(opened[0]).toMatchObject({ saves: 1, disposes: 1 })
    expect(opened[1]).toMatchObject({ saves: 1, disposes: 1 })
  })
})
