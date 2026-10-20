// Shared helpers for showing JSON and recognising tokens.

const TOKEN_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_[0-9A-F]{7}$/;
export const isToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightJson(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return escapeHtml(json ?? '').replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, bool, num) => {
      if (str) {
        if (colon) return `<span class="k">${str}</span>${colon}`;
        return `<span class="${isToken(str.slice(1, -1)) ? 't' : 's'}">${str}</span>`;
      }
      if (bool) return `<span class="b">${bool}</span>`;
      return `<span class="n">${num}</span>`;
    }
  );
}
