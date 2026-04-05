// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

// Mock "server-only" so the module can be imported in the test environment
vi.mock("server-only", () => ({}));

// Mock next/headers cookies
const mockCookieSet = vi.fn();
const mockCookieStore = { set: mockCookieSet };
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

describe("createSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("sets an HTTP-only cookie named 'auth-token'", async () => {
    const { createSession } = await import("@/lib/auth");

    await createSession("user-123", "test@example.com");

    expect(mockCookieSet).toHaveBeenCalledOnce();
    const [cookieName, , cookieOptions] = mockCookieSet.mock.calls[0];
    expect(cookieName).toBe("auth-token");
    expect(cookieOptions.httpOnly).toBe(true);
    expect(cookieOptions.sameSite).toBe("lax");
    expect(cookieOptions.path).toBe("/");
  });

  test("cookie expiry is approximately 7 days from now", async () => {
    const { createSession } = await import("@/lib/auth");
    const before = Date.now();

    await createSession("user-123", "test@example.com");

    const after = Date.now();
    const [, , cookieOptions] = mockCookieSet.mock.calls[0];
    const expires: Date = cookieOptions.expires;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });

  test("JWT token contains the correct userId and email claims", async () => {
    const { createSession } = await import("@/lib/auth");

    await createSession("user-123", "test@example.com");

    const [, token] = mockCookieSet.mock.calls[0];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("user-123");
    expect(payload.email).toBe("test@example.com");
  });

  test("JWT token expires in approximately 7 days", async () => {
    const { createSession } = await import("@/lib/auth");
    const before = Math.floor(Date.now() / 1000);

    await createSession("user-123", "test@example.com");

    const after = Math.floor(Date.now() / 1000);
    const [, token] = mockCookieSet.mock.calls[0];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    const sevenDaysSec = 7 * 24 * 60 * 60;
    expect(payload.exp).toBeGreaterThanOrEqual(before + sevenDaysSec - 5);
    expect(payload.exp).toBeLessThanOrEqual(after + sevenDaysSec + 5);
  });

  test("JWT token is signed with HS256", async () => {
    const { createSession } = await import("@/lib/auth");

    await createSession("user-123", "test@example.com");

    const [, token] = mockCookieSet.mock.calls[0];
    // Decode header without verifying to check the algorithm
    const header = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString()
    );
    expect(header.alg).toBe("HS256");
  });

  test("works with different userId and email values", async () => {
    const { createSession } = await import("@/lib/auth");

    await createSession("another-user", "another@test.org");

    const [, token] = mockCookieSet.mock.calls[0];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("another-user");
    expect(payload.email).toBe("another@test.org");
  });
});
