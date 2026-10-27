import { AI_PROVIDERS } from "@/shared/constants/providers";
import { WAM_SECRET_FIELD } from "open-sse/config/wamConstants.js";

export function usesAwsCredentialForm(provider) {
  return AI_PROVIDERS[provider]?.credentialForm === "aws";
}

/**
 * providerSpecificData keys that must never leave the server for this provider.
 *
 * Bedrock's profile mode resolves a session token into the connection; a wam connection holds the
 * client secret it authenticates to wam-proxy with. Both are secrets in the same sense as an API
 * key — anything that can read them can act as the connection — so they are dropped the same way.
 *
 * Exported because the edit path needs the same list: a blank secret field keeps the stored value
 * and an explicit null removes it, and that rule has to cover every secret field, not just AWS's.
 */
export function secretPsdFields(provider) {
  if (usesAwsCredentialForm(provider)) return ["sessionToken"];
  if (AI_PROVIDERS[provider]?.credentialForm === "wam") return WAM_SECRET_FIELD;
  return [];
}

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection;

  const secretFields = secretPsdFields(connection.provider);
  if (!secretFields.length || !connection.providerSpecificData) {
    return safe;
  }

  const providerSpecificData = { ...connection.providerSpecificData };
  for (const field of secretFields) delete providerSpecificData[field];
  return { ...safe, providerSpecificData };
}
