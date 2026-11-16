import type { Database } from '#collector/database'
import { changeMatrixGeneration } from '#collector/matrix-generation'
import { validateBatch } from '@darkgrade/contribute/batch'

export interface ProtocolFinding {
    scope: {
        manufacturer: string
        model: string
        firmware: string
        revision: string
        transport: string
        evidence: string
    }
    category: 'operation' | 'property' | 'event' | 'response'
    code: number
    name: string
    summary: string
    status: 'documented' | 'tested'
    references: Array<{ title: string; revision: string; locator: string; url?: string }>
}
export function validateFinding(value: unknown): asserts value is ProtocolFinding {
    const item = value as ProtocolFinding
    const text = (value: unknown, maximum: number) =>
        typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f]/.test(value)
    if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).some(
            key => !['scope', 'category', 'code', 'name', 'summary', 'status', 'references'].includes(key)
        ) ||
        !['operation', 'property', 'event', 'response'].includes(item.category) ||
        !Number.isSafeInteger(item.code) ||
        item.code < 0 ||
        item.code > (item.category === 'property' ? 0xffffffff : 0xffff) ||
        !text(item.name, 80) ||
        !text(item.summary, 500) ||
        !['documented', 'tested'].includes(item.status) ||
        !Array.isArray(item.references) ||
        item.references.length < 1 ||
        item.references.length > 8
    )
        throw new Error('Invalid protocol finding')
    if (
        !item.scope ||
        Object.keys(item.scope).sort().join(',') !== 'evidence,firmware,manufacturer,model,revision,transport' ||
        Object.values(item.scope).some(value => !text(value, 100)) ||
        !['hardware', 'synthetic'].includes(item.scope.evidence) ||
        !['usb', 'ptp-ip', 'wifi', 'unknown', 'sony-sdk'].includes(item.scope.transport) ||
        !/^[a-f0-9]{7,40}$/.test(item.scope.revision)
    )
        throw new Error('Invalid finding scope')
    for (const reference of item.references) {
        if (
            !reference ||
            Object.keys(reference).some(key => !['title', 'revision', 'locator', 'url'].includes(key)) ||
            !text(reference.title, 120) ||
            !text(reference.revision, 80) ||
            !text(reference.locator, 240)
        )
            throw new Error('A source, revision and exact location are required')
        if (reference.url !== undefined) {
            const url = new URL(reference.url)
            if (url.protocol !== 'https:' || url.username || url.password || url.search || reference.url.length > 500)
                throw new Error('Use a credential-free HTTPS source URL')
        }
    }
    if (item.status === 'tested' && !item.references.some(reference => /test/i.test(reference.locator)))
        throw new Error('Tested findings require a regression test reference')
}

/** Findings belong to original evidence. Withdrawal/expiry removes their export and attribution together. */
export async function saveProtocolFinding(database: Database, sourceRecord: string, input: unknown) {
    if (!/^[a-f0-9-]{36}_[a-f0-9-]{36}$/.test(sourceRecord)) throw new Error('Invalid source record')
    validateFinding(input)
    return database.transaction(async transaction => {
        const original = await transaction.get(`diagnostics/${sourceRecord}`)
        if (!original || !(original.expiresAt instanceof Date) || +original.expiresAt <= Date.now())
            throw new Error('Source expired or unavailable')
        const installation = await transaction.get(`installations/${original.installId}`)
        if (!installation || installation.revoked) throw new Error('Source withdrawn')
        const batch = JSON.parse(original.payload)
        validateBatch(batch)
        if (
            !batch.contributions.some(
                contribution =>
                    Object.entries(input.scope).every(
                        ([key, value]) => (contribution.camera as unknown as Record<string, unknown>)[key] === value
                    ) &&
                    contribution.entries.some(
                        entry =>
                            entry.protocol?.type === 'unknown' &&
                            entry.protocol.category === input.category &&
                            entry.protocol.code === input.code
                    )
            )
        )
            throw new Error('This source does not contain that unknown code')
        const path = `protocolFindings/${sourceRecord}`
        const previous = await transaction.get(path)
        const findings = (previous?.findings ?? []).filter(
            (item: ProtocolFinding) =>
                item.category !== input.category ||
                item.code !== input.code ||
                Object.entries(input.scope).some(([key, value]) => item.scope[key as keyof typeof item.scope] !== value)
        )
        if (findings.length >= 128) throw new Error('Source finding limit reached')
        findings.push(structuredClone(input))
        transaction.set(path, {
            installId: original.installId,
            sourceHash: original.sha256,
            expiresAt: original.expiresAt,
            findings,
        })
        changeMatrixGeneration(transaction)
        return { saved: true, sourceRecord, hardwarePass: false }
    })
}
