# Camera device lab

The simulator (`docs/camera-simulation.md`) checks darkgrade against camera profiles on every push. It cannot prove that a camera accepts a command; only the camera can. The device-lab tier runs the same capability suite against the physical bodies on the testbench, and both tiers write the same support-matrix format.

| Tier       | Workflow                           | Runs on                                    | When                                                   | Fidelity                 |
| ---------- | ---------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------ |
| Simulation | `.github/workflows/camera-sim.yml` | `ubuntu-latest`                            | every push and pull request                            | `captured`, `documented` |
| Device lab | `.github/workflows/camera-lab.yml` | self-hosted runners on the testbench hosts | nightly, pushes to the default branch, manual dispatch | `hardware`               |

## Camera registry

`cameras.lab.json` lists each physical body: manufacturer, line, model, firmware, the connection the lab tests (`usb`, `ptpip` or `sony-remote`) and the others verified on it, USB vendor/product IDs, bench host, bench label (its name in the host's `testbench.conf`), and the captured profile it corresponds to. Every value cites a `darkgrade/test-bench` document with a verbatim excerpt; anything the documents do not state is `null` (firmware for the α6700, EOS 80D and FX2, and every USB serial). Cameras listed only under historical evidence (Z 7, E-PL5, the former EOS R6) are present but disabled.

```sh
bun run lab:registry                                     # validate and list
bun run lab:registry -- --matrix                         # the GitHub Actions matrix for enabled cameras
bun run lab:registry -- --verify-sources ../test-bench   # check every cited excerpt still exists
```

To add a camera, add its entry with sources and a captured profile (see "Adding a camera" in `docs/camera-simulation.md`), then run `bun run test:simulation`; `tests/camera-simulation/camera-registry.test.ts` checks the entry against its profile.

## What a lab job does

The hardware entrypoint requires `DARKGRADE_TESTBENCH_DIR` to name the deployed bench checkout. It fails before USB access if the checkout has no shared `HardwareCoordinator`, loopback MCP is unavailable, the host or camera mapping differs, another job/recording/recovery owns the camera, or the camera is powered off or unavailable on USB. It does not power on or recover cameras.

For each available camera:

1. Read fresh MCP `bench_status`, then acquire shared `HardwareCoordinator` ownership using the deployed bench’s state database. Read status again and require that MCP sees the same owner; this prevents running against a different state database or a service without shared ownership support.
2. Start an `agent_job_start` scoped to the configured camera and heartbeat it. Run a worker under the bench’s existing per-camera `flock`; the parent retains shared ownership until that worker exits, including interruption and timeout cleanup.
3. Run read-only connection/session and fresh PTP `GetDeviceInfo` checks. All other capabilities carry `no-data` with the read-only scope stated explicitly. Captured exchanges are never replayed against hardware. No settings, capture, power or recovery actions run, so initial settings and power are preserved.
4. Close the worker’s camera session and finish the scoped job in `finally`, then release hardware ownership. A failed lease, lock, worker or cleanup fails the run. Results retain fidelity `hardware`, with only the actual read-only checks classified; firmware is omitted rather than inferred from the historical registry.

The parent bounds its worker to two minutes, requests termination, and waits for exit before releasing ownership. This worker awaits each operation fully, stops after failure or interruption and awaits disconnect in `finally`. Mutation, capture and live-view tests remain outside this adapter until cancellation and state restoration are implemented inside the bench. This limit avoids overlapping a timed-out command with a later capability or restoration write.

A `report` job combines per-camera results (`bun run lab:results`) and publishes them when configured. No raw USB captures are uploaded by this workflow; collect and sanitize additional evidence through the guarded bench tools.

A single runner per host and an idle schedule do not establish camera ownership. The bench owns that boundary so CI, Fleet and a future Outpost Simulation Bench share it.

### Limits

- The adapter requires a deployed MCP version that reports current `hardwareOwners`; older services fail closed.
- Only read-only USB identity/session checks run. Wi-Fi, property writes, image capture, recording and live view remain untested by this tier.
- A successful command or DeviceInfo response does not establish visual focus, exposure, recording or media behavior.
- Busy or intentionally powered-off cameras fail the run without recovery or power changes.

## Registering the testbench hosts as runners

Each host registers one runner. A runner runs one job at a time, so cameras sharing a host's USB hub are never driven concurrently; the workflow only lets different hosts run in parallel.

On each host, as the user that owns the `darkgrade-testbench` checkout and has USB and usbmon access (the bench service user):

1. In GitHub, open **Settings → Actions → Runners → New self-hosted runner** for `darkgrade/darkgrade`, choose Linux x64, and follow the download steps.
2. Configure it with the shared label and the host's own label, which must match `runnerLabel` in `cameras.lab.json`:

    ```sh
    ./config.sh --url https://github.com/darkgrade/darkgrade --token <registration token> \
        --name darkgrade01 --labels darkgrade-testbench,darkgrade01 --unattended
    sudo ./svc.sh install "$USER" && sudo ./svc.sh start
    ```

3. Set repository variable `DARKGRADE_TESTBENCH_DIR` to the deployed test-bench checkout’s absolute path. Its state directory must match the MCP service; if using a custom location, set `DARKGRADE_BENCH_STATE_DIR` in the runner’s environment. The adapter verifies ownership is visible to MCP before opening USB.
4. When every host is registered, set the repository variable `CAMERA_LAB_ENABLED` to `true`. Until then the workflow's jobs are skipped instead of waiting for a runner.

The runner only makes outbound HTTPS connections to GitHub (it long-polls for jobs), so the hosts need no inbound ports, port forwarding or tailnet exposure. A tailnet would only be needed for a different design in which CI calls an agent on each host (for example the testbench MCP server over Tailscale) instead of running jobs there.

The lab workflow has no `pull_request` trigger, so code from forks never runs on the bench. Keep it that way, and restrict the runners' group to this repository.

## Results on Google Cloud

Both workflows publish to `gs://$GCP_RESULTS_BUCKET/runs/<commit sha>/`:

| Object               | Written by                        |
| -------------------- | --------------------------------- |
| `simulation.json`    | camera-sim (support matrix)       |
| `compatibility.json` | camera-sim (merged matrix, below) |
| `hardware.json`      | camera-lab                        |

The lab also writes `latest/hardware.json` from default-branch runs, which the simulation workflow merges into its compatibility matrix. Every step is skipped while `GCP_RESULTS_BUCKET` is unset, and pull requests from forks never publish. With `GCP_BQ_DATASET` set, both workflows also load one row per camera and capability into `<dataset>.camera_capability_results` (schema: `bigquery-schema.json`; `bun run compat:records` writes the rows).

### One-time setup

```sh
PROJECT=<project id>; PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
BUCKET=<bucket name>; ACCOUNT=camera-results@$PROJECT.iam.gserviceaccount.com

gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location us-east1 --uniform-bucket-level-access
gcloud iam service-accounts create camera-results --project "$PROJECT" --display-name "Camera results publisher"
# objectAdmin: create runs/, overwrite latest/hardware.json, and read it back.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$ACCOUNT" --role roles/storage.objectAdmin

gcloud iam workload-identity-pools create github --project "$PROJECT" --location global
gcloud iam workload-identity-pools providers create-oidc darkgrade --project "$PROJECT" --location global \
    --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition "assertion.repository == 'darkgrade/darkgrade'"
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project "$PROJECT" --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/darkgrade/darkgrade"

# Optional BigQuery history.
bq mk --dataset "$PROJECT:camera_results"
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$ACCOUNT" --role roles/bigquery.jobUser
bq add-iam-policy-binding --member "serviceAccount:$ACCOUNT" --role roles/bigquery.dataEditor "$PROJECT:camera_results"
```

Then set these repository variables (Settings → Secrets and variables → Actions → Variables); none of them is secret:

| Variable              | Value                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `GCP_RESULTS_BUCKET`  | the bucket name, without `gs://`                                                              |
| `GCP_WIF_PROVIDER`    | `projects/<project number>/locations/global/workloadIdentityPools/github/providers/darkgrade` |
| `GCP_SERVICE_ACCOUNT` | `camera-results@<project id>.iam.gserviceaccount.com`                                         |
| `GCP_BQ_DATASET`      | optional, `<project id>:camera_results`                                                       |

## Merged compatibility matrix

`bun run compat:merge` combines the simulation matrix with the latest hardware matrix, when there is one, into `test-results/camera-compatibility.{json,md}`. Rows join only when USB identity and an exact catalog/profile model alias agree. Shared product IDs alone do not establish model aliases. Conflicting known firmware versions remain separate. Each capability takes its strongest available evidence (hardware, then captured, then documented), with its source retained in `resultEvidence`; a weaker source is labeled in the rendered cell. Per-line documented mocks are dropped in favour of the per-model ones.

`bun run compat:readme` regenerates the "Camera compatibility matrix" section of the repository README between the `camera-compatibility` markers. To refresh it with hardware results:

```sh
bun run test:simulation
gcloud storage cp "gs://$BUCKET/latest/hardware.json" test-results/camera-lab-matrix.json   # optional
bun run compat:merge && bun run compat:readme
```
