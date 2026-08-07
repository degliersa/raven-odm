import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type IdResolution, selectIdStrategy } from '../src/id-strategy'

const userSchema = z.object({ name: z.string(), email: z.email() })

function resolution(
  overrides: Partial<IdResolution<typeof userSchema>> = {},
): IdResolution<typeof userSchema> {
  return {
    document: { name: 'Maria', email: 'maria@example.com' },
    collection: 'Users',
    database: 'app',
    sessionProvided: false,
    reserveId: async () => 'Users/1-A',
    ...overrides,
  }
}

describe('id strategies', () => {
  it('defaults to a client-side uuid under the collection name', async () => {
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: undefined,
      idGenerator: undefined,
    })
    await expect(resolve(resolution())).resolves.toMatch(/^Users\/[0-9a-f-]{36}$/)
  })

  it('reserves a HiLo id through the binding', async () => {
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: 'hilo',
      idGenerator: undefined,
    })
    await expect(resolve(resolution())).resolves.toBe('Users/1-A')
  })

  it('normalizes a HiLo reservation failure', async () => {
    const failure = Object.assign(new Error('range unavailable'), {
      name: 'ConcurrencyException',
    })
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: 'hilo',
      idGenerator: undefined,
    })
    await expect(
      resolve(
        resolution({
          reserveId: async () => {
            throw failure
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'concurrency_conflict', collection: 'Users' })
  })

  it('returns the RavenDB identity prefix for the server strategy', async () => {
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: 'server',
      idGenerator: undefined,
    })
    await expect(resolve(resolution())).resolves.toBe('Users/')
  })

  it('rejects the server strategy inside an external session', async () => {
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: 'server',
      idGenerator: undefined,
    })
    await expect(resolve(resolution({ sessionProvided: true }))).rejects.toMatchObject({
      code: 'invalid_configuration',
      collection: 'Users',
    })
  })

  it('gives a custom generator the document, collection, and database', async () => {
    let seen: unknown
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: undefined,
      idGenerator: (ctx) => {
        seen = ctx
        return `user_${ctx.document.name.toLowerCase()}`
      },
    })
    await expect(resolve(resolution())).resolves.toBe('user_maria')
    expect(seen).toEqual({
      document: { name: 'Maria', email: 'maria@example.com' },
      collection: 'Users',
      database: 'app',
    })
  })

  it('does not reserve a HiLo id when a custom generator is used', async () => {
    let reserved = false
    const resolve = selectIdStrategy<typeof userSchema>({
      idStrategy: undefined,
      idGenerator: () => 'custom/1',
    })
    await resolve(
      resolution({
        reserveId: async () => {
          reserved = true
          return 'Users/1-A'
        },
      }),
    )
    expect(reserved).toBe(false)
  })
})
