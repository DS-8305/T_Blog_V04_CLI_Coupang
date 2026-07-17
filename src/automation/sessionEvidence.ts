export type SessionEvidence = {
  url: string;
  hasRequiredCookies: boolean;
  authenticatedUiVisible: boolean;
  loginFormVisible: boolean;
  securityRequirementVisible: boolean;
};

export function classifySessionEvidence(evidence: SessionEvidence) {
  if (evidence.securityRequirementVisible) return "security" as const;
  if (
    evidence.loginFormVisible
    || evidence.url.includes("nid.naver.com")
    || evidence.url.includes("nidlogin.login")
  ) return "missing" as const;
  if (!evidence.hasRequiredCookies && !evidence.authenticatedUiVisible) return "missing" as const;
  return "authenticated" as const;
}
