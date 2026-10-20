import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { highlightJson } from './json.js';

const LINE_HEIGHT = 20;
const PAD = 12;
const INDENT = '  ';
const HIGHLIGHT_LIMIT = 200_000; // characters; above this, skip live highlighting to keep typing smooth
const PAIRS = { '{': '}', '[': ']', '"': '"' };

/**
 * Locates the first JSON syntax error with a readable message and 1-based line/column.
 * Returns null when the text is valid JSON. (JSON.parse messages don't always carry a position.)
 */
export function locateJsonError(text) {
  let i = 0;
  const n = text.length;
  const fail = (message) => {
    throw { pos: Math.min(i, n), message };
  };
  const ws = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  const describe = () => (i >= n ? 'Unexpected end of JSON' : `Unexpected character '${text[i]}'`);

  const str = () => {
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('Invalid \\u escape: expected 4 hex digits');
          i += 6;
        } else if (esc !== undefined && '"\\/bfnrt'.includes(esc)) {
          i += 2;
        } else {
          i++;
          fail(esc === undefined ? 'Unterminated string' : `Invalid escape '\\${esc}' in string`);
        }
        continue;
      }
      if (c === '\n') fail('Unterminated string');
      if (c < ' ') fail('Control characters must be escaped in strings');
      i++;
    }
    fail('Unterminated string');
  };
  const num = () => {
    const m = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    m.lastIndex = i;
    const r = m.exec(text);
    if (!r || !r[0] || r[0] === '-') fail('Invalid number');
    i += r[0].length;
  };
  const lit = (word) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail(describe());
  };
  const container = (close, readItem) => {
    i++;
    ws();
    if (text[i] === close) {
      i++;
      return;
    }
    for (;;) {
      ws();
      readItem();
      ws();
      if (text[i] === ',') {
        i++;
        ws();
        if (text[i] === close) fail('Trailing comma is not allowed in JSON');
        continue;
      }
      if (text[i] === close) {
        i++;
        return;
      }
      fail(i >= n ? 'Unexpected end of JSON' : `Expected ',' or '${close}'`);
    }
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{')
      container('}', () => {
        if (text[i] !== '"') fail('Expected a double-quoted property name');
        str();
        ws();
        if (text[i] !== ':') fail("Expected ':' after property name");
        i++;
        value();
      });
    else if (c === '[') container(']', value);
    else if (c === '"') str();
    else if (c === 't') lit('true');
    else if (c === 'f') lit('false');
    else if (c === 'n') lit('null');
    else if (c === '-' || (c >= '0' && c <= '9')) num();
    else fail(describe());
  };

  try {
    value();
    ws();
    if (i < n) fail('Unexpected content after the JSON value');
    return null;
  } catch (e) {
    if (!('pos' in e)) throw e;
    const before = text.slice(0, e.pos);
    const line = before.split('\n').length;
    const col = e.pos - before.lastIndexOf('\n');
    return { line, col, message: e.message };
  }
}

/** Inserts text at the selection, keeping the browser's undo history (Cmd/Ctrl+Z) intact. */
function insertText(ta, text, caretOffset = text.length) {
  const start = ta.selectionStart;
  ta.focus();
  if (!document.execCommand?.('insertText', false, text)) {
    ta.setRangeText(text, start, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(start + caretOffset, start + caretOffset);
}

export default function JsonEditor({ value, onChange, errorLine, ariaLabel = 'JSON data', minRows = 14, maxRows = 26 }) {
  const taRef = useRef(null);
  const hlRef = useRef(null);
  const gutterRef = useRef(null);
  const escaped = useRef(false); // after Esc, Tab moves focus instead of indenting (keyboard users can leave)

  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const rows = Math.min(Math.max(lineCount, minRows), maxRows);
  const html = useMemo(() => (value.length > HIGHLIGHT_LIMIT ? null : highlightJson(value) + '\n'), [value]);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (hlRef.current) {
      hlRef.current.scrollTop = ta.scrollTop;
      hlRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  useLayoutEffect(syncScroll, [value]);

  const onKeyDown = (e) => {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = ta;
    const prev = value[s - 1];
    const next = value[s];

    if (e.key === 'Escape') {
      escaped.current = true;
      return;
    }
    if (e.key === 'Tab' && !escaped.current && !e.shiftKey) {
      e.preventDefault();
      insertText(ta, INDENT);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Type-over: typing a closer that is already the next character just moves past it
    if ((e.key === '}' || e.key === ']' || (e.key === '"' && prev !== '\\')) && next === e.key && s === end) {
      e.preventDefault();
      ta.setSelectionRange(s + 1, s + 1);
      return;
    }

    // Auto-close { [ " (wraps the selection if there is one)
    if (PAIRS[e.key]) {
      if (e.key === '"' && (prev === '\\' || /\w/.test(prev ?? ''))) return;
      e.preventDefault();
      const selected = value.slice(s, end);
      insertText(ta, e.key + selected + PAIRS[e.key], 1 + selected.length);
      return;
    }

    // Backspace between an empty pair removes both characters
    if (e.key === 'Backspace' && s === end && prev && PAIRS[prev] === next) {
      e.preventDefault();
      ta.setSelectionRange(s - 1, s + 1);
      insertText(ta, '', 0);
      return;
    }

    // Enter keeps the indentation; between {} or [] it opens an indented block
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))[0];
      if ((prev === '{' && next === '}') || (prev === '[' && next === ']')) {
        insertText(ta, `\n${indent}${INDENT}\n${indent}`, 1 + indent.length + INDENT.length);
      } else if (prev === '{' || prev === '[') {
        insertText(ta, `\n${indent}${INDENT}`);
      } else {
        insertText(ta, `\n${indent}`);
      }
    }
  };

  const height = rows * LINE_HEIGHT + PAD * 2;

  return (
    <div className={`editor${errorLine ? ' invalid' : ''}`} style={{ height }}>
      <div className="gutter" aria-hidden="true">
        <div ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={errorLine === i + 1 ? 'err' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="editor-area">
        {html !== null && (
          <pre ref={hlRef} className="editor-hl code" aria-hidden="true">
            {errorLine && <span className="err-line" style={{ top: PAD + (errorLine - 1) * LINE_HEIGHT }} />}
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        )}
        <textarea
          ref={taRef}
          className={html !== null ? 'overlay' : undefined}
          value={value}
          onChange={(e) => {
            escaped.current = false;
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          onFocus={() => (escaped.current = false)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={ariaLabel}
          aria-invalid={!!errorLine}
        />
      </div>
    </div>
  );
}
