import { describe, expect, it } from "vitest";
import { classifySessionEvidence } from "../../src/automation/sessionEvidence";

describe("classifySessionEvidence", () => {
  it("classifies a ready Tistory editor as authenticated", () => {
    expect(classifySessionEvidence({
      url: "https://sample.tistory.com/manage/newpost",
      editorReady: true,
      loginFormVisible: false,
      securityRequirementVisible: false,
      accessDeniedVisible: false
    })).toBe("authenticated");
  });

  it("classifies a Kakao login page as missing", () => {
    expect(classifySessionEvidence({
      url: "https://accounts.kakao.com/login/",
      editorReady: false,
      loginFormVisible: true,
      securityRequirementVisible: false,
      accessDeniedVisible: false
    })).toBe("missing");
  });

  it("classifies inaccessible blog writing as profile_error", () => {
    expect(classifySessionEvidence({
      url: "https://sample.tistory.com/manage/newpost",
      editorReady: false,
      loginFormVisible: false,
      securityRequirementVisible: false,
      accessDeniedVisible: true
    })).toBe("profile_error");
  });

  it("gives security evidence priority over cookies and login UI", () => {
    expect(classifySessionEvidence({
      url: "https://accounts.kakao.com/login/",
      editorReady: false,
      loginFormVisible: true,
      securityRequirementVisible: true,
      accessDeniedVisible: false
    })).toBe("security");
  });
});
