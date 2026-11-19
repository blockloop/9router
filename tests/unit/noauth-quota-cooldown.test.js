import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const db = await import("@/lib/localDb");
const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const LIMIT = "Free usage limit reached. Free models work in OpenCode";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("no-auth free provider cooldown", () => {
  it("uses a long plan-window cooldown instead of 2s exponential backoff", () => {
    expect(checkFallbackError(429, LIMIT, 0, "opencode")).toMatchObject({
      shouldFallback: true, cooldownMs: 30 * 60 * 1000,
    });
  });

  it("falls back to the next combo member and skips upstream during the cooldown", async () => {
    const creds = await getProviderCredentials("opencode", null, "deepseek-v4.1-flash-free");
    expect(creds.connectionId).toBe("noauth:opencode");

    const mark = await markAccountUnavailable("noauth:opencode", 429, LIMIT, "oc", "deepseek-v4.1-flash-free");
    expect(mark).toMatchObject({ shouldFallback: true, cooldownMs: 30 * 60 * 1000 });

    const blocked = await getProviderCredentials("opencode", null, "deepseek-v4.1-flash-free");
    expect(blocked.allRateLimited).toBe(true);
    expect(blocked.lastErrorCode).toBe(429);

    // Cooldown expires: the free member is offered again.
    vi.setSystemTime(new Date("2026-11-19T00:31:00.000Z"));
    const again = await getProviderCredentials("opencode", null, "deepseek-v4.1-flash-free");
    expect(again.id).toBe("noauth");
  });

  it("does not persist a DB lock: no-auth connections have no row", async () => {
    await markAccountUnavailable("noauth:opencode", 429, LIMIT, "oc", "deepseek-v4.1-flash-free");
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });
});
