type MfaEnvironment = Record<string, string | undefined>;

export function isTestAdminPasswordOnlyLoginAllowed(
  email: string,
  hostname: string,
  environment: MfaEnvironment = process.env,
) {
  const configuredEmail = environment.PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL?.trim().toLowerCase();
  const configuredHost = environment.PLATFORM_ADMIN_TEST_MFA_BYPASS_HOST?.trim().toLowerCase();
  return environment.VERCEL === "1"
    && environment.VERCEL_ENV === "production"
    && Boolean(configuredEmail && configuredHost)
    && email.trim().toLowerCase() === configuredEmail
    && hostname.trim().toLowerCase() === configuredHost;
}
