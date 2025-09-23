We are building an API around Picture Transfer Protocol (PTP).

We have amassed a vast collection on this protocol (both the generic ISO spec and various vendor implementations). You have access to all of this in the `docs/` folder.

Essential background context:

- You **MUST FULLY** read, understand, and adhere to this prompt before continuing.
- You **MUST FULLY** read, understand, and adhere to the important notes before continuing.
- You **MUST FULLY** read, understand, and adhere to the goals before continuing.
- You **MUST FULLY** read, understand, and adhere to the success criteria before continuing.
- You **MUST FULLY** read, understand, and adhere to `./AGENTS.md` before continuing.
- You _may_ read through `prompt_history/` to understand our work so far at any time.
- You _may_ read through anything in the `docs/` folder to understand the ISO or vendor implementations of the spec.

Goals:

* We have a script that analyzes all the exported members in every file in the repo. The fact that these are "exports" is not helpful or actionable inherently, it just gives us a good overview of WHAT functionality exists and WHERE in the repo it lives. That script is in `scripts/analyze-exports.ts` for you to run.
* After you have the script output, analyze the logs and try to identify the functionality of each export. Don't write a script for this, analyze it manually.
* After you have identified the purpose of each, identify areas in the codebase where (1) we have duplicated functionality in multiple places, (2) we have unused functionality which we are not consuming anywhere, or (3) things are overly complex, (4) things that could be relocated or renamed for further clarity or legibility. Don't write a script for this, analyze it manually. Output bullet points with specific references to files for each of these categories. You can ignore any "red flags" related to SonySDIOParser (we want to keep it), web vs. node entry points & polyfills including EventEmitter (these are necessary to have our library run in the browser). Also ignore any custom encode/decode functions within constants; those are intentional and should be left alone.
* Keep any constants in @src/constants/ .
* Only refactor things that are used in more than one place.
