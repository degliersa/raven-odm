#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const PFX_EXTENSIONS = new Set(['.pfx', '.p12'])
const PEM_EXTENSIONS = new Set(['.pem', '.crt', '.cer'])

const USAGE = 'Usage: raven-odm cert-to-env <path> [--ca <path>]\n'

export class CliError extends Error {}

/** `.pfx`/`.p12` -> `pfx`, `.pem`/`.crt`/`.cer` -> `pem`. Never guesses beyond that. */
export function inferCertificateType(filePath: string): 'pem' | 'pfx' {
  const ext = extname(filePath).toLowerCase()
  if (PFX_EXTENSIONS.has(ext)) return 'pfx'
  if (PEM_EXTENSIONS.has(ext)) return 'pem'
  const supported = [...PFX_EXTENSIONS, ...PEM_EXTENSIONS].join(', ')
  throw new CliError(
    `Cannot tell the certificate type from "${filePath}" (extension "${ext || '(none)'}"). ` +
      `Rename it to one of: ${supported}.`,
  )
}

/** The certificate alone when there's no ca, or two labeled lines when there is. */
export function formatOutput(certificate: string, ca: string | undefined): string {
  return ca === undefined ? certificate : `certificate=${certificate}\nca=${ca}`
}

export interface CertToEnvArgs {
  readonly path: string
  readonly ca: string | undefined
}

export function parseCertToEnvArgs(argv: readonly string[]): CertToEnvArgs {
  const { values, positionals } = parseArgs({
    args: argv as string[],
    options: { ca: { type: 'string' } },
    allowPositionals: true,
  })
  const [path] = positionals
  if (!path) throw new CliError(USAGE.trim())
  return { path, ca: values.ca }
}

export interface CertToEnvResult {
  readonly output: string
  /** A pfx may need a password; the CLI never reads or asks for one, only flags this. */
  readonly warning: string | undefined
}

export function certToEnv(args: CertToEnvArgs): CertToEnvResult {
  const type = inferCertificateType(args.path)
  const certificate = readFileSync(args.path).toString('base64')
  const ca = args.ca !== undefined ? readFileSync(args.ca).toString('base64') : undefined
  const warning =
    type === 'pfx'
      ? 'Note: if this certificate needs a password, configure it separately — ' +
        'e.g. certificateFromBase64(value, { type: "pfx", password: ... }).'
      : undefined
  return { output: formatOutput(certificate, ca), warning }
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)

  if (command === '-h' || command === '--help') {
    process.stdout.write(USAGE)
    return
  }
  if (command !== 'cert-to-env') {
    process.stderr.write(USAGE)
    process.exitCode = 1
    return
  }

  try {
    const { output, warning } = certToEnv(parseCertToEnvArgs(rest))
    if (warning) process.stderr.write(`${warning}\n`)
    process.stdout.write(`${output}\n`)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
