# Backend Architecture V2 Additions

This document captures the project additions requested for export, supplements, memory, security, jobs, commands, and error handling.

## 1. Excel Export Sheets

`/export` now generates a 5-sheet workbook with these sheets:

1. `Food Log`
- Row unit: one row per `food_item`
- Key columns: `Date`, `Meal`, `Name`, `Qty`, `Unit`, all nutrient columns
- Adds a per-day `TOTAL` row in the sheet data

2. `Daily Totals`
- Row unit: one row per day
- Key columns: `Date`, macro totals, key micronutrients
- Goal bands are emitted as statuses: `GREEN` (>= goal), `YELLOW` (70-99%), `RED` (<70%)

3. `Weekly Averages`
- Row unit: one row per week
- Key columns: week start, averages, `% of goal`
- Trend column uses arrows: `↑`, `↓`, `→`

4. `Micronutrient Heatmap`
- Row unit: one row per day
- Key columns: all vitamin + mineral values
- Band columns use `GREEN`/`YELLOW`/`RED` with thresholds:
  - `GREEN`: >= RDA
  - `YELLOW`: 50-99% RDA
  - `RED`: <50% RDA

5. `Supplement Log`
- Row unit: one row per `supplement_log`
- Key columns: `Date`, `Time`, `Name`, `Brand`, `Form`, `Servings`, `Dose`, nutrient fields
- Adds `supplement_type_color` classification

## 2. Supplements System

Migration adds:
- `supplement_profiles` with `aliases TEXT[]` and GIN index
- `supplement_logs` storing scaled nutrient fields

Alias lookup pattern:

```sql
SELECT *
FROM supplement_profiles
WHERE user_id = $1
  AND is_active = TRUE
  AND (
    name ILIKE '%' || $2 || '%'
    OR aliases @> ARRAY[$2]::TEXT[]
  )
LIMIT 1;
```

## 3. Memory System

`src/services/memory.ts` implements Mifflin-St Jeor BMR and activity-multiplied TDEE:
- `calculateBMR(weightKg, heightCm, age, sex)`
- `calculateTDEE(bmr, activityLevel)`

## 4. Security Layer

Migration adds:
- `security_events` table with severity and payload

Existing runtime guardrails continue to apply (`checkRateLimit`, temporary block support), and this migration provides the persistence layer for richer security event handling.

## 5. Scheduled Jobs (DB Support)

Migration adds support tables used by scheduled workloads:
- `report_send_log`

## 6. Commands

Implemented command in this increment:
- `/export`

Usage:
- `/export` -> last 30 days
- `/export YYYY-MM-DD` -> single day
- `/export YYYY-MM-DD YYYY-MM-DD` -> custom range

## 7. Error Behavior

`/export` user-facing behaviors:
- Invalid range format -> validation message with supported formats
- No logs in range -> explicit "No logs found" message
- Missing onboarding -> asks user to run `/start`

## 8. Migration Added

`prisma/migrations/20260329223000_export_memory_supplements_security/migration.sql`
