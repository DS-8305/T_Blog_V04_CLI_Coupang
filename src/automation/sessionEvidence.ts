export type SessionEvidence = {
  url: string;
  editorReady: boolean;
  loginFormVisible: boolean;
  securityRequirementVisible: boolean;
  accessDeniedVisible: boolean;
};

export function classifySessionEvidence(evidence: SessionEvidence) {
  if (evidence.securityRequirementVisible) return "security" as const;
  if (
    evidence.loginFormVisible
    || evidence.url.includes("accounts.kakao.com")
    || evidence.url.includes("auth.tistory.com")
  ) return "missing" as const;
  if (evidence.accessDeniedVisible) return "profile_error" as const;
  if (evidence.editorReady) return "authenticated" as const;
  return "profile_error" as const;
}
