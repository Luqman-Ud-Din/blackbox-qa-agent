---
name: qa-detect-form-captcha
description: "Detects login/register forms with no captcha protection (potential bot abuse), and detects captcha widget presence + container visibility"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks

- Login / register / contact forms with NO captcha widget present — potential brute-force / bot abuse target
- Captcha widget present but its iframe / container is `display:none` or has zero size — broken captcha

## Probe (browser_evaluate)

```js
() => {
  const sel = el => el.id ? `#${el.id}` : el.tagName.toLowerCase();
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // Captcha detection signatures
  const hasRecaptcha = !!document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]');
  const hasHCaptcha  = !!document.querySelector('.h-captcha, [data-hcaptcha-sitekey], iframe[src*="hcaptcha"]');
  const hasTurnstile = !!document.querySelector('.cf-turnstile, iframe[src*="turnstile"]');
  const hasCaptcha   = hasRecaptcha || hasHCaptcha || hasTurnstile;

  // 1. Detect login/register/contact form context
  const bodyText = (document.body && document.body.innerText || '').toLowerCase();
  const looksLikeAuth =
    /(sign\s*in|log\s*in|sign\s*up|register|create\s*account)/i.test(bodyText) &&
    !!document.querySelector('input[type="password"]');
  const looksLikeContact =
    /contact\s*us|get\s*in\s*touch|send\s*message/i.test(bodyText) &&
    !!document.querySelector('textarea, input[name*="message" i]');

  // 2. Auth forms without captcha — flag at register specifically
  if (!hasCaptcha && looksLikeAuth && /(sign\s*up|register|create\s*account)/i.test(bodyText)) {
    out.push({
      issueType: 'captchaMissingOnSignup',
      severity: 'medium',
      selector: 'form',
      description: 'Signup/register form has no captcha widget (reCAPTCHA/hCaptcha/Turnstile) — potential bot-account creation vector',
      bbox: { x: 0, y: 0, w: 200, h: 80 }
    });
  }
  if (!hasCaptcha && looksLikeContact) {
    out.push({
      issueType: 'captchaMissingOnContact',
      severity: 'low',
      selector: 'form',
      description: 'Contact / message form has no captcha widget — likely spam target',
      bbox: { x: 0, y: 0, w: 200, h: 80 }
    });
  }

  // 3. Captcha is present but its container is broken (display:none, zero size)
  const captchaEls = document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile');
  for (const c of captchaEls) {
    if (out.length >= 8) break;
    const r = c.getBoundingClientRect();
    const style = getComputedStyle(c);
    if (style.display === 'none' || style.visibility === 'hidden' || (r.width === 0 && r.height === 0)) {
      out.push({
        issueType: 'captchaContainerHidden',
        severity: 'high',
        selector: sel(c),
        description: `Captcha widget ${sel(c)} is present but its container is hidden (display=${style.display}, w×h=${r.width}×${r.height}) — users can't solve it`,
        bbox: bb(c)
      });
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| captchaMissingOnSignup | medium | "Signup form has no captcha — bot signup vector" |
| captchaMissingOnContact | low | "Contact form has no captcha — spam target" |
| captchaContainerHidden | high | "Captcha widget present but its container is hidden — users cannot solve it" |
