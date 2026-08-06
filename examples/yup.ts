import { createDatabase, defineCollection } from '@degliersa/raven-odm'
import { object, string } from 'yup'

const Users = defineCollection({
  name: 'ExampleUsersYup',
  schema: object({
    name: string().required().min(1),
    email: string().required().email(),
  }),
})

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'raven-odm-examples',
  collections: [Users],
})

await db.connect()
try {
  const created = await Users.create({ name: 'Yup', email: 'yup@example.com' })
  console.log(await Users.findById(created.id))
} finally {
  await db.dispose()
}
