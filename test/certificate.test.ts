import { describe, expect, it } from 'vitest'
import { certificateFromBase64 } from '../src/certificate'

describe('certificateFromBase64', () => {
  it('decodes a pem certificate to a string', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n'
    const value = Buffer.from(pem, 'utf8').toString('base64')
    const authOptions = certificateFromBase64(value, { type: 'pem' })
    expect(authOptions.type).toBe('pem')
    expect(authOptions.certificate).toBe(pem)
  })

  it('decodes a pfx certificate to a Buffer and passes the password through', () => {
    const bytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const value = bytes.toString('base64')
    const authOptions = certificateFromBase64(value, { type: 'pfx', password: 'secret' })
    expect(authOptions.type).toBe('pfx')
    expect(Buffer.isBuffer(authOptions.certificate)).toBe(true)
    expect(authOptions.certificate).toEqual(bytes)
    expect(authOptions.password).toBe('secret')
  })

  it('decodes ca to a Buffer for either certificate type, and omits it when absent', () => {
    const certBytes = Buffer.from('cert-bytes')
    const caBytes = Buffer.from('ca-bytes')
    const withCa = certificateFromBase64(certBytes.toString('base64'), {
      type: 'pfx',
      ca: caBytes.toString('base64'),
    })
    expect(Buffer.isBuffer(withCa.ca)).toBe(true)
    expect(withCa.ca).toEqual(caBytes)

    const withoutCa = certificateFromBase64(certBytes.toString('base64'), { type: 'pfx' })
    expect('ca' in withoutCa).toBe(false)
    expect('password' in withoutCa).toBe(false)
  })

  it('rejects a missing or empty certificate before decoding anything', () => {
    expect(() => certificateFromBase64(undefined, { type: 'pem' })).toThrowError(
      expect.objectContaining({ code: 'invalid_configuration' }),
    )
    expect(() => certificateFromBase64('', { type: 'pem' })).toThrowError(
      expect.objectContaining({ code: 'invalid_configuration' }),
    )
  })

  it('rejects malformed base64 instead of silently truncating it', () => {
    expect(() => certificateFromBase64('not-valid-base64!!!', { type: 'pem' })).toThrowError(
      expect.objectContaining({ code: 'invalid_configuration' }),
    )
    // Missing padding decodes "successfully" but does not round-trip, so it is
    // rejected too — the whole point is catching an off-by-one-character typo.
    expect(() => certificateFromBase64('SGVsbG8', { type: 'pem' })).toThrowError(
      expect.objectContaining({ code: 'invalid_configuration' }),
    )
  })

  it('rejects malformed ca independently of a valid certificate', () => {
    const certBytes = Buffer.from('cert-bytes')
    expect(() =>
      certificateFromBase64(certBytes.toString('base64'), {
        type: 'pem',
        ca: 'not-valid-base64!!!',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_configuration' }))
  })

  it('never includes the certificate value in a thrown error message', () => {
    const secret = 'TOTALLY-SECRET-VALUE'
    try {
      certificateFromBase64(`not-valid-base64!!!${secret}`, { type: 'pem' })
      expect.unreachable('expected certificateFromBase64 to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).not.toContain(secret)
      expect(JSON.stringify(err)).not.toContain(secret)
    }
  })
})
