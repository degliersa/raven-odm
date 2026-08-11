---
"@degliersa/raven-odm": minor
---

Add `certificateFromBase64()` and document secured connections.

```ts
const db = createDatabase({
  urls: [process.env.RAVENDB_URL!],
  database: process.env.RAVENDB_DATABASE!,
  collections: { users },
  authOptions: certificateFromBase64(process.env.RAVENDB_CERTIFICATE, {
    type: "pfx", // or "pem"
    password: process.env.RAVENDB_CERTIFICATE_PASSWORD,
    ca: process.env.RAVENDB_CA, // optional, also base64
  }),
});
```

`type` is required: PEM decodes to a `string`, PFX to a `Buffer`; `ca` always decodes to a `Buffer`. An absent, empty, or malformed value raises `invalid_configuration` immediately, naming the option — never the certificate value or its decoded bytes. `authOptions` passed directly keeps working exactly as before; this is one way to produce it, not the only one.
