---
name: qa-review-content
description: "Reviews visible page text for spelling, grammar, word choice, pluralization, placeholder leaks, untranslated keys, encoding issues, and markdown / HTML-entity rendering bugs. Uses Claude (Sonnet) directly — no probe regex required."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Everything that lives in the visible page text. This is the single grammar / content-quality skill — Claude reads the page text directly and judges it. No spellcheck library, no external API.

Specifically, the skill emits findings for:

| Issue type | severity | What it catches |
|---|---|---|
| `spellingError` | medium | Misspelled words: `recieve`, `seperate`, `definately`, `occured` |
| `grammarError` | medium | Subject-verb disagreement, wrong tense, missing articles |
| `wordChoice` | medium | `your` vs `you're`, `their` vs `there`, `its` vs `it's`, `affect` vs `effect` |
| `pluralAgreement` | low | "1 items", "0 results found", "1 days ago" |
| `placeholderText` | high | Lorem ipsum, "TODO", "FIXME", "TBD", "XXX", "Sample text" leaking past staging |
| `untranslatedKey` | high | Strings like `common.button.save`, `{{username}}`, `[error.notfound]`, `__MSG_save__` |
| `htmlEntityLiteral` | medium | `&amp;`, `&lt;`, `&nbsp;` rendered as visible text |
| `markdownLiteral` | medium | `**bold**`, `__italic__`, `[link](url)` rendered as plain text |
| `encodingMojibake` | medium | `Ã©` instead of `é`, `â€™` instead of `'` — UTF-8 / Latin-1 corruption |
| `awkwardPhrasing` | low | Run-on sentences, stilted machine-translated copy |
| `capitalizationInconsistency` | low | Headings mixing Title Case / sentence case / ALL CAPS |
| `punctuationError` | low | Missing periods, double commas, no space after punctuation |

## Orchestrator flow

This skill is interactive. The orchestrator dispatches it to a Sonnet sub-agent because the actual judgment work is Claude-side, not browser-side.

1. Run `probe.extractVisibleText` — single small probe that returns the visible text of the page's main content area (plus a few signal hints).
   - Cap the returned text at 5,000 characters. If the page is longer, take the first 2,500 + last 2,500 chars.
   - Skip text inside `<nav>`, `<footer>`, `<script>`, `<style>`, `<noscript>`, and elements with `aria-hidden="true"`.
2. Pass the extracted `text` + cell context to a Sonnet sub-agent:

   ```
   Agent(
     subagent_type = "qa-review-content",
     model         = "sonnet",
     prompt = `You are reviewing the visible text of a web page for content quality issues.

     Cell context:
       route: {cell.route}
       viewport: {cell.viewport}
       browser: {cell.browser}

     Visible text from the page:
     ---
     {extractedText}
     ---

     Find any issues from these categories (only emit if you're confident):
       - spellingError       (real misspellings)
       - grammarError        (subject-verb / tense / articles)
       - wordChoice          (your/you're, their/there, its/it's, affect/effect)
       - pluralAgreement     ("1 items", "0 days ago", "1 results")
       - placeholderText     (Lorem ipsum, TODO, FIXME, sample)
       - untranslatedKey     (common.foo.bar, {{var}}, __MSG_*)
       - htmlEntityLiteral   (&amp;, &lt;, &nbsp; as visible text)
       - markdownLiteral     (**bold**, [link](url) as visible text)
       - encodingMojibake    (Ã©, â€™ — broken UTF-8)
       - awkwardPhrasing     (only flag clear run-ons / stilted machine translation)
       - capitalizationInconsistency
       - punctuationError    (missing period, double punctuation)

     Rules:
       - Do NOT flag product names, brand names, or technical acronyms as misspellings.
       - Do NOT flag intentional casing like iPhone, macOS, GitHub.
       - Do NOT flag URLs or code snippets.
       - Limit total findings to 15 per cell.
       - Output ONLY a valid JSON array — no prose, no markdown.

     Return JSON:
     [
       {
         "issueType": "<one of the categories above>",
         "severity":  "low" | "medium" | "high",
         "snippet":   "<the offending text, max 80 chars>",
         "suggestion":"<corrected text, max 80 chars, or null>",
         "context":   "<what's around it, max 80 chars, for the bug description>"
       }
     ]
     If nothing is wrong, return [].`
   )
   ```

3. Receive the JSON array back. For each finding, convert into the standard issue schema:

   ```js
   {
     skill: "qa-review-content",
     issueType: <finding.issueType>,
     severity: <finding.severity>,
     selector: null,
     description: `${finding.context} → "${finding.snippet}"` +
                  (finding.suggestion ? ` (suggestion: "${finding.suggestion}")` : ''),
     bbox: null
   }
   ```

4. Append to issues. Apply the standard screenshot step from qa-argus (cell-level capture is sufficient; per-finding annotation is not meaningful for content issues — they don't have bboxes).

## Probe (browser_evaluate)

The only probe needed is the one that extracts visible text:

```js
// probe.extractVisibleText
() => {
  // Walk the DOM and collect visible text, skipping decorative / non-content regions
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'IFRAME']);
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (SKIP_TAGS.has(node.tagName)) return;
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return;
      const style = node.nodeType === 1 ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2) out.push(t);
      return;
    }
    for (const c of (node.childNodes || [])) walk(c);
  };
  walk(document.body);

  let combined = out.join(' ').replace(/\s+/g, ' ').trim();

  // Cap at 5000 chars: keep the first 2500 + last 2500
  if (combined.length > 5000) {
    combined = combined.slice(0, 2500) + ' … ' + combined.slice(combined.length - 2500);
  }
  return {
    text: combined,
    charCount: combined.length,
    pageTitle: document.title || ''
  };
}
```

## Cost control

For larger audits, scope this skill via `customize.toml`:

```toml
[grammar]
# Only run content review on these routes (others get probe-based skills only)
critical_routes = ["/", "/login", "/signup", "/checkout", "/dashboard"]
# Hard cap on cells reviewed per audit
max_cells = 10
```

If both keys are absent, the skill runs on every cell — typically ~9 cells = ~$0.12 per audit.

If `critical_routes` is set, only cells matching those routes are reviewed. If `max_cells` is set, the skill stops after that many cells (extra cells get no findings emitted but are silently skipped, not flagged as broken).

## Issue schema mapping

The Sonnet sub-agent returns `{issueType, severity, snippet, suggestion, context}`. The orchestrator maps each to the standard issue record:

| Sub-agent field | Issue record field |
|-----------------|-------------------|
| `issueType` | `issueType` |
| `severity` | `severity` |
| `snippet` + `context` + `suggestion` | combined into `description` |
| `null` | `selector` (content findings have no element selector) |
| `null` | `bbox` (no element box) |

## Cell-skipping rules

- **Self-skip** if `probe.extractVisibleText` returns `charCount < 50` — the page has almost no visible text (likely a redirect, loader, or blank state).
- **Self-skip** if the route matches `customize.toml → grammar.critical_routes` and the current cell's route is NOT in that list.
- **Hard cap** after `customize.toml → grammar.max_cells` is reached for this run.

## Notes

- This skill does NOT require any new dependencies, library, or external API.
- It does NOT modify the page, never types, never clicks, never navigates.
- Findings without selectors are still useful — the `snippet` field identifies the offending text in the bug report.
- The Sonnet sub-agent is given strict instructions to NOT flag brand/product names. Add domain-specific terms to a future `customize.toml → grammar.allow_terms` list if false positives become noisy.
