/** Login del portal merchant (backoffice público para comercios). */
export function getMerchantBackofficeLoginUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL ??
    "https://psp-backoffice.onrender.com/login"
  );
}
