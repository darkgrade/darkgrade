# PTP Constants Documentation Audit Script

## **Prerequisites - MUST READ FIRST**

You **MUST FULLY** read, understand, and adhere to the following before continuing:
- This prompt in its entirety
- The important notes section below
- The goals and success criteria sections
- `./AGENTS.md`

Optional reference materials:
- Review `prompt_history/` to understand previous work
- Examine `docs/` folder for ISO and vendor implementation specs

## **Background**

We are building an API around Picture Transfer Protocol (PTP). We have a comprehensive collection of protocol documentation (both the generic ISO spec and various vendor implementations) in the `docs/` folder. It is time for a complete audit of our `src/constants/` folder against our documentation to verify correctness.

## **Primary Goal**

Create a comprehensive audit script that extracts, validates, and documents all hex codes from our constants against our reference documentation.

## **Technical Requirements**

### **1. Hex Code Extraction**

Extract ALL hex codes from source files in `src/constants/` matching these patterns:
- `0x[0-9A-Fa-f]{2,4}` (e.g., `0x00`, `0x0000`, `0x5007`)
- From: variable assignments, constants, enum values, and any other code structures
- Output format: Structured JSON specification with:
  ```json
  {
    "source_file": "path/to/file.js",
    "hex_code": "0x5007",
    "constant_name": "F_NUMBER",
    "category": "property|operation|event|response|control",
    "vendor": "iso|sony"
  }
  ```

### **2. Documentation Search & Extraction**

For each extracted hex code, perform targeted document searches:

#### **ISO Documentation** (`docs/iso/ptp_iso_15740_reference`)
Search for blocks matching this structure:
```markdown
### **13.5.7 F-Number**

DevicePropCode = 0x5007

Data type: UINT16

DescForms: Enum

Get/Set: Get, Get/Set

Description: this property corresponds to the aperture...
```

**Required validation criteria:**
- Contains the target hex code
- Contains appropriate field type:
  - **Properties**: `DevicePropCode`, `Data type`, `Description`
  - **Operations**: `OperationCode`, `Parameter1`, `Description`
  - **Responses**: `ResponseCode`, `Description`
  - **Events**: `EventCode`, `Parameter1`, `Description`
- Section numbers (e.g., `10.5.1`) mark good boundaries
- Table references (e.g., `**Table 22**`) mark good end boundaries

#### **Sony Documentation** (`docs/manufacturers/sony/ptp_sony_reference`)
Search for blocks matching this structure:
```markdown
# White Balance

# **Summary**

Get/Set the white balance.

# **Description**

| Field        | Field Order | Size (Bytes) | Datatype | Value             |
|--------------|-------------|--------------|----------|-------------------|
| PropertyCode | 1           | 2            | UINT16   | 0x5005            |
```

**Required validation criteria:**
- Contains the target hex code
- Contains `Summary` and `Description` sections
- Contains appropriate field type:
  - **Properties**: `PropertyCode`
  - **Operations**: `Operation Code` (may include parameters)
  - **Events**: `Event Code`
  - **Controls**: `ControlCode`

### **3. Fuzzy Matching Algorithm**

When multiple potential blocks are found for a hex code:

1. **Extract heading text** immediately preceding each candidate block
2. **Normalize both strings**:
   - Remove special characters (`-`, `_`, numbers, punctuation)
   - Convert to lowercase
   - Remove common words (`get`, `set`, `the`, `a`, `an`)
3. **Apply fuzzy matching**:
   - Use substring matching or Levenshtein distance
   - Minimum 60% similarity threshold
   - Prioritize exact substring matches
4. **Validate content** using the criteria above
5. **Select best match** based on combined fuzzy score + validation score

### **4. Block Extraction Logic**

Once the correct block is identified:

1. **Find start boundary**: Previous main heading (any level: `#`, `##`, `###`, or `**Bold**`)
2. **Find end boundary**: Next main heading or table reference
3. **Handle edge cases**:
   - Multi-page tables (look for repeated column headers)
   - Nested sections (prefer higher-level headings as boundaries)
   - Inconsistent formatting (treat bold text as potential headings)
4. **Extract complete section** from start to end boundary

### **5. Output Structure**

Create organized documentation in:
- `docs/audit/iso/0x<HEX_CODE>_<NAME>.md`
- `docs/audit/sony/0x<HEX_CODE>_<NAME>.md`

## **Validation & Quality Assurance**

### **Content Validation**
- Verify extracted blocks contain the target hex code
- Confirm required fields are present for each category
- Check minimum content length (>100 characters)
- Validate proper markdown structure

### **Coverage Analysis**
Output detailed coverage report:
```
PTP Constants Coverage Report
=============================

ISO Constants (src/constants/ptp):
✅ Found & extracted: 45/60 (75%)
❌ Missing documentation: 15/60 (25%)

Sony Constants (src/constants/vendors/sony):
✅ Found & extracted: 38/42 (90%)
❌ Missing documentation: 4/42 (10%)

Missing Codes:
- 0x1234: SOME_PROPERTY_NAME
- 0x5678: ANOTHER_OPERATION
```

### **Error Handling**

If coverage is below 80%:
1. **Manual investigation required**: Examine 2-3 missing codes manually
2. **Update parser logic**: Make parsing more permissive for:
   - Additional heading variations
   - Special characters in names
   - Alternative document structures
3. **Iterative improvement**: Re-run with updated logic

## **Success Criteria**

- [ ] All hex codes extracted from `src/constants/` with proper categorization
- [ ] Minimum 80% coverage for both ISO and Sony constants
- [ ] Extracted documentation blocks are complete and accurate
- [ ] Clear audit trail with coverage statistics
- [ ] Fuzzy matching successfully handles name variations
- [ ] Parser handles known edge cases (multi-page tables, inconsistent headings)
- [ ] Output files are properly organized and named

## **Important Notes**

- **Heading formats are inconsistent**: Handle `###`, `##`, `#`, and `**bold**` variations
- **Tables may span pages**: Look for repeated headers or blank lines
- **Multiple matches expected**: Use fuzzy matching and validation to select correct blocks
- **Document boundaries matter**: Section numbers and table references are reliable markers
- **Name variations common**: "F-Number" vs "F Number" vs "FNumber" - normalize before matching
- **Parser must be robust**: Low coverage likely indicates parsing logic needs adjustment

## **Troubleshooting**

If you encounter low coverage rates:
1. Manually search docs for 1-2 missing hex codes
2. Analyze why the parser missed them
3. Update fuzzy matching thresholds or boundary detection
4. Consider alternative heading patterns
5. Re-run with improved logic