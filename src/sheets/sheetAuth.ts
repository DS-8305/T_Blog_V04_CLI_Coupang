import { GoogleAuth } from "google-auth-library";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type TokenResult = string | null | { token?: string | null };
type AuthFactory = (options: { keyFile: string; scopes: string[] }) => {
  getClient(): Promise<{ getAccessToken(): Promise<TokenResult> }>;
};

export async function createSheetsAccessToken(
  credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS,
  createAuth: AuthFactory = defaultAuthFactory
): Promise<string> {
  const keyFile = credentialsPath?.trim();
  if (!keyFile) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON file.");
  }

  const client = await createAuth({ keyFile, scopes: [SHEETS_SCOPE] }).getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("Google service account did not return an access token.");
  return token;
}

const defaultAuthFactory: AuthFactory = (options) => {
  const auth = new GoogleAuth(options);
  return {
    async getClient() {
      const client = await auth.getClient();
      return {
        async getAccessToken() {
          return client.getAccessToken();
        }
      };
    }
  };
};
