import type { Database, Transaction } from '#collector/database'
import { operatorQueries } from '#collector/operator-queries'
import { Pool, type PoolClient } from 'pg'
import {cameraConnection} from '#collector/transport'

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
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS backend text NOT NULL DEFAULT 'unknown';
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS connection_normalized boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS telemetry_events_pending_connection ON telemetry_events(batch_path) WHERE NOT connection_normalized;
CREATE INDEX IF NOT EXISTS telemetry_events_legacy_connection ON telemetry_events(batch_path) WHERE NOT connection_normalized AND transport='sony-sdk';
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
CREATE TABLE IF NOT EXISTS telemetry_sessions (
    installation_id uuid NOT NULL,
    session_id uuid NOT NULL,
    events bigint NOT NULL,
    errors bigint NOT NULL,
    signals bigint NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    latest_received_at timestamptz NOT NULL,
    manufacturer text NOT NULL,
    model text NOT NULL,
    transports text[] NOT NULL,
    evidence text[] NOT NULL,
    backends text[] NOT NULL,
    revisions text[] NOT NULL,
    hardware_fingerprints text[] NOT NULL,
    truncated boolean NOT NULL,
    stale boolean NOT NULL DEFAULT false,
    PRIMARY KEY (installation_id, session_id)
);
CREATE INDEX IF NOT EXISTS telemetry_sessions_recent ON telemetry_sessions (latest_received_at, installation_id, session_id);
CREATE INDEX IF NOT EXISTS telemetry_sessions_stale ON telemetry_sessions (installation_id) WHERE stale;
CREATE TABLE IF NOT EXISTS telemetry_session_signals (
    installation_id uuid NOT NULL,
    session_id uuid NOT NULL,
    signal text NOT NULL,
    events bigint NOT NULL,
    latest timestamptz NOT NULL,
    PRIMARY KEY (installation_id, session_id, signal)
);
CREATE INDEX IF NOT EXISTS telemetry_session_signals_signal ON telemetry_session_signals (signal, latest);
CREATE TABLE IF NOT EXISTS telemetry_rollup_state (name text PRIMARY KEY, completed_at timestamptz NOT NULL);
CREATE OR REPLACE FUNCTION telemetry_event_signal(failed boolean, kind text, code integer, properties jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
    SELECT CASE WHEN failed THEN 'failed'
        WHEN coalesce((properties->>'droppedEntries')::int,0)>0 THEN 'dropped-events'
        WHEN properties ? 'operation' THEN 'operation:'||(properties->>'operation')
        WHEN kind='response' AND code=8193 THEN 'ok'
        WHEN code IS NOT NULL THEN kind||':0x'||lpad(to_hex(code),4,'0')
        ELSE kind END
$f$;
CREATE OR REPLACE FUNCTION telemetry_union(a text[], b text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
    SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}') FROM unnest(a||b) AS value WHERE value IS NOT NULL
$f$;
CREATE OR REPLACE FUNCTION telemetry_events_added() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
    INSERT INTO telemetry_sessions AS s (installation_id,session_id,events,errors,signals,started_at,ended_at,
        latest_received_at,manufacturer,model,transports,evidence,backends,revisions,hardware_fingerprints,truncated)
    SELECT installation_id, coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid) AS session_id, count(*),
        count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)),
        count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)
            OR coalesce((properties->>'droppedEntries')::int,0)>0),
        min(coalesce(occurred_at,received_at)), max(coalesce(occurred_at,received_at)), max(received_at),
        (array_agg(manufacturer ORDER BY (model='Unknown'),received_at DESC))[1],
        (array_agg(model ORDER BY (model='Unknown'),received_at DESC))[1],
        telemetry_union(array_agg(transport),'{}'), telemetry_union(array_agg(evidence),'{}'),
        telemetry_union(array_agg(backend),'{}'), telemetry_union(array_agg(revision),'{}'),
        telemetry_union(array_agg(hardware_fingerprint),'{}'),
        bool_or(coalesce((properties->>'droppedEntries')::int,0)>0)
    FROM added GROUP BY 1,2 ORDER BY 1,2
    ON CONFLICT (installation_id,session_id) DO UPDATE SET
        events=s.events+EXCLUDED.events, errors=s.errors+EXCLUDED.errors, signals=s.signals+EXCLUDED.signals,
        started_at=least(s.started_at,EXCLUDED.started_at), ended_at=greatest(s.ended_at,EXCLUDED.ended_at),
        latest_received_at=greatest(s.latest_received_at,EXCLUDED.latest_received_at),
        manufacturer=CASE WHEN EXCLUDED.model<>'Unknown' OR s.model='Unknown' THEN EXCLUDED.manufacturer ELSE s.manufacturer END,
        model=CASE WHEN EXCLUDED.model<>'Unknown' OR s.model='Unknown' THEN EXCLUDED.model ELSE s.model END,
        transports=telemetry_union(s.transports,EXCLUDED.transports), evidence=telemetry_union(s.evidence,EXCLUDED.evidence),
        backends=telemetry_union(s.backends,EXCLUDED.backends), revisions=telemetry_union(s.revisions,EXCLUDED.revisions),
        hardware_fingerprints=telemetry_union(s.hardware_fingerprints,EXCLUDED.hardware_fingerprints),
        truncated=s.truncated OR EXCLUDED.truncated;
    INSERT INTO telemetry_session_signals AS g (installation_id,session_id,signal,events,latest)
    SELECT installation_id, coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid),
        telemetry_event_signal(failed,kind,code,properties), count(*), max(received_at)
    FROM added GROUP BY 1,2,3 ORDER BY 1,2,3
    ON CONFLICT (installation_id,session_id,signal) DO UPDATE SET
        events=g.events+EXCLUDED.events, latest=greatest(g.latest,EXCLUDED.latest);
    RETURN NULL;
END $f$;
CREATE OR REPLACE FUNCTION telemetry_events_removed() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
    -- Counts stay exact immediately. Time bounds and label sets are refreshed by maintenance (stale).
    UPDATE telemetry_sessions s SET events=s.events-r.events, errors=s.errors-r.errors, signals=s.signals-r.signals, stale=true
    FROM (SELECT installation_id, coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid) AS session_id, count(*) AS events,
            count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)) AS errors,
            count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)
                OR coalesce((properties->>'droppedEntries')::int,0)>0) AS signals
          FROM removed GROUP BY 1,2) r
    WHERE s.installation_id=r.installation_id AND s.session_id=r.session_id;
    DELETE FROM telemetry_sessions s USING (SELECT DISTINCT installation_id,
            coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid) AS session_id FROM removed) r
    WHERE s.installation_id=r.installation_id AND s.session_id=r.session_id AND s.events<=0;
    UPDATE telemetry_session_signals g SET events=g.events-r.events
    FROM (SELECT installation_id, coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid) AS session_id,
            telemetry_event_signal(failed,kind,code,properties) AS signal, count(*) AS events FROM removed GROUP BY 1,2,3) r
    WHERE g.installation_id=r.installation_id AND g.session_id=r.session_id AND g.signal=r.signal;
    DELETE FROM telemetry_session_signals g USING (SELECT DISTINCT installation_id,
            coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid) AS session_id FROM removed) r
    WHERE g.installation_id=r.installation_id AND g.session_id=r.session_id AND g.events<=0;
    RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS telemetry_events_added ON telemetry_events;
CREATE TRIGGER telemetry_events_added AFTER INSERT ON telemetry_events
    REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION telemetry_events_added();
DROP TRIGGER IF EXISTS telemetry_events_removed ON telemetry_events;
CREATE TRIGGER telemetry_events_removed AFTER DELETE ON telemetry_events
    REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION telemetry_events_removed();
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

const sessionless = "'00000000-0000-0000-0000-000000000000'::uuid"
/** A connection's first commands precede its identity read. Give those events the single camera
 * identity the same connection session observed later; signed source payloads stay unchanged. */
const adoptSessionIdentity = (scope: string) => `
    UPDATE telemetry_events u SET manufacturer=k.manufacturer, model=k.model, firmware=k.firmware,
        hardware_fingerprint=coalesce(u.hardware_fingerprint,k.hardware_fingerprint)
    FROM (SELECT installation_id, session_id, min(manufacturer) AS manufacturer, min(model) AS model,
            min(firmware) AS firmware, min(hardware_fingerprint) AS hardware_fingerprint
          FROM telemetry_events e WHERE model<>'Unknown' AND session_id IS NOT NULL ${scope}
          GROUP BY 1,2 HAVING count(DISTINCT (manufacturer,model,firmware))=1
            AND count(DISTINCT hardware_fingerprint)<=1) k
    WHERE u.model='Unknown' AND u.installation_id=k.installation_id AND u.session_id=k.session_id`
const sessionAggregate = `count(*) AS events,
    count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)) AS errors,
    count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)
        OR coalesce((properties->>'droppedEntries')::int,0)>0) AS signals,
    min(coalesce(occurred_at,received_at)) AS started_at, max(coalesce(occurred_at,received_at)) AS ended_at,
    max(received_at) AS latest_received_at,
    (array_agg(manufacturer ORDER BY (model='Unknown'),received_at DESC))[1] AS manufacturer,
    (array_agg(model ORDER BY (model='Unknown'),received_at DESC))[1] AS model,
    telemetry_union(array_agg(DISTINCT transport),'{}') AS transports, telemetry_union(array_agg(DISTINCT evidence),'{}') AS evidence,
    telemetry_union(array_agg(DISTINCT backend),'{}') AS backends, telemetry_union(array_agg(DISTINCT revision),'{}') AS revisions,
    telemetry_union(array_agg(DISTINCT hardware_fingerprint),'{}') AS hardware_fingerprints,
    bool_or(coalesce((properties->>'droppedEntries')::int,0)>0) AS truncated`
const sessionColumns = `events,errors,signals,started_at,ended_at,latest_received_at,manufacturer,model,
    transports,evidence,backends,revisions,hardware_fingerprints,truncated`

/** Build the session summaries once from existing events. Uploads wait briefly behind the table
 * lock so no event is counted twice or missed; later starts find the marker and skip this. */
const rebuilt = new WeakSet<Pool>()
async function backfillRollups(pool: Pool) {
    if (rebuilt.has(pool)) return
    const done = await pool.query("SELECT 1 FROM telemetry_rollup_state WHERE name='sessions-v1'")
    if (done.rowCount) {
        rebuilt.add(pool)
        return
    }
    const connection = await pool.connect()
    try {
        await connection.query('BEGIN')
        await connection.query('SET LOCAL statement_timeout=0')
        await connection.query("SELECT pg_advisory_xact_lock(hashtext('darkgrade.telemetry.rollup'))")
        const again = await connection.query("SELECT 1 FROM telemetry_rollup_state WHERE name='sessions-v1'")
        if (!again.rowCount) {
            await connection.query('LOCK TABLE telemetry_events IN SHARE ROW EXCLUSIVE MODE')
            await connection.query(`CREATE INDEX IF NOT EXISTS telemetry_events_errors ON telemetry_events (received_at)
                WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193)`)
            await connection.query(adoptSessionIdentity(''))
            await connection.query('DELETE FROM telemetry_session_signals')
            await connection.query('DELETE FROM telemetry_sessions')
            await connection.query(`INSERT INTO telemetry_sessions (installation_id,session_id,${sessionColumns})
                SELECT installation_id, coalesce(session_id,${sessionless}), ${sessionAggregate}
                FROM telemetry_events GROUP BY 1,2`)
            await connection.query(`INSERT INTO telemetry_session_signals (installation_id,session_id,signal,events,latest)
                SELECT installation_id, coalesce(session_id,${sessionless}),
                    telemetry_event_signal(failed,kind,code,properties), count(*), max(received_at)
                FROM telemetry_events GROUP BY 1,2,3`)
            await connection.query("INSERT INTO telemetry_rollup_state VALUES('sessions-v1',now())")
        }
        await connection.query('COMMIT')
        rebuilt.add(pool)
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => {})
        throw error
    } finally {
        connection.release()
    }
}

/** Private operational state, flat diagnostic events, and per-session summaries kept current at ingest. */
export async function postgresDatabase(connectionString: string, options: { deferSummaryRebuild?: boolean } = {}) {
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
        // A service defers this until it is listening: the rebuild can outlast a startup probe.
        if (!options.deferSummaryRebuild) await backfillRollups(pool)
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
        const events = batch.contributions.flatMap((contribution: any) => {
            const camera = cameraConnection(contribution.camera,contribution.entries)
            return contribution.entries.map((event: any) => ({
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
                transport: camera.transport,
                backend: camera.backend,
                connection_normalized: true,
                evidence: contribution.camera.evidence,
                hardware_fingerprint: contribution.camera.hardwareFingerprint ?? null,
                kind: event.kind,
                code: event.code ?? null,
                failed: event.failed,
                properties: { ...event, dirty: contribution.camera.dirty, droppedEntries: contribution.droppedEntries },
            }))
        })
        // One database round trip for a whole batch, not one per camera message.
        await connection.query(
            `INSERT INTO telemetry_events
            (batch_path,sequence,installation_id,session_id,occurred_at,received_at,manufacturer,model,
             firmware,revision,transport,evidence,kind,code,failed,properties,hardware_fingerprint,backend,connection_normalized)
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS events(
                batch_path text, sequence integer, installation_id uuid, session_id uuid,
                occurred_at timestamptz, received_at timestamptz, manufacturer text, model text,
                firmware text, revision text, transport text, evidence text, kind text, code integer,
                failed boolean, properties jsonb, hardware_fingerprint text, backend text, connection_normalized boolean)`,
            [JSON.stringify(events)]
        )
        const sessions = [...new Set(events.map((event: { session_id: string | null }) => event.session_id).filter(Boolean))]
        if (!sessions.length) return
        const unidentified = await connection.query(
            `SELECT DISTINCT session_id FROM telemetry_events
             WHERE installation_id=$1::uuid AND session_id=ANY($2::uuid[]) AND model='Unknown'`,
            [data.installId, sessions]
        )
        if (!unidentified.rowCount) return
        await connection.query(adoptSessionIdentity('AND e.installation_id=$1::uuid AND e.session_id=ANY($2::uuid[])'), [
            data.installId,
            unidentified.rows.map(row => row.session_id),
        ])
        // Session summaries were written before adoption; a later identity must replace Unknown there too.
        await connection.query(
            `UPDATE telemetry_sessions s SET manufacturer=k.manufacturer, model=k.model,
                hardware_fingerprints=telemetry_union(s.hardware_fingerprints,k.fingerprints)
             FROM (SELECT installation_id, session_id, min(manufacturer) AS manufacturer, min(model) AS model,
                    array_agg(DISTINCT hardware_fingerprint) AS fingerprints FROM telemetry_events
                   WHERE installation_id=$1::uuid AND session_id=ANY($2::uuid[]) AND model<>'Unknown'
                   GROUP BY 1,2 HAVING count(DISTINCT (manufacturer,model))=1) k
             WHERE s.installation_id=k.installation_id AND s.session_id=k.session_id AND s.model='Unknown'`,
            [data.installId, unidentified.rows.map(row => row.session_id)]
        )
    }
    const database: Database & {
        operator: ReturnType<typeof operatorQueries>
        close(): Promise<void>
        expire(): Promise<void>
        normalizeConnections(): Promise<number>
        refreshSessions(): Promise<number>
        rebuildSummaries(): Promise<void>
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
        async normalizeConnections() {
            // Run after HTTP startup. Each statement commits a bounded set of whole batches,
            // so interrupted rollouts resume without rewriting signed source payloads.
            // Old collector instances can still insert during a rolling update: their default
            // false marker keeps those late arrivals eligible on the next maintenance pass.
            let updated = 0
            const started = performance.now()
            for (let page = 0; page < 100 && performance.now() - started < 5000; page++) {
                const result = await pool.query(`
                    WITH candidates AS MATERIALIZED (
                        SELECT DISTINCT batch_path FROM (
                            (SELECT batch_path FROM telemetry_events
                             WHERE NOT connection_normalized AND transport='sony-sdk' LIMIT 1000)
                            UNION ALL
                            (SELECT batch_path FROM telemetry_events
                             WHERE NOT connection_normalized ORDER BY batch_path LIMIT 1000)
                        ) pending
                    ), wifi_batches AS MATERIALIZED (
                        SELECT DISTINCT e.batch_path FROM telemetry_events e JOIN candidates c USING(batch_path)
                        WHERE e.transport='sony-sdk'
                          AND e.properties->>'operation' IN ('connect_wifi','connect_bluetooth_direct')
                    )
                    , updated AS (UPDATE telemetry_events e SET
                        backend=CASE WHEN e.backend<>'unknown' THEN e.backend
                            WHEN e.properties ? 'operation' OR e.transport='sony-sdk' THEN 'vendor-api'
                            ELSE 'ptp' END,
                        transport=CASE WHEN e.transport<>'sony-sdk' THEN e.transport
                            WHEN e.batch_path IN (SELECT batch_path FROM wifi_batches) THEN 'wifi'
                            ELSE 'unknown' END,
                        connection_normalized=true
                    FROM candidates c WHERE e.batch_path=c.batch_path AND NOT e.connection_normalized
                    RETURNING e.installation_id, e.session_id),
                    marked AS (UPDATE telemetry_sessions s SET stale=true
                        FROM (SELECT DISTINCT installation_id, coalesce(session_id,${sessionless}) AS session_id FROM updated) u
                        WHERE s.installation_id=u.installation_id AND s.session_id=u.session_id)
                    SELECT count(*)::int AS updated FROM updated
                `)
                updated += result.rows[0].updated
                if (!result.rows[0].updated) break
            }
            return updated
        },
        rebuildSummaries: () => backfillRollups(pool),
        async refreshSessions() {
            // Deletions and relabeling keep counts exact but leave time bounds and label sets stale.
            // Recompute a bounded number per pass; rows another upload holds are skipped until the next.
            let refreshed = 0
            const started = performance.now()
            for (let page = 0; page < 50 && performance.now() - started < 5000; page++) {
                const result = await pool.query(`
                    WITH picked AS MATERIALIZED (SELECT installation_id,session_id FROM telemetry_sessions
                        WHERE stale ORDER BY installation_id LIMIT 25 FOR UPDATE SKIP LOCKED),
                    fresh AS (SELECT e.installation_id, e.session_id, ${sessionAggregate}
                        FROM telemetry_events e JOIN picked p ON e.installation_id=p.installation_id AND e.session_id=p.session_id
                        GROUP BY 1,2),
                    renewed AS (UPDATE telemetry_sessions s SET (${sessionColumns})=
                        (f.events,f.errors,f.signals,f.started_at,f.ended_at,f.latest_received_at,f.manufacturer,f.model,
                         f.transports,f.evidence,f.backends,f.revisions,f.hardware_fingerprints,f.truncated), stale=false
                        FROM fresh f WHERE s.installation_id=f.installation_id AND s.session_id=f.session_id)
                    UPDATE telemetry_sessions s SET stale=false FROM picked p
                    WHERE s.installation_id=p.installation_id AND s.session_id=p.session_id
                      AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.installation_id=p.installation_id AND f.session_id=p.session_id)
                    RETURNING 1`)
                const remaining = await pool.query('SELECT 1 FROM telemetry_sessions WHERE stale LIMIT 1')
                refreshed += 25
                void result
                if (!remaining.rowCount) break
            }
            return refreshed
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
