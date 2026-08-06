import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { type } from 'arktype'

const Users = defineCollection({
  name: 'ExampleUsersArkType',
  schema: type({
    name: 'string > 0',
    email: 'string.email',
  }),
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: [Users],
})

await db.connect()
try {
  const created = await Users.create({ name: 'Ark', email: 'ark@example.com' })
  console.log(await Users.findById(created.id))
} finally {
  await db.dispose()
}
