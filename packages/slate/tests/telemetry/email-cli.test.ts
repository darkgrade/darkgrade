import { createTelemetry, resendContactSender, type ContactMessage } from '@darkgrade/slate/telemetry/server'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { memoryDatabase } from './telemetry-fixture.ts'

test('actual CLI and HTTPS collector link a verified email, report status and unlink without changing consent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-email-cli-'))
    const certificate = join(directory, 'certificate.pem')
    const key = join(directory, 'key.pem')
    const fixture = memoryDatabase()
    const messages: ContactMessage[] = []
    let now = Date.now(),
        providerFails = false,
        requests = 0
    const sender = resendContactSender('server-only-test-key', 'contact@example.com', async () =>
        providerFails
            ? Response.json({ error: 'private provider reason' }, { status: 403 })
            : Response.json({ id: 'f1ab6c3d-1679-42fa-bc14-561b69c3e6bb' })
    )
    let handle: (request: Request) => Promise<Response>
    let server: ReturnType<typeof createServer> | undefined
    try {
        await promisify(execFile)('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            key,
            '-out',
            certificate,
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=DNS:localhost,IP:127.0.0.1',
        ])
        const certificateBytes = await readFile(certificate)
        server = createServer({ key: await readFile(key), cert: certificateBytes }, async (incoming, outgoing) => {
            requests++
            try {
                const chunks: Buffer[] = []
                for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
                const response = await handle(
                    new Request(origin + incoming.url, {
                        method: incoming.method,
                        headers: incoming.headers as Record<string, string>,
                        ...(!['GET', 'HEAD'].includes(incoming.method!) && { body: Buffer.concat(chunks) }),
                    })
                )
                outgoing.writeHead(response.status, Object.fromEntries(response.headers))
                outgoing.end(await response.text())
            } catch {
                outgoing.writeHead(500)
                outgoing.end()
            }
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        assert.ok(address && typeof address === 'object')
        const origin = `https://127.0.0.1:${address.port}`
        handle = createTelemetry(fixture.database, {
            publicUrl: origin,
            now: () => new Date(now),
            sendContact: async message => {
                await sender(message)
                messages.push(message)
            },
        })
        const runner =
            'import {runDarkgradeCli} from "@darkgrade/slate/cli"; process.exitCode=await runDarkgradeCli(process.argv.slice(1));'
        const run = (...args: string[]) =>
            promisify(execFile)(
                process.execPath,
                ['--input-type=module', '--eval', runner, '--', 'telemetry', ...args],
                {
                    cwd: fileURLToPath(new URL('../..', import.meta.url)),
                    env: {
                        ...process.env,
                        DARKGRADE_HOME: directory,
                        DARKGRADE_TELEMETRY_URL: origin,
                        NODE_EXTRA_CA_CERTS: certificate,
                        NODE_ENV: 'production',
                        DO_NOT_TRACK: '0',
                        DARKGRADE_CONTRIBUTIONS: '1',
                    },
                    timeout: 20_000,
                }
            )
        const status = await run('status')
        assert.equal(JSON.parse(status.stdout).contact, undefined)
        assert.equal(requests, 0, 'ordinary status stays offline')
        assert.equal(JSON.parse((await run('status', '--email')).stdout).contact, null)
        assert.equal(requests, 0, 'email status cannot enroll a new installation')
        assert.match((await run('login', 'Contributor@example.com')).stdout, /Confirmation email requested/)
        assert.equal(messages.length, 1)
        assert.deepEqual(JSON.parse((await run('status', '--email')).stdout).contact,
            { email: 'contributor@example.com', verified: false, credit: null })
        const token = new URL(messages[0].confirmationUrl).hash.slice(1)
        const confirm = () =>
            new Promise<number>((resolve, reject) => {
                const request = httpsRequest(
                    origin + '/v2/contact/confirm',
                    {
                        method: 'POST',
                        ca: certificateBytes,
                        headers: { 'content-type': 'application/json' },
                    },
                    response => {
                        response.resume()
                        response.on('end', () => resolve(response.statusCode ?? 0))
                    }
                )
                request.on('error', reject)
                request.end(JSON.stringify({ token }))
            })
        assert.equal(await confirm(), 200)
        assert.equal(await confirm(), 410)
        const contact = JSON.parse((await run('status', '--email')).stdout).contact
        assert.equal(contact.email, 'contributor@example.com')
        assert.equal(contact.verified, true)
        assert.equal(contact.credit, null, 'email linking does not publish contributor credit')
        assert.doesNotMatch(
            await readFile(join(directory, 'settings.json'), 'utf8'),
            /contributor@example.com|server-only-test-key/
        )
        await run('opt-out')
        assert.equal(JSON.parse((await run('status', '--email')).stdout).contact.verified, true)
        assert.equal(JSON.parse((await run('status')).stdout).sharing, false)
        await run('logout')
        assert.equal(JSON.parse((await run('status', '--email')).stdout).contact, null)
        assert.equal(JSON.parse((await run('status')).stdout).sharing, false)
        const offlineRequests = requests
        await assert.rejects(run('login', 'contributor@example.com'), error =>
            /Turn on sharing to link an email/.test(String((error as { stderr: string }).stderr))
        )
        assert.equal(requests, offlineRequests, 'opting out cannot send another confirmation')
        await run('opt-in')
        now += 61_000
        providerFails = true
        await assert.rejects(run('login', 'contributor@example.com'), error =>
            /Email confirmation is temporarily unavailable/.test(String((error as { stderr: string }).stderr))
        )
        assert.deepEqual(JSON.parse((await run('status', '--email')).stdout).contact,
            { email: 'contributor@example.com', verified: false, credit: null })
        assert.equal((await fixture.database.list('diagnostics')).length, 0)
        await run('delete')
        assert.equal(JSON.parse((await run('status')).stdout).sharing, false)
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
        await rm(directory, { recursive: true, force: true })
    }
})
