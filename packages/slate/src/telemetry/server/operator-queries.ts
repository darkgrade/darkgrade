import type { Row } from '#telemetry-server/database'

/** The query capability used by operators, without exposing the optional Postgres driver. */
export interface OperatorQueryConnection {
    query(sql: string, values?: unknown[]): Promise<{ rows: Row['data'][] }>
}

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

// An event's signal and whether it is an error are derived by the database's own functions
// (`telemetry_event_signal`, `telemetry_event_error` in postgres.ts), the same ones the summary
// triggers and the rebuild use, so a filter on raw events always agrees with the summaries.
const eventSignal=`telemetry_event_signal(failed,kind,code,properties,manufacturer)`
const sessionless=`'00000000-0000-0000-0000-000000000000'::uuid`
const signalName=`CASE WHEN signal='failed' THEN 'Failed'
    WHEN signal='dropped-events' THEN 'Dropped events'
    WHEN signal='response:0x2019' THEN 'Device busy · 0x2019'
    WHEN signal='response:0x2019:device-ready' THEN 'Device busy · 0x2019 (DeviceReady poll)'
    WHEN signal='response:0xa102:object-not-ready' THEN 'Object not ready · 0xA102'
    WHEN signal='attach' THEN 'Attached to an open connection'
    WHEN signal LIKE 'response:0x2001:result-%' THEN 'OK carrying camera result '||split_part(signal,'result-',2)
    WHEN signal='ok' THEN 'OK'
    WHEN signal LIKE 'call:%:%' THEN split_part(signal,':',2)||' · '||initcap(replace(split_part(signal,':',3),'-',' '))
    WHEN signal LIKE 'call:%' THEN split_part(signal,':',2)||' · any outcome'
    ELSE replace(signal,'operation:','') END`
/** `call:<operation>` (no outcome) selects every outcome of that public operation, and a response
 * code (`response:0x2019`) also selects the readings of it named apart (`response:0x2019:device-ready`). */
const signalMatches=(column:string,parameter:string)=>`(${column}=${parameter} OR (((${parameter} LIKE 'call:%'
    AND ${parameter} NOT LIKE 'call:%:%') OR ${parameter} ~ '^response:0x[0-9a-f]{4}$') AND ${column} LIKE ${parameter}||':%'))`
/** Parameterized, bounded operator queries. Contact data is restricted to the explicit support lookup. */
export function operatorQueries(pool: OperatorQueryConnection) {
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
        AND ($8::text IS NULL OR ${signalMatches(eventSignal,'$8')})`
    const sessionWhere = `s.latest_received_at >= now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR s.installation_id=$2)
        AND ($3::text IS NULL OR s.model=$3)
        AND ($4::uuid IS NULL OR s.session_id=$4)
        AND ($5::text IS NULL OR $5=ANY(s.revisions))
        AND ($6::text IS NULL OR $6=ANY(s.transports))
        AND ($7::text IS NULL OR $7=ANY(s.hardware_fingerprints))
        AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM telemetry_session_signals wanted
            WHERE wanted.installation_id=s.installation_id AND wanted.session_id=s.session_id AND ${signalMatches('wanted.signal','$8')}))`
    // Issues list errors. A busy reply (telemetry_event_busy) is a retry warning: it is listed only when
    // a signal filter asks for it. The first clause is the partial index telemetry_events_errors.
    const errors = `(failed OR (kind='response' AND code IS NOT NULL AND code<>8193))
        AND (failed OR NOT telemetry_event_busy(kind,code,manufacturer) OR $8::text IS NOT NULL)`
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
        async contributors(filters: { email?: string; installations?: string[]; after?: string; includeHistory?: boolean } = {}) {
            // Join the current submitted identity to retained summaries by installation. This includes
            // sessions uploaded before enrollment without copying addresses into diagnostic records.
            const includeHistory=filters.includeHistory!==false,pageSize=includeHistory?20:100
            const result = await pool.query(
                `WITH selected AS (
                    SELECT split_part(i.path,'/',2) AS id, c.data AS contact, p.data AS pending
                    FROM telemetry_state i
                    LEFT JOIN telemetry_state c ON c.path='contacts/'||split_part(i.path,'/',2)
                    LEFT JOIN telemetry_state p ON p.path='contactRequests/'||split_part(i.path,'/',2)
                    WHERE split_part(i.path,'/',1)='installations'
                      AND NOT coalesce((i.data->>'revoked')::boolean,false)
                      AND ($1::text IS NULL OR lower(c.data->>'email')=$1 OR lower(p.data->>'email')=$1)
                      AND ($2::uuid[] IS NULL OR split_part(i.path,'/',2)::uuid=ANY($2))
                      AND ($2::uuid[] IS NOT NULL OR coalesce(c.data->>'email',p.data->>'email') IS NOT NULL)
                      AND ($3::text IS NULL OR split_part(i.path,'/',2) COLLATE "C" > $3 COLLATE "C")
                    ORDER BY i.path COLLATE "C" LIMIT $5::int
                )
                SELECT selected.id, coalesce(contact->>'email',pending->>'email') AS email,
                    contact->>'confirmedAt' IS NOT NULL AS verified,
                    CASE WHEN contact->>'email' IS NOT NULL AND pending->>'email'<>contact->>'email'
                        THEN pending->>'email' END AS pending_email,
                    coalesce(pending->>'requestedAt',contact->>'requestedAt') AS requested_at, contact->>'confirmedAt' AS confirmed_at,
                    coalesce(summary.sessions,0)::int AS sessions, coalesce(summary.events,0)::bigint AS events,
                    coalesce(summary.errors,0)::bigint AS errors, coalesce(summary.signals,0)::bigint AS signals,
                    summary.first_seen, summary.last_seen,
                    coalesce(cameras.items,'[]'::jsonb) AS cameras
                FROM selected
                LEFT JOIN LATERAL (
                    SELECT count(*) FILTER(WHERE s.session_id<>${sessionless}) AS sessions,
                        sum(s.events) AS events,sum(failed.events) AS errors,sum(s.signals) AS signals,
                        min(s.started_at) AS first_seen,max(s.latest_received_at) AS last_seen
                    FROM telemetry_sessions s LEFT JOIN telemetry_session_signals failed
                        ON failed.installation_id=s.installation_id AND failed.session_id=s.session_id AND failed.signal='failed'
                    WHERE $4::boolean AND s.installation_id=selected.id::uuid
                      AND s.latest_received_at>=now()-interval '90 days'
                ) summary ON true
                LEFT JOIN LATERAL (
                    SELECT jsonb_agg(to_jsonb(camera)) AS items FROM (
                        SELECT s.manufacturer,s.model,
                            count(*) FILTER(WHERE s.session_id<>${sessionless})::int AS sessions,
                            sum(s.events)::bigint AS events,coalesce(sum(failed.events),0)::bigint AS errors,sum(s.signals)::bigint AS signals,
                            min(s.started_at) AS first_seen,max(s.latest_received_at) AS last_seen,
                            ARRAY(SELECT DISTINCT unnest(t.hardware_fingerprints) FROM telemetry_sessions t
                                WHERE t.installation_id=selected.id::uuid AND t.manufacturer=s.manufacturer AND t.model=s.model
                                AND t.latest_received_at>=now()-interval '90 days' ORDER BY 1 LIMIT 100) AS hardware_fingerprints,
                            ARRAY(SELECT DISTINCT unnest(t.transports) FROM telemetry_sessions t
                                WHERE t.installation_id=selected.id::uuid AND t.manufacturer=s.manufacturer AND t.model=s.model
                                AND t.latest_received_at>=now()-interval '90 days' ORDER BY 1) AS transports,
                            ARRAY(SELECT DISTINCT unnest(t.backends) FROM telemetry_sessions t
                                WHERE t.installation_id=selected.id::uuid AND t.manufacturer=s.manufacturer AND t.model=s.model
                                AND t.latest_received_at>=now()-interval '90 days' ORDER BY 1) AS backends,
                            ARRAY(SELECT DISTINCT unnest(t.revisions) FROM telemetry_sessions t
                                WHERE t.installation_id=selected.id::uuid AND t.manufacturer=s.manufacturer AND t.model=s.model
                                AND t.latest_received_at>=now()-interval '90 days' ORDER BY 1 LIMIT 100) AS revisions,
                            ARRAY(SELECT DISTINCT unnest(t.evidence) FROM telemetry_sessions t
                                WHERE t.installation_id=selected.id::uuid AND t.manufacturer=s.manufacturer AND t.model=s.model
                                AND t.latest_received_at>=now()-interval '90 days' ORDER BY 1) AS evidence
                        FROM telemetry_sessions s LEFT JOIN telemetry_session_signals failed
                            ON failed.installation_id=s.installation_id AND failed.session_id=s.session_id AND failed.signal='failed'
                        WHERE $4::boolean AND s.installation_id=selected.id::uuid
                          AND s.latest_received_at>=now()-interval '90 days'
                        GROUP BY s.manufacturer,s.model ORDER BY max(s.latest_received_at) DESC,s.manufacturer,s.model LIMIT 50
                    ) camera
                ) cameras ON true ORDER BY selected.id COLLATE "C"`,
                [filters.email?.trim().toLowerCase() || null, filters.installations ?? null, filters.after || null,includeHistory,pageSize+1]
            )
            const items = result.rows.slice(0, pageSize).map((row): Row['data'] => ({
                ...row, events: Number(row.events), errors: Number(row.errors), signals: Number(row.signals),
            }))
            return { items, next: result.rows.length > pageSize ? items.at(-1)!.id : null, retentionDays: 90, cameraLimit: 50, identityOnly:!includeHistory }
        },
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
                  AND NOT EXISTS (SELECT 1 FROM telemetry_unknown_code_repairs p WHERE p.key=u.key AND p.installation_id=u.installation_id)
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
                // Each public operation is offered once with every outcome (`call:<operation>`) beside its outcomes.
                const result=await pool.query(`WITH matched AS (
                    SELECT g.signal,g.events,g.latest
                    FROM telemetry_session_signals g JOIN telemetry_sessions s USING (installation_id,session_id)
                    WHERE ${sessionWhere}), grouped AS (
                    SELECT signal,sum(events)::int AS events,max(latest) AS latest FROM matched GROUP BY signal
                    UNION ALL
                    SELECT 'call:'||split_part(signal,':',2),sum(events)::int,max(latest) FROM matched
                    WHERE signal LIKE 'call:%:%' GROUP BY split_part(signal,':',2))
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
            // A value's camera is the latest session's, manufacturer and model from that same row.
            const latestSession=(value:string)=>`(array_agg(${value} ORDER BY s.latest_received_at DESC,s.installation_id,s.session_id))[1]`
            const expand = field === 'revision' ? ', unnest(s.revisions) AS choice'
                : field === 'hardware' ? ', unnest(s.hardware_fingerprints) AS choice' : ''
            const result = await pool.query(
                `SELECT ${column} AS value, ${latestSession('s.manufacturer')} AS manufacturer, ${latestSession('s.model')} AS model,
                count(DISTINCT s.model)::int AS models,
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
                    count(*) FILTER (WHERE s.session_id<>${sessionless})::int AS sessions, max(s.latest_received_at) AS latest,
                    coalesce(sum(failed.events),0)::int AS failures
                    FROM telemetry_sessions s LEFT JOIN telemetry_session_signals failed
                        ON failed.installation_id=s.installation_id AND failed.session_id=s.session_id AND failed.signal='failed'
                    WHERE ${sessionWhere}`,
                    parameters
                ),
                pool.query(
                    `SELECT manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,
                    properties->>'operation' AS operation,count(*)::int AS occurrences,
                    count(*) FILTER(WHERE failed)::int AS failures,
                    count(DISTINCT installation_id)::int AS installations,
                    max(coalesce(occurred_at,received_at)) AS latest,max(received_at) AS latest_received_at,
                    (properties->>'commandCode')::int AS command_code,
                    properties->'call'->>'operation' AS call_operation,properties->'call'->>'outcome' AS call_outcome,
                    properties->'call'->'error'->>'type' AS call_error,
                    (properties->'call'->'error'->>'response')::int AS call_response,
                    (array_agg(properties->'call'->'error'->>'message' ORDER BY received_at DESC))[1] AS call_message,
                    (array_agg(DISTINCT properties->'call'->>'surface')
                        FILTER(WHERE properties ? 'call')) AS call_surfaces
                    FROM telemetry_events WHERE ${errors} AND ${where}
                    GROUP BY manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,properties->>'operation',
                        properties->'call'->>'operation',properties->'call'->>'outcome',properties->'call'->'error'->>'type',
                        properties->'call'->'error'->>'response',properties->>'commandCode'
                    ORDER BY max(coalesce(occurred_at,received_at)) DESC LIMIT 100`,
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
                    s.hardware_fingerprints,s.truncated,coalesce(failed.events,0)::int AS failures
                    ,to_char(s.latest_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
                    ,(${order})::text AS cursor_value
                    FROM telemetry_sessions s LEFT JOIN telemetry_session_signals failed
                        ON failed.installation_id=s.installation_id AND failed.session_id=s.session_id AND failed.signal='failed'
                    WHERE ${sessionWhere} AND s.session_id<>${sessionless}
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
                sessions.rows.length > 100 && last
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
                result.rows.length > 500 && last
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
