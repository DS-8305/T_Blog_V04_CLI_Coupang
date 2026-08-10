export const TISTORY_HOME_URL = "https://www.tistory.com/";

export const tistorySelectors = {
  editorIframe: ["#editor-tistory_ifr", "iframe[title*='서식 있는 텍스트 편집기']"],
  editorReady: [
    "textarea#post-title-inp",
    "textarea[placeholder*='제목']",
    "div[contenteditable='true'][role='textbox']",
    ".mce-content-body[contenteditable='true']"
  ],
  loginForm: [
    "input[name='loginId']",
    "input[name='email']",
    "input[type='password']",
    "form[action*='accounts.kakao.com']"
  ],
  securityChallenge: [
    "[id*='captcha']",
    "[class*='captcha']",
    "[data-testid*='captcha']",
    "[class*='challenge']"
  ],
  title: ["textarea#post-title-inp", "textarea[placeholder*='제목']"],
  body: [".mce-content-body[contenteditable='true']", "div[contenteditable='true'][role='textbox']"],
  formatMenu: ["[aria-label='문단모양'] button", ".mce-menubtn[aria-haspopup='true'] button"],
  heading1: ["[role='menuitem']:has-text('제목1')", "button:has-text('제목1')", "span:has-text('제목1')"],
  divider: ["[aria-label='구분선'] button"],
  dividerStyle1: [
    "[role='menuitem']:has-text('구분선 style1')",
    ".mce-hr:has(.mce-i-hr-style1)"
  ],
  attach: ["#mceu_0-open", "[aria-label='첨부'] button"],
  photoMenuItem: ["[role='menuitem']:has-text('사진')"],
  categoryButton: ["button:has-text('카테고리')", "button[aria-label*='카테고리']"],
  tagInput: ["input[placeholder*='태그']", "input[aria-label*='태그']"],
  draftButton: [
    "a.action[role='button']:has-text('임시저장')",
    "[role='button'].action:has-text('임시저장')",
    "button:has-text('임시저장')"
  ],
  draftCount: ["button.count[aria-label^='임시저장 개수']"],
  completeButton: ["button:has-text('완료')", "button:has-text('발행')"],
  publicOption: ["label:has-text('공개')", "button:has-text('공개')"],
  scheduleOption: ["label:has-text('예약')", "button:has-text('예약')"],
  scheduleDate: ["input[type='date']", "input[placeholder*='날짜']"],
  scheduleTime: ["input[type='time']", "input[placeholder*='시간']"],
  finalPublishButton: ["button:has-text('공개 발행')", "button:has-text('발행')", "button:has-text('저장')"],
  success: ["[role='alert']:has-text('저장')", "[role='alert']:has-text('발행')", ".toast"]
} as const;

export const TISTORY_SECURITY_TEXT = /captcha|캡차|보안\s*확인|추가\s*인증|본인\s*인증/i;
export const TISTORY_ACCESS_DENIED_TEXT = /권한이\s*없|접근이\s*제한|블로그를\s*관리할\s*수\s*없/i;
