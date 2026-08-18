import type { ISwotaAvailabilityClient } from './ISwotaAvailabilityClient';
import { loadSwotaConfig, type SwotaConfig } from './swotaConfig';
import { buildCabinAvailRequestXml, countAvailableCabins, extractErrorMessage } from './swotaXml';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;
// Refresh the cached Auth0 token this many ms before its reported expiry, so
// a call doesn't race a token that's about to lapse mid-flight.
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
// Auth0's typical client-credentials default when the token response is
// somehow missing `expires_in` — matches .NET's SwOTAAvailabilityClient
// .GetAccessTokenAsync fallback exactly (see its `?? 3600` comment).
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

interface Auth0TokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
}

/** Thrown for a SWOTA business/validation error (`<Errors><Error>...`) — never retried. */
class SwotaBusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwotaBusinessError';
    Object.setPrototypeOf(this, SwotaBusinessError.prototype);
  }
}

/** Thrown for a non-2xx HTTP response. Retryable only for 5xx (see {@link isRetryable}). */
class SwotaHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SwotaHttpError';
    Object.setPrototypeOf(this, SwotaHttpError.prototype);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof SwotaBusinessError) return false;
  if (err instanceof SwotaHttpError) return err.status >= 500 && err.status < 600;
  // Network errors, timeouts/aborts, JSON/response-body failures, etc. are
  // all treated as transient.
  return true;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable body>';
  }
}

/** Result of {@link SwotaAvailabilityClient.postCabinAvail}: status plus the fully-read body. */
interface CabinAvailResponse {
  status: number;
  ok: boolean;
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Live {@link ISwotaAvailabilityClient} implementation backing the `'swota'`
 * {@link DataSourceFormat}. Talks to the real SWOTA REST API:
 *  - Auth0 client-credentials bearer auth (token cached in-memory and reused
 *    until close to its reported expiry).
 *  - POSTs an OTA_CruiseCabinAvailRQ XML request per (voyageId, cabinCode)
 *    lookup and parses the OTA_CruiseCabinAvailRS response.
 *  - Retries transient failures (network errors, 5xx, request timeout) with
 *    linear backoff; a 401 invalidates the cached token and retries with a
 *    fresh one.
 *
 * See swotaXml.ts for the request/response shape and countAvailableCabins,
 * which derives a real cabin count from the response's CabinOption list
 * (one entry per sellable cabin, excluding the synthetic "GTY" entry) —
 * unlike the category-level Status enum this replaced, OTA_CruiseCabinAvailRQ
 * carries a genuine numeric cabin count.
 */
export class SwotaAvailabilityClient implements ISwotaAvailabilityClient {
  private readonly config: SwotaConfig;
  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0; // epoch ms
  // Single-flight guard: while a token fetch is in progress, concurrent
  // callers await this same promise instead of each firing their own Auth0
  // request. Mirrors .NET's SwOTAAvailabilityClient, which guards the
  // equivalent section with a SemaphoreSlim(1, 1) — a shared in-flight
  // Promise is the idiomatic JS equivalent of that semaphore-guarded
  // critical section. Cleared once the fetch settles (success or failure)
  // so a later call can fetch again.
  private inFlightTokenFetch: Promise<string> | null = null;

  /**
   * @param config Optional explicit config (used by tests). Defaults to
   *   {@link loadSwotaConfig}, which reads config.json/config.local.json from
   *   the repo root — evaluated lazily here (constructor time), so plain
   *   `'v1'`/`'v3'` loads that never construct this class never touch it.
   */
  constructor(config?: SwotaConfig) {
    this.config = config ?? loadSwotaConfig();
  }

  async getAvailableCabins(voyageId: string, cabinCode: string): Promise<number | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const token = await this.getToken();
        const response = await this.postCabinAvail(voyageId, cabinCode, token);

        if (response.status === 401) {
          // Token may have expired/been revoked server-side since caching —
          // invalidate and let the loop's next attempt fetch a fresh one.
          // Also reset inFlightTokenFetch: without this, a concurrent caller
          // that is mid-flight through getToken() right as this 401 lands
          // could still be resolving (or about to resolve) the OLD in-flight
          // promise and hand back the just-invalidated token, defeating the
          // point of clearing cachedToken above.
          this.cachedToken = null;
          this.inFlightTokenFetch = null;
          lastError = new SwotaHttpError(
            `SWOTA request unauthorized (HTTP 401): ${response.text}`,
            401
          );
          if (attempt < MAX_ATTEMPTS) continue;
          throw lastError;
        }

        if (!response.ok) {
          throw new SwotaHttpError(
            `SWOTA request failed (HTTP ${response.status}): ${response.text}`,
            response.status
          );
        }

        const xml = response.text;
        const errorMessage = extractErrorMessage(xml);
        if (errorMessage) {
          throw new SwotaBusinessError(`SWOTA returned an error: ${errorMessage}`);
        }

        return countAvailableCabins(xml);
      } catch (err) {
        const normalized = isAbortError(err)
          ? new Error(`SWOTA request timed out after ${REQUEST_TIMEOUT_MS}ms`)
          : err;
        lastError = normalized;

        if (attempt < MAX_ATTEMPTS && isRetryable(normalized)) {
          await sleep(RETRY_BACKOFF_MS * attempt);
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt) {
      return this.cachedToken;
    }

    // Concurrent callers on a cold/expired cache share the same in-flight
    // fetch rather than each firing their own Auth0 request (e.g. checking
    // availability for several cabin grades on the same departure at once).
    if (this.inFlightTokenFetch) {
      return this.inFlightTokenFetch;
    }

    this.inFlightTokenFetch = this.fetchToken().finally(() => {
      this.inFlightTokenFetch = null;
    });
    return this.inFlightTokenFetch;
  }

  private async fetchToken(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.config.Auth0.TokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.config.Auth0.ClientId,
          client_secret: this.config.Auth0.ClientSecret,
          audience: this.config.Auth0.Audience,
          grant_type: 'client_credentials',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SwotaHttpError(
          `Auth0 token request failed (HTTP ${response.status}): ${await safeText(response)}`,
          response.status
        );
      }

      const data = (await response.json()) as Auth0TokenResponse;
      if (!data.access_token) {
        throw new Error('Auth0 token response did not include an access_token.');
      }

      this.cachedToken = data.access_token;
      // `expires_in` absent OR present-but-non-positive (0 or negative) ->
      // fall back to a sane default TTL (matches .NET's `?? 3600` fallback)
      // rather than collapsing to 0. A non-positive `expires_in` is just as
      // much "no usable TTL" as an absent one -- treating only "absent" as
      // the trigger for the fallback would let an explicit `0`/negative
      // value sail through Math.max(0, ...) unchanged, yielding a TTL of 0
      // and disabling caching entirely (refetching a token on every single
      // call, risking Auth0 rate-limiting under load). When present and
      // positive but smaller than the safety margin, clamp to the raw
      // `expires_in` with no margin subtracted, rather than letting the
      // subtraction go negative (which `Math.max(0, ...)` alone would floor
      // to 0 — i.e. "never actually cache" — defeating the cache entirely).
      const expiresInSeconds =
        typeof data.expires_in === 'number' && !Number.isNaN(data.expires_in) && data.expires_in > 0
          ? data.expires_in
          : DEFAULT_TOKEN_TTL_SECONDS;
      const rawTtlMs = expiresInSeconds * 1000;
      const ttlMs = rawTtlMs > TOKEN_EXPIRY_BUFFER_MS ? rawTtlMs - TOKEN_EXPIRY_BUFFER_MS : rawTtlMs;
      this.cachedTokenExpiresAt = Date.now() + ttlMs;
      return this.cachedToken;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Posts the cabin-availability request and fully reads the response body,
   * all under the same abort timeout. `fetch()`'s promise only resolves once
   * headers arrive — a stalled/slow-draining body after that would otherwise
   * go unbounded, since `clearTimeout` would already have fired by the time
   * a caller got around to reading it. Reading the body here, before
   * `finally` clears the timer, keeps the whole request (headers + body)
   * within {@link REQUEST_TIMEOUT_MS}.
   */
  private async postCabinAvail(
    voyageId: string,
    cabinCode: string,
    token: string
  ): Promise<CabinAvailResponse> {
    const body = buildCabinAvailRequestXml(this.config, voyageId, cabinCode);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.RestBaseUrl}OTA_CruiseCabinAvailRQ`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/xml',
        },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, ok: response.ok, text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
