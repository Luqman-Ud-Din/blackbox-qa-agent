# Step 1.5 Inline Settings Editor — Implementation

Replace the old free-form prompts with this numbered menu approach.

## Setting 1: Browsers

```
Browsers [chromium]:
  [1] chromium  [2] firefox  [3] webkit  [4] all
  Select [1-4] or press Enter to keep [chromium]:
```

**User selects:**
- `1` → chromium
- `2` → firefox  
- `3` → webkit
- `4` → all
- (Enter) → keep current

## Setting 2: Workers

```
Workers [4]:
  [1] auto (1 browser × 4)  [2] custom number
  Select [1-2] or press Enter to keep [4]:
```

**If user selects [2]:** Ask "Enter custom number of workers:"

## Setting 3: Viewports

```
Viewports [mobile, tablet, desktop]:
  [1] mobile only  [2] tablet only  [3] desktop only
  [4] mobile + tablet + desktop  [5] all
  Select [1-5] or press Enter to keep [mobile, tablet, desktop]:
```

## Setting 4: Headless

```
Headless [false]:
  [1] true (headless browser)  [2] false (visible browser)
  Select [1-2] or press Enter to keep [false]:
```

## Setting 5: Dry run

```
Dry run [true]:
  [1] true (dry-run, no bugs filed)  [2] false (file real bugs to Azure DevOps)
  Select [1-2] or press Enter to keep [true]:
```

## After All 5 Settings

1. If user selected custom workers number → re-calculate: `workers = browsers.length × viewports.length` (one browser per engine × viewport; unless they entered custom)
2. Re-print Step 1.5 confirmation screen with updated values
3. Show [Y] [N] menu again

## Implementation Logic

For EACH setting:

```
1. Show the menu with numbered options
2. Wait for user input
3. Validate:
   - If Enter pressed → keep current value
   - If [1], [2], [3], [4], [5] typed → select that option
   - Otherwise → show "Invalid selection, try again"
4. Move to next setting
```

## Key Differences from Old Approach

| Old | New |
|-----|-----|
| "What browsers?" (free-form) | [1] chromium [2] firefox (select) |
| User types "chromium" | User types "1" |
| No default shown | Current value in brackets [chromium] |
| No options listed | All options listed with numbers |
