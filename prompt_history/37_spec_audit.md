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
* It is time for a full audit of everything in our `src/constants/` folder against our `docs/` folder to verify correctness.
* Write a script that:
    * Extracts ALL hex codes (`0x00`, `0x0000`) from any source file in `src/constants/` into a nice JSON specification
    * Does a find operation for each specific hex code within the `docs/` folder and extracts the relevant piece of those docs into a new `docs/audit/iso` or `docs/audit/sony` folder where the title of the doc is the `0x<HEX_CODE>_<NAME>.md` we're interested in
        * For the ISO docs, you're looking for a Markdown block in `docs/iso/ptp_iso_15740_reference` similar to this, where the PropertyCode corresponds to the property we're interested in, where it continues until the next property/operation is defined with a similar structure (just fetch the block for THIS property):

            ```markdown
            ### **13.5.7 F-Number**

            DevicePropCode = 0x5007

            Data type: UINT16

            DescForms: Enum

            Get/Set: Get, Get/Set

            Description: this property corresponds to the aperture of the lens. The units are equal to the F-number scaled by 100. When the device is in an automatic exposure program mode, the setting of this property via the SetDeviceProp operation may cause other properties such as exposure time and exposure index to change. Like all device properties that cause other device properties to change, the device is required to issue DevicePropChanged events for the other device properties that changed as a side effect of the invoked change. The setting of this property is typically only valid when the device has an ExposureProgramMode setting of manual or aperture priority.
            ```

        * For the Sony docs, you're looking for a block in `docs/manufacturers/sony/ptp_sony_reference` similar to this, where the PropertyCode corresponds to the property we're interested in, where it continues until the next property/operation is defined with a similar structure (just fetch the block for THIS property):

            ```markdown
            # White Balance

            # **Summary**

            Get/Set the white balance.

            # **Description**

            | Field        | Field Order | Size (Bytes) | Datatype | Value             |
            |--------------|-------------|--------------|----------|-------------------|
            | PropertyCode | 1           | 2            | UINT16   | 0x5005            |
            ...
            ```

    * There is almost guaranteed to be multiple results for this code in the document, so you want to validate the part of the document you're extracting meets this criteria:
        * Do fuzzy matching on the heading that comes directly before the target block and see how it matches up against the name of the property before we choose that block for certain. Strip any special characters and numbers and lowercase both sides of the match before you do the fuzzy match
        * ISO - if it doesn't contain this text within the surrounding lines, it is probably not the block you're looking for:
            * The hex code you're looking for
            * For properties, it will contain a DevicePropCode, Data type, and description
            * For operations, it will contain an OperationCode Parameter1, and description
            * For responses, it will contain a ResponseCode and description
            * For events, it will contain an EventCode, Parameter1, and description
            * Section numbers (e.g. 10.5.1) will almost always occur in the beginning of each code description and make good boundaries for splitting the document.
            * Any mention of tables (e.g. **Table 22**) in a subsequent heading make a good end boundary.
        * Sony - if it doesn't contain this text within the surrounding lines, it is probably not the block you're looking for:
            * The hex code you're looking for
            * For properties, it will contain Summary and Description and PropertyCode
            * For operations, it will contain Summary and Description and Operation Code and perhaps parameters
            * For events, it will contain Summary and Description and Event Code
            * For controls, it will contain Summary and Description and ControlCode
    * Once you do find the block that we're interested in matching the above criteria, the goal is to extract the part of the document from the previous main heading (which will likely loosely correspond to the name of this operation/property/event/control/response) to the next main heading (which will likely have a different named operation/property/event/control/response)
    * The headings format can be inconsistent. Sometimes they will be level 1/2/3 headings, sometimes they get miscategorized and will just be **bold** in the markdown export. Unfortunately formatting is not reliable enough.
    * Output a count & list of what's currently in `src/constants/ptp` and `src/constants/vendors/sony` for each code saying:
        - Found & extracted documentation for code (GREEN)
        - Could find & extract documentation for code (RED)
    * If you can't find a large number of codes, that probably means your parsing logic needs to be slightly more permissive to tolerate additional heading inconsistencies, special characters, or parsing errors
    * Tables can span more than one page in the original document, in which case you might see an additional table header with the same column names or a few blank lines in between    
    * Make the script output coverage by category in absolute number and percentage.

If we're getting low coverage, dig around manually in the documents to examine one code that's missing, see if you can find it, and update the parser logic!
