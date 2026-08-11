import type { IAuthOptions } from 'ravendb'
import { RavenOdmError } from './errors'

export interface CertificateFromBase64Options {
  readonly type: 'pem' | 'pfx'
  readonly password?: string | undefined
  /** Base64-encoded, decoded the same way as the certificate itself. */
  readonly ca?: string | undefined
}

/** Decodes and rejects anything that doesn't round-trip back to the same string. */
function decodeBase64(value: string, optionName: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new RavenOdmError('invalid_configuration', `"${optionName}" is not valid base64`)
  }
  return decoded
}

/**
 * Turns a base64-encoded certificate into `authOptions` for `createDatabase`.
 *
 * `value` is decoded to a `string` for `type: 'pem'` and a `Buffer` for
 * `type: 'pfx'`, matching what the RavenDB client expects for each format.
 * `ca` follows the same base64 encoding and always decodes to a `Buffer`,
 * which the client accepts for either certificate type.
 *
 * Fails fast: an absent, empty, or malformed `value` raises `invalid_configuration`
 * immediately, naming the option — never a TLS error at connect time from a
 * silently truncated secret. Neither the raw value nor the decoded bytes ever
 * appear in a thrown message.
 *
 * @example
 * ```ts
 * const db = createDatabase({
 *   urls: [process.env.RAVENDB_URL!],
 *   database: process.env.RAVENDB_DATABASE!,
 *   collections: { users },
 *   authOptions: certificateFromBase64(process.env.RAVENDB_CERTIFICATE, {
 *     type: 'pfx',
 *     password: process.env.RAVENDB_CERTIFICATE_PASSWORD,
 *   }),
 * })
 * ```
 *
 * @throws `RavenOdmError` with `invalid_configuration` — `value` is missing,
 * empty, or not valid base64.
 */
export function certificateFromBase64(
  value: string | undefined,
  options: CertificateFromBase64Options,
): IAuthOptions {
  if (!value) {
    throw new RavenOdmError(
      'invalid_configuration',
      '"certificate" is required and must not be empty',
    )
  }
  const decoded = decodeBase64(value, 'certificate')
  const certificate = options.type === 'pem' ? decoded.toString('utf8') : decoded
  const ca = options.ca ? decodeBase64(options.ca, 'ca') : undefined

  return {
    type: options.type,
    certificate,
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(ca !== undefined ? { ca } : {}),
  }
}
