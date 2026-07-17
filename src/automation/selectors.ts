export const NAVER_BLOG_WRITE_URL = "https://blog.naver.com/GoBlogWrite.naver";
export const NAVER_HOME_URL = "https://www.naver.com/";
export const NAVER_LOGIN_URL = "https://nid.naver.com/nidlogin.login";

export const loginCookieNames = ["NID_AUT", "NID_SES"] as const;

export const loginSelectors = {
  form: ["input#id", "input[name='id']", "input#pw", "input[name='pw']"],
  authenticated: [
    "a:has-text('로그아웃')",
    "button:has-text('로그아웃')",
    "[aria-label*='로그아웃']"
  ]
};

export const editorSelectors = {
  writeReady: [
    "div.se-title-text",
    "div.se-main-container [contenteditable='true']",
    "button[class*='save']"
  ],
  popupClose: [
    "button.se-popup-button.se-popup-button-cancel",
    "button.se-help-panel-close-button",
    "button[aria-label='\uB2EB\uAE30']",
    "button[class*='close']",
    "button:has-text('\uCDE8\uC18C')",
    "button:has-text('\uB2EB\uAE30')"
  ],
  title: [
    "div.se-section-documentTitle [contenteditable='true']",
    "div.se-title-text [contenteditable='true']",
    "div.se-title-text p",
    ".se-title-text",
    ".se-title-text [contenteditable=\"true\"]",
    "[class*=\"se-title\"] [contenteditable=\"true\"]",
    "[class*=\"title\"] [contenteditable=\"true\"]",
    'textarea[placeholder*="\uC81C\uBAA9"]',
    'input[placeholder*="\uC81C\uBAA9"]',
    '[contenteditable="true"][aria-label*="\uC81C\uBAA9"]'
  ],
  body: [
    "div.se-module.se-module-text.__se-unit:not(.se-title-text) p.se-text-paragraph",
    "div.se-module.se-module-text.__se-unit:not(.se-title-text)",
    "div.se-main-container div.se-module-text:not(.se-title-text) [contenteditable='true']",
    "div.se-main-container div.se-module-text:not(.se-title-text) p.se-text-paragraph",
    "div.se-component-contenteditable[contenteditable='true']",
    ".se-main-container .se-text-paragraph",
    ".se-component-content .se-text-paragraph",
    ".se-section-text .se-text-paragraph",
    ".se-module-text",
    ".se-main-container [contenteditable=\"true\"]",
    ".se-component-content [contenteditable=\"true\"]",
    ".se-section-text [contenteditable=\"true\"]",
    ".se-component-content",
    ".se-section-text",
    '[contenteditable="true"][aria-label*="\uBCF8\uBB38"]',
    '[contenteditable="true"][data-a11y-title*="\uBCF8\uBB38"]',
    'div[role="textbox"]',
    '[contenteditable="true"]'
  ],
  initialBody: [
    "div.se-module.se-module-text.__se-unit:not(.se-title-text) p.se-text-paragraph",
    "div.se-module.se-module-text.__se-unit:not(.se-title-text)",
    "div.se-main-container div.se-module-text:not(.se-title-text) [contenteditable='true']",
    "div.se-main-container div.se-module-text:not(.se-title-text) p.se-text-paragraph"
  ],
  normalBody: [
    "p.se-text-paragraph.se-text-paragraph-align-justify",
    "p.se-text-paragraph:has(span.__se-node)",
    ".se-component-content p.se-text-paragraph",
    ".se-section-text p.se-text-paragraph",
    ".se-main-container p.se-text-paragraph"
  ],
  draftSave: [
    "button[data-click-area='tpb.save']",
    "button.save_btn__m9Khh",
    "button:has-text('\uC784\uC2DC\uC800\uC7A5')",
    "button[class*='save']"
  ],
  draftSaveButtonNames: ["\uC784\uC2DC\uC800\uC7A5", "\uC800\uC7A5"],
  strikethrough: [
    "button[data-name='strikethrough']",
    "button.se-strikethrough-toolbar-button"
  ],
  bold: [
    "button[data-group='propertyToolbar'][data-name='bold']",
    "button[data-name='bold']",
    "button[data-log='prt.bold']",
    "button.se-bold-toolbar-button"
  ],
  boldButtonNames: ["\uAD75\uAC8C", "Bold"],
  quoteOption: [
    "button[data-role='option'][data-name='quotation'][data-value='quotation_line']",
    "button[data-group='documentToolbar'][data-name='quotation'][data-value='quotation_line']",
    "button[data-log='dot.quota1']",
    "button.se-toolbar-option-insert-quotation-quotation_line-button"
  ],
  quoteMenu: [
    "button[data-name='quotation']",
    "button[data-name='quote']",
    "button[data-log='dot.quote']",
    "button[class*='quote']",
    "button[aria-label*='\uC778\uC6A9']"
  ],
  quoteBlock: [
    "div[class*='se-component-quotation']",
    "div[class*='se-module-quotation']",
    "div[class*='se-quotation']",
    "div[class*='quotation']",
    "div[class*='quote']"
  ],
  quoteButtonNames: ["\uC778\uC6A9\uAD6C", "\uC778\uC6A9"],
  divider: [
    "button[data-name='horizontalLine']",
    "button[data-name='line']",
    "button[data-log='dot.line']",
    "button[class*='horizontal']",
    "button[aria-label*='\uAD6C\uBD84\uC120']"
  ],
  dividerButtonNames: ["\uAD6C\uBD84\uC120"],
  imageToolbar: [
    "button[data-name='image']",
    "button[data-log='dot.img']",
    "button.se-image-toolbar-button",
    "button[aria-label*='\uC0AC\uC9C4']",
    "button[title*='\uC774\uBBF8\uC9C0']"
  ],
  imageButtonNames: ["\uC0AC\uC9C4", "\uC774\uBBF8\uC9C0"],
  imageFileInput: [
    "input[type='file'][accept*='image']",
    "input[type='file']"
  ],
  imageInsertedMarkers: ["div.se-module-image", "div.se-main-container img"]
};
