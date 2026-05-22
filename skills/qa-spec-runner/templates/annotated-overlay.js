/**
 * annotated-overlay.js
 * Injected into page context via page.evaluate() after detection.
 * Draws a red banner + red outlines around culprit elements.
 * Called as: injectAuditOverlay(findings, vpName)
 * Remove after each annotated screenshot so subsequent screenshots are clean.
 */
function injectAuditOverlay(findings, vpName) {
  const existing = document.getElementById('__audit_overlay__');
  if (existing) existing.remove();

  const layer = document.createElement('div');
  layer.id = '__audit_overlay__';
  layer.style.cssText = [
    'position:fixed', 'inset:0', 'pointer-events:none',
    'z-index:2147483647', 'font-family:system-ui,sans-serif',
  ].join(';') + ';';

  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'right:0',
    'background:#dc2626', 'color:#fff',
    'padding:8px 12px', 'font-size:13px',
    'font-weight:600', 'line-height:1.4',
    'border-bottom:2px solid #991b1b',
  ].join(';') + ';';
  banner.textContent = '⚠ ' + findings.length + ' issue' + (findings.length > 1 ? 's' : '') +
    ' on ' + vpName + ': ' + findings.map(function(f) { return f.type + ' (' + f.severity + ')'; }).join('  ·  ');
  layer.appendChild(banner);

  findings.forEach(function(f, idx) {
    const isValidSelector = f.selector && !f.selector.startsWith('(');
    let el = null;
    if (isValidSelector) {
      try { el = document.querySelector(f.selector); } catch (_) { el = null; }
    }
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const box = document.createElement('div');
        box.style.cssText = [
          'position:absolute',
          'left:' + r.left + 'px', 'top:' + r.top + 'px',
          'width:' + r.width + 'px', 'height:' + r.height + 'px',
          'outline:3px solid #dc2626', 'outline-offset:2px',
          'background:rgba(220,38,38,0.08)',
        ].join(';') + ';';
        layer.appendChild(box);
      }
    }
    const labelTop = el ? Math.max(el.getBoundingClientRect().top - 24, 44) : 44 + idx * 22;
    const labelLeft = el ? el.getBoundingClientRect().left : 12;
    const tag = document.createElement('div');
    tag.style.cssText = [
      'position:absolute',
      'left:' + labelLeft + 'px', 'top:' + labelTop + 'px',
      'background:#dc2626', 'color:#fff',
      'padding:2px 8px', 'font-size:11px', 'font-weight:600',
      'border-radius:3px', 'white-space:nowrap',
      'max-width:90vw', 'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';') + ';';
    tag.textContent = (idx + 1) + '. ' + f.type + ': ' + f.description.slice(0, 120);
    layer.appendChild(tag);
  });

  document.body.appendChild(layer);
}
