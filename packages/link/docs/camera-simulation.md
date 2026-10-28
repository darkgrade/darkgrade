# Simulated cameras and the support matrix

`SimulatedTransport` answers PTP requests from a camera profile, so `Camera` can be exercised in CI without hardware. The `Camera simulation` workflow runs `tests/camera-simulation` on every push and pull request, uploads the resulting support matrix (JSON and Markdown) as an artifact, and writes the table to the job summary. Hardware tests (`tests/01_usb.test.ts` and similar) are not run there; the device-lab tier runs the same capabilities on the physical testbench cameras (see [`camera-lab/README.md`](../camera-lab/README.md)). The capabilities live in `scripts/camera-profiles/camera-capabilities.ts` so both tiers share them.

## Profiles

Profiles live in `camera-profiles/<manufacturer>/<line>/<id>.json` and are typed and validated by `src/transport/simulated/camera-profile.ts`. Each profile has:

- `provenance.fidelity`: `captured` (built from evidence recorded on the testbench) or `documented` (built from vendor documentation, never presented as hardware-verified). `provenance.sources` lists every file, excerpt or URL a fact came from; facts cite a source by index.
- `manufacturer`, `line`, `model`, optional `firmware` and `usb` identity.
- `deviceInfo`: a complete `raw` GetDeviceInfo dataset, or parsed fields. Operation, event and property lists are only present when the complete list is known.
- `properties`: descriptors as raw bytes or parsed fields, plus values observed on hardware for checking darkgrade's decoding.
- `exchanges`: recorded request/response pairs. Omitted request parameters or data match anything; repeated matches are consumed in recorded order and the last one repeats.
- `events`: events delivered after a given operation.
- `quirks`: line or model behaviours with a citation and a simulator `behaviour`: `device-busy`, `disconnect-on-request`, `session-id`, `strict-transaction-ids`, `event-delivery`, `property-datatype`, `requires-operations`, `requires-sequence`, `rejects-operations`, `hidden-from-device-info`, `emit-event`, `ptp-ip-personality`, or `none` for behaviours documented for reference only. Quirks carry `unverified: true` when their source flags them.

The simulator resolves each request through quirks, then recorded exchanges, then standard answers derived from the profile (DeviceInfo, OpenSession/CloseSession, property descriptors with state that `SetDevicePropValue` changes). An operation missing from a complete advertised list returns `OperationNotSupported`. Anything else raises `ProfileDataMissingError`: the simulator never invents a camera response.

## Documented profiles

`camera-catalog/camera-lines.json` (see its README) lists 11 manufacturers, 47 lines and 838 models with USB IDs and line quirks cited from libgphoto2 and vendor SDK pages. `bun run profiles:documented` regenerates one documented mock per line, named `<manufacturer>-<line>-documented.json`, using the newest capture-capable model with a known USB product ID. Lines with no such model (Hasselblad, Panasonic S, Pentax 645, Leica S, Sigma BF) get no mock and are listed in the matrix's line coverage table.

A documented mock's DeviceInfo lists the ISO 15740 mandatory operations, InitiateCapture when libgphoto2 marks the model capture-capable, and the opcodes its line's verified quirks document. The lists are marked incomplete, so other requests report missing data. `QUIRK_WIRING` in `build-documented-profiles.ts` maps each catalog quirk to a simulator behaviour where the source states one, such as the Canon remote-mode gate, Canon/Nikon polled events, Nikon DeviceReady busy, Canon live-view not-ready, hidden Panasonic operations and download-only refusals. Other quirks are kept for reference with behaviour `none`, and quirks the catalog marks unverified carry `unverified: true`. For documented rows only a disagreement with a documented exchange counts as a failure; vendor operations darkgrade has no definition for are reported as unsupported, so the matrix doubles as a list of support gaps.

## Per-model documented mocks

The suite also builds one documented mock per catalog model at test time (`catalogModelMocks` in `scripts/camera-profiles/documented-profile.ts`) instead of committing hundreds of files: 806 models, skipping 31. Thirty have no USB product ID; the Hasselblad X1D-50c has one from usb.ids but no PTP evidence. Each model mock takes its own USB vendor/product ID and model string (in DeviceInfo too), inherits its line's quirks, and differs from the line mock in two ways:

- Line quirks the catalog scopes to particular models apply only to them. Flag-scoped quirks (`canon-delete-sends-event`, `coolpix-no-capture-complete`, `leica-no-capture-complete`) need the model's libgphoto2 flag; name-scoped ones (`fuji-xt30-no-tether`, `fuji-xs10-webcam-only`, `fuji-xe5-no-capture`, `coolpix-a-hidden-ops`, `nikon-d3xxx-hidden-ops`) need the named model.
- The model's libgphoto2 device flags become reference quirks citing its `library.c` entry. Flags inside C comments in that entry (for example `0/*PTP_CAP|...*/` on the EOS M) are not in effect and are recorded as such; `PTP_CAP` decides whether InitiateCapture is advertised.

The Markdown matrix rolls these results up per line, with the full per-model table collapsed; the JSON artifact has every row (`scope: "model"`).

## Over PTP/IP (Wi-Fi)

A profile with a `ptp-ip-personality` quirk also runs over the network. `SimulatedPtpIpCamera` (`src/transport/simulated/simulated-ptpip-camera.ts`) serves the profile's `SimulatedTransport` as a standard PTP/IP camera on a loopback TCP port: command and event channels, data phases in both directions, events and pings. darkgrade then connects with its real `IPTransport`. A request the profile cannot answer is cancelled with a PTP/IP Cancel packet instead of being given an invented response, so it is reported as no data without waiting for a timeout.

The catalog documents a standard PTP/IP personality for five Sony lines (`sony-ptpip-vendor-id`: over PTP/IP the DeviceInfo reports VendorExtensionID 0xFFFFFFFF and Manufacturer "Sony Corporation", per libgphoto2 `library.c`) and for Ricoh THETA (`theta-ptpip`). That covers 86 profiles: 6 line mocks and 80 per-model mocks. Matrix rows carry `transport: "ptp-ip"`, the Markdown has an "Over PTP/IP" section, and the merged matrix attaches them to the camera as `ptpIp`. The suite checks that every PTP/IP row gives the same status per capability as the same profile over USB, so a difference points at the IP transport. The matrix lists the lines with Wi-Fi evidence that are not simulated, and why: Fujifilm uses its own framing on TCP 55740-55742, and the catalog cites PTP/IP for Canon and Nikon only at manufacturer level.

## Compatibility UI

```sh
bun run compat:ui            # http://127.0.0.1:4174/ (also from the repository root)
```

A dense table, one row per evaluated profile, tier and link. It has columns for manufacturer, line, fidelity, link (USB or PTP/IP), an unverified flag, run progress, the ten capabilities, and the last run time.

- **Routes** with stable URLs: `/`, `/m/<manufacturer>`, `/m/<manufacturer>/<line>`, `/camera/<profile id>`, `/runs`, and `/gaps`. A camera page shows the camera's identity, USB IDs, catalog entry and libgphoto2 flags. It also shows every result per tier and link with its full message, other profiles with the same USB identity, quirks with citations, recorded exchanges, numbered sources, and the run history.
- **Filters** live in the query string, so views can be bookmarked and shared, and back and forward work:
    - `fidelity`, `transport`, `kind` (`model`, `line` or `profile`), `unverified`, and `q` (free-text search over model, profile and VID:PID);
    - `profile` (exact ids);
    - one key per capability with a status, for example `?set-property=fail`;
    - `sort` and `order`.
- **Live progress:** the simulation suite appends JSONL to `test-results/compat-runs/<run id>.jsonl` as each capability starts and finishes. The UI tails these logs and pushes changes over server-sent events. It shows overall progress (rows, checks, the capability in flight) and per-row progress; rows not reached yet are queued. The format is in `scripts/camera-profiles/compat-progress.ts`. Set `COMPAT_PROGRESS=off` to write no log.
- **Results when nothing runs:** the UI loads `test-results/camera-support-matrix.json`, the hardware matrices, imports and newer run logs. `/runs` lists every run log and matrix, opens any of them on its own (`?run=<id>`), loads a file from disk, and can start a simulation run for the current view. `compat:ui -- --results <file>` adds files too.
- `bun run compat:ui:build [-- --out <dir> --base /compat/]` writes the same pages as static HTML (`<route>/index.html`) plus `view.json` for client-side filtering.

The UI is TypeScript with no framework: server-rendered pages from `scripts/compat-ui/compat-pages.ts`, plus a small client bundled with Vite that shares the filter and rendering code.

## Standalone testing: record, ingest, see it in the UI

Outside CI, collect new hardware evidence through the configured bench adapter, or import previously recorded evidence for simulation:

1. **Run guarded identity/session checks on the camera.** Keep `bun run compat:ui` open to see completed results:

    ```sh
    # On the camera's configured bench host, with DARKGRADE_TESTBENCH_DIR set:
    bun run compat:hardware -- --usb 04a9:3294 --profile canon-eos-80d
    ```

    `compat:hardware` resolves only enabled USB mappings in `camera-lab/cameras.lab.json` and delegates to `lab:hardware`. The deployed bench must provide shared ownership support, matching live mappings, a scoped job and the existing per-camera lock. Busy, recording, powered-off, unregistered and PTP/IP cameras fail closed. The adapter runs read-only session and fresh DeviceInfo checks; other capabilities remain `no-data`. See [the device-lab boundary](../camera-lab/README.md). Completed results refresh the matrix shown in the UI; no settings, capture, recovery or power changes run.

    The exported `runStandalone` function is a software fixture evaluator with explicit `SimulatedTransport` injection. It refuses real transports and labels its output `captured` or `documented`, with simulation progress. Its tests do not establish physical validation.

2. **Record what is missing.** The UI's no-data cells and `/gaps` name the first request each profile cannot answer, for example `0x1002 [0x1]`. Record a usbmon trace of that action with the `camera-re-capture` skill.
3. **Ingest it:**

    ```sh
    bun run compat:ingest -- --capture canon-canon-eos-r5=~/captures/r5-connect.pcapng --simulate
    bun run compat:ingest -- --results ~/Downloads/<run id>.jsonl   # a hardware run log from another machine
    ```

    `--capture` extends a committed captured profile, or starts one from a per-model mock id, taking the catalog identity and none of the documented facts. `--simulate` re-runs the suite for those profiles only and leaves the full matrix untouched. The refreshed rows appear in the UI.

4. **See what is left** with `bun run compat:gaps`, which regenerates `packages/link/GAPS.md`.

## Producing captured profiles

```sh
bun run --cwd packages/link profiles:ingest -- --test-bench ../test-bench
```

The ingest script reads a `darkgrade/test-bench` checkout:

1. Structured evidence under `docs/` and `artifacts/` (`*.json`, `*.jsonl`): bench-probe results (USB identity, reported PTP identity, OpenSession) and darkgrade operation logs.
2. Prose observations transcribed in `scripts/camera-profiles/test-bench-observations.ts`. Each one cites a file and a verbatim excerpt, and the script stops if an excerpt is no longer in the checkout.
3. Optional usbmon captures, which give the most complete profiles. Run the script on a bench, where captures are kept under `/var/lib/darkgrade-testbench`:

    ```sh
    bun run profiles:ingest -- --test-bench ~/darkgrade-testbench \
        --capture canon-eos-r6-mark-iii=/var/lib/darkgrade-testbench/captures/<trace>.pcapng
    ```

    Only transactions whose every phase was captured in full are kept; GetDeviceInfo and GetDevicePropDesc responses become the profile's DeviceInfo and descriptors.

## Adding a camera

1. Add its observations to `test-bench-observations.ts` (identity, line, and any exchanges or quirks the evidence states), citing excerpts.
2. Capture a session on the bench with the `camera-re-capture` skill, including a connect, `GetDeviceInfo`, the property descriptors you need and any operations to cover, then ingest it with `--capture`.
3. Run `bun run --cwd packages/link test:simulation` and `bun run --cwd packages/link simulation:matrix`, and check `test-results/camera-support-matrix.md`.

A capability is reported as `pass`, `fail`, `unsupported` (the camera answered `OperationNotSupported`/`DevicePropNotSupported`, or darkgrade does not offer it for that vendor), or `no-data`. A `fail` in a captured profile fails the suite, because it means darkgrade mishandles data a real camera produced.

## Runtime identification and future application

`identifyCamera` is exported from `@darkgrade/link` and included in USB discovery results. It preserves unknown identities, shared-ID ambiguity, model-readback conflicts and per-profile evidence coverage. Run `bun run cameras:build` after changing the catalog or profiles; `cameras:check` verifies the committed table. A USB match does not establish working PTP controls.

The merged compatibility artifact records `resultEvidence` for every capability. A result can come from captured or documented simulation even when another capability on the same camera has hardware evidence; its tier is retained and shown in the rendered table. See [the Outpost integration boundary](simulation-bench-outpost.md) for the future application design and [SDK findings](camera-sdk-evidence.md) for artifact-backed constraints and limits.
