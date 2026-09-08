import { GoogleAuth } from "google-auth-library";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type TokenResult = string | null | { token?: string | null };
type AuthFactory = (options: { keyFile: string; scopes: string[] }) => {
  getClient(): Promise<{ getAccessToken(): Promise<TokenResult> }>;
};

export async function createSheetsAccessToken(
  credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS,
  createAuth: AuthFactory = defaultAuthFactory,
  scopes: string[] = [SHEETS_SCOPE]
): Promise<string> {
  const keyFile = credentialsPath?.trim();
  if (!keyFile) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON file.");
  }

  let result: TokenResult;
  try {
    const client = await createAuth({ keyFile, scopes }).getClient();
    result = await client.getAccessToken();
  } catch {
    throw new Error("Google Sheets service account authentication failed.");
  }
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
