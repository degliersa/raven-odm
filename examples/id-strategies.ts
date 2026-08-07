import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { z } from 'zod'

const userSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: {
    uuidUsers: defineCollection({
      name: 'ExampleUuidUsers',
      schema: userSchema,
      idStrategy: 'uuid',
    }),
    hiloUsers: defineCollection({
      name: 'ExampleHiloUsers',
      schema: userSchema,
      idStrategy: 'hilo',
    }),
    serverUsers: defineCollection({
      name: 'ExampleServerUsers',
      schema: userSchema,
      idStrategy: 'server',
    }),
    customUsers: defineCollection({
      name: 'ExampleCustomUsers',
      schema: userSchema,
      idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
    }),
  },
})

await db.connect()
try {
  const uuid = await db.uuidUsers.create({ name: 'UUID', email: 'uuid@example.com' })
  const custom = await db.customUsers.create({ name: 'Custom', email: 'custom@example.com' })
  const server = await db.serverUsers.create({ name: 'Server', email: 'server@example.com' })

  const session = db.openSession()
  try {
    const hilo = await db.hiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' }, { session })
    console.log({ uuid: uuid.id, custom: custom.id, server: server.id, hilo: hilo.id })
    await session.saveChanges()
  } finally {
    session.dispose()
  }
} finally {
  await db.dispose()
}
