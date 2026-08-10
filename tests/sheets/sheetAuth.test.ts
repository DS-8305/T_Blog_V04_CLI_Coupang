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
});
