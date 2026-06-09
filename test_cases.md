# Argus project-local test cases
# Written by the user, in the audited repo's root. Argus auto-detects this file
# at audit start (no plugin edit needed). Each "##" heading is one test case.
# A `route:` line wires the case to the page it runs on. Missing file = skipped.

## Create a department and verify it appears
app: ghazali-foundation
route: /admin/administrative/departments
1. click "New Department"
2. type "Finance QA Dept" in input[placeholder*=department name]
3. click "Save"
4. verify text "Finance QA Dept" is visible

## Search filters the departments list
app: ghazali-foundation
route: /admin/administrative/departments
1. type "Finance" in input[placeholder*=Search]
2. verify text "Finance QA Dept" is visible

## Empty search shows a no-results message
app: ghazali-foundation
route: /admin/administrative/departments
1. type "zzzqx-not-real-9999" in input[placeholder*=Search]
2. verify text "No records found" is visible
