import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import * as v from 'valibot'

const Users = defineCollection({
  name: 'ExampleUsersValibot',
  schema: v.object({
    name: v.pipe(v.string(), v.minLength(1)),
    email: v.pipe(v.string(), v.email()),
  }),
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: [Users],
})

await db.connect()
try {
  const created = await Users.create({ name: 'Val', email: 'val@example.com' })
  console.log(await Users.findById(created.id))
} finally {
  await db.dispose()
}
