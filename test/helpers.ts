import { randomBytes } from 'node:crypto'
import {
  CreateDatabaseOperation,
  DeleteDatabasesOperation,
  DocumentStore,
  type IDocumentStore,
} from 'ravendb'

export const RAVENDB_URL = process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'

export interface TestDatabase {
  readonly name: string
  readonly admin: IDocumentStore
  dispose(): Promise<void>
}

export async function withDatabase(): Promise<TestDatabase> {
  const name = `test_${Date.now()}_${randomBytes(4).toString('hex')}`
  const admin = new DocumentStore([RAVENDB_URL], 'RavenDB')
  admin.initialize()
  await admin.maintenance.server.send(
    new CreateDatabaseOperation((builder) => {
      builder.regular(name)
    }),
  )

  return {
    name,
    admin,
    async dispose(): Promise<void> {
      await admin.maintenance.server.send(
        new DeleteDatabasesOperation({
          databaseNames: [name],
          hardDelete: true,
        }),
      )
      admin.dispose()
    },
  }
}
