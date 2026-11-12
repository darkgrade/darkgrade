import type { Pool } from 'pg'

export interface EventFilters {
    days: number
    installation?: string
    model?: string
    session?: string
    revision?: string
    transport?: string
}

/** Parameterized, bounded operator queries; never return installation credentials or contact data. */
export function operatorQueries(pool: Pool) {
    const where = `received_at >= now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR installation_id=$2)
        AND ($3::text IS NULL OR model=$3)
        AND ($4::uuid IS NULL OR session_id=$4)
        AND ($5::text IS NULL OR revision=$5)
        AND ($6::text IS NULL OR transport=$6)`
    const errors = `(failed OR (kind='response' AND code IS NOT NULL AND code<>8193))`
    const values = (filters: EventFilters) => [
        filters.days,
        filters.installation || null,
        filters.model || null,
        filters.session || null,
        filters.revision || null,
        filters.transport || null,
    ]
    return {
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
                    `SELECT manufacturer,model,firmware,revision,transport,evidence,kind,code,
                    properties->>'operation' AS operation,count(*)::int AS occurrences,
                    count(DISTINCT installation_id)::int AS installations,max(received_at) AS latest
                    FROM telemetry_events WHERE ${where} AND ${errors}
                    GROUP BY manufacturer,model,firmware,revision,transport,evidence,kind,code,properties->>'operation'
                    ORDER BY max(received_at) DESC LIMIT 100`,
                    parameters
                ),
                pool.query(
                    `SELECT batch_path,sequence,installation_id,session_id,occurred_at,received_at,
                    manufacturer,model,firmware,revision,transport,evidence,kind,code,failed,properties
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
                    array_agg(DISTINCT revision) AS revisions
                    FROM telemetry_events WHERE ${where} AND session_id IS NOT NULL
                    GROUP BY installation_id,session_id ORDER BY max(received_at) DESC,installation_id,session_id LIMIT 100`,
                    parameters
                ),
            ])
            return {
                summary: summary.rows[0],
                sessions: sessions.rows,
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
                manufacturer,model,firmware,revision,transport,evidence,kind,code,failed,properties,
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
