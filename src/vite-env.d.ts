/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM_ADMIN_ENABLED?: string;
  readonly VITE_PLATFORM_ADMIN_ALLOWED_HOSTS?: string;
  readonly VITE_PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL?: string;
}
