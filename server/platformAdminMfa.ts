type MfaEnvironment = Record<string, string | undefined>;

// Bind this test-only exception to the Vercel project for homologation.
const HOMOLOGATION_VERCEL_PROJECT_ID = "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc";

export function isTestAdminPasswordOnlyLoginAllowed(
  email: string,
  hostname: string,
  environment: MfaEnvironment = process.env,
) {
  const configuredEmail = environment.PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL?.trim().toLowerCase();
  const configuredHost = environment.PLATFORM_ADMIN_TEST_MFA_BYPASS_HOST?.trim().toLowerCase();
  return environment.VERCEL === "1"
    && environment.VERCEL_ENV === "production"
    && environment.VERCEL_PROJECT_ID === HOMOLOGATION_VERCEL_PROJECT_ID
    && Boolean(configuredEmail && configuredHost)
    && email.trim().toLowerCase() === configuredEmail
    && hostname.trim().toLowerCase() === configuredHost;
}
