import { describe, expect, it } from "vitest";

import { OidcError, createOidcVerifier } from "./oidc";

/**
 * Signs real tokens with a real key pair and verifies them through the real code path.
 *
 * No mock of `jwtVerify` anywhere: mocking the verifier in a test *of* the verifier proves
 * only that the test's assumptions agree with themselves. Every token below is genuinely
 * signed, and the rejections are genuine cryptographic or claim failures.
 */
const ISSUER = "https://issuer.test";
const AUDIENCE = "corpus-lens-mcp";

type Jose = typeof import("jose", { with: { "resolution-mode": "import" } });

async function jose(): Promise<Jose> {
  return await import("jose");
}

async function makeKeys() {
  const { generateKeyPair, exportJWK, createLocalJWKSet } = await jose();
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });

  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";

  // A local key set rather than a remote one: the behaviour under test is claim
  // validation, not HTTP. The remote path is `jose`'s own well-tested code.
  return { privateKey, getKey: createLocalJWKSet({ keys: [jwk] }) };
}

interface TokenOverrides {
  issuer?: string;
  audience?: string;
  subject?: string;
  expiresIn?: string;
  notBefore?: string;
  claims?: Record<string, unknown>;
}

async function signToken(
  privateKey: Awaited<ReturnType<typeof makeKeys>>["privateKey"],
  overrides: TokenOverrides = {},
): Promise<string> {
  const { SignJWT } = await jose();

  return await new SignJWT({ email: "someone@issuer.test", ...overrides.claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? "user-123")
    .setIssuedAt()
    .setNotBefore(overrides.notBefore ?? "0s")
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

function verifier(getKey: Awaited<ReturnType<typeof makeKeys>>["getKey"], overrides = {}) {
  return createOidcVerifier(
    {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: `${ISSUER}/.well-known/jwks.json`,
      ...overrides,
    },
    getKey,
  );
}

describe("createOidcVerifier", () => {
  it("accepts a correctly signed token and maps the subject", async () => {
    const { privateKey, getKey } = await makeKeys();

    const caller = await verifier(getKey).verify(await signToken(privateKey));

    expect(caller.id).toBe("user-123");
    expect(caller.email).toBe("someone@issuer.test");
    expect(caller.role).toBe("USER");
  });

  it("rejects a token signed by a different key", async () => {
    const { getKey } = await makeKeys();
    const attacker = await makeKeys();

    // Correct claims, wrong signer — the case JWKS verification exists for.
    const forged = await signToken(attacker.privateKey);

    await expect(verifier(getKey).verify(forged)).rejects.toThrow(OidcError);
  });

  it("rejects a token from another issuer", async () => {
    const { privateKey, getKey } = await makeKeys();
    const token = await signToken(privateKey, { issuer: "https://someone-else.test" });

    // Without this check, a token from any OIDC provider on the internet is accepted, and
    // anyone can create a tenant somewhere and mint one.
    await expect(verifier(getKey).verify(token)).rejects.toThrow(OidcError);
  });

  it("rejects a token minted for another audience", async () => {
    const { privateKey, getKey } = await makeKeys();
    const token = await signToken(privateKey, { audience: "some-other-app" });

    // Same user, same provider, different application. Without the audience check, a token
    // the user legitimately holds for another service is replayable here.
    await expect(verifier(getKey).verify(token)).rejects.toThrow(OidcError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, getKey } = await makeKeys();
    const token = await signToken(privateKey, { expiresIn: "-1m" });

    await expect(verifier(getKey).verify(token)).rejects.toThrow(OidcError);
  });

  it("rejects a token that is not yet valid", async () => {
    const { privateKey, getKey } = await makeKeys();
    const token = await signToken(privateKey, { notBefore: "10m" });

    await expect(verifier(getKey).verify(token)).rejects.toThrow(OidcError);
  });

  it("rejects a token with no subject", async () => {
    const { privateKey, getKey } = await makeKeys();
    const { SignJWT } = await jose();

    const token = await new SignJWT({ email: "nobody@issuer.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifier(getKey).verify(token)).rejects.toThrow(/subject/i);
  });

  it("rejects an unsigned token", async () => {
    const { getKey } = await makeKeys();
    const { UnsecuredJWT } = await jose();

    // `alg: "none"`. Historically the most effective JWT attack there is, and the reason
    // the accepted algorithms are pinned rather than read from the token's own header.
    const unsecured = new UnsecuredJWT({ email: "attacker@evil.test" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("attacker")
      .setIssuedAt()
      .setExpirationTime("5m")
      .encode();

    await expect(verifier(getKey).verify(unsecured)).rejects.toThrow(OidcError);
  });

  describe("role mapping", () => {
    it("grants ADMIN from an array claim", async () => {
      const { privateKey, getKey } = await makeKeys();
      const token = await signToken(privateKey, { claims: { roles: ["viewer", "admin"] } });

      expect((await verifier(getKey).verify(token)).role).toBe("ADMIN");
    });

    it("grants ADMIN from a space-separated string claim", async () => {
      const { privateKey, getKey } = await makeKeys();
      const token = await signToken(privateKey, { claims: { roles: "viewer admin" } });

      expect((await verifier(getKey).verify(token)).role).toBe("ADMIN");
    });

    it("reads a nested claim path, as Keycloak produces", async () => {
      const { privateKey, getKey } = await makeKeys();
      const token = await signToken(privateKey, {
        claims: { realm_access: { roles: ["admin"] } },
      });

      const caller = await verifier(getKey, { roleClaim: "realm_access.roles" }).verify(token);
      expect(caller.role).toBe("ADMIN");
    });

    it("honours a configured admin role value", async () => {
      const { privateKey, getKey } = await makeKeys();
      const token = await signToken(privateKey, { claims: { groups: ["corpus-admins"] } });

      const caller = await verifier(getKey, {
        roleClaim: "groups",
        adminRoleValue: "corpus-admins",
      }).verify(token);
      expect(caller.role).toBe("ADMIN");
    });

    /**
     * The direction of the default, tested from four angles. A mapping bug must leave
     * someone unable to act, never able to do everything.
     */
    it("defaults to USER when the claim is missing, wrong-typed or unrecognised", async () => {
      const { privateKey, getKey } = await makeKeys();

      const cases = [
        {},
        { roles: [] },
        { roles: 42 },
        { roles: ["viewer", "editor"] },
        { realm_access: { roles: ["admin"] } }, // right value, wrong configured path
      ];

      for (const claims of cases) {
        const token = await signToken(privateKey, { claims });
        expect((await verifier(getKey).verify(token)).role).toBe("USER");
      }
    });
  });
});
