import type { Database, Transaction } from '#collector/database'
import { operatorQueries } from '#collector/operator-queries'
import { Pool, type PoolClient } from 'pg'

const schema = `
CREATE TABLE IF NOT EXISTS telemetry_state (
    path text PRIMARY KEY,
    data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_state_install ON telemetry_state ((data->>'installId'));
CREATE INDEX IF NOT EXISTS telemetry_state_expiry ON telemetry_state ((data->>'expiresAt'));
CREATE INDEX IF NOT EXISTS telemetry_state_collection_path ON telemetry_state ((split_part(path,'/',1)),path COLLATE "C");
CREATE TABLE IF NOT EXISTS telemetry_events (
    batch_path text NOT NULL REFERENCES telemetry_state(path) ON DELETE CASCADE,
    sequence integer NOT NULL,
    installation_id uuid NOT NULL,
    session_id uuid,
    occurred_at timestamptz,
    received_at timestamptz NOT NULL,
    manufacturer text NOT NULL,
    model text NOT NULL,
    firmware text NOT NULL,
    revision text NOT NULL,
    transport text NOT NULL,
    evidence text NOT NULL,
    kind text NOT NULL,
    code integer,
    failed boolean NOT NULL,
    properties jsonb NOT NULL,
    PRIMARY KEY (batch_path, sequence)
);
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS hardware_fingerprint text;
CREATE INDEX IF NOT EXISTS telemetry_events_hardware_time ON telemetry_events (hardware_fingerprint,received_at) WHERE hardware_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS telemetry_events_install_time ON telemetry_events (installation_id, received_at);
CREATE INDEX IF NOT EXISTS telemetry_events_session ON telemetry_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS telemetry_events_model ON telemetry_events (manufacturer, model, transport);
CREATE INDEX IF NOT EXISTS telemetry_events_received ON telemetry_events (received_at);
CREATE INDEX IF NOT EXISTS telemetry_events_session_replay ON telemetry_events
    (installation_id,session_id,(coalesce(occurred_at,received_at)),batch_path,sequence);
CREATE INDEX IF NOT EXISTS telemetry_events_protocol ON telemetry_events
    ((properties->'protocol'->>'type'),received_at) WHERE properties ? 'protocol';
CREATE INDEX IF NOT EXISTS telemetry_events_benchmark ON telemetry_events
    (installation_id,(properties->'protocol'->>'benchmarkId')) WHERE properties ? 'protocol';
`

function checkedPath(path: string) {
    if (!/^[\w-]+\/[\w.-]+$/.test(path)) throw new Error('Invalid telemetry record path')
    return path
}
function restoreDates(data: Record<string, any>) {
    return JSON.parse(JSON.stringify(data), (key, value) =>
        /At$/.test(key) && typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? new Date(value) : value
    )
}

/** Two tables: private operational state and flat, queryable diagnostic events. */
export async function postgresDatabase(connectionString: string) {
    if (!connectionString) throw new Error('DATABASE_URL is required')
    const pool = new Pool({
        connectionString,
        max: 8,
        connectionTimeoutMillis: 5000,
        statement_timeout: 15_000,
        idle_in_transaction_session_timeout: 20_000,
    })
    // Pool errors must not crash an otherwise idle HTTP service.
    pool.on('error', () => console.error('Telemetry database connection unavailable'))
    try {
        await pool.query(
            "BEGIN; SELECT pg_advisory_xact_lock(hashtext('darkgrade.telemetry.schema'));" + schema + ';COMMIT;'
        )
    } catch (error) {
        await pool.end()
        throw error
    }
    const read = async (connection: Pool | PoolClient, path: string) => {
        const result = await connection.query('SELECT data FROM telemetry_state WHERE path = $1', [checkedPath(path)])
        return result.rows[0] ? restoreDates(result.rows[0].data) : undefined
    }
    const write = async (connection: PoolClient, path: string, data: Record<string, any>) => {
        await connection.query(
            'INSERT INTO telemetry_state(path,data) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data',
            [checkedPath(path), JSON.stringify(data)]
        )
        if (!path.startsWith('diagnostics/')) return
        const batch = JSON.parse(data.payload)
        let sequence = 0
        await connection.query('DELETE FROM telemetry_events WHERE batch_path=$1', [path])
        const events = batch.contributions.flatMap((contribution: any) =>
            contribution.entries.map((event: any) => ({
                batch_path: path,
                sequence: sequence++,
                installation_id: data.installId,
                session_id: event.sessionId ?? null,
                occurred_at: event.occurredAt ?? null,
                received_at: data.receivedAt,
                manufacturer: contribution.camera.manufacturer,
                model: contribution.camera.model,
                firmware: contribution.camera.firmware,
                revision: contribution.camera.revision,
                transport: contribution.camera.transport,
                evidence: contribution.camera.evidence,
                hardware_fingerprint: contribution.camera.hardwareFingerprint ?? null,
                kind: event.kind,
                code: event.code ?? null,
                failed: event.failed,
                properties: { ...event, dirty: contribution.camera.dirty, droppedEntries: contribution.droppedEntries },
            }))
        )
        // One database round trip for a whole batch, not one per camera message.
        await connection.query(
            `INSERT INTO telemetry_events
            (batch_path,sequence,installation_id,session_id,occurred_at,received_at,manufacturer,model,
             firmware,revision,transport,evidence,kind,code,failed,properties,hardware_fingerprint)
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS events(
                batch_path text, sequence integer, installation_id uuid, session_id uuid,
                occurred_at timestamptz, received_at timestamptz, manufacturer text, model text,
                firmware text, revision text, transport text, evidence text, kind text, code integer,
                failed boolean, properties jsonb, hardware_fingerprint text)`,
            [JSON.stringify(events)]
        )
    }
    const database: Database & {
        operator: ReturnType<typeof operatorQueries>
        close(): Promise<void>
        expire(): Promise<void>
        health(): Promise<void>
        timeline(filters: {
            installation?: string
            model?: string
            session?: string
        }): Promise<Record<string, unknown>[]>
    } = {
        operator: operatorQueries(pool),
        get: path => read(pool, path),
        async transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
            for (let attempt = 0; attempt < 6; attempt++) {
                const connection = await pool.connect()
                try {
                    await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
                    const changes = new Map<string, Record<string, any> | null>()
                    const value = await work({
                        get: async path =>
                            changes.has(path)
                                ? structuredClone(changes.get(path) ?? undefined)
                                : read(connection, path),
                        set: (path, data) => {
                            changes.set(checkedPath(path), structuredClone(data))
                        },
                        delete: path => {
                            changes.set(checkedPath(path), null)
                        },
                    })
                    for (const [path, data] of changes) {
                        if (data === null) await connection.query('DELETE FROM telemetry_state WHERE path=$1', [path])
                        else await write(connection, path, data)
                    }
                    await connection.query('COMMIT')
                    return value
                } catch (error) {
                    await connection.query('ROLLBACK').catch(() => {})
                    if (!['40001', '40P01', '23505'].includes((error as { code?: string }).code ?? '') || attempt === 5)
                        throw error
                } finally {
                    connection.release()
                }
                await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 20))
            }
            throw new Error('Telemetry transaction contended')
        },
        async list(collection, field, value, after) {
            if (!/^[\w-]+$/.test(collection) || (field && !/^\w+$/.test(field))) throw new Error('Invalid query')
            const result = await pool.query(
                `SELECT path,data FROM telemetry_state WHERE split_part(path,'/',1)=$1
                 AND ($2::text IS NULL OR data->$2=$3::jsonb)
                 AND ($4::text IS NULL OR path COLLATE "C" > $4 COLLATE "C") ORDER BY path COLLATE "C" LIMIT 100`,
                [collection, field ?? null, field ? JSON.stringify(value) : null, after ?? null]
            )
            return result.rows.map(row => ({ path: row.path, data: restoreDates(row.data) }))
        },
        async matrixSources(after) {
            // One statement supplies a consistent snapshot without hundreds of serializable
            // transactions competing with camera uploads. Bound the source page before joins.
            const result = await pool.query(
                `WITH sources AS MATERIALIZED (
                    SELECT path,data FROM telemetry_state
                    WHERE split_part(path,'/',1)='diagnostics'
                    AND ($1::text IS NULL OR path COLLATE "C" > $1 COLLATE "C")
                    ORDER BY path COLLATE "C" LIMIT 100
                )
                SELECT s.path,s.data AS original,i.data AS installation,r.data AS reviewed,
                    c.data AS contact,f.data AS research
                FROM sources s
                LEFT JOIN telemetry_state i ON i.path='installations/'||(s.data->>'installId')
                LEFT JOIN telemetry_state r ON r.path='reviewedPatterns/'||substring(s.path from 13)
                LEFT JOIN telemetry_state c ON c.path='contacts/'||(s.data->>'installId')
                LEFT JOIN telemetry_state f ON f.path='protocolFindings/'||substring(s.path from 13)
                ORDER BY s.path COLLATE "C"`,
                [after ?? null]
            )
            return result.rows.map(row => ({
                path: row.path,
                ...Object.fromEntries(['original', 'installation', 'reviewed', 'contact', 'research']
                    .map(key => [key, row[key] ? restoreDates(row[key]) : undefined])),
            }))
        },
        async expire() {
            // FK cascade removes the associated flat events in the same transaction.
            await pool.query(`DELETE FROM telemetry_state WHERE path IN (
                SELECT path FROM telemetry_state
                WHERE data->>'expiresAt' < to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                LIMIT 1000
            )`)
        },
        async health() {
            await pool.query('SELECT 1')
        },
        async timeline(filters) {
            const result = await pool.query(
                `SELECT batch_path, sequence, installation_id, session_id, occurred_at, received_at, manufacturer, model,
                    firmware, revision, transport, evidence, kind, code, failed, properties, hardware_fingerprint
                 FROM telemetry_events
                 WHERE ($1::text IS NULL OR installation_id::text=$1)
                   AND ($2::text IS NULL OR model=$2)
                   AND ($3::text IS NULL OR session_id::text=$3)
                   AND received_at > now() - interval '90 days'
                 ORDER BY received_at DESC, batch_path, sequence LIMIT 500`,
                [filters.installation || null, filters.model || null, filters.session || null]
            )
            return result.rows
        },
        close: () => pool.end(),
    }
    return database
}
