const workosClientId = process.env.WORKOS_CLIENT_ID;

// Legacy WorkOS issuers keep the old Next.js app authenticated while the
// TanStack Start migration is in flight. Remove together with the Next.js app.
const legacyWorkosProviders = workosClientId
  ? [
      {
        type: "customJwt",
        issuer: "https://api.workos.com/",
        algorithm: "RS256",
        jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
        applicationID: workosClientId,
      },
      {
        type: "customJwt",
        issuer: `https://api.workos.com/user_management/${workosClientId}`,
        algorithm: "RS256",
        jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
      },
    ]
  : [];

const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
    ...legacyWorkosProviders,
  ],
};

export default authConfig;
