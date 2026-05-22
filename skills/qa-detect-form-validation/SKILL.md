---
name: qa-detect-form-validation
description: "Interactively submits empty and invalid forms to verify inline validation feedback, required attributes, and email validation."
---

# Form Validation Detection

## What Claude checks
- Submitting an **empty required form** — does the page show inline validation errors next to each required field?
- Submitting with an **invalid email address** (e.g. `notanemail`) — does the field show a validation error?
- HTML5 validation attributes are present on form fields: `required` on mandatory fields, `type="email"` on email fields, `pattern` on fields with format constraints
- Validation errors are **visible and descriptive** — not just a browser tooltip, but an inline message near the field
- Form does not submit and navigate away when validation fails

## How to detect

```js
// Step 1: Find all forms on the page
const forms = await page.locator('form').all();

for (const form of forms) {
  // Step 2: Check HTML5 validation attributes on required fields
  const requiredFieldsCheck = await form.evaluate(formEl => {
    const fields = formEl.querySelectorAll('input, select, textarea');
    const results = [];
    fields.forEach(field => {
      // Email fields should have type="email"
      const isEmailField = /email/i.test(field.name + field.id + field.placeholder);
      if (isEmailField && field.type !== 'email') {
        results.push({
          issue: 'missingEmailValidation',
          selector: field.id ? `#${field.id}` : `input[name="${field.name}"]`,
          name: field.name || field.id,
          currentType: field.type
        });
      }
      // Visually required fields (marked with * or "required") missing the required attribute
      const label = field.id ? document.querySelector(`label[for="${field.id}"]`) : null;
      const labelText = label ? label.innerText : '';
      if (/\*|required/i.test(labelText) && !field.hasAttribute('required') && !field.hasAttribute('aria-required')) {
        results.push({
          issue: 'missingRequired',
          selector: field.id ? `#${field.id}` : `input[name="${field.name}"]`,
          name: field.name || field.id
        });
      }
    });
    return results;
  });

  // Step 3: Try to submit the empty form
  const urlBefore = page.url();
  const submitBtn = form.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
  const hasSubmit = await submitBtn.count() > 0;

  if (hasSubmit) {
    // Clear all fields first
    const inputs = await form.locator('input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])').all();
    for (const input of inputs) {
      await input.fill('');
    }

    await submitBtn.click();
    await page.waitForTimeout(1000);  // allow validation UI to appear

    const urlAfter = page.url();
    const navigatedAway = urlAfter !== urlBefore;

    // Check for inline validation messages
    const validationMessages = await page.evaluate(() => {
      const results = [];
      // Browser native validation messages
      document.querySelectorAll('input, select, textarea').forEach(field => {
        if (field.validationMessage) {
          results.push({ field: field.id || field.name, message: field.validationMessage, native: true });
        }
      });
      // Custom validation messages (common class patterns)
      document.querySelectorAll('[class*="error"], [class*="invalid"], [class*="validation"], [aria-invalid="true"]').forEach(el => {
        const text = el.innerText.trim();
        if (text) results.push({ selector: el.className, message: text, native: false });
      });
      return results;
    });

    if (validationMessages.length === 0 && navigatedAway) {
      // Form submitted without validation
      await page.goBack();
    } else if (validationMessages.length === 0 && !navigatedAway) {
      // Form did not submit but also showed no validation feedback
      // File noValidationFeedback issue
    }

    // Step 4: Test invalid email
    const emailInput = form.locator('input[type="email"], input[name*="email" i], input[id*="email" i]').first();
    const hasEmailField = await emailInput.count() > 0;
    if (hasEmailField) {
      await emailInput.fill('notanemail');
      await submitBtn.click();
      await page.waitForTimeout(500);
      const emailValidation = await page.evaluate(() => {
        const emailFields = document.querySelectorAll('input[type="email"]');
        return Array.from(emailFields).map(f => ({
          validationMessage: f.validationMessage,
          ariaInvalid: f.getAttribute('aria-invalid')
        }));
      });
      // If no validation message appears after invalid email, file missingEmailValidation
    }
  }
}
```

## Issue schema
- type: `"noValidationFeedback"` | `"missingRequired"` | `"missingEmailValidation"`
- severity: from config (`medium` for all)
- selector: CSS selector of the form or field
- description:
  - noValidationFeedback: `"Form <selector> submitted without showing any validation errors for empty required fields"`
  - missingRequired: `"Field <selector> ('<name>') appears required (has asterisk/label) but is missing the required attribute"`
  - missingEmailValidation: `"Email field <selector> uses type='<currentType>' instead of type='email' — native email validation will not trigger"`

## Viewport behaviour
- Check on **all viewports** — form validation behaviour is not viewport-specific
- On **mobile**, also verify that validation error messages are visible above the keyboard and not obscured when the virtual keyboard opens
- Interact with forms at mobile viewport since touch interactions may behave differently than mouse clicks
