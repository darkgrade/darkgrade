# Test email enrollment

No camera is required. From the repository root, build the current source:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run --cwd packages/slate build
bun run --cwd packages/cli build
```

For a separate test identity that does not replace your normal Studio/CLI preferences:

```sh
export DARKGRADE_HOME="$(mktemp -d)"
node packages/cli/dist/main.js telemetry opt-in
node packages/cli/dist/main.js telemetry login first@example.com
node packages/cli/dist/main.js telemetry status --email
```

Use an address you control. Before confirmation, `contact.email` is the submitted address
and `contact.verified` is `false`. Open the email link within **2 hours**; it can be used once.
Run `status --email` again to see `verified: true`.

To test reassociation, use a second address you control in the **same terminal**, keeping
the same `DARKGRADE_HOME`:

```sh
node packages/cli/dist/main.js telemetry login second@example.com
node packages/cli/dist/main.js telemetry status --email
```

The first verified address remains current, and `pendingEmail` shows the second address.
Once you verify the latest email, `contact.email` becomes the second address, `verified`
is true, and the pending address clears. Previous confirmation links cannot switch it back.
Different addresses can be submitted immediately; resending to the same address requires
one minute, and each installation is limited to five confirmation requests per day.

## Find contributors and earlier sessions

In Outpost, open **Telemetry → Contributors**. Enter an email and Apply. Each row shows the
installation ID, ✅ for a verified address or **Unverified**, pending replacements,
camera models, connection/backend setup, retained sessions and signals.

Open the row for camera fingerprints, source revisions, first/last seen and session links.
**Sessions** opens that installation's last 90 days; each replay also shows its current
email identity. A newly submitted address joins to the installation's retained history,
including sessions uploaded before enrollment. A verified replacement changes that lookup
for all retained sessions automatically; events themselves never contain an email.

Unverified addresses are user-submitted claims and do not establish ownership. An email
lookup may return multiple independent installations; a shared camera fingerprint does
not merge their users. Deleted/expired data and diagnostics never uploaded while opted
out cannot be recovered. Raw addresses stay in the private Telemetry support tools and
are excluded from Matrix exports/public attribution.

Warnings are yellow, explicit errors are red, and clear observations remain white/grey.
A busy response or retry is a warning; it does not establish a failed final workflow.

## Remove the test enrollment

```sh
node packages/cli/dist/main.js telemetry logout
node packages/cli/dist/main.js telemetry delete
unset DARKGRADE_HOME
```

Logout removes both the verified and pending associations without changing sharing.
Delete disables sharing and withdraws the test installation and its cloud history.
Keep your normal installation ID/settings if you want future enrollment to include its
existing history. Starting with a fresh test directory deliberately creates another identity.
