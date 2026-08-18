import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SwotaAvailabilityClient } from '../availability/SwotaAvailabilityClient';
import type { SwotaConfig } from '../availability/swotaConfig';

const CONFIG: SwotaConfig = {
  RestBaseUrl: 'https://swota.example.com/ota/rest/',
  Auth0: {
    TokenUrl: 'https://auth0.example.com/oauth/token',
    ClientId: 'test-client-id',
    ClientSecret: 'test-client-secret',
    Audience: 'https://partner.example.com/api',
  },
  PointOfSale: {
    RequestorIdType: '5',
    RequestorIdContext: 'SEAWARE',
    RequestorId: '0000',
    BookingChannelType: '1',
    BookingChannelCompanyName: 'INT-AGENT',
  },
  DefaultFareCode: 'BESTPRICE',
  DefaultGuestQty: 2,
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** Minimal Response stand-in — only the members SwotaAvailabilityClient reads. */
function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

function tokenResponseBody(accessToken = 'tok-1', expiresIn = 3600): string {
  return JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' });
}

function cabinAvailResponseBody(cabinNumbers: string[]): string {
  const cabinOptions = cabinNumbers
    .map(
      (cabinNumber, i) =>
        `<vx:CabinOption CabinCategoryCode="A" CabinCategoryStatusCode="36" ` +
        `CabinNumber="${cabinNumber}" CabinRanking="${i + 1}" DeclineIndicator="false" ` +
        `HeldIndicator="false" MaxOccupancy="2" Status="36"><vx:Remark>Cabin</vx:Remark></vx:CabinOption>`
    )
    .join('');
  return (
    '<vx:OTA_CruiseCabinAvailRS xmlns:vx="http://www.opentravel.org/OTA/2003/05" Version="1.999">' +
    '<vx:Success/>' +
    `<vx:CabinOptions>${cabinOptions}</vx:CabinOptions>` +
    '</vx:OTA_CruiseCabinAvailRS>'
  );
}

/**
 * Installs a mock global.fetch for the duration of `fn`, restoring the
 * original afterwards even if `fn` throws. `handler` decides the response
 * (or throws/rejects to simulate a network failure) per call; every call is
 * also recorded in the returned `calls` array for assertion.
 */
async function withMockFetch<T>(
  handler: (url: string, init: RequestInit | undefined, callIndex: number) => Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<T>
): Promise<T> {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let callIndex = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const response = await handler(url, init, callIndex);
    callIndex += 1;
    return response;
  }) as typeof fetch;

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('fetches an Auth0 token once and reuses it across multiple availability calls', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async (calls) => {
      const client = new SwotaAvailabilityClient(CONFIG);

      const first = await client.getAvailableCabins('SCABC-260101', 'DS');
      const second = await client.getAvailableCabins('SCXYZ-260201', 'DS');

      assert.equal(first, 1);
      assert.equal(second, 1);

      const tokenCalls = calls.filter((c) => c.url === CONFIG.Auth0.TokenUrl);
      assert.equal(tokenCalls.length, 1, 'expected the Auth0 token endpoint to be called exactly once');
    }
  );
});

test('builds the OTA_CruiseCabinAvailRQ request from POS/fare/guest config and the given voyageId/cabinCode', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async (calls) => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await client.getAvailableCabins('SCABC-260101', 'DS');

      const call = calls.find((c) => c.url === `${CONFIG.RestBaseUrl}OTA_CruiseCabinAvailRQ`);
      assert.ok(call, 'expected a request to the cabin-availability endpoint');
      assert.equal(call?.init?.method, 'POST');
      const headers = call?.init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer tok-1');
      assert.equal(headers['Content-Type'], 'application/xml');

      const body = String(call?.init?.body);
      assert.match(body, /<OTA_CruiseCabinAvailRQ[^>]*Version="1\.0">/);
      assert.match(
        body,
        /<RequestorID Type="5" ID_Context="SEAWARE" ID="0000" \/>/
      );
      assert.match(body, /<BookingChannel Type="1"><CompanyName>INT-AGENT<\/CompanyName><\/BookingChannel>/);
      assert.match(body, /<GuestCounts><GuestCount Code="10" Quantity="2"\/><\/GuestCounts>/);
      assert.match(body, /<SelectedSailing VoyageID="SCABC-260101">/);
      assert.match(body, /<SelectedCategory PricedCategoryCode="DS"\/>/);
      assert.match(body, /<SelectedFare FareCode="BESTPRICE"\/>/);
    }
  );
});

test('counts real CabinOption entries, excluding the synthetic GTY entry', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, cabinAvailResponseBody(['1002', '1003', '1004', 'GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      assert.equal(await client.getAvailableCabins('SCABC-260101', 'DS'), 3);
    }
  );
});

test('returns 0 when the response contains only the GTY entry', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, cabinAvailResponseBody(['GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      assert.equal(await client.getAvailableCabins('SCABC-260101', 'DS'), 0);
    }
  );
});

test('returns 0 for an empty/absent CabinOptions list, rather than null', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, cabinAvailResponseBody([]));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      const result = await client.getAvailableCabins('SCABC-260101', 'DOES-NOT-EXIST');
      assert.equal(result, 0);
    }
  );
});

test('a 401 on the availability call invalidates the cached token and retries once with a fresh one', async () => {
  let tokenCallCount = 0;
  let availabilityCallCount = 0;

  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) {
        tokenCallCount += 1;
        // First token call issues tok-1, the post-401 refresh issues tok-2.
        return fakeResponse(200, tokenResponseBody(tokenCallCount === 1 ? 'tok-1' : 'tok-2'));
      }
      availabilityCallCount += 1;
      if (availabilityCallCount === 1) {
        return fakeResponse(401, '<vx:Errors><vx:Error>Unauthorized</vx:Error></vx:Errors>');
      }
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async (calls) => {
      const client = new SwotaAvailabilityClient(CONFIG);
      const result = await client.getAvailableCabins('SCABC-260101', 'DS');
      assert.equal(result, 1);
      assert.equal(tokenCallCount, 2, 'expected a fresh token fetch after the 401');
      assert.equal(availabilityCallCount, 2, 'expected exactly one retry after the 401');

      const availCalls = calls.filter(
        (c) => c.url === `${CONFIG.RestBaseUrl}OTA_CruiseCabinAvailRQ`
      );
      const authHeaders = availCalls.map(
        (c) => (c.init?.headers as Record<string, string>).Authorization
      );
      assert.deepEqual(authHeaders, ['Bearer tok-1', 'Bearer tok-2']);
    }
  );
});

test('a SWOTA <Errors> business error is not retried and throws', async () => {
  let availabilityCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      availabilityCallCount += 1;
      return fakeResponse(
        200,
        '<vx:Errors><vx:Error Code="168">Agent not recognised</vx:Error></vx:Errors>'
      );
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await assert.rejects(
        () => client.getAvailableCabins('SCABC-260101', 'DS'),
        /Agent not recognised/
      );
      assert.equal(availabilityCallCount, 1, 'business errors must not be retried');
    }
  );
});

test('a transient network error is retried and succeeds on a later attempt', async () => {
  let availabilityCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      availabilityCallCount += 1;
      if (availabilityCallCount === 1) {
        throw new Error('ECONNRESET');
      }
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      const result = await client.getAvailableCabins('SCABC-260101', 'DS');
      assert.equal(result, 1);
      assert.equal(availabilityCallCount, 2, 'expected exactly one retry after the network error');
    }
  );
});

// --- token cache: in-flight dedup + TTL formula -----------------------------

test('concurrent calls on a cold token cache share one in-flight Auth0 request instead of each firing their own', async () => {
  let tokenCallCount = 0;
  let resolveToken!: (body: string) => void;
  const tokenReady = new Promise<string>((resolve) => {
    resolveToken = resolve;
  });

  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) {
        tokenCallCount += 1;
        // Delay the token response so several getAvailableCabins() calls
        // overlap while the cache is still cold, mirroring the CLI's
        // selectDeparture kicking off fetches for every offering in a
        // departure simultaneously.
        const body = await tokenReady;
        return fakeResponse(200, body);
      }
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);

      const calls = Promise.all([
        client.getAvailableCabins('SCABC-260101', 'DS'),
        client.getAvailableCabins('SCDEF-260102', 'DB'),
        client.getAvailableCabins('SCGHI-260103', 'OV'),
      ]);

      // Let all three calls reach the token fetch before letting it resolve.
      await Promise.resolve();
      await Promise.resolve();
      resolveToken(tokenResponseBody());

      const results = await calls;
      assert.deepEqual(results, [1, 1, 1]);
      assert.equal(tokenCallCount, 1, 'expected exactly one Auth0 token request across all concurrent callers');
    }
  );
});

test('a missing expires_in falls back to a sane default TTL instead of refetching every call', async () => {
  let tokenCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) {
        tokenCallCount += 1;
        return fakeResponse(200, JSON.stringify({ access_token: 'tok-1', token_type: 'Bearer' }));
      }
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await client.getAvailableCabins('SCABC-260101', 'DS');
      await client.getAvailableCabins('SCXYZ-260201', 'DS');
      assert.equal(tokenCallCount, 1, 'a missing expires_in must not collapse the cache TTL to ~0');
    }
  );
});

test('an expires_in smaller than the safety margin still caches the token instead of an effective TTL of 0', async () => {
  let tokenCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) {
        tokenCallCount += 1;
        // 30s is well under the 60s safety margin; a naive
        // `expires_in - margin` formula collapses to a negative/zero TTL,
        // which Math.max(0, ...) would floor to 0 -- i.e. "never cache".
        return fakeResponse(200, tokenResponseBody('tok-1', 30));
      }
      return fakeResponse(200, cabinAvailResponseBody(['1002', 'GTY']));
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await client.getAvailableCabins('SCABC-260101', 'DS');
      await client.getAvailableCabins('SCXYZ-260201', 'DS');
      assert.equal(tokenCallCount, 1, 'a short expires_in must still be cached (clamped, not zeroed) rather than refetched every call');
    }
  );
});

// --- unparseable/error response bodies must never silently count as 0 ------

test('a self-closing <Error ShortText="..."/> response throws with that message instead of silently returning 0', async () => {
  let availabilityCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      availabilityCallCount += 1;
      return fakeResponse(
        200,
        '<vx:OTA_CruiseCabinAvailRS xmlns:vx="http://www.opentravel.org/OTA/2003/05" Version="1.999">' +
          '<vx:Errors><vx:Error Type="3" ShortText="SAIL_PACKAGE_NOT_FOUND"/></vx:Errors>' +
          '</vx:OTA_CruiseCabinAvailRS>'
      );
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await assert.rejects(
        () => client.getAvailableCabins('SCABC-260101', 'DS'),
        /SAIL_PACKAGE_NOT_FOUND/
      );
      // The self-closing error form is a business error, same as the
      // open/close form -- it must not be retried either.
      assert.equal(availabilityCallCount, 1, 'a self-closing business error must not be retried');
    }
  );
});

test('an empty response body throws instead of silently returning 0', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, '');
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      const result = client.getAvailableCabins('SCABC-260101', 'DS');
      await assert.rejects(() => result, /empty response body/);
    }
  );
});

test('a non-XML/HTML response body throws instead of silently returning 0', async () => {
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      return fakeResponse(200, '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>');
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      const result = client.getAvailableCabins('SCABC-260101', 'DS');
      await assert.rejects(() => result, /non-XML response body/);
    }
  );
});

test('a persistent 5xx exhausts retries and throws', async () => {
  let availabilityCallCount = 0;
  await withMockFetch(
    async (url) => {
      if (url === CONFIG.Auth0.TokenUrl) return fakeResponse(200, tokenResponseBody());
      availabilityCallCount += 1;
      return fakeResponse(503, 'Service Unavailable');
    },
    async () => {
      const client = new SwotaAvailabilityClient(CONFIG);
      await assert.rejects(() => client.getAvailableCabins('SCABC-260101', 'DS'), /503/);
      assert.equal(availabilityCallCount, 3, 'expected all 3 attempts to be used before giving up');
    }
  );
});
