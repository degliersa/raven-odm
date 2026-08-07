# @degliersa/raven-odm

`@degliersa/raven-odm` é um object-document mapper tipado e enxuto para o cliente oficial do RavenDB para Node.js. Ele adiciona uma pequena API de coleções, validação Standard Schema, IDs previsíveis, sessões explícitas e erros normalizados sem ocultar o RavenDB.

## Por que usar o Raven ODM?

Ao criar diretamente com o cliente oficial um novo tipo de documento do RavenDB, você tem flexibilidade, mas precisa decidir onde manter o nome da collection, o formato do documento, as regras de validação, o comportamento do ID, os limites das sessões e o código das consultas. Repetir essas decisões para cada tipo de documento cria código de infraestrutura que pode se desalinhar com facilidade.

O Raven ODM centraliza a definição da collection, o schema, a validação e o acesso ao RavenDB em um único objeto tipado. Isso reduz o código repetitivo necessário para adicionar documentos sem exigir uma classe, uma camada de mapeamento escrita manualmente e uma configuração de validação separada para cada tipo de documento. O TypeScript pode inferir o formato do documento a partir do schema, enquanto objetos simples continuam sendo o modelo de dados normal.

### Cliente oficial do RavenDB versus Raven ODM

Com o cliente oficial do RavenDB, você trabalha diretamente com `DocumentStore`, sessões de documentos, `store`, `load`, `query` e `saveChanges()`. Você obtém a API completa do RavenDB e decide como sua aplicação organiza modelos, validação, IDs e persistência.

Com o Raven ODM, você continua usando o mesmo cliente oficial por baixo. Você define uma collection com `defineCollection`, registra-a com `createDatabase` e usa métodos tipados como `create`, `findById` e `findMany`. O ODM valida a entrada por meio do Standard Schema, gerencia o ciclo de vida usual das sessões nos métodos de conveniência e mantém `db.store` e `raw` disponíveis quando o acesso nativo ao RavenDB for necessário.

O Raven ODM não substitui o RavenDB Client. Ele é uma camada fina de modelagem e validação sobre o cliente oficial.

### Um exemplo pequeno e real

Esta definição usa as APIs atuais `defineCollection`, `createDatabase`, `create` e `findMany`:

```ts
import { z } from 'zod'
import { createDatabase, defineCollection } from '@degliersa/raven-odm'

const db = createDatabase({
  urls: ['http://127.0.0.1:8080'],
  database: 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
    }),
  },
})

await db.connect()

const created = await db.users.create({
  name: 'Maria',
  email: 'maria@example.com',
})

const byId = await db.users.findById(created.id)
const matching = await db.users.findMany({
  where: { email: 'maria@example.com' },
})

console.log({ created, byId, matching })
await db.dispose()
```

O `schema` é a fonte única para validação e tipos de documento inferidos. As coleções são acessadas pelo banco conectado — `db.users` — e a chave do objeto nomeia apenas o acessor: a coleção do RavenDB continua sendo exatamente o `name` que você deu. O `create` retorna um documento com `id`.

| Abordagem | Novo documento | Validação | Tipagem | Código repetitivo |
|-----------|----------------|-----------|---------|-------------------|
| Cliente RavenDB direto | Organizado manualmente | Organizada manualmente | Escolhida e mantida manualmente | Mais código de infraestrutura na aplicação |
| Raven ODM | Defina uma collection e um schema | Standard Schema no limite da collection | Inferida a partir do schema | Menos configuração repetida |

### Benefícios

- adicionar rapidamente novos tipos de documento definindo uma collection e um schema;
- reutilizar schemas como valores comuns do TypeScript;
- manter a validação independente de um provider específico por meio do Standard Schema;
- usar os validadores compatíveis já cobertos pelo projeto: Zod, Valibot, ArkType e Yup;
- inferir os tipos dos documentos a partir do schema, incluindo o `id` público;
- reduzir o acoplamento entre os dados do domínio e a infraestrutura do RavenDB;
- usar objetos simples do TypeScript em vez de tornar uma classe obrigatória para cada documento.

### Quando usar

Use o Raven ODM quando um projeto TypeScript deseja nomes explícitos de collections, schemas reutilizáveis, validação consistente, CRUD tipado e convenções para sessões e IDs de documentos, mantendo acesso ao cliente oficial do RavenDB.

### Quando não usar

O cliente oficial do RavenDB pode ser suficiente quando a aplicação é baseada em consultas avançadas, modelos de documentos muito dinâmicos ou uso direto de recursos específicos do RavenDB que não deveriam passar por uma abstração de ODM. O Raven ODM mantém um escape hatch nativo, mas não deve ser adicionado apenas para ocultar APIs que a aplicação precisa usar diretamente.

O projeto foi criado para aplicações que desejam:

- nomes exatos de coleções do RavenDB sem pluralização implícita;
- schemas independentes de Zod, Valibot, ArkType, Yup ou outro validador Standard Schema;
- CRUD tipado com validação antes das gravações;
- limites explícitos de Unit of Work e concorrência otimista;
- um escape hatch nativo do RavenDB sempre que o ODM não deve atrapalhar.

O pacote é atualmente publicado pelo canal de pré-lançamento `alpha` do Changesets. A API pública é intencionalmente pequena enquanto a suíte de integração é executada contra um servidor RavenDB real.

## Instalação

### Requisitos

- Node.js 22 ou mais recente;
- RavenDB 7.x ou mais recente;
- um validador compatível com Standard Schema.

Instale o ODM, o cliente RavenDB e um validador:

```bash
npm install @degliersa/raven-odm ravendb zod
```

O cliente RavenDB é uma peer dependency, portanto sua aplicação controla a versão do cliente.

### Executar o RavenDB localmente

Os exemplos e testes de integração podem usar um servidor Docker local:

```bash
docker run -d --name raven-odm-local -p 8080:8080 \
  -e RAVEN_Setup_Mode=None \
  -e RAVEN_License_Eula_Accepted=true \
  -e RAVEN_Security_UnsecuredAccessAllowed=PublicNetwork \
  ravendb/ravendb:latest
```

Crie um banco de dados da aplicação, como `raven-odm-examples`, no RavenDB Studio antes de executar um exemplo. Defina `RAVENDB_URL` e `RAVENDB_DATABASE` quando o servidor ou banco de dados usar valores diferentes.

## Início rápido

Este exemplo define uma coleção, conecta um banco de dados e executa criação, leitura, atualização, consulta e exclusão:

```ts
import { z } from 'zod'
import { createDatabase, defineCollection } from '@degliersa/raven-odm'

const db = createDatabase({
  urls: [process.env.RAVENDB_URL ?? 'http://127.0.0.1:8080'],
  database: process.env.RAVENDB_DATABASE ?? 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
    }),
  },
})

await db.connect()

try {
  const created = await db.users.create({
    name: 'Maria',
    email: 'maria@example.com',
  })
  const loaded = await db.users.findById(created.id)
  const updated = await db.users.update(created.id, { name: 'Maria Silva' })
  const matching = await db.users.findMany({
    where: { email: 'maria@example.com' },
  })

  console.log({ created, loaded, updated, matching })
  await db.users.delete(created.id)
} finally {
  await db.dispose()
}
```

Os nomes das coleções são exatos. Uma coleção chamada `Order` é armazenada na coleção `Order` do RavenDB, e não em uma coleção `Orders` pluralizada automaticamente. Isso vale também para o acessor: `collections: { orders: defineCollection({ name: 'Order', ... }) }` te dá `db.orders`, gravando na coleção `Order`.

Uma chave que sombrearia a API do próprio banco — `database`, `store`, `connect`, `dispose`, `transaction`, `openSession` — é rejeitada, em tempo de compilação e de novo em tempo de execução.

## Validadores

Qualquer validador que implemente Standard Schema pode ser passado como `schema`. Estes validadores e versões mínimas foram verificados:

| Validador | Versão mínima | Exemplo no repositório |
| --- | ---: | --- |
| [Zod](https://github.com/colinhacks/zod) | 3.24.0 | [`examples/zod.ts`](examples/zod.ts) |
| [Valibot](https://github.com/fabian-hiller/valibot) | 1.0 | [`examples/valibot.ts`](examples/valibot.ts) |
| [ArkType](https://github.com/arktypeio/arktype) | 2.0 | [`examples/arktype.ts`](examples/arktype.ts) |
| [Yup](https://github.com/jquense/yup) | 1.7.0 | [`examples/yup.ts`](examples/yup.ts) |

O exemplo com Zod usa a API de nível superior `z.email()` do Zod 4. O Zod 3.24 continua sendo compatível com o ODM; use a API correspondente de schema de e-mail para aplicações fixadas no Zod 3. O validador é uma dependência da sua aplicação, não uma dependência do núcleo do ODM. Consulte [`examples/README.md`](examples/README.md) para instruções de configuração e execução.

## IDs

A estratégia padrão `idStrategy: 'uuid'` cria intencionalmente um ID conhecido no lado do cliente no formato `<collection>/<uuid>`. Isso mantém o ID do documento disponível antes de `saveChanges()` e funciona ao criar documentos em uma sessão externa. HiLo continua disponível como uma opção explícita quando são preferidos intervalos gerenciados pelo RavenDB.
Use `idGenerator` para IDs definidos pela aplicação. Ele recebe o documento validado, o nome da coleção e o nome do banco de dados. `idGenerator` e `idStrategy` são mutuamente exclusivos: uma coleção que define os dois é rejeitada com `invalid_configuration`, de modo que a origem do ID fica sempre visível na definição.

```ts
const db = createDatabase({
  urls,
  database: 'example',
  collections: {
    users: defineCollection({
      name: 'Users',
      schema: userSchema,
      idGenerator: ({ document }) => `user_${document.name.toLowerCase()}`,
    }),
  },
})
```

Use `idStrategy: 'hilo'` para o gerador HiLo do lado do cliente do RavenDB. O cliente reserva um intervalo de IDs e retorna IDs como `Orders/128-A` antes de `saveChanges()`, portanto HiLo funciona com sessões externas. O primeiro ID de uma coleção pode fazer uma requisição ao servidor para reservar o intervalo, e valores não utilizados podem deixar lacunas.

Use `idStrategy: 'server'` para solicitar identidades do RavenDB, como `Orders/1-A`. O RavenDB atribui esse ID durante `saveChanges()`, portanto essa estratégia não pode ser usada com `create(data, { session })`. Use um gerador personalizado ou a estratégia UUID padrão para sessões externas.

Consulte [`examples/id-strategies.ts`](examples/id-strategies.ts) para ver os quatro caminhos de geração em um único exemplo executável.

## Consultas e obsolescência de índice

O `findMany()` sem `where` ou `orderBy` lê a coleção diretamente e sempre observa gravações anteriores.

Ao adicionar `where` ou `orderBy`, a consulta passa a ser respondida por um índice automático do RavenDB, e índices automáticos são atualizados de forma assíncrona. Por padrão o ODM não espera por eles — o mesmo comportamento do cliente oficial —, então uma consulta pode não enxergar um documento gravado instantes antes. Opte pela espera por chamada quando a leitura precisa observar a gravação anterior:

```ts
// espera com o timeout padrão do RavenDB
await Users.findMany({ where: { active: true }, waitForNonStaleResults: true })

// ou limite a espera explicitamente, em milissegundos
await Users.findMany({ orderBy: { field: 'name' }, waitForNonStaleResults: 5_000 })
```

Esgotar a espera lança `RavenOdmError` com `code === 'query_timeout'`. Esperar custa latência, então prefira usar isso em fluxos de leitura após gravação, e não como padrão global.

## Sessões e Unit of Work

Os métodos CRUD de conveniência abrem, salvam e descartam uma sessão automaticamente. Use `transaction` para agrupar gravações entre coleções:

```ts
await db.transaction(async (session) => {
  await db.users.create({ name: 'Maria', email: 'maria@example.com' }, { session })
  await db.orders.create({ status: 'pending', total: 42 }, { session })
})
```

`db.openSession()` retorna uma sessão explícita. Operações que recebem essa sessão não são persistidas até `session.saveChanges()`; descartá-la primeiro elimina as alterações pendentes.

## Concorrência otimista

Defina `optimisticConcurrency: true` para habilitar a concorrência otimista do RavenDB em todas as sessões abertas pelo banco de dados:

```ts
const db = createDatabase({
  urls,
  database,
  collections: { users: Users },
  optimisticConcurrency: true,
})
```

Um salvamento obsoleto lança `ConcurrencyConflictError` com `code === 'concurrency_conflict'`. Com o padrão `false`, o RavenDB mantém o comportamento de last-write-wins.

## Erros

As falhas do RavenDB são normalizadas em subclasses de `RavenOdmError`. Inspecione `code`, `collection` e `documentId` em vez de comparar classes de exceção específicas da implementação do RavenDB.

| Código | Significado |
| --- | --- |
| `validation_failed` | A validação da entrada ou da leitura falhou; `ValidationError.issues` contém os problemas do Standard Schema. |
| `concurrency_conflict` | A concorrência otimista rejeitou uma gravação obsoleta. |
| `document_not_found` | Uma atualização teve como alvo um documento inexistente. |
| `not_connected` | Um banco de dados ou coleção foi usado antes de `connect()`. |
| `already_bound` | Uma coleção foi vinculada a mais de um banco de dados. |
| `invalid_configuration` | A configuração da coleção ou do banco de dados é inválida. |
| `query_timeout` | O `findMany` esperou por um índice não obsoleto e a espera se esgotou. |
| `raven_error` | Uma falha não classificada do cliente/servidor RavenDB. |

`findById` retorna `null` para um documento inexistente; ele não lança `document_not_found`.

## Escape hatches nativos

Use `db.store` para acessar o `IDocumentStore` nativo ou execute uma operação nativa em uma sessão de coleção:

```ts
await db.users.raw(async (session) => {
  const raw = await session.load('Users/1-A')
  console.log(raw)
})

const nativeStore = db.store
```

## Ciclo de vida da conexão

O `connect()` vincula ao banco todas as coleções configuradas; o `dispose()` as libera. Um banco descartado pode ser conectado de novo, e suas coleções continuam funcionando na nova conexão:

```ts
await db.connect()
await db.dispose()
await db.connect() // as mesmas coleções, utilizáveis de novo
```

Entre as duas chamadas a coleção não tem banco, então usá-la lança `not_connected`. Um `connect()` que falha libera o que já tinha vinculado, de modo que um erro de configuração pode ser corrigido e tentado outra vez.

Uma coleção pertence a um banco conectado por vez. Passar a mesma coleção para um segundo banco enquanto o primeiro ainda está conectado lança `already_bound`; descartar o primeiro a libera para o segundo.

## Ciclo de vida dos documentos

Os documentos retornados são cópias validadas simples, não entidades rastreadas. Os metadados do RavenDB são removidos antes da validação e o `id` público é reanexado depois. Alterar um objeto retornado não agenda uma gravação no banco de dados; chame `update`, use uma sessão explícita ou use o escape hatch nativo para persistir.

## Desenvolvimento

A partir da raiz do repositório:

```bash
npm ci
npm run lint
npm run typecheck
npm run typecheck:examples
npm run build
npm test
npm run check:pack
```

A suíte de integração usa `RAVENDB_URL` quando ela está definida. Sem essa variável, o Vitest inicia `ravendb/ravendb:latest` na porta 8099 e remove apenas o contêiner que iniciou.

## Contribuição

Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de abrir uma issue ou pull request. O documento descreve o fluxo de desenvolvimento, os princípios de design, os requisitos dos testes de integração, a política do Changesets, as convenções de commits e o Código de Conduta.

## Licença

MIT © 2026 degliersa
