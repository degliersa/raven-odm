import { randomBytes } from 'node:crypto'
import {
  CreateDatabaseOperation,
  DeleteDatabasesOperation,
  DocumentStore,
  type IDocumentStore,
} from 'ravendb'
import { InMemoryDatabaseAdapter } from '../src/in-memory-adapter'
import { createDatabase, type Database, type DatabaseOptions } from '../src/index'

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

export interface InMemoryTestDatabase {
  readonly adapter: InMemoryDatabaseAdapter
  readonly db: Database
  dispose(): Promise<void>
}

export function withInMemoryDatabase(
  options: Omit<DatabaseOptions, 'urls' | 'adapterFactory'>,
): InMemoryTestDatabase {
  const adapter = new InMemoryDatabaseAdapter({
    urls: ['memory://raven-odm'],
    database: options.database,
    authOptions: undefined,
    optimisticConcurrency: options.optimisticConcurrency ?? false,
  })
  const db = createDatabase({
    ...options,
    urls: ['memory://raven-odm'],
    adapterFactory: () => adapter,
  })
  return {
    adapter,
    db,
    async dispose(): Promise<void> {
      await db.dispose()
    },
  }
}
