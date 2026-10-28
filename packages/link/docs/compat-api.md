# Compatibility API and MCP server

`bun run compat:ui` serves a JSON API next to the UI, and `bun run compat:mcp` exposes the same calls to an MCP client. Use them during standalone testing to ask what needs changing or configuring and to act on it. The API and MCP server read the same data as the UI: matrices and run logs under `test-results/`, the camera catalog, and the profiles.

## HTTP API

The base path is `http://127.0.0.1:4174/api/v1`. `GET /api/v1` lists the endpoints, and `GET /api/v1/openapi.json` is the OpenAPI 3.1 description.

| Method and path                 | What it does                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /cameras?<filters>`        | Rows (one per profile, tier and link) with a status per capability. It takes the UI's query string (`manufacturer`, `line`, `fidelity`, `transport`, `kind`, `unverified`, `q`, `profile`, `<capability>=<status>`, `sort`, `order`, `run`), plus `limit` (default 100) and `offset`. |
| `GET /cameras/{profile}`        | One profile: identity, USB IDs, every result per tier and link, quirks with citations, recorded exchanges, sources, and run history.                                                                                                                                                  |
| `GET /view`                     | The whole view model the UI renders.                                                                                                                                                                                                                                                  |
| `GET /status`                   | The run in progress, the run this server started, and the latest runs.                                                                                                                                                                                                                |
| `GET /runs`, `GET /runs/{id}`   | Run summaries, newest first. With an id, one run log on its own.                                                                                                                                                                                                                      |
| `GET /gaps`                     | What needs changing or configuring, per manufacturer and line, with next actions. Filter with `manufacturer`, `line`, `kind`, `area` (`library` or `data`), and `all=true`.                                                                                                           |
| `GET /gaps.md`                  | `GAPS.md` as Markdown.                                                                                                                                                                                                                                                                |
| `GET /catalog`, `GET /profiles` | Manufacturers, lines, capabilities and statuses, and the simulator profiles (`manufacturer`, `fidelity`, `q`).                                                                                                                                                                        |
| `GET /events`                   | Server-sent events: `progress` (the active run or `null`), `rows` (changed rows), and `reload`.                                                                                                                                                                                       |
| `POST /runs`                    | Starts a simulation run: `{"filter": "manufacturer=sony&transport=ptp-ip"}`, or the same filter as fields in `{"filters": {...}}`. An empty filter runs everything. One run at a time.                                                                                                |
| `DELETE /runs/active`           | Cancels the run this server started.                                                                                                                                                                                                                                                  |
| `POST /ingest`                  | Ingests files by path on the server machine: `{"captures": [{"profile": "canon-canon-eos-r5", "file": "~/r5.pcapng"}], "results": ["~/run.jsonl"], "simulate": true, "merge": true}`.                                                                                                 |
| `POST /import?name=<file>`      | Uploads a run log or matrix to view in the UI. The body is the file.                                                                                                                                                                                                                  |
| `POST /reports`                 | Regenerates reports: `{"targets": ["merge", "readme", "gaps"]}`. With no targets, it regenerates all three.                                                                                                                                                                           |

Each gap action has a `kind` (for example `define-operations`, `capture-responses`, `run-hardware`, `verify-quirks`, or `configure-ptp-ip`), an `area`, a `summary`, the `items` it concerns, and the `command` or skill that closes it.

Read endpoints answer anyone who can reach the server. The server binds `127.0.0.1` by default. Control endpoints (`POST` and `DELETE`) have four requirements:

- The request comes from a loopback address and is addressed to a loopback host. This blocks DNS rebinding.
- The request has no foreign `Origin`.
- `POST` requests send `content-type: application/json`.
- When `COMPAT_API_TOKEN` is set, the request sends `Authorization: Bearer <token>`. The UI asks for the token once per session.

```sh
curl -s 'http://127.0.0.1:4174/api/v1/cameras?manufacturer=nikon&set-property=fail&limit=5'
curl -s 'http://127.0.0.1:4174/api/v1/gaps?area=library'
curl -s -X POST -H 'content-type: application/json' -d '{"filter":"manufacturer=canon&line=eos-r"}' http://127.0.0.1:4174/api/v1/runs
curl -s http://127.0.0.1:4174/api/v1/status
```

## MCP server

```sh
bun run compat:mcp                                   # uses a running compat:ui, else reads test-results/ itself
bun run compat:mcp -- --url http://127.0.0.1:4174/   # always through that UI's API
bun run compat:mcp -- --local                        # never through a UI
```

The server speaks MCP over stdio, using `@modelcontextprotocol/sdk`. When a `compat:ui` is running, the MCP server goes through its API, so a run it starts shows live in the open UI. Without a UI, it reads the results directly and starts runs as its own child processes. It logs to stderr. It sends `COMPAT_API_TOKEN` when that variable is set.

| Tool                 | What it does                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `list_cameras`       | Compact rows (a status per capability) for structured filters, with the total, the filter as a query string, and a UI link. |
| `get_camera`         | Everything about one profile.                                                                                               |
| `get_run_status`     | The run in progress and recent runs.                                                                                        |
| `list_runs`          | Run summaries.                                                                                                              |
| `list_gaps`          | Gaps grouped by manufacturer and line, each with next actions. Filter by `manufacturer`, `line`, `kind`, or `area`.         |
| `start_run`          | Runs the simulation suite for a filter.                                                                                     |
| `cancel_run`         | Cancels that run.                                                                                                           |
| `ingest`             | Ingests usbmon captures into profiles and hardware result files, then optionally re-simulates and merges.                   |
| `regenerate_reports` | Rebuilds the merged matrix, the README section, and `GAPS.md`.                                                              |

It also has three resources: `compat://matrix` (every row as JSON), `compat://gaps` (`GAPS.md`), and `compat://openapi`.

To register it with an MCP client, for example in Claude Code's `.mcp.json` or Claude Desktop's `claude_desktop_config.json`:

```json
{
    "mcpServers": {
        "darkgrade-compat": {
            "command": "bun",
            "args": ["run", "--cwd", "/path/to/darkgrade/packages/link", "compat:mcp"],
            "env": { "COMPAT_API_TOKEN": "" }
        }
    }
}
```

With the Claude Code CLI: `claude mcp add darkgrade-compat -- bun run --cwd /path/to/darkgrade/packages/link compat:mcp`.
