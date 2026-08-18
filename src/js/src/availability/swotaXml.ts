import type { SwotaConfig } from './swotaConfig';

const OTA_NAMESPACE = 'http://www.opentravel.org/OTA/2003/05';

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the OTA_CruiseCabinAvailRQ XML request body for one voyage/cabin
 * category, matching the reference OTA_CruiseCategoryAvailRQ builder
 * element-for-element (see docfx/HX/swota/development/messages/cabin-availability.md)
 * with one addition:
 *  - POS/Source/RequestorID + BookingChannel from config.PointOfSale
 *  - exactly two `<Guest/>` elements (the reference hardcodes this
 *    regardless of guest quantity — reproduced as-is here)
 *  - GuestCounts/GuestCount Quantity from config.DefaultGuestQty
 *  - SailingInfo/SelectedSailing[VoyageID] for the requested voyage
 *  - SailingInfo/SelectedCategory[PricedCategoryCode] for the requested cabin code
 *  - SelectedFare[FareCode] from config.DefaultFareCode
 */
export function buildCabinAvailRequestXml(
  config: SwotaConfig,
  voyageId: string,
  cabinCode: string
): string {
  const pos = config.PointOfSale;
  return (
    `<OTA_CruiseCabinAvailRQ xmlns="${OTA_NAMESPACE}" Version="1.0">` +
    '<POS><Source>' +
    `<RequestorID Type="${escapeXmlAttr(pos.RequestorIdType)}" ` +
    `ID_Context="${escapeXmlAttr(pos.RequestorIdContext)}" ` +
    `ID="${escapeXmlAttr(pos.RequestorId)}" />` +
    `<BookingChannel Type="${escapeXmlAttr(pos.BookingChannelType)}">` +
    `<CompanyName>${escapeXmlAttr(pos.BookingChannelCompanyName)}</CompanyName>` +
    '</BookingChannel>' +
    '</Source></POS>' +
    '<Guest/><Guest/>' +
    `<GuestCounts><GuestCount Code="10" Quantity="${config.DefaultGuestQty}"/></GuestCounts>` +
    `<SailingInfo><SelectedSailing VoyageID="${escapeXmlAttr(voyageId)}"><CruiseLine/></SelectedSailing>` +
    `<SelectedCategory PricedCategoryCode="${escapeXmlAttr(cabinCode)}"/></SailingInfo>` +
    `<SelectedFare FareCode="${escapeXmlAttr(config.DefaultFareCode)}"/>` +
    '</OTA_CruiseCabinAvailRQ>'
  );
}

/** One `<CabinOption>` element parsed out of an OTA_CruiseCabinAvailRS. */
export interface ParsedCabinOption {
  cabinNumber: string | null;
}

// Matches an opening (possibly self-closing) CabinOption tag with an
// optional XML namespace prefix (SwOTA responses use "vx:"), capturing its
// attribute string. Deliberately NOT a full XML parser — the response shape
// here is flat attribute-only elements, so a targeted regex avoids pulling
// in a new dependency, and nothing in this repo currently parses XML.
const CABIN_OPTION_TAG_RE = /<(?:[\w.-]+:)?CabinOption\b([^>]*)>/g;
const ATTR_RE = /([A-Za-z_][-\w.:]*)\s*=\s*"([^"]*)"/g;
// Non-self-closing form: <Error ...>message text</Error>.
const ERROR_TAG_RE = /<(?:[\w.-]+:)?Error\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Error>/;
// Self-closing form: <Error ShortText="..." .../>. The standard OTA error
// shape carries its message in a ShortText attribute rather than element
// text when self-closed -- this form was previously missed entirely, so a
// response using it fell through to countAvailableCabins finding zero
// CabinOption elements and returning 0, indistinguishable from a genuine
// sold-out category.
const ERROR_SELFCLOSE_TAG_RE = /<(?:[\w.-]+:)?Error\b([^>]*)\/>/;
// A response body that isn't XML at all (HTML error page, empty body, plain
// text) must never fall through to countAvailableCabins either -- it would
// find no CabinOption elements and silently return 0, indistinguishable from
// a real sold-out category.
const HTML_BODY_RE = /<!DOCTYPE\s+html|<html[\s>]/i;
const NO_ERROR_MESSAGE_PROVIDED = '(no error message provided)';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

/** Parses every `<CabinOption>` element out of an OTA_CruiseCabinAvailRS body. */
export function parseCabinOptions(xml: string): ParsedCabinOption[] {
  const options: ParsedCabinOption[] = [];
  CABIN_OPTION_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CABIN_OPTION_TAG_RE.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1]);
    options.push({ cabinNumber: attrs.CabinNumber ?? null });
  }
  return options;
}

/**
 * Extracts an error message from a SwOTA response body, if the body
 * indicates an error condition. Checks, in order:
 *
 *  1. An empty/whitespace-only body -- SWOTA (or an intermediary) returned
 *     nothing.
 *  2. A non-XML body (HTML error page, plain text, anything not starting
 *     with `<`) -- e.g. a proxy/gateway error page instead of a real SWOTA
 *     response.
 *  3. The standard `<Errors><Error ...>message</Error></Errors>` form (see
 *     docfx/HX/swota/development/basics.md — "Error Handling and Success
 *     Indicator": business/validation errors come back this way, often
 *     alongside a 200 OK).
 *  4. The self-closing `<Error ShortText="..." .../>` form, whose message
 *     lives in the `ShortText` attribute rather than element text.
 *
 * Returns `null` only when none of the above apply -- i.e. the body is real,
 * parseable XML with no `Error` element, which is the only case where
 * falling through to {@link countAvailableCabins} is safe. Every other case
 * returns a non-null message so the caller throws instead of silently
 * counting zero `CabinOption` elements and returning `0`, which would be
 * indistinguishable from a genuine sold-out category.
 */
export function extractErrorMessage(xml: string): string | null {
  const trimmed = xml.trim();
  if (trimmed.length === 0) {
    return 'SWOTA returned an empty response body.';
  }
  if (!trimmed.startsWith('<') || HTML_BODY_RE.test(trimmed)) {
    const snippet = trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
    return `SWOTA returned a non-XML response body: ${snippet}`;
  }

  const openClose = ERROR_TAG_RE.exec(xml);
  if (openClose) {
    const text = decodeXmlEntities(openClose[1].trim());
    return text.length > 0 ? text : NO_ERROR_MESSAGE_PROVIDED;
  }

  const selfClosing = ERROR_SELFCLOSE_TAG_RE.exec(xml);
  if (selfClosing) {
    const attrs = parseAttrs(selfClosing[1]);
    const shortText = attrs.ShortText?.trim();
    return shortText && shortText.length > 0 ? shortText : NO_ERROR_MESSAGE_PROVIDED;
  }

  return null;
}

// --- availability-count derivation ------------------------------------------
//
// OTA_CruiseCabinAvailRS's CabinOptions list is genuinely one entry per
// sellable cabin — per docfx/HX/swota/development/messages/cabin-availability.md's
// "Not-available cabins are NOT returned" note — so the count of CabinOption
// elements IS the real available-cabin number, no Status-code guesswork
// needed (contrast the coarse category-level Status enum this replaced).
//
// One synthetic entry is always mixed in: a CabinNumber="GTY" ("Guarantee" —
// book without a specific cabin), returned by default even when real cabins
// are also available. It must be excluded from the count (case-insensitive
// compare, per the doc's exact "GTY" casing, defensively normalized here).
const GTY_CABIN_NUMBER = 'GTY';

/**
 * Counts the real sellable cabins in an OTA_CruiseCabinAvailRS body: every
 * `<CabinOption>` with a `CabinNumber` other than the synthetic "GTY" entry.
 * Returns `0` (not null) when there are no real cabins — an empty/absent
 * CabinOptions list, or one containing only the GTY entry — matching the
 * "not-available cabins are NOT returned" semantics documented above.
 */
export function countAvailableCabins(xml: string): number {
  return parseCabinOptions(xml).filter((option) => {
    const cabinNumber = option.cabinNumber?.trim();
    return !!cabinNumber && cabinNumber.toUpperCase() !== GTY_CABIN_NUMBER;
  }).length;
}
