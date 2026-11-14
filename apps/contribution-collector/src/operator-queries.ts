import type { Pool } from 'pg'

export interface EventFilters {
    days: number
    includeEvents?: boolean
    installation?: string
    model?: string
    session?: string
    revision?: string
    transport?: string
    hardware?: string
    signal?: string
    sort?: 'recent' | 'signals' | 'events' | 'duration' | 'camera'
    direction?: 'asc' | 'desc'
    after?: { time: string; installation: string; session: string; sort?: string; direction?: string; value?: string }
}
export type SuggestionField = 'model' | 'installation' | 'session' | 'revision' | 'hardware' | 'signal'

const eventSignal=`CASE WHEN failed THEN 'failed'
    WHEN coalesce((properties->>'droppedEntries')::int,0)>0 THEN 'dropped-events'
    WHEN properties ? 'operation' THEN 'operation:'||(properties->>'operation')
    WHEN kind='response' AND code=8193 THEN 'ok'
    WHEN code IS NOT NULL THEN kind||':0x'||lpad(to_hex(code),4,'0')
    ELSE kind END`
const sessionless=`'00000000-0000-0000-0000-000000000000'::uuid`
const signalName=`CASE WHEN signal='failed' THEN 'Failed'
    WHEN signal='dropped-events' THEN 'Dropped events'
    WHEN signal='response:0x2019' THEN 'Device busy · 0x2019'
    WHEN signal='ok' THEN 'OK'
    ELSE replace(signal,'operation:','') END`

/** Parameterized, bounded operator queries; never return installation credentials or contact data. */
export function operatorQueries(pool: Pool) {
    const activeSource = `EXISTS (SELECT 1 FROM telemetry_state d WHERE d.path=telemetry_events.batch_path
        AND d.data->>'expiresAt' > to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        AND EXISTS (SELECT 1 FROM telemetry_state i WHERE i.path='installations/'||telemetry_events.installation_id
        AND NOT coalesce((i.data->>'revoked')::boolean,false))`
    const where = `received_at >= now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR installation_id=$2)
        AND ($3::text IS NULL OR model=$3)
        AND ($4::uuid IS NULL OR session_id=$4)
        AND ($5::text IS NULL OR revision=$5)
        AND ($6::text IS NULL OR transport=$6)
        AND ($7::text IS NULL OR hardware_fingerprint=$7)
        AND ($8::text IS NULL OR ${eventSignal}=$8)`
    const sessionWhere = `s.latest_received_at >= now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR s.installation_id=$2)
        AND ($3::text IS NULL OR s.model=$3)
        AND ($4::uuid IS NULL OR s.session_id=$4)
        AND ($5::text IS NULL OR $5=ANY(s.revisions))
        AND ($6::text IS NULL OR $6=ANY(s.transports))
        AND ($7::text IS NULL OR $7=ANY(s.hardware_fingerprints))
        AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM telemetry_session_signals wanted
            WHERE wanted.installation_id=s.installation_id AND wanted.session_id=s.session_id AND wanted.signal=$8))`
    const errors = `(failed OR (kind='response' AND code IS NOT NULL AND code<>8193))`
    const values = (filters: EventFilters) => [
        filters.days,
        filters.installation || null,
        filters.model || null,
        filters.session || null,
        filters.revision || null,
        filters.transport || null,
        filters.hardware || null,
        filters.signal || null,
    ]
    return {
        async protocol(filters: EventFilters, after?: string) {
            // Session, body and signal scopes are narrow enough to read their own events. Everything
            // else reads the per-installation summary kept current at ingest.
            if (filters.session || filters.hardware || filters.signal) return this.protocolFromEvents(filters, after)
            const result = await pool.query(
                `WITH grouped AS (
                SELECT u.key, min(u.manufacturer) AS manufacturer, min(u.model) AS model, min(u.firmware) AS firmware,
                    min(u.revision) AS revision, min(u.transport) AS transport, min(u.evidence) AS evidence,
                    min(u.category) AS category, min(u.code) AS code, sum(u.occurrences)::int AS occurrences,
                    count(*)::int AS installations, max(u.latest) AS latest, min(u.source) AS source
                FROM telemetry_unknown_codes u
                WHERE u.latest >= now() - ($1::int * interval '1 day')
                  AND ($2::uuid IS NULL OR u.installation_id=$2) AND ($3::text IS NULL OR u.model=$3)
                  AND ($4::text IS NULL OR u.revision=$4) AND ($5::text IS NULL OR u.transport=$5)
                  AND EXISTS (SELECT 1 FROM telemetry_state d WHERE d.path=u.source
                    AND d.data->>'expiresAt' > to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                  AND EXISTS (SELECT 1 FROM telemetry_state i WHERE i.path='installations/'||u.installation_id
                    AND NOT coalesce((i.data->>'revoked')::boolean,false))
                GROUP BY u.key)
                SELECT g.*, r.data->'findings' AS findings FROM grouped g
                LEFT JOIN telemetry_state r ON r.path='protocolFindings/'||substring(g.source from 13)
                WHERE ($6::text IS NULL OR key COLLATE "C" > $6 COLLATE "C")
                ORDER BY key COLLATE "C" LIMIT 51`,
                [filters.days, filters.installation || null, filters.model || null, filters.revision || null,
                    filters.transport || null, after || null]
            )
            return { items: result.rows.slice(0, 50), next: result.rows.length > 50 ? result.rows[49].key : null }
        },
        async protocolFromEvents(filters: EventFilters, after?: string) {
            const result = await pool.query(
                `WITH grouped AS (
                SELECT manufacturer,model,firmware,revision,transport,evidence,
                    properties->'protocol'->>'category' AS category,
                    (properties->'protocol'->>'code')::bigint AS code,
                    count(*)::int AS occurrences, count(DISTINCT installation_id)::int AS installations,
                    max(received_at) AS latest, min(batch_path) AS source,
                    md5(jsonb_build_array(manufacturer,model,firmware,revision,transport,evidence,
                        properties->'protocol'->>'category',properties->'protocol'->>'code')::text) AS key
                FROM telemetry_events WHERE ${where} AND ${activeSource} AND properties->'protocol'->>'type'='unknown'
                GROUP BY manufacturer,model,firmware,revision,transport,evidence,
                    properties->'protocol'->>'category',properties->'protocol'->>'code')
                SELECT g.*, r.data->'findings' AS findings FROM grouped g
                LEFT JOIN telemetry_state r ON r.path='protocolFindings/'||substring(g.source from 13)
                WHERE ($9::text IS NULL OR key COLLATE "C" > $9 COLLATE "C")
                ORDER BY key COLLATE "C" LIMIT 51`,
                [...values(filters), after || null]
            )
            return { items: result.rows.slice(0, 50), next: result.rows.length > 50 ? result.rows[49].key : null }
        },
        async profile(installation: string, benchmark: string) {
            const result = await pool.query(
                `SELECT batch_path,sequence,session_id,manufacturer,model,firmware,revision,transport,evidence,
                    hardware_fingerprint, properties->'protocol' AS protocol,
                    coalesce((properties->>'droppedEntries')::int,0) AS dropped_entries
                FROM telemetry_events WHERE installation_id=$1 AND ${activeSource} AND properties->'protocol'->>'benchmarkId'=$2
                ORDER BY received_at,batch_path,sequence LIMIT 8193`, [installation, benchmark]
            )
            return { schema: 'darkgrade.camera-profile-evidence/v1', installation, benchmark, hardwarePass: false, items: result.rows.slice(0,8192),
                truncated: result.rows.length > 8192 || result.rows.some(row => row.dropped_entries > 0) }
        },
        async suggestions(field: SuggestionField, query: string, filters: EventFilters) {
            // Suggestions read the per-session summaries, never raw events.
            if(field==='signal'){
                const result=await pool.query(`WITH grouped AS (
                    SELECT g.signal,sum(g.events)::int AS events,max(g.latest) AS latest
                    FROM telemetry_session_signals g JOIN telemetry_sessions s USING (installation_id,session_id)
                    WHERE ${sessionWhere} GROUP BY g.signal)
                    SELECT signal AS value,${signalName} AS label,events,latest FROM grouped
                    WHERE strpos(lower(signal||' '||(${signalName})),lower($9::text))>0
                    ORDER BY events DESC,signal LIMIT 21`,[...values({...filters,signal:undefined}),query])
                return {field,items:result.rows.slice(0,20),more:result.rows.length>20}
            }
            const column = {
                model: 's.model',
                installation: 's.installation_id::text',
                session: 's.session_id::text',
                revision: 'choice',
                hardware: 'choice',
            }[field]
            if (!column) throw new Error('Invalid suggestion field')
            const expand = field === 'revision' ? ', unnest(s.revisions) AS choice'
                : field === 'hardware' ? ', unnest(s.hardware_fingerprints) AS choice' : ''
            const result = await pool.query(
                `SELECT ${column} AS value, min(s.manufacturer) AS manufacturer, min(s.model) AS model, count(DISTINCT s.model)::int AS models,
                min(s.installation_id::text) AS installation, count(DISTINCT s.installation_id)::int AS installations,
                (SELECT array_agg(DISTINCT kind) FROM unnest(array_agg(array_to_string(s.evidence,','))) joined,
                    unnest(string_to_array(joined,',')) kind) AS evidence,
                sum(s.events)::int AS events, max(s.latest_received_at) AS latest
                FROM telemetry_sessions s${expand} WHERE ${sessionWhere}${field === 'session' ? ` AND s.session_id<>${sessionless}` : ''}
                AND ${
                    field === 'model'
                        ? `NOT EXISTS (SELECT 1 FROM unnest(string_to_array(lower($9::text),' ')) term
                        WHERE strpos(lower(s.manufacturer||' '||s.model),term)=0)`
                        : `strpos(lower(${column}),lower($9::text))>0`
                }
                GROUP BY ${column} ORDER BY max(s.latest_received_at) DESC,${column} LIMIT 21`,
                [...values({ ...filters, [field]: undefined }), query]
            )
            return { field, items: result.rows.slice(0, 20), more: result.rows.length > 20 }
        },
        async reviewQueue(after?: string) {
            const condition = `split_part(d.path,'/',1)='diagnostics'
                AND d.data->>'expiresAt' > to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                AND EXISTS (SELECT 1 FROM telemetry_state i WHERE i.path='installations/'||(d.data->>'installId')
                    AND NOT coalesce((i.data->>'revoked')::boolean,false))
                AND NOT EXISTS (SELECT 1 FROM telemetry_state r WHERE r.path='reviewedPatterns/'||split_part(d.path,'/',2))`
            const [count, items] = await Promise.all([
                pool.query(`SELECT count(*)::int AS pending FROM telemetry_state d WHERE ${condition}`),
                pool.query(
                    `SELECT d.path, d.data->>'receivedAt' AS received_at, d.data->>'expiresAt' AS expires_at,
                    d.data->>'installId' AS installation,
                    (SELECT jsonb_agg(c->'camera') FROM jsonb_array_elements((d.data->>'payload')::jsonb->'contributions') c) AS cameras
                    FROM telemetry_state d WHERE ${condition} AND ($1::text IS NULL OR d.path COLLATE "C" > $1 COLLATE "C")
                    ORDER BY d.path COLLATE "C" LIMIT 21`,
                    [after || null]
                ),
            ])
            const selected = items.rows.slice(0, 20)
            return {
                pending: count.rows[0].pending,
                items: selected,
                next: items.rows.length > 20 ? selected.at(-1)!.path : null,
            }
        },
        async report(filters: EventFilters) {
            const parameters = values(filters)
            const sort=filters.sort||'recent',direction=filters.direction||'desc'
            const order={
                recent:'s.latest_received_at',
                signals:'s.signals',
                events:'s.events',
                duration:'extract(epoch from (s.ended_at-s.started_at))',
                camera:`s.model COLLATE "C"`,
            }[sort]
            if(!order||!['asc','desc'].includes(direction))throw new Error('Invalid session sorting')
            const cursorType=sort==='recent'?'timestamptz':sort==='camera'?'text':'numeric'
            const comparison=direction==='asc'?'>':'<'
            if(filters.after&&((filters.after.sort||'recent')!==sort||(filters.after.direction||'desc')!==direction))
                throw new Error('Session cursor belongs to a different sort')
            // Summary and session list come from summaries kept current at ingest; issues use the
            // partial error index. Nothing here scans every raw event in the window.
            const [summary, issues, events, sessions] = await Promise.all([
                pool.query(
                    `SELECT coalesce(sum(s.events),0)::int AS events, coalesce(sum(s.errors),0)::int AS errors,
                    count(DISTINCT s.installation_id)::int AS installations,
                    count(*) FILTER (WHERE s.session_id<>${sessionless})::int AS sessions, max(s.latest_received_at) AS latest
                    FROM telemetry_sessions s WHERE ${sessionWhere}`,
                    parameters
                ),
                pool.query(
                    `SELECT manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,
                    properties->>'operation' AS operation,count(*)::int AS occurrences,
                    count(DISTINCT installation_id)::int AS installations,max(received_at) AS latest
                    FROM telemetry_events WHERE ${errors} AND ${where}
                    GROUP BY manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,properties->>'operation'
                    ORDER BY max(received_at) DESC LIMIT 100`,
                    parameters
                ),
                filters.includeEvents === false ? Promise.resolve({rows: []}) : pool.query(
                    `SELECT batch_path,sequence,installation_id,session_id,occurred_at,received_at,
                    manufacturer,model,firmware,revision,transport,backend,evidence,hardware_fingerprint,kind,code,failed,properties
                    FROM telemetry_events WHERE ${where}
                    ORDER BY received_at DESC,batch_path,sequence LIMIT 500`,
                    parameters
                ),
                pool.query(
                    `SELECT s.installation_id,s.session_id,s.events::int AS events,s.errors::int AS errors,s.signals::int AS signals,
                    s.started_at,s.ended_at,s.model,s.manufacturer,s.transports,s.evidence,s.backends,s.revisions,
                    s.hardware_fingerprints,s.truncated
                    ,to_char(s.latest_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
                    ,(${order})::text AS cursor_value
                    FROM telemetry_sessions s WHERE ${sessionWhere} AND s.session_id<>${sessionless}
                    AND ($9::${cursorType} IS NULL OR (${order},s.installation_id,s.session_id)${comparison}($9::${cursorType},$10::uuid,$11::uuid))
                    ORDER BY ${order} ${direction},s.installation_id ${direction},s.session_id ${direction} LIMIT 101`,
                    [
                        ...parameters,
                        filters.after?.value || filters.after?.time || null,
                        filters.after?.installation || null,
                        filters.after?.session || null,
                    ]
                ),
            ])
            const selected = sessions.rows.slice(0, 100),
                last = selected.at(-1)
            const sessionsNext =
                sessions.rows.length > 100
                    ? Buffer.from(
                          JSON.stringify({
                              time: last.cursor_time,
                              installation: last.installation_id,
                              session: last.session_id,
                              sort,direction,value:sort==='recent'?last.cursor_time:last.cursor_value,
                          })
                      ).toString('base64url')
                    : null
            for (const row of selected) {delete row.cursor_time;delete row.cursor_value}
            return {
                summary: summary.rows[0],
                sessions: selected,
                sessionsNext,
                sessionLimit: 100,
                issues: issues.rows,
                events: events.rows,
                eventLimit: filters.includeEvents === false ? 0 : 500,
                issueLimit: 100,
            }
        },
        async session(
            installation: string,
            session: string,
            after?: { time: string; batch: string; sequence: number }
        ) {
            const result = await pool.query(
                `SELECT batch_path,sequence,installation_id,session_id,occurred_at,received_at,
                manufacturer,model,firmware,revision,transport,backend,evidence,hardware_fingerprint,kind,code,failed,properties,
                to_char(coalesce(occurred_at,received_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
                FROM telemetry_events WHERE installation_id=$1::uuid AND session_id=$2::uuid
                AND ($3::timestamptz IS NULL OR (coalesce(occurred_at,received_at),batch_path,sequence)>($3::timestamptz,$4::text,$5::int))
                ORDER BY coalesce(occurred_at,received_at),batch_path,sequence LIMIT 501`,
                [installation, session, after?.time || null, after?.batch || null, after?.sequence ?? null]
            )
            const events = result.rows.slice(0, 500),
                last = events.at(-1)
            const next =
                result.rows.length > 500
                    ? Buffer.from(
                          JSON.stringify({ time: last.cursor_time, batch: last.batch_path, sequence: last.sequence })
                      ).toString('base64url')
                    : null
            for (const event of events) delete event.cursor_time
            return { installation, session, events, next, pageLimit: 500 }
        },
        async installations(after?: string, installation?: string) {
            const result = await pool.query(
                `WITH selected AS (
                SELECT split_part(path,'/',2) AS id,data FROM telemetry_state
                WHERE split_part(path,'/',1)='installations'
                  AND ($1::text IS NULL OR split_part(path,'/',2)>$1)
                  AND ($2::text IS NULL OR split_part(path,'/',2)=$2)
                  AND ($2::text IS NOT NULL OR NOT coalesce((data->>'revoked')::boolean,false)
                    OR coalesce((data->>'pendingDeletion')::boolean,false)
                    OR EXISTS(SELECT 1 FROM telemetry_sessions e WHERE e.installation_id=split_part(path,'/',2)::uuid))
                ORDER BY path COLLATE "C" LIMIT 101
            ) SELECT id, data->>'createdAt' AS created_at,
                coalesce((data->>'revoked')::boolean,false) AS revoked,
                coalesce((data->>'pendingDeletion')::boolean,false) AS deletion_pending,
                (SELECT max(latest_received_at) FROM telemetry_sessions WHERE installation_id=id::uuid) AS latest
              FROM selected ORDER BY id COLLATE "C"`,
                [after || null, installation || null]
            )
            const items = result.rows.slice(0, 100)
            return { items, next: result.rows.length > 100 ? items.at(-1)!.id : null }
        },
    }
}
