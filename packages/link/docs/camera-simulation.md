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
- `quirks`: line or model behaviours with a citation and a simulator `behaviour`: `device-busy`, `disconnect-on-request`, `session-id`, `strict-transaction-ids`, `event-delivery`, `property-datatype`, `requires-operations`, `rejects-operations`, `hidden-from-device-info`, `emit-event`, or `none` for behaviours documented for reference only. Quirks carry `unverified: true` when their source flags them.

The simulator resolves each request through quirks, then recorded exchanges, then standard answers derived from the profile (DeviceInfo, OpenSession/CloseSession, property descriptors with state that `SetDevicePropValue` changes). An operation missing from a complete advertised list returns `OperationNotSupported`. Anything else raises `ProfileDataMissingError`: the simulator never invents a camera response.

## Documented profiles

`camera-catalog/camera-lines.json` (see its README) lists 11 manufacturers, 46 lines and 837 models with USB IDs and line quirks cited from libgphoto2 and vendor SDK pages. `bun run profiles:documented` regenerates one documented mock per line, named `<manufacturer>-<line>-documented.json`, using the newest capture-capable model with a known USB product ID. Lines with no such model (Hasselblad, Panasonic S, Pentax 645, Leica S, Sigma BF) get no mock and are listed in the matrix's line coverage table.

A documented mock's DeviceInfo lists the ISO 15740 mandatory operations, InitiateCapture when libgphoto2 marks the model capture-capable, and the opcodes its line's verified quirks document. The lists are marked incomplete, so other requests report missing data. `QUIRK_WIRING` in `build-documented-profiles.ts` maps each catalog quirk to a simulator behaviour where the source states one, such as the Canon remote-mode gate, Canon/Nikon polled events, Nikon DeviceReady busy, Canon live-view not-ready, hidden Panasonic operations and download-only refusals. Other quirks are kept for reference with behaviour `none`, and quirks the catalog marks unverified carry `unverified: true`. For documented rows only a disagreement with a documented exchange counts as a failure; vendor operations darkgrade has no definition for are reported as unsupported, so the matrix doubles as a list of support gaps.

## Per-model documented mocks

The suite also builds one documented mock per catalog model at test time (`catalogModelMocks` in `scripts/camera-profiles/documented-profile.ts`) instead of committing hundreds of files: 806 models, skipping the 31 with no USB product ID. Each model mock takes its own USB vendor/product ID and model string (in DeviceInfo too), inherits its line's quirks, and differs from the line mock in two ways:

- Line quirks the catalog scopes to particular models apply only to them. Flag-scoped quirks (`canon-delete-sends-event`, `coolpix-no-capture-complete`, `leica-no-capture-complete`) need the model's libgphoto2 flag; name-scoped ones (`fuji-xt30-no-tether`, `fuji-xs10-webcam-only`, `fuji-xe5-no-capture`, `coolpix-a-hidden-ops`, `nikon-d3xxx-hidden-ops`) need the named model.
- The model's libgphoto2 device flags become reference quirks citing its `library.c` entry. Flags inside C comments in that entry (for example `0/*PTP_CAP|...*/` on the EOS M) are not in effect and are recorded as such; `PTP_CAP` decides whether InitiateCapture is advertised.

The Markdown matrix rolls these results up per line, with the full per-model table collapsed; the JSON artifact has every row (`scope: "model"`).

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
