import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { object, string } from 'yup'

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: {
    users: defineCollection({
      name: 'ExampleUsersYup',
      schema: object({
        name: string().required().min(1),
        email: string().required().email(),
      }),
    }),
  },
})

await db.connect()
try {
  const created = await db.users.create({ name: 'Yup', email: 'yup@example.com' })
  console.log(await db.users.findById(created.id))
} finally {
  await db.dispose()
}
