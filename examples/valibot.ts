import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import * as v from 'valibot'

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: {
    users: defineCollection({
      name: 'ExampleUsersValibot',
      schema: v.object({
        name: v.pipe(v.string(), v.minLength(1)),
        email: v.pipe(v.string(), v.email()),
      }),
    }),
  },
})

await db.connect()
try {
  const created = await db.users.create({ name: 'Val', email: 'val@example.com' })
  console.log(await db.users.findById(created.id))
} finally {
  await db.dispose()
}
