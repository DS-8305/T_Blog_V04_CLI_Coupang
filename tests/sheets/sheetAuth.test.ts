import { describe, expect, it, vi } from "vitest";
import { createSheetsAccessToken, SHEETS_SCOPE } from "../../src/sheets/sheetAuth";

describe("createSheetsAccessToken", () => {
  it("requires a service-account credential path", async () => {
    await expect(createSheetsAccessToken(" ")).rejects.toThrow(
      "GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON file."
    );
  });

  it("requests the Sheets scope and returns the client token", async () => {
    const getAccessToken = vi.fn(async () => ({ token: "access-token" }));
    const createAuth = vi.fn(() => ({
      getClient: async () => ({ getAccessToken })
    }));

    await expect(createSheetsAccessToken("C:\\secure\\service-account.json", createAuth))
      .resolves.toBe("access-token");
    expect(createAuth).toHaveBeenCalledWith({
      keyFile: "C:\\secure\\service-account.json",
      scopes: [SHEETS_SCOPE]
    });
  });

  it("rejects an empty token", async () => {
    const createAuth = () => ({
      getClient: async () => ({ getAccessToken: async () => ({ token: null }) })
    });

    await expect(createSheetsAccessToken("C:\\secure\\service-account.json", createAuth))
      .rejects.toThrow("Google service account did not return an access token.");
  });

  it("does not expose the credential path when authentication fails", async () => {
    const secretPath = "C:\\secret\\project-private-key.json";
    const createAuth = () => ({
      getClient: async () => {
        throw new Error(`ENOENT: no such file, open '${secretPath}'`);
      }
    });

    let message = "";
    try {
      await createSheetsAccessToken(secretPath, createAuth);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Google Sheets service account authentication failed.");
    expect(message).not.toContain(secretPath);
  });
});
