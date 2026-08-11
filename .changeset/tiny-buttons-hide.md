---
"@degliersa/raven-odm": minor
---

Add a `raven-odm cert-to-env` CLI that turns a certificate file into the base64 value `certificateFromBase64()` expects.

```bash
npx raven-odm cert-to-env ./certificate.pfx
# prints only the base64-encoded certificate to stdout

npx raven-odm cert-to-env ./certificate.pfx --ca ./ca.pem
# certificate=<base64>
# ca=<base64>
```

Type is inferred from the file extension (`.pfx`/`.p12` → `pfx`, `.pem`/`.crt`/`.cer` → `pem`); an unrecognized extension is a clear error, never a guess. The CLI never asks for or handles a password — encoding a file's bytes doesn't require decrypting it — and prints a stderr-only reminder for `.pfx` input that the password still needs configuring separately, in the application, via `certificateFromBase64(value, { password })`.
