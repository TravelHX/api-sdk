using System.Globalization;

namespace ApiSdk.Loading;

/// <summary>
/// Pure, stateless parsing/normalization helpers for the V3 flat-file format.
/// Factored out of <see cref="V3DataSetLoader"/> so the rules can be unit
/// tested in isolation without any fixture files.
/// </summary>
internal static class V3Normalization
{
    /// <summary>Literal strings that must normalize to null everywhere.</summary>
    private static readonly string[] NullSentinels = { "No Mapping", "No Market", "NaT" };

    /// <summary>Datetime formats V3 uses: ISO datetime and date-only.</summary>
    private static readonly string[] DateTimeFormats =
    {
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-dd",
    };

    /// <summary>True if the value is null/blank or one of the null sentinels.</summary>
    public static bool IsNullSentinel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        var trimmed = value.Trim();
        foreach (var s in NullSentinels)
            if (string.Equals(trimmed, s, StringComparison.Ordinal)) return true;
        return false;
    }

    /// <summary>Normalize a free-text string: sentinels and blanks become null,
    /// otherwise the trimmed value.</summary>
    public static string? NormalizeString(string? value) =>
        IsNullSentinel(value) ? null : value!.Trim();

    /// <summary>
    /// Parse a number-with-units string ("11,647 t", "114 m", "13 knots"):
    /// strip comma thousands separators and any trailing non-numeric unit suffix,
    /// then InvariantCulture-parse. Returns null on sentinel/blank/garbage.
    /// </summary>
    public static double? ParseNumberWithUnit(string? value)
    {
        if (IsNullSentinel(value)) return null;

        var s = value!.Trim().Replace(",", string.Empty);

        // Keep the leading numeric run (digits, sign, decimal point); drop the
        // unit suffix (" t", " m", " knots", etc.).
        var end = 0;
        while (end < s.Length && (char.IsDigit(s[end]) || s[end] == '.' || s[end] == '-' || s[end] == '+'))
            end++;
        if (end == 0) return null;

        var numeric = s.Substring(0, end);
        return double.TryParse(numeric, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    /// <summary>Parse an embedded rate string ("38995.00") to a double; null on
    /// sentinel/blank/garbage. Mirrors the V1 ParseRate semantics.</summary>
    public static double? ParseRate(string? value)
    {
        if (IsNullSentinel(value)) return null;
        return double.TryParse(value!.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    /// <summary>Parse a string integer (e.g. passengerCapacity "200",
    /// yearOfConstruction "2007"); null on sentinel/blank/garbage.</summary>
    public static int? ParseInt(string? value)
    {
        if (IsNullSentinel(value)) return null;
        return int.TryParse(value!.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : null;
    }

    /// <summary>
    /// Defensively parse a V3 datetime (ISO "yyyy-MM-ddTHH:mm:ss" or date-only
    /// "yyyy-MM-dd"), returning the normalized "yyyy-MM-dd" string to mirror how
    /// the V1 path stores dates as strings. Returns null on sentinel/unknown
    /// rather than throwing.
    /// </summary>
    public static string? NormalizeDate(string? value)
    {
        if (IsNullSentinel(value)) return null;

        if (DateTime.TryParseExact(
                value!.Trim(),
                DateTimeFormats,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var dt))
        {
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return null;
    }

    /// <summary>
    /// Strip the "_@" prefix from a V3 VoyageID, exactly like the V1 TourCode
    /// handling. Returns empty string for null/blank.
    /// </summary>
    public static string StripVoyageId(string? voyageId)
    {
        if (string.IsNullOrEmpty(voyageId)) return string.Empty;
        return voyageId.StartsWith("_@", StringComparison.Ordinal) ? voyageId.Substring(2) : voyageId;
    }
}
