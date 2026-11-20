---
description: Audit existing abstractions and consolidate repeated camera behavior before adding code.
---

Read AGENTS.md and packages/link/docs/pre-release-audit.md first.

1. State the behavior to preserve and list its existing definitions, adapters,
   workflows, UI consumers and tests. Search both canonical names and aliases.
2. Check the current README promises against built package exports, strict consumer
   types and actual behavior. Do not use source imports as package evidence.
3. Measure the available history window and changes before attributing complexity.
   Separate generated catalogs, tests, necessary vendor encodings and duplicated
   application behavior.
4. Reuse the smallest existing primitive. Map camera controls in Link, preserve
   vendor units/mode/availability guards, and update all consumers together.
5. Test different vendors/modes, absent/read-only/empty/ambiguous choices, failed
   readback and genuine package consumers. Preserve failed evidence.
6. Record decisions and prevention rules in the existing audit/AGENTS guidance.
   Keep the requested work on one branch and one PR; do not merge without authorization.
