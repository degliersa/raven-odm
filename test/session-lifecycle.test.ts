import type { IDocumentSession } from 'ravendb'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CollectionBinding, CollectionDescriptor } from '../src/collection'
import {
  type Collection,
  createDatabase,
  type Database,
  defineCollection,
  type OdmSession,
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
  let db: Database
  let Users: Collection<typeof userSchema>
  let binding: CollectionBinding
  let opened: FakeSession[]

  beforeEach(async () => {
    const probe: CollectionDescriptor = {
      name: 'Probe',
      isType: () => false,
      construct: (dto) => dto,
    }
    Users = defineCollection({ name: 'Users', schema: userSchema })
    db = createDatabase({
      urls: ['http://127.0.0.1:8099'],
      database: 'session-lifecycle',
      collections: [
        Users,
        {
          name: 'Probe',
          descriptor: probe,
          bind: (b) => {
            binding = b
          },
        },
      ],
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
    it('reuses the given session without saving or disposing it', async () => {
      const given = new FakeSession()
      const seen = await binding.runInSession(given, async (session, owned) => {
        expect(owned).toBe(false)
        return session
      })
      expect(seen).toBe(given)
      expect(given).toMatchObject({ saves: 0, disposes: 0 })
      expect(opened).toHaveLength(0)
    })

    it('leaves an external session untouched across collection operations', async () => {
      const given = new FakeSession()
      await expect(Users.findById('Users/1-A', { session: given })).resolves.toBeNull()
      expect(given).toMatchObject({ saves: 0, disposes: 0 })
      expect(opened).toHaveLength(0)
    })
  })

  it('applies the same policy to transactions and collection operations', async () => {
    await binding.runInSession(undefined, async (_session, owned) => {
      expect(owned).toBe(true)
    })
    await db.transaction(async () => undefined)

    expect(opened).toHaveLength(2)
    expect(opened[0]).toMatchObject({ saves: 1, disposes: 1 })
    expect(opened[1]).toMatchObject({ saves: 1, disposes: 1 })
  })
})
