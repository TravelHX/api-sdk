/**
 * Minimal, zero-dependency terminal UI toolkit.
 *
 * Uses only Node built-ins: raw-mode stdin for key handling and ANSI escape
 * codes on the alternate screen buffer. Renders full-screen, k9s-style views
 * (a scrollable list with a live detail pane, and a scrollable pager) inside
 * the terminal that launched the program — no separate window, no packages.
 */

// --- ANSI helpers -----------------------------------------------------------

const CSI = '\x1b[';
const ALT_ON = `${CSI}?1049h${CSI}?25l`; // alt screen + hide cursor
const ALT_OFF = `${CSI}?25h${CSI}?1049l`; // show cursor + main screen

const bold = (s) => `${CSI}1m${s}${CSI}22m`;
const dim = (s) => `${CSI}2m${s}${CSI}22m`;
const invert = (s) => `${CSI}7m${s}${CSI}27m`;
const cyan = (s) => `${CSI}36m${s}${CSI}39m`;

function size() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

// Matches only the SGR ("m"-terminated) escape codes this file's ANSI
// helpers (bold/dim/invert/cyan) ever produce. Other CSI sequences (cursor
// moves, clear-to-EOL, alt-screen toggles) are written directly by
// frame()/clear()/ALT_ON/ALT_OFF and never flow through truncate()/pad().
const SGR_RE = /\x1b\[[0-9;]*m/g;

/**
 * Split a string into an ordered list of tokens: each SGR escape sequence is
 * one atomic 'ansi' token (zero visible width, never split), and every other
 * character is its own 'char' token — iterated by Unicode codepoint (not
 * UTF-16 code unit), so multi-byte/surrogate-pair characters count as one.
 */
function tokenize(str) {
  const tokens = [];
  let lastIndex = 0;
  SGR_RE.lastIndex = 0;
  let m;
  while ((m = SGR_RE.exec(str))) {
    if (m.index > lastIndex) {
      for (const ch of str.slice(lastIndex, m.index)) tokens.push({ type: 'char', text: ch });
    }
    tokens.push({ type: 'ansi', text: m[0] });
    lastIndex = SGR_RE.lastIndex;
  }
  if (lastIndex < str.length) {
    for (const ch of str.slice(lastIndex)) tokens.push({ type: 'char', text: ch });
  }
  return tokens;
}

/** Visible-character count, ignoring any embedded SGR escape sequences. */
function visibleLength(str) {
  let n = 0;
  for (const t of tokenize(str)) if (t.type === 'char') n++;
  return n;
}

/**
 * Truncate to `width` VISIBLE characters, never slicing into the middle of
 * an SGR escape sequence (a raw string.slice() on an already-colored string,
 * as this used to do, can cut an escape code in half and leave an
 * unterminated invert/bold/etc. bleeding into the rest of the frame).
 */
function truncate(str, width) {
  const s = String(str ?? '');
  if (width <= 0) return '';
  const tokens = tokenize(s);
  const visLen = tokens.reduce((n, t) => n + (t.type === 'char' ? 1 : 0), 0);
  if (visLen <= width) return s;

  let out = '';
  let count = 0;
  for (const t of tokens) {
    if (t.type === 'ansi') {
      out += t.text;
      continue;
    }
    if (count >= width - 1) break;
    out += t.text;
    count++;
  }
  // Always reset SGR state when truncating — if the cut point landed between
  // an escape sequence's "on" and its "off" (e.g. an invert(' ') marker
  // whose closing code fell past the cutoff), this guarantees nothing bleeds
  // into the rest of the frame. A redundant reset when nothing was open is
  // harmless.
  return `${out}…${CSI}0m`;
}

function pad(str, width) {
  const s = truncate(str, width);
  return s + ' '.repeat(Math.max(0, width - visibleLength(s)));
}

// --- input ------------------------------------------------------------------

let activeHandler = null;
let started = false;
// When true, onData bypasses decodeKey's vi-style letter remapping (j/k/g/q
// etc. would otherwise be swallowed as navigation) and hands the raw chunk
// straight to activeHandler. Only runInput() sets this.
let rawInputMode = false;

function decodeKey(seq) {
  switch (seq) {
    case '\x1b[A':
    case '\x1bOA':
      return 'up';
    case '\x1b[B':
    case '\x1bOB':
      return 'down';
    case '\x1b[C':
    case '\x1bOC':
      return 'right';
    case '\x1b[D':
    case '\x1bOD':
      return 'left';
    case '\x1b[5~':
      return 'pageup';
    case '\x1b[6~':
      return 'pagedown';
    case '\x1b[H':
    case '\x1b[1~':
      return 'home';
    case '\x1b[F':
    case '\x1b[4~':
      return 'end';
    case '\r':
    case '\n':
      return 'enter';
    case '\x7f':
    case '\b':
      return 'backspace';
    case '\x1b':
      return 'escape';
    case '\x03':
      return 'ctrl-c';
    case 'k':
      return 'up';
    case 'j':
      return 'down';
    case 'g':
      return 'home';
    case 'G':
      return 'end';
    case 'q':
    case 'Q':
      return 'q';
    default:
      return seq;
  }
}

function onData(chunk) {
  if (chunk.includes('\x03')) {
    // Ctrl-C always aborts, in raw-input mode or not. Scan for the byte
    // rather than requiring the WHOLE chunk to be exactly \x03 — a chunk
    // can legitimately bundle it with other bytes (fast typing, a paste, a
    // terminal that coalesces keystrokes), and a bare equality check misses
    // Ctrl-C entirely in that case (it would just fall through and get
    // silently stripped later as a stray C0 control, with no shutdown at
    // all). process.exit() here can't unwind to main()'s try/finally (we're
    // inside a stdin 'data' listener, not on that awaited call stack) —
    // nothing else will ever send ALT_OFF, so without this the terminal is
    // left on the alt-screen buffer with the cursor hidden and the user has
    // to run `reset`.
    process.stdout.write(ALT_OFF);
    stop();
    process.exit(130); // conventional 128+SIGINT exit code
    return;
  }
  if (!activeHandler) return;
  try {
    if (rawInputMode) {
      activeHandler(chunk);
    } else {
      activeHandler(decodeKey(chunk));
    }
  } catch (ex) {
    // Defensive: if a handler throws mid-flight, never leave rawInputMode
    // stuck true. Rethrowing here would NOT be caught by main()'s
    // try/finally, for the same reason as Ctrl-C above — restore the
    // terminal ourselves before going down.
    rawInputMode = false;
    activeHandler = null;
    process.stdout.write(ALT_OFF);
    stop();
    console.error(`FATAL ERROR (input handler): ${ex.message}`);
    console.error(ex.stack);
    process.exit(1);
  }
}

export function start() {
  if (started) return;
  started = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
}

export function stop() {
  if (!started) return;
  started = false;
  process.stdin.off('data', onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

export function enterFullscreen() {
  process.stdout.write(ALT_ON);
}

export function exitFullscreen() {
  process.stdout.write(ALT_OFF);
}

function clear() {
  process.stdout.write(`${CSI}2J${CSI}H`);
}

function frame(lines) {
  // Home cursor, draw each line clearing to EOL, then clear below.
  process.stdout.write(`${CSI}H${lines.map((l) => `${l}${CSI}K`).join('\n')}${CSI}0J`);
}

// --- views ------------------------------------------------------------------

/**
 * Full-screen scrollable list with a live detail pane.
 * @returns Promise<number> selected index, or -1 if the user backed out.
 */
export function runList({ title, items, renderItem, renderDetail, footer }) {
  let index = 0;
  let top = 0;
  // Vertical scroll offset into the detail pane's rendered lines. A voyage's
  // itinerary can render to hundreds of lines, far more than fit in viewH —
  // PageUp/PageDown scroll this independently of list navigation. Always
  // reset to 0 when the selected item changes, so switching items starts the
  // detail view back at the top rather than carrying over a stale offset
  // that might not even apply to the new item's (possibly much shorter)
  // content.
  let detailScroll = 0;
  const { cols, rows } = size();
  const listWidth = Math.max(16, Math.min(50, Math.floor(cols * 0.45)));
  const detailWidth = Math.max(0, cols - listWidth - 3);
  const viewH = Math.max(1, rows - 4);
  const hint = footer || 'arrows/jk move · pgup/pgdn scroll detail · enter open · q/esc back';

  return new Promise((resolve) => {
    const draw = () => {
      if (index < top) top = index;
      if (index >= top + viewH) top = index - viewH + 1;

      const detail = renderDetail ? renderDetail(items[index], detailWidth) : [];
      const maxDetailScroll = Math.max(0, detail.length - viewH);
      detailScroll = Math.min(Math.max(0, detailScroll), maxDetailScroll);
      const hasMoreBelow = detailScroll + viewH < detail.length;

      const out = [];
      out.push(cyan(bold(pad(` ${title}`, cols))));
      out.push('─'.repeat(cols));
      for (let r = 0; r < viewH; r++) {
        const i = top + r;
        let left;
        if (i < items.length) {
          const label = renderItem ? renderItem(items[i], i) : String(items[i]);
          const marker = i === index ? '▶ ' : '  ';
          left = pad(marker + label, listWidth);
          if (i === index) left = invert(left);
        } else {
          left = ' '.repeat(listWidth);
        }
        const detailLine = detail[detailScroll + r] ?? '';
        let right;
        if (r === viewH - 1 && hasMoreBelow) {
          const suffix = ' ↓ more';
          const budget = Math.max(0, detailWidth - suffix.length);
          right = pad(truncate(detailLine, budget) + dim(suffix), detailWidth);
        } else {
          right = pad(detailLine, detailWidth);
        }
        out.push(`${left} ${dim('│')} ${right}`);
      }
      out.push('─'.repeat(cols));
      out.push(dim(pad(` ${hint}   [${items.length ? index + 1 : 0}/${items.length}]`, cols)));
      frame(out);
    };

    const onKey = (key) => {
      switch (key) {
        case 'up':
          index = Math.max(0, index - 1);
          detailScroll = 0;
          break;
        case 'down':
          index = Math.min(items.length - 1, index + 1);
          detailScroll = 0;
          break;
        case 'pageup':
          detailScroll = Math.max(0, detailScroll - viewH);
          break;
        case 'pagedown':
          detailScroll = detailScroll + viewH; // clamped against actual content length in draw()
          break;
        case 'home':
          index = 0;
          detailScroll = 0;
          break;
        case 'end':
          index = items.length - 1;
          detailScroll = 0;
          break;
        case 'enter':
        case 'right':
          rawInputMode = false;
          activeHandler = null;
          return resolve(items.length ? index : -1);
        case 'q':
        case 'escape':
        case 'backspace':
        case 'left':
          rawInputMode = false;
          activeHandler = null;
          return resolve(-1);
        default:
          return;
      }
      draw();
    };

    clear();
    // Always false while this view holds activeHandler — decoded nav keys,
    // never raw chunks. Resetting it here (not just on resolve) is what
    // actually unblocks the TUI if a PRIOR runInput() ever failed to
    // resolve (its finish() is the only other place this gets reset):
    // without this, onData would keep routing raw chunks into whatever
    // onKey happens to be active, and this view would never respond to a
    // normal keypress again.
    rawInputMode = false;
    activeHandler = onKey;
    draw();
  });
}

// Introducer bytes (the character right after ESC) recognized as starting a
// multi-byte escape/control sequence, split by how each shape terminates:
//  - CONTROL_SEQUENCE_INTRODUCERS (CSI '[', SS2 'N', SS3 'O'): ECMA-48
//    "control sequence" shape — parameter/intermediate bytes in 0x20-0x3F,
//    ended by a single final byte in 0x40-0x7E. Covers arrow keys, Home/End,
//    PgUp/PgDn, Delete, F-keys — whatever concrete bytes the terminal sends.
//  - STRING_SEQUENCE_INTRODUCERS (DCS 'P', OSC ']', PM '^', APC '_'):
//    ECMA-48 "string" shape — an arbitrary run of bytes ended by ST (String
//    Terminator: ESC \, or the single byte BEL \x07 as the widely-supported
//    xterm convention for OSC specifically). Reachable via terminal-emitted
//    OSC replies (some terminals echo query responses) or pasted content
//    that happens to contain one — without recognizing these too, their
//    payload would leak into the buffer as literal text.
const CONTROL_SEQUENCE_INTRODUCERS = new Set(['[', 'N', 'O']);
const STRING_SEQUENCE_INTRODUCERS = new Set(['P', ']', '^', '_']);

/**
 * Scans `chars` (a codepoint array — see Array.from(str)) starting at the
 * ESC byte `chars[start]` for a recognized escape/control sequence. Returns
 * one of:
 *  - { status: 'complete', length } — a full, valid sequence; the caller
 *    consumes `length` chars from `start` and discards them (never
 *    appended as text, never treated as cancel).
 *  - { status: 'invalid', length } — malformed (hit a byte that can't be
 *    part of this sequence type); consume `length` chars UP TO but
 *    EXCLUDING the offending byte, so the caller re-processes that byte
 *    normally on the next iteration instead of it being silently swallowed.
 *  - { status: 'incomplete' } — ran out of `chars` before finding a
 *    terminator, or the introducer byte hasn't even arrived yet. The
 *    sequence may simply be split across two separate stdin `data` events
 *    (common under load, over SSH, or from certain terminal emulators) —
 *    the caller must hold everything from `start` onward as pending input
 *    and wait briefly for more bytes rather than guessing.
 *  - { status: 'not-a-sequence' } — `chars[start + 1]` is a real, already
 *    -arrived byte that isn't a recognized introducer (e.g. an Alt-key
 *    combo, which sends ESC then the raw character) — only the lone ESC
 *    byte itself is implicated, not what follows it.
 */
function scanEscapeSequence(chars, start) {
  const next = chars[start + 1];
  if (next === undefined) return { status: 'incomplete' };

  if (CONTROL_SEQUENCE_INTRODUCERS.has(next)) {
    let i = start + 2;
    while (i < chars.length) {
      const code = chars[i].codePointAt(0);
      if (code < 0x20 || code > 0x7e) return { status: 'invalid', length: i - start };
      if (code >= 0x40 && code <= 0x7e) return { status: 'complete', length: i - start + 1 };
      i++;
    }
    return { status: 'incomplete' };
  }

  if (STRING_SEQUENCE_INTRODUCERS.has(next)) {
    let i = start + 2;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === '\x07') return { status: 'complete', length: i - start + 1 }; // BEL (OSC convention)
      if (ch === '\x1b') {
        if (chars[i + 1] === '\\') return { status: 'complete', length: i - start + 2 }; // ST = ESC \
        if (chars[i + 1] === undefined) return { status: 'incomplete' }; // ST itself might be split
        return { status: 'invalid', length: i - start }; // unexpected nested ESC inside the string
      }
      i++;
    }
    return { status: 'incomplete' };
  }

  return { status: 'not-a-sequence' };
}

/**
 * Compose the visible input line for runInput()'s draw(): `prefix` (e.g. "
 * label: ") followed by `buffer` and a trailing invert(' ') cursor marker.
 *
 * Unlike static/read-only text elsewhere (which goes through pad()/
 * truncate()'s head-first ellipsis), this field's "cursor" is always fixed
 * at the END of `buffer` — truncating the head and keeping the tail (as
 * pad() does) would push the cursor and every recent keystroke off-screen
 * the moment the line overflows, making further typing/backspacing
 * invisible. So when it doesn't fit, this instead keeps `prefix` + an
 * ellipsis + the TAIL of `buffer` (whatever fits) + the cursor — the
 * opposite truncation direction, deliberately, for this one field only.
 */
function inputLine(prefix, buffer, cols) {
  const cursorWidth = 1; // invert(' ')'s visible width
  const prefixLen = visibleLength(prefix);
  const bufChars = Array.from(buffer); // codepoint array
  if (prefixLen + bufChars.length + cursorWidth <= cols) {
    return `${prefix}${buffer}${invert(' ')}`;
  }
  const budget = Math.max(0, cols - prefixLen - 1 /* ellipsis */ - cursorWidth);
  const tail = bufChars.slice(Math.max(0, bufChars.length - budget)).join('');
  return `${prefix}…${tail}${invert(' ')}`;
}

/**
 * Full-screen single-line free-text prompt. Unlike runList/runPager, this
 * reads raw keystrokes (rawInputMode) rather than decoded nav keys, so typed
 * letters (including j/k/g/q, which decodeKey remaps to navigation elsewhere)
 * are taken literally.
 * @returns Promise<string|null> the entered text, or null if the user backed out (esc).
 */
export function runInput({ title, label = '', initial = '', info = [], footer }) {
  let buffer = initial;
  const { cols } = size();
  const hint = footer || 'enter confirm · esc cancel';

  // Cross-chunk escape-sequence state: bytes collected since an
  // as-yet-unresolved ESC (including the ESC itself), plus the timer that
  // disambiguates "this really is just a lone Escape keypress" from "a
  // sequence — or an Alt-key combo — that's still arriving" (see
  // scanEscapeSequence's 'incomplete' status). One escape sequence CAN
  // legitimately arrive split across two separate stdin `data` events
  // (under load, over SSH, from certain terminal emulators), so a chunk
  // ending mid-sequence must wait briefly rather than being judged on the
  // spot.
  let pending = [];
  let escapeTimer = null;
  const ESCAPE_TIMEOUT_MS = 50; // similar order of magnitude to common terminal/editor escape-time defaults

  return new Promise((resolve) => {
    const finish = (value) => {
      if (escapeTimer) {
        clearTimeout(escapeTimer);
        escapeTimer = null;
      }
      rawInputMode = false;
      activeHandler = null;
      resolve(value);
    };

    const draw = () => {
      const out = [];
      out.push(cyan(bold(pad(` ${title}`, cols))));
      out.push('─'.repeat(cols));
      // Static context lines (e.g. what failed, what was tried) — NOT part of
      // the editable buffer. Kept separate because this input has no cursor
      // movement (append/backspace only from the end), so anything the user
      // needs to edit belongs in `buffer`, not folded into a pre-filled value
      // they'd have to backspace all the way through.
      for (const line of info) out.push(pad(` ${line}`, cols));
      if (info.length) out.push('');
      out.push(pad(inputLine(` ${label}`, buffer, cols), cols));
      out.push('');
      out.push('─'.repeat(cols));
      out.push(dim(pad(` ${hint}`, cols)));
      frame(out);
    };

    // Fires when a pending, not-yet-resolved ESC has gone quiet for
    // ESCAPE_TIMEOUT_MS with nothing more arriving to complete it.
    const settleTimedOutEscape = () => {
      escapeTimer = null;
      const wasLoneEscape = pending.length === 1; // nothing ever followed the bare ESC
      pending = [];
      if (wasLoneEscape) {
        finish(null);
      } else {
        // An introducer arrived (CSI/SS3/OSC/etc.) but the sequence never
        // completed in time — drop it silently rather than leaking its
        // bytes into the buffer, and keep the prompt open.
        draw();
      }
    };

    const armEscapeTimer = () => {
      escapeTimer = setTimeout(settleTimedOutEscape, ESCAPE_TIMEOUT_MS);
      // Node timers keep the event loop alive by default; this prompt's
      // liveness already depends on stdin being resumed regardless, so
      // don't let this specific short timer be the thing holding the
      // process open if everything else has already wound down.
      if (typeof escapeTimer.unref === 'function') escapeTimer.unref();
    };

    // Iterated character-by-character (by Unicode codepoint, via
    // Array.from(), so multi-byte/surrogate-pair characters count as one —
    // both for classification here and for backspace below, which must trim
    // one CODEPOINT, not one UTF-16 code unit, or backspacing over an emoji
    // etc. leaves an orphan surrogate in the buffer) rather than per-chunk.
    // A pasted/injected chunk can bundle multiple keystrokes — including an
    // embedded \n or an escape sequence — into one onData delivery; every
    // character is individually classified: Enter/Backspace act
    // immediately; escape/control sequences (arrow keys, Home/End,
    // PgUp/PgDn, Delete, F-keys, and OSC/DCS/PM/APC string sequences — see
    // scanEscapeSequence) are recognized and consumed as one atomic unit and
    // silently ignored — NOT appended as text, NOT treated as cancel,
    // UNLESS the ESC turns out to be a genuine standalone keypress (only
    // decided once a sequence is still incomplete after the timeout above).
    // Every other C0/C1 control byte is dropped; only genuinely printable
    // characters are appended to the buffer.
    const onRaw = (chunk) => {
      let chars = Array.from(chunk);
      if (pending.length > 0) {
        if (escapeTimer) {
          clearTimeout(escapeTimer);
          escapeTimer = null;
        }
        chars = pending.concat(chars);
        pending = [];
      }

      let i = 0;
      while (i < chars.length) {
        const ch = chars[i];
        if (ch === '\r' || ch === '\n') return finish(buffer);
        if (ch === '\x1b') {
          const result = scanEscapeSequence(chars, i);
          if (result.status === 'incomplete') {
            // Hold everything from the ESC onward and wait — see the
            // ESCAPE_TIMEOUT_MS comment above.
            pending = chars.slice(i);
            armEscapeTimer();
            return draw();
          }
          if (result.status === 'not-a-sequence') {
            // ESC followed by something real that isn't a recognized
            // introducer — e.g. an Alt-key combo (ESC then the raw
            // character). Drop just the ESC; the next char is classified
            // normally on the following iteration.
            i++;
            continue;
          }
          // 'complete' or 'invalid': consumed, discarded, never appended,
          // never treated as cancel.
          i += result.length;
          continue;
        }
        if (ch === '\x7f' || ch === '\b') {
          buffer = Array.from(buffer).slice(0, -1).join('');
          i++;
          continue;
        }
        const code = ch.codePointAt(0);
        if (code === undefined || code < 0x20 || (code >= 0x80 && code <= 0x9f)) {
          // Any other C0 (0x00-0x1F) control byte, or a C1 (U+0080-U+009F)
          // control byte, is stripped rather than stored verbatim. NOTE:
          // C1 codes are single-byte introducers for the SAME sequence
          // types as the 7-bit ESC-prefixed ones (e.g. U+009B is the C1
          // form of CSI) — this only drops the single introducer byte, it
          // does NOT parse/consume whatever parameter/terminator bytes
          // might follow it the way scanEscapeSequence() does for
          // ESC-prefixed sequences. In practice this path isn't expected to
          // fire: terminals overwhelmingly send 7-bit ESC-prefixed
          // sequences, and stdin here is UTF-8 decoded, so a genuine C1
          // codepoint would only appear from an unusual/legacy 8-bit
          // terminal or injected content. Treat this as a known,
          // deliberately out-of-scope gap, not a claim that C1 sequences
          // are fully handled.
          i++;
          continue;
        }
        buffer += ch;
        i++;
      }
      draw();
    };

    clear();
    rawInputMode = true;
    activeHandler = onRaw;
    draw();
  });
}

/**
 * Full-screen scrollable text pager.
 *
 * `lines` is normally a static array, but may instead be a `() => string[]`
 * — re-invoked on every draw — for content that can change while the pager
 * is open (e.g. a live value resolving in the background). Pair it with
 * `subscribe`: a `(redraw) => unsubscribe` hook, called once on mount with a
 * function that re-reads `lines` and re-renders; its returned unsubscribe is
 * called automatically when the pager closes, so callers never have to
 * remember to detach the listener themselves.
 *
 * @returns Promise<void> resolves when the user backs out.
 */
export function runPager({ title, lines, footer, subscribe }) {
  let topLine = 0;
  const { cols, rows } = size();
  const viewH = Math.max(1, rows - 4);
  const hint = footer || 'arrows/jk scroll · q/esc back';
  const getLines = () => (typeof lines === 'function' ? lines() : lines);

  return new Promise((resolve) => {
    let unsubscribe = null;

    const draw = () => {
      const currentLines = getLines();
      const maxTop = Math.max(0, currentLines.length - viewH);
      topLine = Math.min(topLine, maxTop);

      const out = [];
      out.push(cyan(bold(pad(` ${title}`, cols))));
      out.push('─'.repeat(cols));
      for (let r = 0; r < viewH; r++) {
        out.push(pad(currentLines[topLine + r] ?? '', cols));
      }
      out.push('─'.repeat(cols));
      const pos = currentLines.length > viewH ? `   [${topLine + 1}-${Math.min(topLine + viewH, currentLines.length)}/${currentLines.length}]` : '';
      out.push(dim(pad(` ${hint}${pos}`, cols)));
      frame(out);
    };

    const finish = () => {
      rawInputMode = false;
      activeHandler = null;
      if (unsubscribe) unsubscribe();
      resolve();
    };

    const onKey = (key) => {
      const maxTop = Math.max(0, getLines().length - viewH);
      switch (key) {
        case 'up':
          topLine = Math.max(0, topLine - 1);
          break;
        case 'down':
          topLine = Math.min(maxTop, topLine + 1);
          break;
        case 'pageup':
          topLine = Math.max(0, topLine - viewH);
          break;
        case 'pagedown':
          topLine = Math.min(maxTop, topLine + viewH);
          break;
        case 'home':
          topLine = 0;
          break;
        case 'end':
          topLine = maxTop;
          break;
        case 'q':
        case 'escape':
        case 'backspace':
        case 'enter':
        case 'left':
          return finish();
        default:
          return;
      }
      draw();
    };

    clear();
    // See runList's identical reset for why this matters even though this
    // view never sets rawInputMode itself: it must still clear it in case a
    // PRIOR runInput() left it stuck true.
    rawInputMode = false;
    activeHandler = onKey;
    draw();
    if (subscribe) unsubscribe = subscribe(draw);
  });
}

/** Render static lines (e.g. a loading screen) without waiting for input. */
export function render(title, lines) {
  const { cols } = size();
  clear();
  frame([cyan(bold(pad(` ${title}`, cols))), '─'.repeat(cols), ...lines.map((l) => pad(l, cols))]);
}

/** Wait for any key press. */
export function waitKey() {
  return new Promise((resolve) => {
    // See runList's identical reset for why this matters — clears any
    // rawInputMode left stuck true by a prior runInput() that never
    // resolved, or this (and every runList/runPager call after it) would
    // stay permanently unresponsive to normal keypresses.
    rawInputMode = false;
    activeHandler = () => {
      rawInputMode = false;
      activeHandler = null;
      resolve();
    };
  });
}
