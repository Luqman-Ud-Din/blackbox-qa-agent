---
name: qa-detect-form-autocomplete
description: "Detects form fields with missing or incorrect autocomplete attributes — breaks password managers, browser autofill, and accessibility"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks

Form inputs need correct `autocomplete=` values so password managers, browser autofill, and assistive tech work properly. Common bugs:
- Email field missing `autocomplete="email"` or `"username"`
- Login password missing `autocomplete="current-password"`
- Signup password missing `autocomplete="new-password"` (would otherwise be filled with existing password)
- Generic `autocomplete="off"` on inputs where it shouldn't be (anti-pattern; doesn't actually disable password managers)

## Probe (browser_evaluate)

```js
() => {
  const sel = el => (el.id ? `#${el.id}` : `input[name="${el.name}"]`).slice(0, 120);
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // Detect login vs signup form by the count of password fields + presence of "confirm" / "sign up" text
  const passwordFields = [...document.querySelectorAll('input[type="password"]')];
  const formContext = document.body.innerText.toLowerCase();
  const isSignup = passwordFields.length >= 2 ||
                    /sign\s*up|create\s*account|register/.test(formContext) &&
                    !/sign\s*in|log\s*in/.test(formContext);

  for (const input of document.querySelectorAll('input, textarea')) {
    if (out.length >= 15) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') continue;

    const auto = (input.getAttribute('autocomplete') || '').trim().toLowerCase();
    const type = input.type;
    const name = (input.name || input.id || '').toLowerCase();

    // Email field
    if (type === 'email' || /email/.test(name)) {
      if (!auto || (auto !== 'email' && auto !== 'username')) {
        out.push({
          issueType: 'autocompleteMissingEmail',
          severity: 'medium',
          selector: sel(input),
          description: `Email input ${sel(input)} has autocomplete="${auto || 'none'}" — should be "email" or "username"`,
          bbox: bb(input)
        });
        continue;
      }
    }

    // Password field
    if (type === 'password') {
      const expected = isSignup ? 'new-password' : 'current-password';
      if (auto !== expected) {
        out.push({
          issueType: 'autocompleteWrongPassword',
          severity: 'medium',
          selector: sel(input),
          description: `Password input ${sel(input)} has autocomplete="${auto || 'none'}" — should be "${expected}" for ${isSignup ? 'signup' : 'login'} flow`,
          bbox: bb(input)
        });
      }
      continue;
    }

    // Name/given-name/family-name fields
    if (/first.?name|given.?name|fname/.test(name)) {
      if (auto !== 'given-name' && auto !== 'name') {
        out.push({
          issueType: 'autocompleteMissingName',
          severity: 'low',
          selector: sel(input),
          description: `First name field ${sel(input)} missing autocomplete="given-name"`,
          bbox: bb(input)
        });
      }
      continue;
    }
    if (/last.?name|family.?name|surname|lname/.test(name)) {
      if (auto !== 'family-name') {
        out.push({
          issueType: 'autocompleteMissingName',
          severity: 'low',
          selector: sel(input),
          description: `Last name field ${sel(input)} missing autocomplete="family-name"`,
          bbox: bb(input)
        });
      }
      continue;
    }

    // Phone
    if (type === 'tel' || /phone|mobile|tel/.test(name)) {
      if (auto !== 'tel' && auto !== 'tel-national') {
        out.push({
          issueType: 'autocompleteMissingTel',
          severity: 'low',
          selector: sel(input),
          description: `Phone input ${sel(input)} missing autocomplete="tel"`,
          bbox: bb(input)
        });
      }
      continue;
    }

    // autocomplete="off" anti-pattern — flag if found on credential field
    if (auto === 'off' && (type === 'email' || type === 'password' || type === 'text')) {
      out.push({
        issueType: 'autocompleteOffAntiPattern',
        severity: 'low',
        selector: sel(input),
        description: `Input ${sel(input)} uses autocomplete="off" — most browsers ignore this; use specific tokens like new-password instead`,
        bbox: bb(input)
      });
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| autocompleteMissingEmail | medium | "Email field missing autocomplete=email" |
| autocompleteWrongPassword | medium | "Password field wrong autocomplete — should be current-password or new-password" |
| autocompleteMissingName | low | "Name field missing autocomplete=given-name / family-name" |
| autocompleteMissingTel | low | "Phone field missing autocomplete=tel" |
| autocompleteOffAntiPattern | low | "autocomplete=off on credential field — anti-pattern, browsers ignore it" |
