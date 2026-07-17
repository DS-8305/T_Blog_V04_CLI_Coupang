import { describe, expect, it } from "vitest";
import { classifySessionEvidence } from "../../src/automation/sessionEvidence";

describe("classifySessionEvidence", () => {
  it("classifies complete cookies without login or security UI as authenticated", () => {
    expect(classifySessionEvidence({
      url: "https://www.naver.com/",
      hasRequiredCookies: true,
      authenticatedUiVisible: false,
      loginFormVisible: false,
      securityRequirementVisible: false
    })).toBe("authenticated");
  });

  it("accepts an explicit logout control when legacy session cookies are absent", () => {
    expect(classifySessionEvidence({
      url: "https://www.naver.com/",
      hasRequiredCookies: false,
      authenticatedUiVisible: true,
      loginFormVisible: false,
      securityRequirementVisible: false
    })).toBe("authenticated");
  });

  it("classifies an ordinary missing login as missing", () => {
    expect(classifySessionEvidence({
      url: "https://nid.naver.com/nidlogin.login",
      hasRequiredCookies: false,
      authenticatedUiVisible: false,
      loginFormVisible: true,
      securityRequirementVisible: false
    })).toBe("missing");
  });

  it("gives security evidence priority over cookies and login UI", () => {
    expect(classifySessionEvidence({
      url: "https://nid.naver.com/nidlogin.login",
      hasRequiredCookies: true,
      authenticatedUiVisible: true,
      loginFormVisible: true,
      securityRequirementVisible: true
    })).toBe("security");
  });
});
