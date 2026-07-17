import { useEffect, useMemo, useState } from "react";
import type { LoginState, LoginStateSnapshot, PostJob, PostStatus, TypingSpeedName } from "../shared/types";

const statusLabels: Record<PostStatus, string> = {
  pending: "대기",
  validation_error: "검증 오류",
  running: "작성 중",
  draft_saved: "임시저장 완료",
  failed: "실패",
  stopped: "중지됨"
};

const speedLabels: Record<TypingSpeedName, string> = {
  fast: "빠름",
  normal: "보통",
  slow: "느림"
};

const loginStateLabels: Record<LoginState, string> = {
  unverified: "로그인 미확인",
  login_open: "전용 Chrome 로그인 대기",
  checking: "전용 Chrome 로그인 확인 중",
  ready: "전용 Chrome 로그인 확인 완료",
  security_hold: "보안 대기"
};

const initialLoginState: LoginStateSnapshot = {
  state: "unverified",
  message: "로그인 상태를 확인하는 중입니다.",
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

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [posts, setPosts] = useState<PostJob[]>([]);
  const [speed, setSpeed] = useState<TypingSpeedName>("normal");
  const [runLimit, setRunLimit] = useState<RunLimit>("1");
  const [loginState, setLoginState] = useState<LoginStateSnapshot>(initialLoginState);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>(["작업 폴더를 선택하세요."]);
  const runInFlight = runPhase !== "idle";

  const summary = useMemo(() => {
    const valid = posts.filter((post) => post.status === "pending").length;
    const invalid = posts.filter((post) => post.status === "validation_error").length;
    return { valid, invalid, total: posts.length };
  }, [posts]);

  useEffect(() => {
    void refreshLoginState().catch((error) => addLog(errorMessage(error)));
    const unsubscribe = window.electronAPI?.onRunLog((message) => {
      addLog(message);
    });
    return unsubscribe;
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

  async function refreshPosts(targetWorkspace = workspace) {
    if (!targetWorkspace) return;

    await withAction(async () => {
      const loaded = await requireApi().loadPosts(targetWorkspace);
      setPosts(loaded);
      addLog("글 목록을 새로고침했습니다.");
    });
  }

  async function refreshLoginState() {
    const snapshot = await requireApi().getLoginState();
    setLoginState(snapshot);
    return snapshot;
  }

  async function openManualLogin() {
    await withAction(async () => {
      const result = await requireApi().openManualLogin();
      setLoginState(result.snapshot);
      addLog(result.snapshot.message);
      await refreshLoginState();
    });
  }

  async function verifyLogin() {
    await withAction(async () => {
      const result = await requireApi().verifyLogin();
      setLoginState(result.snapshot);
      addLog(result.snapshot.message);
      await refreshLoginState();
    });
  }

  async function clearSecurityHold() {
    await withAction(async () => {
      const snapshot = await requireApi().clearSecurityHold();
      setLoginState(snapshot);
      addLog(snapshot.message);
      await refreshLoginState();
    });
  }

  async function startRun() {
    if (!workspace || runInFlight) return;

    setRunPhase((current) => transitionRunPhase(current, "start"));
    addLog(`자동화를 시작합니다. 입력 속도: ${speedLabels[speed]}`);

    try {
      const maxPosts = runLimit === "all" ? null : Number(runLimit);
      const result = await requireApi().startRun(workspace, speed, maxPosts);
      addLog(result.message || (result.stopped ? "작업이 중지되었습니다." : "작업이 완료되었습니다."));
      const refreshed = await requireApi().loadPosts(workspace);
      setPosts(refreshed);
    } catch (error) {
      addLog(errorMessage(error));
    } finally {
      try {
        await refreshLoginState();
      } catch (error) {
        addLog(errorMessage(error));
      }
      setRunPhase((current) => transitionRunPhase(current, "settled"));
    }
  }

  async function stopRun() {
    if (runPhase !== "running") return;

    setRunPhase((current) => transitionRunPhase(current, "stop_requested"));
    await withAction(async () => {
      await requireApi().stopRun();
      addLog("중지 요청을 보냈습니다.");
      await refreshLoginState();
    });
  }

  function addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    setLog((current) => [`[${timestamp}] ${message}`, ...current].slice(0, 80));
  }

  async function withAction(action: () => Promise<void>) {
    setLoading(true);
    try {
      await action();
    } catch (error) {
      addLog(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>Tistory Blog Automation</h1>
          <p>작업 폴더의 글을 티스토리 입력기에 옮겨 임시저장, 공개 또는 예약 발행합니다.</p>
        </div>
        <button onClick={selectWorkspace} disabled={loading || runInFlight}>
          작업 폴더 선택
        </button>
      </header>

      <section className="controls" aria-label="실행 제어">
        <label>
          입력 속도
          <select
            value={speed}
            onChange={(event) => setSpeed(event.target.value as TypingSpeedName)}
            disabled={runInFlight}
          >
            <option value="fast">{speedLabels.fast}</option>
            <option value="normal">{speedLabels.normal}</option>
            <option value="slow">{speedLabels.slow}</option>
          </select>
        </label>
        <label>
          실행 개수
          <select
            value={runLimit}
            onChange={(event) => setRunLimit(event.target.value as RunLimit)}
            disabled={runInFlight}
          >
            <option value="all">전체</option>
            <option value="1">1</option>
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        </label>
        <button onClick={openManualLogin} disabled={loading || runInFlight}>
          브라우저 열기 / 로그인
        </button>
        <button onClick={verifyLogin} disabled={loading || runInFlight}>
          로그인 확인
        </button>
        {loginState.state === "security_hold" ? (
          <button onClick={clearSecurityHold} disabled={loading || runInFlight}>
            보안 대기 해제
          </button>
        ) : null}
        <button
          onClick={startRun}
          disabled={loginState.state !== "ready" || summary.valid === 0 || runInFlight || loading}
        >
          시작
        </button>
        <button onClick={stopRun} disabled={runPhase !== "running"}>
          {runPhase === "stopping" ? "중지 중" : "중지"}
        </button>
        <button onClick={() => void refreshPosts()} disabled={!workspace || loading || runInFlight}>
          새로고침
        </button>
      </section>

      <section className="workspace-path">
        <span>작업 폴더</span>
        <strong>{workspace || "선택된 작업 폴더 없음"}</strong>
      </section>

      <section className="workspace-path" aria-label="로그인 상태">
        <span>로그인 상태</span>
        <strong>{loginStateLabels[loginState.state]}</strong>
        <span>{loginState.message}</span>
        {loginState.manualChromeRunning ? (
          <span>전용 Chrome을 로그인 확인과 작업이 끝날 때까지 열어 두세요.</span>
        ) : null}
      </section>

      <section className="summary-grid" aria-label="작업 요약">
        <div>
          <span>전체</span>
          <strong>{summary.total}</strong>
        </div>
        <div>
          <span>작성 가능</span>
          <strong>{summary.valid}</strong>
        </div>
        <div>
          <span>검증 오류</span>
          <strong>{summary.invalid}</strong>
        </div>
      </section>

      <section className="post-list">
        <div className="section-heading">
          <h2>글 목록</h2>
          {runInFlight ? (
            <span className="run-badge">{runPhase === "stopping" ? "중지 중" : "실행 중"}</span>
          ) : null}
        </div>
        {posts.length === 0 ? (
          <p className="empty">감지된 글 폴더가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>폴더</th>
                <th>제목</th>
                <th>상태</th>
                <th>검증</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>{post.id}</td>
                  <td>{post.parsed.title || "-"}</td>
                  <td>
                    <span className={`status status-${post.status}`}>{statusLabels[post.status]}</span>
                  </td>
                  <td>{post.parsed.errors.map((error) => error.message).join(", ") || "정상"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="log-panel">
        <h2>로그</h2>
        <div className="log-list">
          {log.map((entry, index) => (
            <div key={`${entry}-${index}`}>{entry}</div>
          ))}
        </div>
      </section>
    </main>
  );
}

function requireApi() {
  if (!window.electronAPI) {
    throw new Error("Electron API를 사용할 수 없습니다. 데스크톱 앱에서 다시 실행하세요.");
  }
  return window.electronAPI;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
