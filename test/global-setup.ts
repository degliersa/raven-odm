import { execFileSync, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.env.RAVENDB_URL ?? 'http://127.0.0.1:8099'
const container = 'raven-odm-test'
let startedBySetup = false

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/build/version`)
      if (response.ok) return
    } catch {
      // RavenDB is still booting.
    }
    await delay(1_000)
  }
  throw new Error(`RavenDB did not become ready at ${url}`)
}

export async function setup(): Promise<() => void> {
  if (!process.env.RAVENDB_URL) {
    const existing = spawnSync('docker', ['inspect', '--format={{.State.Running}}', container], {
      stdio: 'pipe',
      encoding: 'utf8',
    })
    if (existing.status !== 0 || existing.stdout.trim() !== 'true') {
      execFileSync(
        'docker',
        [
          'run',
          '-d',
          '--name',
          container,
          '-p',
          '8099:8080',
          '-e',
          'RAVEN_Setup_Mode=None',
          '-e',
          'RAVEN_License_Eula_Accepted=true',
          '-e',
          'RAVEN_Security_UnsecuredAccessAllowed=PublicNetwork',
          'ravendb/ravendb:latest',
        ],
        { stdio: 'ignore' },
      )
      startedBySetup = true
    }
  }
  await waitForServer()
  return () => {
    if (startedBySetup) spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  }
}
