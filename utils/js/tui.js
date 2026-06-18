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

function truncate(str, width) {
  const s = String(str ?? '');
  if (width <= 0) return '';
  return s.length > width ? `${s.slice(0, width - 1)}…` : s;
}

function pad(str, width) {
  const s = truncate(str, width);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

// --- input ------------------------------------------------------------------

let activeHandler = null;
let started = false;

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
  const key = decodeKey(chunk);
  if (key === 'ctrl-c') {
    stop();
    process.exit(130);
    return;
  }
  if (activeHandler) activeHandler(key);
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
  const { cols, rows } = size();
  const listWidth = Math.max(16, Math.min(50, Math.floor(cols * 0.45)));
  const detailWidth = Math.max(0, cols - listWidth - 3);
  const viewH = Math.max(1, rows - 4);
  const hint = footer || 'arrows/jk move · enter open · q/esc back';

  return new Promise((resolve) => {
    const draw = () => {
      if (index < top) top = index;
      if (index >= top + viewH) top = index - viewH + 1;

      const detail = renderDetail ? renderDetail(items[index]) : [];
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
        const right = pad(detail[r] ?? '', detailWidth);
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
          break;
        case 'down':
          index = Math.min(items.length - 1, index + 1);
          break;
        case 'pageup':
          index = Math.max(0, index - viewH);
          break;
        case 'pagedown':
          index = Math.min(items.length - 1, index + viewH);
          break;
        case 'home':
          index = 0;
          break;
        case 'end':
          index = items.length - 1;
          break;
        case 'enter':
        case 'right':
          activeHandler = null;
          return resolve(items.length ? index : -1);
        case 'q':
        case 'escape':
        case 'backspace':
        case 'left':
          activeHandler = null;
          return resolve(-1);
        default:
          return;
      }
      draw();
    };

    clear();
    activeHandler = onKey;
    draw();
  });
}

/**
 * Full-screen scrollable text pager.
 * @returns Promise<void> resolves when the user backs out.
 */
export function runPager({ title, lines, footer }) {
  let topLine = 0;
  const { cols, rows } = size();
  const viewH = Math.max(1, rows - 4);
  const maxTop = Math.max(0, lines.length - viewH);
  const hint = footer || 'arrows/jk scroll · q/esc back';

  return new Promise((resolve) => {
    const draw = () => {
      const out = [];
      out.push(cyan(bold(pad(` ${title}`, cols))));
      out.push('─'.repeat(cols));
      for (let r = 0; r < viewH; r++) {
        out.push(pad(lines[topLine + r] ?? '', cols));
      }
      out.push('─'.repeat(cols));
      const pos = lines.length > viewH ? `   [${topLine + 1}-${Math.min(topLine + viewH, lines.length)}/${lines.length}]` : '';
      out.push(dim(pad(` ${hint}${pos}`, cols)));
      frame(out);
    };

    const onKey = (key) => {
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
          activeHandler = null;
          return resolve();
        default:
          return;
      }
      draw();
    };

    clear();
    activeHandler = onKey;
    draw();
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
    activeHandler = () => {
      activeHandler = null;
      resolve();
    };
  });
}
