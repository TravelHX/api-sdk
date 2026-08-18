using System.Text;

namespace ApiSdk.SDKCLI;

/// <summary>
/// Minimal, zero-dependency terminal UI toolkit — the C# counterpart of
/// <c>utils/js/tui.js</c>.
///
/// Uses only the BCL: <see cref="Console.ReadKey(bool)"/> for key handling and
/// ANSI escape codes on the alternate screen buffer. Renders full-screen,
/// k9s-style views (a scrollable list with a live detail pane, and a scrollable
/// pager) inside the terminal that launched the program — no separate window,
/// no packages.
/// </summary>
public static class Tui
{
    // --- ANSI helpers -------------------------------------------------------

    private const string CSI = "\x1b[";
    private const string AltOn = CSI + "?1049h" + CSI + "?25l";  // alt screen + hide cursor
    private const string AltOff = CSI + "?25h" + CSI + "?1049l"; // show cursor + main screen

    private static string Bold(string s) => $"{CSI}1m{s}{CSI}22m";
    private static string Dim(string s) => $"{CSI}2m{s}{CSI}22m";
    private static string Invert(string s) => $"{CSI}7m{s}{CSI}27m";
    private static string Cyan(string s) => $"{CSI}36m{s}{CSI}39m";

    private static (int Cols, int Rows) Size()
    {
        int cols, rows;
        try { cols = Console.WindowWidth; } catch { cols = 0; }
        try { rows = Console.WindowHeight; } catch { rows = 0; }
        return (cols > 0 ? cols : 80, rows > 0 ? rows : 24);
    }

    private static string Truncate(string? str, int width)
    {
        var s = str ?? string.Empty;
        if (width <= 0) return string.Empty;
        return s.Length > width ? s[..(width - 1)] + "…" : s;
    }

    private static string Pad(string? str, int width)
    {
        var s = Truncate(str, width);
        return s + new string(' ', Math.Max(0, width - s.Length));
    }

    // --- input --------------------------------------------------------------

    public enum Key
    {
        Up, Down, Left, Right,
        PageUp, PageDown, Home, End,
        Enter, Backspace, Escape, Quit, CtrlC,
        Other,
    }

    /// <summary>
    /// Blocks for a single key press and maps it to a <see cref="Key"/>, mirroring
    /// the JS <c>decodeKey</c> table (arrows, page/home/end, vim j/k/g/G, q/Q,
    /// enter, esc, backspace, Ctrl-C).
    /// </summary>
    private static Key ReadKeyMapped()
    {
        var info = Console.ReadKey(intercept: true);

        // Ctrl-C arrives as a key with the Control modifier on most terminals.
        if ((info.Modifiers & ConsoleModifiers.Control) != 0 &&
            (info.Key == ConsoleKey.C || info.KeyChar == '\x03'))
        {
            return Key.CtrlC;
        }

        switch (info.Key)
        {
            case ConsoleKey.UpArrow: return Key.Up;
            case ConsoleKey.DownArrow: return Key.Down;
            case ConsoleKey.LeftArrow: return Key.Left;
            case ConsoleKey.RightArrow: return Key.Right;
            case ConsoleKey.PageUp: return Key.PageUp;
            case ConsoleKey.PageDown: return Key.PageDown;
            case ConsoleKey.Home: return Key.Home;
            case ConsoleKey.End: return Key.End;
            case ConsoleKey.Enter: return Key.Enter;
            case ConsoleKey.Backspace: return Key.Backspace;
            case ConsoleKey.Escape: return Key.Escape;
        }

        return info.KeyChar switch
        {
            'k' or 'K' => Key.Up,
            'j' or 'J' => Key.Down,
            'g' => Key.Home,
            'G' => Key.End,
            'q' or 'Q' => Key.Quit,
            '\r' or '\n' => Key.Enter,
            '\x7f' or '\b' => Key.Backspace,
            '\x1b' => Key.Escape,
            '\x03' => Key.CtrlC,
            _ => Key.Other,
        };
    }

    // --- screen control -----------------------------------------------------

    public static void EnterFullscreen() => Console.Out.Write(AltOn);

    public static void ExitFullscreen() => Console.Out.Write(AltOff);

    private static void Clear() => Console.Out.Write($"{CSI}2J{CSI}H");

    /// <summary>
    /// Home the cursor, draw each line clearing to EOL, then clear below — the
    /// flicker-free repaint used by <c>tui.js</c>.
    /// </summary>
    private static void Frame(IReadOnlyList<string> lines)
    {
        var sb = new StringBuilder();
        sb.Append(CSI).Append('H');
        for (var i = 0; i < lines.Count; i++)
        {
            if (i > 0) sb.Append('\n');
            sb.Append(lines[i]).Append(CSI).Append('K');
        }
        sb.Append(CSI).Append("0J");
        Console.Out.Write(sb.ToString());
    }

    // --- views --------------------------------------------------------------

    /// <summary>
    /// Full-screen scrollable list with a live detail pane.
    /// Returns the selected index, or -1 if the user backed out.
    /// </summary>
    public static int RunList<T>(
        string title,
        IReadOnlyList<T> items,
        Func<T, int, string>? renderItem = null,
        Func<T, int, IReadOnlyList<string>>? renderDetail = null,
        string? footer = null)
    {
        var index = 0;
        var top = 0;
        // Vertical scroll offset into the detail pane's own line list — distinct
        // from `top`, which scrolls the list on the left. Reset to 0 whenever the
        // selected item changes so a fresh item's detail always opens at the top.
        // Bound to PageUp/PageDown (Up/Down/Home/End remain list navigation, and
        // detail content is usually much longer than the list — e.g. a voyage's
        // rendered itinerary — so a page-at-a-time scroll matters more there than
        // for the list itself, which already has single-step j/k/arrows).
        var detailScroll = 0;
        var (cols, rows) = Size();
        var listWidth = Math.Max(16, Math.Min(50, (int)(cols * 0.45)));
        var detailWidth = Math.Max(0, cols - listWidth - 3);
        var viewH = Math.Max(1, rows - 4);
        var hint = footer ?? "arrows/jk move · enter open · q/esc back";
        const string moreIndicator = " ↓ more";

        void Draw()
        {
            if (index < top) top = index;
            if (index >= top + viewH) top = index - viewH + 1;

            var detail = renderDetail is not null && items.Count > 0
                ? renderDetail(items[index], detailWidth)
                : Array.Empty<string>();

            var maxDetailScroll = Math.Max(0, detail.Count - viewH);
            detailScroll = Math.Clamp(detailScroll, 0, maxDetailScroll);

            var outLines = new List<string>
            {
                Cyan(Bold(Pad($" {title}", cols))),
                new string('─', cols),
            };

            for (var r = 0; r < viewH; r++)
            {
                var i = top + r;
                string left;
                if (i < items.Count)
                {
                    var label = renderItem is not null ? renderItem(items[i], i) : items[i]?.ToString() ?? string.Empty;
                    var marker = i == index ? "▶ " : "  ";
                    left = Pad(marker + label, listWidth);
                    if (i == index) left = Invert(left);
                }
                else
                {
                    left = new string(' ', listWidth);
                }

                var di = detailScroll + r;
                var isLastRow = r == viewH - 1;
                var hasMoreBelow = isLastRow && di + 1 < detail.Count;
                string right;
                if (hasMoreBelow && detailWidth > moreIndicator.Length)
                {
                    var lineText = di < detail.Count ? detail[di] : string.Empty;
                    var truncWidth = detailWidth - moreIndicator.Length;
                    right = Pad(lineText, truncWidth) + Dim(moreIndicator);
                }
                else
                {
                    right = Pad(di < detail.Count ? detail[di] : string.Empty, detailWidth);
                }
                outLines.Add($"{left} {Dim("│")} {right}");
            }

            outLines.Add(new string('─', cols));
            outLines.Add(Dim(Pad($" {hint}   [{(items.Count > 0 ? index + 1 : 0)}/{items.Count}]", cols)));
            Frame(outLines);
        }

        Clear();
        Draw();

        while (true)
        {
            var key = ReadKeyMapped();
            switch (key)
            {
                case Key.CtrlC:
                    ExitFullscreen();
                    Environment.Exit(130);
                    return -1;
                case Key.Up:
                    index = Math.Max(0, index - 1);
                    detailScroll = 0;
                    break;
                case Key.Down:
                    index = Math.Min(items.Count - 1, index + 1);
                    detailScroll = 0;
                    break;
                case Key.PageUp:
                    detailScroll = Math.Max(0, detailScroll - viewH);
                    break;
                case Key.PageDown:
                    detailScroll += viewH; // clamped against actual detail length in Draw()
                    break;
                case Key.Home:
                    index = 0;
                    detailScroll = 0;
                    break;
                case Key.End:
                    index = items.Count - 1;
                    detailScroll = 0;
                    break;
                case Key.Enter:
                case Key.Right:
                    return items.Count > 0 ? index : -1;
                case Key.Quit:
                case Key.Escape:
                case Key.Backspace:
                case Key.Left:
                    return -1;
                default:
                    continue; // ignore unknown keys without redrawing
            }
            Draw();
        }
    }

    /// <summary>
    /// Full-screen scrollable text pager. Returns when the user backs out.
    /// </summary>
    public static void RunPager(string title, IReadOnlyList<string> lines, string? footer = null)
    {
        var topLine = 0;
        var (cols, rows) = Size();
        var viewH = Math.Max(1, rows - 4);
        var maxTop = Math.Max(0, lines.Count - viewH);
        var hint = footer ?? "arrows/jk scroll · q/esc back";

        void Draw()
        {
            var outLines = new List<string>
            {
                Cyan(Bold(Pad($" {title}", cols))),
                new string('─', cols),
            };
            for (var r = 0; r < viewH; r++)
            {
                var i = topLine + r;
                outLines.Add(Pad(i < lines.Count ? lines[i] : string.Empty, cols));
            }
            outLines.Add(new string('─', cols));
            var pos = lines.Count > viewH
                ? $"   [{topLine + 1}-{Math.Min(topLine + viewH, lines.Count)}/{lines.Count}]"
                : string.Empty;
            outLines.Add(Dim(Pad($" {hint}{pos}", cols)));
            Frame(outLines);
        }

        Clear();
        Draw();

        while (true)
        {
            var key = ReadKeyMapped();
            switch (key)
            {
                case Key.CtrlC:
                    ExitFullscreen();
                    Environment.Exit(130);
                    return;
                case Key.Up:
                    topLine = Math.Max(0, topLine - 1);
                    break;
                case Key.Down:
                    topLine = Math.Min(maxTop, topLine + 1);
                    break;
                case Key.PageUp:
                    topLine = Math.Max(0, topLine - viewH);
                    break;
                case Key.PageDown:
                    topLine = Math.Min(maxTop, topLine + viewH);
                    break;
                case Key.Home:
                    topLine = 0;
                    break;
                case Key.End:
                    topLine = maxTop;
                    break;
                case Key.Quit:
                case Key.Escape:
                case Key.Backspace:
                case Key.Enter:
                case Key.Left:
                    return;
                default:
                    continue;
            }
            Draw();
        }
    }

    /// <summary>
    /// Like <see cref="RunPager(string, IReadOnlyList{string}, string?)"/>, but
    /// for a screen whose content can change in the background — e.g. a cabin
    /// list whose live availability figures resolve asynchronously after the
    /// screen is already showing. <paramref name="linesProvider"/> is
    /// re-invoked to refresh the displayed content whenever
    /// <paramref name="hasPendingRedraw"/> reports a change is waiting (it
    /// should atomically test-and-clear whatever "dirty" flag the caller's
    /// background work sets, e.g. from a <c>CabinOffering.AvailabilityChanged</c>
    /// handler).
    ///
    /// The only structural difference from the plain pager: instead of
    /// blocking indefinitely on a key press, this polls
    /// <see cref="Console.KeyAvailable"/> on a short interval so a background
    /// redraw request is picked up promptly without a key press. This is a
    /// one-off addition for the one screen that needs it, not a general
    /// "reactive" rebuild of the pager — the plain <see cref="RunPager(string, IReadOnlyList{string}, string?)"/>
    /// above is untouched and still blocks on <see cref="Console.ReadKey(bool)"/>
    /// exactly as before for every other screen.
    /// </summary>
    /// <param name="stillLive">Reports whether background redraws are still
    /// possible (e.g. any offering in view is still <c>NotFetched</c>/
    /// <c>Loading</c>). Once it reports <c>false</c>, the tight
    /// poll-<see cref="Console.KeyAvailable"/>-every-80ms loop stops (nothing
    /// left to observe) and this falls back to a plain blocking key read —
    /// same as the non-live pager — instead of spinning on an idle screen.
    /// <c>null</c> (the default) means "always keep polling", matching the
    /// previous unconditional behaviour.</param>
    public static void RunPager(
        string title,
        Func<IReadOnlyList<string>> linesProvider,
        Func<bool> hasPendingRedraw,
        string? footer = null,
        Func<bool>? stillLive = null)
    {
        var topLine = 0;
        var (cols, rows) = Size();
        var viewH = Math.Max(1, rows - 4);
        var hint = footer ?? "arrows/jk scroll · q/esc back";
        var lines = linesProvider();

        void Draw()
        {
            var maxTop = Math.Max(0, lines.Count - viewH);
            topLine = Math.Clamp(topLine, 0, maxTop);

            var outLines = new List<string>
            {
                Cyan(Bold(Pad($" {title}", cols))),
                new string('─', cols),
            };
            for (var r = 0; r < viewH; r++)
            {
                var i = topLine + r;
                outLines.Add(Pad(i < lines.Count ? lines[i] : string.Empty, cols));
            }
            outLines.Add(new string('─', cols));
            var pos = lines.Count > viewH
                ? $"   [{topLine + 1}-{Math.Min(topLine + viewH, lines.Count)}/{lines.Count}]"
                : string.Empty;
            outLines.Add(Dim(Pad($" {hint}{pos}", cols)));
            Frame(outLines);
        }

        Clear();
        Draw();

        while (true)
        {
            Key key;
            if (stillLive is null || stillLive())
            {
                // Poll rather than block so a background redraw request (e.g.
                // a live cabin availability fetch resolving) surfaces
                // promptly instead of waiting for the next key press.
                while (!Console.KeyAvailable)
                {
                    if (hasPendingRedraw())
                    {
                        lines = linesProvider();
                        Draw();
                    }
                    Thread.Sleep(80);
                }
                key = ReadKeyMapped();
            }
            else
            {
                // Nothing left that could still trigger a background redraw
                // (every offering in view has reached a terminal state) --
                // no point burning CPU polling an idle screen every 80ms, so
                // just block for the next key press like the plain pager.
                // One last pending-redraw check first, in case a final
                // change landed in the gap between the last poll tick and
                // stillLive() flipping to false.
                if (hasPendingRedraw())
                {
                    lines = linesProvider();
                    Draw();
                }
                key = ReadKeyMapped();
            }
            var maxTop = Math.Max(0, lines.Count - viewH);
            switch (key)
            {
                case Key.CtrlC:
                    ExitFullscreen();
                    Environment.Exit(130);
                    return;
                case Key.Up:
                    topLine = Math.Max(0, topLine - 1);
                    break;
                case Key.Down:
                    topLine = Math.Min(maxTop, topLine + 1);
                    break;
                case Key.PageUp:
                    topLine = Math.Max(0, topLine - viewH);
                    break;
                case Key.PageDown:
                    topLine = Math.Min(maxTop, topLine + viewH);
                    break;
                case Key.Home:
                    topLine = 0;
                    break;
                case Key.End:
                    topLine = maxTop;
                    break;
                case Key.Quit:
                case Key.Escape:
                case Key.Backspace:
                case Key.Enter:
                case Key.Left:
                    return;
                default:
                    continue;
            }
            Draw();
        }
    }

    /// <summary>Render static lines (e.g. a loading screen) without waiting for input.</summary>
    public static void Render(string title, IReadOnlyList<string> lines)
    {
        var (cols, _) = Size();
        Clear();
        var outLines = new List<string>
        {
            Cyan(Bold(Pad($" {title}", cols))),
            new string('─', cols),
        };
        foreach (var l in lines) outLines.Add(Pad(l, cols));
        Frame(outLines);
    }

    /// <summary>Wait for any key press.</summary>
    public static void WaitKey()
    {
        var key = ReadKeyMapped();
        if (key == Key.CtrlC)
        {
            ExitFullscreen();
            Environment.Exit(130);
        }
    }

    /// <summary>
    /// Full-screen single-line free-text prompt (there was no text-input
    /// primitive in this toolkit before — every other view is a picker/pager).
    /// Reads raw <see cref="Console.ReadKey(bool)"/> presses directly (rather
    /// than through <see cref="ReadKeyMapped"/>, whose <see cref="Key"/> enum
    /// drops the actual character) so typed characters can be appended to the
    /// buffer. Returns the entered text on Enter, or <c>null</c> if the user
    /// cancelled with Escape. Ctrl-C exits the whole program, same as every
    /// other view.
    /// </summary>
    public static string? PromptText(
        string title,
        IReadOnlyList<string>? detail = null,
        string? initialValue = null,
        string? footer = null)
    {
        var (cols, _) = Size();
        var buffer = new StringBuilder(initialValue ?? string.Empty);
        var hint = footer ?? "enter confirm · esc cancel";
        const string inputPrefix = " > ";
        const string cursorGlyph = "█";

        void Draw()
        {
            var outLines = new List<string>
            {
                Cyan(Bold(Pad($" {title}", cols))),
                new string('─', cols),
            };
            if (detail is { Count: > 0 })
            {
                outLines.Add(string.Empty);
                foreach (var line in detail) outLines.Add(Pad($" {line}", cols));
            }
            outLines.Add(string.Empty);

            // The cursor is always at the END of `buffer` here — this primitive
            // only supports append/backspace, no left/right caret movement — so
            // once the buffer is longer than the visible width, what needs to
            // stay on screen is the buffer's TAIL, not its head. Pad()/Truncate()
            // keep the head and cut the tail (append "…" at the end), which is
            // exactly backwards for this case: with a long prefilled value (e.g.
            // this app's ~100+ char default data directories), that made the
            // cursor — and every subsequent keystroke — permanently off-screen
            // from the very first draw. Build a scrolled window into the tail of
            // `buffer` instead, wide enough to fit before the cursor glyph, with
            // a leading "…" only when content is actually hidden before it.
            var available = Math.Max(0, cols - inputPrefix.Length - cursorGlyph.Length);
            string visible;
            if (buffer.Length <= available)
            {
                visible = buffer.ToString();
            }
            else if (available <= 1)
            {
                visible = available == 1 ? "…" : string.Empty;
            }
            else
            {
                var tailChars = available - 1; // reserve 1 column for the leading "…"
                visible = "…" + buffer.ToString(buffer.Length - tailChars, tailChars);
            }

            outLines.Add(Pad($"{inputPrefix}{visible}{cursorGlyph}", cols));
            outLines.Add(string.Empty);
            outLines.Add(new string('─', cols));
            outLines.Add(Dim(Pad($" {hint}", cols)));
            Frame(outLines);
        }

        Clear();
        Draw();

        while (true)
        {
            var info = Console.ReadKey(intercept: true);

            if ((info.Modifiers & ConsoleModifiers.Control) != 0 &&
                (info.Key == ConsoleKey.C || info.KeyChar == '\x03'))
            {
                ExitFullscreen();
                Environment.Exit(130);
            }

            switch (info.Key)
            {
                case ConsoleKey.Enter:
                    return buffer.ToString();
                case ConsoleKey.Escape:
                    return null;
                case ConsoleKey.Backspace:
                    if (buffer.Length > 0) buffer.Length -= 1;
                    break;
                default:
                    // char.IsControl alone isn't enough of a filter: Alt+<letter>
                    // arrives as a normal, non-control KeyChar (e.g. Alt+F is
                    // KeyChar 'f' with Modifiers=Alt) and would otherwise get
                    // silently appended to the path buffer as if it had been
                    // typed literally, and an unrecognized escape sequence (e.g.
                    // a mouse report some terminals emit) could inject several
                    // such "printable" chars in one burst. Only accept keys with
                    // no modifier or Shift alone — every other modifier
                    // combination is some other terminal function, not text entry.
                    if (info.Modifiers is 0 or ConsoleModifiers.Shift && !char.IsControl(info.KeyChar))
                        buffer.Append(info.KeyChar);
                    break;
            }
            Draw();
        }
    }
}
