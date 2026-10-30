# Darkgrade camera runtime

`@darkgrade/runtime` owns the common camera MCP contract, frontend operation
ordering, and shared lease coordinator. It is a Bun package separate from the
portable `@darkgrade/link` camera library.

The first migration covers 14 tools: controls, ISO, aperture, shutter speed,
white balance, focus mode, autofocus, Manual exposure, movie format, photo
capture, latest-photo download, live-view frame, card storage and Nikon memory
status. Existing names, arguments and annotations remain compatible.
`camera_take_photo` additionally accepts optional `autofocus`, `destination` and
`rawCompression` arguments. For example, autofocus can be disabled for a deliberate
shutter/transfer test, or Nikon NEF capture can request temporary lossless
compression. A successful shutter does not certify focus or independent decoding.

## Use it

From the Darkgrade checkout, with Bun 1.4.2 or newer:

```sh
bun install --frozen-lockfile
bun run --cwd packages/runtime typecheck
bun run --cwd packages/runtime test
DARKGRADE_RUNTIME_URL=http://127.0.0.1:8787 bun run --cwd packages/runtime mcp
```

The stdio MCP server connects to an already running, session-owning host.
It does not open another USB, SDK or Wi-Fi connection. Remote deployment must use
the host's existing authenticated network access; it does not supply credentials
or enable a new unauthenticated listener.

Other hosts can embed `CameraRuntime` with a `CameraProvider`, then pass that
runtime to `createCameraMcpServer()`. UI and CLI callers use the same runtime.
`registerCameraTools()` also installs the identical tools into an existing MCP
server, which is how Test Bench keeps its old API.

## Ownership

Each owning host creates one runtime. Controls and media for one camera queue
together; different cameras remain independent. The runtime resolves a retained
session when work starts, so queued work follows the active connection. An
unsupported command on a retained session fails without opening a competing
connection. Failed writes release the operation queue after the provider settles.
An HTTP timeout never retries a write or pretends the camera operation stopped.

`HardwareCoordinator` supplies renewable, reentrant cross-process leases through
an injected `OwnershipStore`. Test Bench supplies its existing SQLite store, so
old and migrated callers still share the same camera and capture-device locks.
USB switching, power recovery and shared-hub protections remain Bench services.

Providers enforce recording/recovery guards, actual advertised capabilities,
bounded camera transactions and media verification. A successful command reply
is not automatically evidence of a decoded image or a verified setting.

## Migration boundary

This is the controls/media stage, **not a separate camera daemon yet**. Test Bench
still hosts the runtime and provides retained Canon/Sony/Nikon sessions, private
wireless credentials, vendor workers and media storage. Wireless handoffs,
preflight/take orchestration and agent-job persistence have not moved in this
stage. Those adapters remain explicit; no Darkgrade module imports Test Bench.

Move retained-session lifecycle and wireless credentials into the runtime next,
then preflight/takes and operation cancellation/progress. Keep one owning host
during each cutover. Do not run a second independent camera daemon alongside the
existing host. Bench can then become an HTTP/MCP client plus physical-hardware
provider without changing the camera tool contract.
