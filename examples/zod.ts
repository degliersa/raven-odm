import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { z } from 'zod'

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: {
    users: defineCollection({
      name: 'ExampleUsersZod',
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
    }),
  },
})

await db.connect()
try {
  const created = await db.users.create({ name: 'Maria', email: 'maria@example.com' })
  console.log(await db.users.findById(created.id))
} finally {
  await db.dispose()
}
