# N REV dataset refinement

The regenerated dataset contains 82,073 foods from 86,928 source rows, preserving primary-first normalized-name deduplication. Original workbook files and numeric nutrient values are unchanged. Empty strings are represented as null.

## Results

- Primary foods: 40,000; extended foods: 42,073.
- Duplicate names collapsed: 4,855; duplicates with differing source fields: 891.
- Cuisine classified from supported labels or whole-word dish evidence: 4,045.
- Cuisine without sufficient evidence: 78,019; conflicting cuisine evidence: 9.
- Missing serving weights: 13,251; invalid serving weights: 11.
- Energy basis or units requiring review: 19,425. These values were flagged, not converted.
- Missing protein: 630; iron: 49,636; calcium: 48,709; vitamin D: 78,566.

The attachment's historical high cuisine coverage and complete nutrient counts are not substantiated by these source workbooks. Unknown cuisine and nutrient values are retained without fabricated enrichment. Diet and allergen metadata need verified source evidence for all records.

## Outputs

- `foods-refined.jsonl`: retained source fields, canonical cuisine tags, classification evidence, source workbook and row, tier and cuisine rule version.
- `duplicate-review.jsonl`: duplicate and retained IDs, both workbook names and row numbers, and differing fields. Use these references to resolve conflicts against the original workbooks.
- `metadata-review.jsonl`: per-food missing nutrient flags, serving and energy review flags, cuisine evidence, and source row and tier.
- `refinement-audit.json`: source hashes, counts, aggregate quality flags and nutrient coverage.
- `fidelity-verification.json`: retained historical verification artifact; not regenerated in this run.

## Reproduce

From the repository root:

```powershell
pnpm --filter @workspace/api-server dataset:refine
pnpm --filter @workspace/api-server test
```

## Validation and integration status

The refinement command completed. Output checks passed for 82,073 foods, source tier counts, 4,855 duplicate references, original source hashes and per-food missing nutrient flags. All 47 tests in the current API test command passed. That command excludes the existing `refinement.test.ts`; its assertions target a different integration state and are not claimed as passing.

The current application loader still reads the original XLSX workbooks, not this JSONL output. No database import or deployment was performed. Some current source-selection tests explicitly require the full pool when cuisine is absent, conflicting with the attachment's Indian-default candidate-pool requirement. Passing the current suite does not establish compliance with that requirement. Application integration and live database acceptance remain outstanding.
