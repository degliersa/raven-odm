import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CliError,
  certToEnv,
  formatOutput,
  inferCertificateType,
  parseCertToEnvArgs,
} from '../src/cli'

describe('inferCertificateType', () => {
  it('recognizes pfx and pem extensions, case-insensitively', () => {
    expect(inferCertificateType('cert.pfx')).toBe('pfx')
    expect(inferCertificateType('cert.P12')).toBe('pfx')
    expect(inferCertificateType('cert.pem')).toBe('pem')
    expect(inferCertificateType('cert.CRT')).toBe('pem')
    expect(inferCertificateType('cert.cer')).toBe('pem')
  })

  it('rejects an unrecognized extension, naming the supported ones', () => {
    expect(() => inferCertificateType('cert.unknown')).toThrowError(CliError)
    expect(() => inferCertificateType('cert.unknown')).toThrowError(/\.pfx.*\.pem/s)
  })
})

describe('formatOutput', () => {
  it('is just the certificate when there is no ca', () => {
    expect(formatOutput('CERT_B64', undefined)).toBe('CERT_B64')
  })

  it('labels both lines when a ca is given', () => {
    expect(formatOutput('CERT_B64', 'CA_B64')).toBe('certificate=CERT_B64\nca=CA_B64')
  })
})

describe('parseCertToEnvArgs', () => {
  it('requires a path', () => {
    expect(() => parseCertToEnvArgs([])).toThrowError(CliError)
  })

  it('reads the path and an optional --ca', () => {
    expect(parseCertToEnvArgs(['cert.pem'])).toEqual({ path: 'cert.pem', ca: undefined })
    expect(parseCertToEnvArgs(['cert.pem', '--ca', 'ca.pem'])).toEqual({
      path: 'cert.pem',
      ca: 'ca.pem',
    })
  })
})

describe('certToEnv', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raven-odm-cli-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('base64-encodes a pem file with no warning', () => {
    const path = join(dir, 'cert.pem')
    writeFileSync(path, 'pem-bytes')
    const result = certToEnv({ path, ca: undefined })
    expect(result.output).toBe(Buffer.from('pem-bytes').toString('base64'))
    expect(result.warning).toBeUndefined()
  })

  it('base64-encodes a pfx file and warns about the password separately', () => {
    const path = join(dir, 'cert.pfx')
    writeFileSync(path, Buffer.from([1, 2, 3, 4]))
    const result = certToEnv({ path, ca: undefined })
    expect(result.output).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'))
    expect(result.warning).toMatch(/password/i)
    expect(result.warning).not.toMatch(/pem-bytes/)
  })

  it('encodes the ca file too and labels both lines', () => {
    const certPath = join(dir, 'cert.pem')
    const caPath = join(dir, 'ca.pem')
    writeFileSync(certPath, 'cert-bytes')
    writeFileSync(caPath, 'ca-bytes')
    const result = certToEnv({ path: certPath, ca: caPath })
    expect(result.output).toBe(
      `certificate=${Buffer.from('cert-bytes').toString('base64')}\n` +
        `ca=${Buffer.from('ca-bytes').toString('base64')}`,
    )
  })

  it('surfaces a missing file as a clear error, not a stack trace someone has to parse', () => {
    expect(() => certToEnv({ path: join(dir, 'missing.pem'), ca: undefined })).toThrow()
  })
})
