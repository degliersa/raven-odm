import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { z } from 'zod'

const userSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
})

const UuidUsers = defineCollection({
  name: 'ExampleUuidUsers',
  schema: userSchema,
  idStrategy: 'uuid',
})

const HiloUsers = defineCollection({
  name: 'ExampleHiloUsers',
  schema: userSchema,
  idStrategy: 'hilo',
})

const ServerUsers = defineCollection({
  name: 'ExampleServerUsers',
  schema: userSchema,
  idStrategy: 'server',
})

const CustomUsers = defineCollection({
  name: 'ExampleCustomUsers',
  schema: userSchema,
  idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: [UuidUsers, HiloUsers, ServerUsers, CustomUsers],
})

await db.connect()
try {
  const uuid = await UuidUsers.create({ name: 'UUID', email: 'uuid@example.com' })
  const custom = await CustomUsers.create({ name: 'Custom', email: 'custom@example.com' })
  const server = await ServerUsers.create({ name: 'Server', email: 'server@example.com' })

  const session = db.openSession()
  try {
    const hilo = await HiloUsers.create({ name: 'HiLo', email: 'hilo@example.com' }, { session })
    console.log({ uuid: uuid.id, custom: custom.id, server: server.id, hilo: hilo.id })
    await session.saveChanges()
  } finally {
    session.dispose()
  }
} finally {
  await db.dispose()
}
