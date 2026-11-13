import * as ipaddr from "ipaddr.js";

/** Normalize the address resolved by Express so login, whitelist checks and the login-page display agree. */
export function normalizeClientIp(rawIp: string | undefined | null): string | undefined {
  if (!rawIp) return undefined;
  try {
    return ipaddr.process(rawIp).toString();
  } catch {
    return undefined;
  }
}
