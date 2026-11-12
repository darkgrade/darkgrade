import type { Pool } from 'pg'

export interface EventFilters {
    days: number
    installation?: string
    model?: string
    session?: string
    revision?: string
    transport?: string
    hardware?: string
    after?: { time: string; installation: string; session: string }
}
export type SuggestionField = 'model' | 'installation' | 'session' | 'revision' | 'hardware'

/** Parameterized, bounded operator queries; never return installation credentials or contact data. */
export function operatorQueries(pool: Pool) {
    const where = `received_at >= now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR installation_id=$2)
        AND ($3::text IS NULL OR model=$3)
        AND ($4::uuid IS NULL OR session_id=$4)
        AND ($5::text IS NULL OR revision=$5)
        AND ($6::text IS NULL OR transport=$6)
        AND ($7::text IS NULL OR hardware_fingerprint=$7)`
    const errors = `(failed OR (kind='response' AND code IS NOT NULL AND code<>8193))`
    const values = (filters: EventFilters) => [
        filters.days,
        filters.installation || null,
        filters.model || null,
        filters.session || null,
        filters.revision || null,
        filters.transport || null,
        filters.hardware || null,
    ]
    return {
        async suggestions(field: SuggestionField, query: string, filters: EventFilters) {
            const column = {
                model: 'model',
                installation: 'installation_id',
                session: 'session_id',
                revision: 'revision',
                hardware: 'hardware_fingerprint',
            }[field]
            if (!column) throw new Error('Invalid suggestion field')
            const result = await pool.query(
                `SELECT ${column}::text AS value, min(manufacturer) AS manufacturer, min(model) AS model, count(DISTINCT model)::int AS models,
                min(installation_id::text) AS installation, count(DISTINCT installation_id)::int AS installations,
                array_agg(DISTINCT evidence) AS evidence, count(*)::int AS events, max(received_at) AS latest
                FROM telemetry_events WHERE ${where} AND ${column} IS NOT NULL
                AND ${
                    field === 'model'
                        ? `NOT EXISTS (SELECT 1 FROM unnest(string_to_array(lower($8::text),' ')) term
                        WHERE strpos(lower(manufacturer||' '||model),term)=0)`
                        : `strpos(lower(${column}::text),lower($8::text))>0`
                }
                GROUP BY ${column} ORDER BY max(received_at) DESC,${column} LIMIT 21`,
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
            const [summary, issues, events, sessions] = await Promise.all([
                pool.query(
                    `SELECT count(*)::int AS events, count(*) FILTER (WHERE ${errors})::int AS errors,
                    count(DISTINCT installation_id)::int AS installations,
                    count(DISTINCT session_id)::int AS sessions, max(received_at) AS latest
                    FROM telemetry_events WHERE ${where}`,
                    parameters
                ),
                pool.query(
                    `SELECT manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,
                    properties->>'operation' AS operation,count(*)::int AS occurrences,
                    count(DISTINCT installation_id)::int AS installations,max(received_at) AS latest
                    FROM telemetry_events WHERE ${where} AND ${errors}
                    GROUP BY manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,properties->>'operation'
                    ORDER BY max(received_at) DESC LIMIT 100`,
                    parameters
                ),
                pool.query(
                    `SELECT batch_path,sequence,installation_id,session_id,occurred_at,received_at,
                    manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,failed,properties
                    FROM telemetry_events WHERE ${where}
                    ORDER BY received_at DESC,batch_path,sequence LIMIT 500`,
                    parameters
                ),
                pool.query(
                    `SELECT installation_id,session_id,count(*)::int AS events,
                    count(*) FILTER (WHERE ${errors})::int AS errors,
                    min(coalesce(occurred_at,received_at)) AS started_at,
                    max(coalesce(occurred_at,received_at)) AS ended_at,
                    (array_agg(model ORDER BY (model='Unknown'),received_at DESC))[1] AS model,
                    (array_agg(manufacturer ORDER BY (model='Unknown'),received_at DESC))[1] AS manufacturer,
                    array_agg(DISTINCT transport) AS transports,array_agg(DISTINCT evidence) AS evidence,
                    array_agg(DISTINCT revision) AS revisions,
                    array_remove(array_agg(DISTINCT hardware_fingerprint),NULL) AS hardware_fingerprints
                    ,bool_or(coalesce((properties->>'droppedEntries')::int,0)>0) AS truncated
                    ,to_char(max(received_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
                    FROM telemetry_events WHERE ${where} AND session_id IS NOT NULL
                    GROUP BY installation_id,session_id
                    HAVING ($8::timestamptz IS NULL OR (max(received_at),installation_id,session_id)<($8::timestamptz,$9::uuid,$10::uuid))
                    ORDER BY max(received_at) DESC,installation_id DESC,session_id DESC LIMIT 101`,
                    [
                        ...parameters,
                        filters.after?.time || null,
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
                          })
                      ).toString('base64url')
                    : null
            for (const row of selected) delete row.cursor_time
            return {
                summary: summary.rows[0],
                sessions: selected,
                sessionsNext,
                sessionLimit: 100,
                issues: issues.rows,
                events: events.rows,
                eventLimit: 500,
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
                manufacturer,model,firmware,revision,transport,evidence,hardware_fingerprint,kind,code,failed,properties,
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
                    OR EXISTS(SELECT 1 FROM telemetry_events e WHERE e.installation_id=split_part(path,'/',2)::uuid))
                ORDER BY path COLLATE "C" LIMIT 101
            ) SELECT id, data->>'createdAt' AS created_at,
                coalesce((data->>'revoked')::boolean,false) AS revoked,
                coalesce((data->>'pendingDeletion')::boolean,false) AS deletion_pending,
                (SELECT max(received_at) FROM telemetry_events WHERE installation_id=id::uuid) AS latest
              FROM selected ORDER BY id COLLATE "C"`,
                [after || null, installation || null]
            )
            const items = result.rows.slice(0, 100)
            return { items, next: result.rows.length > 100 ? items.at(-1)!.id : null }
        },
    }
}
