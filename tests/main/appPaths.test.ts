import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn()
  }
}));

vi.mock("electron", () => electronMock);

describe("getBrowserProfilePath", () => {
  beforeEach(() => {
    electronMock.app.getPath.mockReset();
  });

  it("stores the browser profile under Electron userData", async () => {
    electronMock.app.getPath.mockReturnValue("C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto");
    const { getBrowserProfilePath } = await import("../../src/main/appPaths");

    expect(getBrowserProfilePath()).toBe("C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto\\browser-profile");
    expect(electronMock.app.getPath).toHaveBeenCalledWith("userData");
  });

  it("normalizes named browser profiles", async () => {
    electronMock.app.getPath.mockReturnValue("C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto");
    const { getBrowserProfilePath, normalizeBrowserProfileName } = await import("../../src/main/appPaths");

    expect(normalizeBrowserProfileName("work profile/one")).toBe("work_profile_one");
    expect(getBrowserProfilePath("work profile/one")).toBe(
      "C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto\\browser-profiles\\profile_work_profile_one"
    );
  });

  it("stores the security hold under Electron userData", async () => {
    electronMock.app.getPath.mockReturnValue("C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto");
    const { getSecurityHoldPath } = await import("../../src/main/appPaths");

    expect(getSecurityHoldPath()).toBe("C:\\Users\\tester\\AppData\\Roaming\\NBlogAuto\\security-hold.json");
    expect(electronMock.app.getPath).toHaveBeenCalledWith("userData");
  });
});
