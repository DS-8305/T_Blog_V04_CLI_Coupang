import { useEffect, useMemo, useState } from "react";
import type { LoginState, LoginStateSnapshot, PostJob, PostStatus, PublicationMode, TypingSpeedName } from "../shared/types";

const statusLabels: Record<PostStatus, string> = {
  pending: "대기",
  validation_error: "검증 오류",
  running: "작성 중",
  draft_saved: "임시저장 완료",
  published: "공개 발행 완료",
  scheduled: "예약 발행 완료",
  needs_review: "결과 확인 필요",
  failed: "실패",
  stopped: "중지됨"
};
const publicationLabels: Record<PublicationMode, string> = {
  draft: "임시저장",
  public: "즉시 공개",
  scheduled: "예약 공개"
};
const speedLabels: Record<TypingSpeedName, string> = { fast: "빠름", normal: "보통", slow: "느림" };
const loginStateLabels: Record<LoginState, string> = {
  unverified: "로그인 미확인",
  login_open: "전용 Chrome 로그인 대기",
  checking: "로그인 확인 중",
  ready: "로그인 및 쓰기 권한 확인 완료",
  security_hold: "보안 확인 대기"
};
const initialLoginState: LoginStateSnapshot = {
  state: "unverified",
  message: "블로그 주소를 저장한 뒤 전용 Chrome에서 로그인하세요.",
  manualChromeRunning: false
};

type RunLimit = "all" | "1" | "3" | "5";
export type RunPhase = "idle" | "running" | "stopping";
type RunPhaseEvent = "start" | "stop_requested" | "settled";

export function transitionRunPhase(current: RunPhase, event: RunPhaseEvent): RunPhase {
  if (event === "settled") return "idle";
  if (event === "start" && current === "idle") return "running";
  if (event === "stop_requested" && current === "running") return "stopping";
  return current;
}

export function buildPublicationSummary(posts: PostJob[]) {
  return posts.filter((post) => post.status === "pending").reduce(
    (summary, post) => ({ ...summary, [post.parsed.metadata.publication]: summary[post.parsed.metadata.publication] + 1 }),
    { draft: 0, public: 0, scheduled: 0 }
  );
}

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [blogUrl, setBlogUrl] = useState("");
  const [posts, setPosts] = useState<PostJob[]>([]);
  const [speed, setSpeed] = useState<TypingSpeedName>("normal");
  const [runLimit, setRunLimit] = useState<RunLimit>("1");
  const [loginState, setLoginState] = useState<LoginStateSnapshot>(initialLoginState);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>(["작업 폴더와 티스토리 블로그를 설정하세요."]);
  const runInFlight = runPhase !== "idle";
  const pending = posts.filter((post) => post.status === "pending");
  const summary = useMemo(() => buildPublicationSummary(posts), [posts]);

  useEffect(() => {
    void (async () => {
      const api = requireApi();
      const [config, snapshot] = await Promise.all([api.getBlogConfig(), api.getLoginState()]);
      if (config) setBlogUrl(config.blogUrl);
      setLoginState(snapshot);
    })().catch((error) => addLog(errorMessage(error)));
    return window.electronAPI?.onRunLog(addLog);
  }, []);

  async function selectWorkspace() {
    await withAction(async () => {
      const selected = await requireApi().selectWorkspace();
      if (!selected) return;
      setWorkspace(selected);
      const loaded = await requireApi().loadPosts(selected);
      setPosts(loaded);
      addLog(`${loaded.length}개 글 폴더를 불러왔습니다.`);
    });
  }

  async function saveBlog() {
    await withAction(async () => {
      const saved = await requireApi().saveBlogConfig(blogUrl);
      setBlogUrl(saved.blogUrl);
      addLog(`대상 블로그를 저장했습니다: ${saved.blogUrl}`);
    });
  }

  async function refreshPosts() {
    if (!workspace) return;
    const loaded = await requireApi().loadPosts(workspace);
    setPosts(loaded);
  }

  async function loginAction(action: "open" | "verify" | "clear") {
    await withAction(async () => {
      const api = requireApi();
      const value = action === "open" ? await api.openManualLogin()
        : action === "verify" ? await api.verifyLogin()
          : { snapshot: await api.clearSecurityHold() };
      setLoginState(value.snapshot);
      addLog(value.snapshot.message);
    });
  }

  async function startRun() {
    if (!workspace || runInFlight || pending.length === 0) return;
    const chosen = runLimit === "all" ? pending : pending.slice(0, Number(runLimit));
    const lines = chosen.map((post) => {
      const metadata = post.parsed.metadata;
      return `• ${post.parsed.title} — ${publicationLabels[metadata.publication]}${metadata.scheduledAt ? ` (${metadata.scheduledAt})` : ""}`;
    });
    const confirmed = window.confirm([
      "다음 작업을 티스토리에 실행하시겠습니까?",
      "최종 저장/발행 후 결과가 불명확하면 자동 재시도하지 않습니다.",
      "",
      ...lines
    ].join("\n"));
    if (!confirmed) return;

    setRunPhase("running");
    addLog(`자동화를 시작합니다. 입력 속도: ${speedLabels[speed]}`);
    try {
      const result = await requireApi().startRun(workspace, speed, runLimit === "all" ? null : Number(runLimit));
      addLog(result.message);
      await refreshPosts();
    } catch (error) {
      addLog(errorMessage(error));
    } finally {
      setLoginState(await requireApi().getLoginState());
      setRunPhase("idle");
    }
  }

  async function stopRun() {
    if (runPhase !== "running") return;
    setRunPhase("stopping");
    await requireApi().stopRun();
    addLog("안전 중지를 요청했습니다.");
  }

  async function resolve(post: PostJob, outcome: "already_created" | "not_created") {
    await withAction(async () => {
      await requireApi().resolveReview(post, outcome);
      await refreshPosts();
      addLog(outcome === "already_created" ? "이미 생성된 글로 확인했습니다." : "생성되지 않은 글로 확인해 다시 대기 상태로 돌렸습니다.");
    });
  }

  function addLog(message: string) {
    setLog((current) => [`[${new Date().toLocaleTimeString()}] ${message}`, ...current].slice(0, 80));
  }

  async function withAction(action: () => Promise<void>) {
    setLoading(true);
    try { await action(); } catch (error) { addLog(errorMessage(error)); } finally { setLoading(false); }
  }

  return <main className="app-shell">
    <header className="toolbar">
      <div><h1>Tistory Blog Automation</h1><p>마커 기반 글을 티스토리에 임시저장, 즉시 공개 또는 예약 공개합니다.</p></div>
      <button onClick={selectWorkspace} disabled={loading || runInFlight}>작업 폴더 선택</button>
    </header>

    <section className="config-card">
      <label>대상 티스토리 블로그 URL<input value={blogUrl} onChange={(event) => setBlogUrl(event.target.value)} placeholder="https://example.tistory.com" disabled={runInFlight} /></label>
      <button onClick={saveBlog} disabled={loading || runInFlight || !blogUrl.trim()}>저장</button>
    </section>

    <section className="controls">
      <label>입력 속도<select value={speed} onChange={(event) => setSpeed(event.target.value as TypingSpeedName)} disabled={runInFlight}>{Object.entries(speedLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>실행 개수<select value={runLimit} onChange={(event) => setRunLimit(event.target.value as RunLimit)} disabled={runInFlight}><option value="1">1</option><option value="3">3</option><option value="5">5</option><option value="all">전체</option></select></label>
      <button onClick={() => void loginAction("open")} disabled={loading || runInFlight || !blogUrl}>전용 Chrome 열기 / 로그인</button>
      <button onClick={() => void loginAction("verify")} disabled={loading || runInFlight || !blogUrl}>로그인·권한 확인</button>
      {loginState.state === "security_hold" && <button onClick={() => void loginAction("clear")}>보안 대기 해제</button>}
      <button className="primary" onClick={startRun} disabled={loginState.state !== "ready" || pending.length === 0 || runInFlight || loading}>실행 전 확인</button>
      <button onClick={stopRun} disabled={runPhase !== "running"}>{runPhase === "stopping" ? "중지 중" : "중지"}</button>
      <button onClick={() => void refreshPosts()} disabled={!workspace || loading || runInFlight}>새로고침</button>
    </section>

    <section className="workspace-path"><span>작업 폴더</span><strong>{workspace || "선택되지 않음"}</strong></section>
    <section className="workspace-path"><span>로그인 상태</span><strong>{loginStateLabels[loginState.state]}</strong><span>{loginState.message}</span></section>

    <section className="summary-grid">
      <div><span>임시저장</span><strong>{summary.draft}</strong></div>
      <div><span>즉시 공개</span><strong>{summary.public}</strong></div>
      <div><span>예약 공개</span><strong>{summary.scheduled}</strong></div>
    </section>

    <section className="post-list"><h2>글 목록</h2>
      {posts.length === 0 ? <p className="empty">불러온 글이 없습니다.</p> : <table><thead><tr><th>폴더</th><th>제목</th><th>작업</th><th>카테고리 / 예약</th><th>상태</th><th>검토</th></tr></thead><tbody>{posts.map((post) => <tr key={post.id} className={`publication-${post.parsed.metadata.publication}`}><td>{post.id}</td><td>{post.parsed.title || "-"}</td><td>{publicationLabels[post.parsed.metadata.publication]}</td><td>{post.parsed.metadata.category || "기본 카테고리"}<br />{post.parsed.metadata.scheduledAt || ""}</td><td><span className={`status status-${post.status}`}>{statusLabels[post.status]}</span><div className="error-text">{post.parsed.errors.map((error) => error.message).join(", ")}</div></td><td>{post.status === "needs_review" && <div className="review-actions"><button onClick={() => void resolve(post, "already_created")}>이미 생성됨</button><button onClick={() => void resolve(post, "not_created")}>생성 안 됨</button></div>}</td></tr>)}</tbody></table>}
    </section>

    <section className="log-panel"><h2>로그</h2><div className="log-list">{log.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}</div></section>
  </main>;
}

function requireApi() {
  if (!window.electronAPI) throw new Error("Electron 앱에서 실행해 주세요.");
  return window.electronAPI;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
