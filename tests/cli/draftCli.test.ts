import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/draftCli";
import type { AutomationEngine } from "../../src/automation/AutomationEngine";
import type { PostJob, SessionVerificationResult } from "../../src/shared/types";
import type { GoogleSheetsClient } from "../../src/sheets/googleSheetsClient";
import type { LinkedSheetSource } from "../../src/sheets/sheetSource";

describe("Tistory draft CLI", () => {
  it('syncs a profile immediately before saving its draft', async () => {
    const job = createJob('pending');
    const linked = {...linkedSource(),postFolder:job.folderPath,source:{...linkedSource().source,version:2 as const,personId:'SP1',promptType:'야구선수'}};
    const order:string[]=[];
    const client=createSheetsClient();
    let completed=false;
    client.readSourceRow=async () => ({keyword:'keyword',result:completed?'done':'',keywordColumn:18,resultColumn:19,automationStatus:completed?'COMPLETE':'READY',profile:{personId:'SP1'} as never});
    const engine=createAutomation({ok:true}); engine.saveDraft=async()=> {order.push('draft');return {outcome:'confirmed',status:'draft_saved'};};
    let calls=0;
    const code=await main(runArgs(),{
      findSheetSources:async()=>[linked],createSheetsClient:()=>client,
      syncCompletedSheetPosts:async()=>{completed=calls++>0;return {synced:0,alreadyDone:0,pending:completed?[]:[linked]};},
      loadPosts:async()=>[job],applyPolicy:async jobs=>jobs,attachAutomation:()=>engine,
      syncProfileResult:async()=> {order.push('profile');return 'url';},
      runPosts:async(jobs,automation)=> {await automation.saveDraft(jobs[0]!,{speed:'normal'});return {stopped:false,message:'complete'};},log:vi.fn()
    });
    expect(code).toBe(0);expect(order).toEqual(['profile','draft']);
  });
  it('does not report success if a profile becomes HOLD during saving and done is still blank',async()=>{
    const job=createJob('pending');const source={...linkedSource(),postFolder:job.folderPath,source:{...linkedSource().source,version:2 as const,personId:'SP1',promptType:'야구선수'}};
    const client=createSheetsClient();let held=false;let calls=0;const errors:string[]=[];
    client.readSourceRow=async()=>({keyword:'keyword',result:'',keywordColumn:18,resultColumn:19,automationStatus:held?'HOLD':'READY',profile:{personId:'SP1'} as never});
    const engine=createAutomation({ok:true});engine.saveDraft=async()=>{held=true;return {outcome:'confirmed',status:'draft_saved'};};
    const code=await main(runArgs(),{
      findSheetSources:async()=>[source],createSheetsClient:()=>client,
      syncCompletedSheetPosts:async()=>({synced:0,alreadyDone:0,pending:calls++===0?[source]:[]}),
      loadPosts:async()=>[job],applyPolicy:async jobs=>jobs,attachAutomation:()=>engine,syncProfileResult:async()=> 'url',
      runPosts:async(jobs,automation)=>{await automation.saveDraft(jobs[0]!,{speed:'normal'});return {stopped:false,message:'complete'};},
      log:vi.fn(),error:message=>errors.push(message)
    });
    expect(code).toBe(1);expect(errors.join()).toContain('completion not confirmed');
  });
  it('filters inactive linked profile jobs before validation and drafting', async () => {
    const job = createJob('validation_error');
    const linked = {...linkedSource(),postFolder:job.folderPath,source:{...linkedSource().source,version:2 as const,personId:'SP1',promptType:'야구선수'}};
    const run = vi.fn(async (_jobs: PostJob[]) => ({stopped:false,message:'complete'}));
    const code = await main(runArgs(),{
      findSheetSources:async () => [linked],createSheetsClient,
      syncCompletedSheetPosts:async () => ({synced:0,alreadyDone:0,pending:[]}),
      loadPosts:async () => [job],applyPolicy:async jobs => jobs,
      attachAutomation:() => createAutomation({ok:true}),runPosts:run
    });
    expect(code).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['auto', 'sample.tistory.com'])('finishes an empty queue without Chrome (%s)', async blogUrl => {
    const attachAutomation = vi.fn(() => { throw new Error('Chrome is not running'); });
    const logs: string[] = [];
    const code = await main(['run', '--workspace', 'C:\\empty', '--blog-url', blogUrl], {
      findSheetSources: async () => [], loadPosts: async () => [],
      attachAutomation, log: message => logs.push(message), error: vi.fn()
    });
    expect(code).toBe(0);
    expect(logs.join()).toContain('No pending posts');
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it('recovers completed Sheet writes without opening Chrome', async () => {
    const sync = vi.fn(async () => ({ synced: 1, alreadyDone: 0, pending: [] }));
    const attachAutomation = vi.fn(() => { throw new Error('Chrome is not running'); });
    const code = await main(runArgs(), {
      findSheetSources: async () => [linkedSource()], createSheetsClient,
      syncCompletedSheetPosts: sync, loadPosts: async () => [],
      attachAutomation, log: vi.fn(), error: vi.fn()
    });
    expect(code).toBe(0);
    expect(sync).toHaveBeenCalledOnce();
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it('does not hide pending Sheet completion when no posts remain', async () => {
    const errors: string[] = [];
    const attachAutomation = vi.fn(() => { throw new Error('Chrome is not running'); });
    const code = await main(runArgs(), {
      findSheetSources: async () => [linkedSource()], createSheetsClient,
      syncCompletedSheetPosts: async () => ({ synced: 0, alreadyDone: 0, pending: [linkedSource()] }),
      loadPosts: async () => [], attachAutomation,
      error: message => errors.push(message)
    });
    expect(code).toBe(1);
    expect(errors.join()).toContain('Sheet completion pending for row 2');
    expect(attachAutomation).not.toHaveBeenCalled();
  });
  it.each([
    ["launched", "Dedicated Chrome opened. Sign in to Kakao/Tistory and keep it open."],
    ["already_running", "Dedicated Chrome is already open."]
  ] as const)("reports the login result %s", async (launchResult, expectedMessage) => {
    const logs: string[] = [];
    const launchChrome = vi.fn(async () => launchResult);

    const code = await main(["login"], {
      getProfilePath: () => "C:\\shared-profile",
      launchChrome,
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(logs).toEqual([expectedMessage]);
    expect(launchChrome).toHaveBeenCalledWith("C:\\shared-profile");
  });

  it("verifies a Tistory session and closes only the attachment", async () => {
    const logs: string[] = [];
    const automation = createAutomation({ ok: true });

    const code = await main(["verify", "--blog-url", "sample.tistory.com"], {
      attachAutomation: (_endpoint, blogUrl) => {
        expect(blogUrl).toBe("https://sample.tistory.com");
        return automation;
      },
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(logs).toEqual(["Login session verified."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("returns a clean failure for an unusable Tistory session", async () => {
    const errors: string[] = [];
    const automation = createAutomation({
      ok: false,
      reason: "missing",
      message: "Log in first."
    });

    const code = await main(["verify", "--blog-url", "sample.tistory.com"], {
      attachAutomation: () => automation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Log in first."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("rejects validation errors before attaching to Chrome", async () => {
    const errors: string[] = [];
    const invalidJob = createJob("validation_error", [
      { code: "cli_unsupported_marker", message: "Tistory draft CLI does not allow [PUBLISH] markers." }
    ]);
    const attachAutomation = vi.fn();

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [invalidJob]),
      applyPolicy: vi.fn(async () => [invalidJob]),
      attachAutomation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual([
      "Invalid post 001-post: Tistory draft CLI does not allow [PUBLISH] markers."
    ]);
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it("rejects unresolved needs_review before attaching to Chrome", async () => {
    const errors: string[] = [];
    const reviewJob = createJob("needs_review");
    const attachAutomation = vi.fn();

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [reviewJob]),
      applyPolicy: vi.fn(async () => [reviewJob]),
      attachAutomation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Post 001-post requires manual review before another CLI run."]);
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it("runs validated posts through the existing Tistory orchestrator", async () => {
    const logs: string[] = [];
    const pendingJob = createJob("pending");
    const automation = createAutomation({ ok: true });
    const runPosts = vi.fn(async () => ({ stopped: false, message: "All eligible Tistory posts completed" }));

    const code = await main([
      ...runArgs(),
      "--speed",
      "fast",
      "--max-posts",
      "2"
    ], {
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => automation,
      runPosts,
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(runPosts).toHaveBeenCalledWith([pendingJob], automation, {
      speed: "fast",
      maxPosts: 2,
      closeEngine: false,
      onLog: expect.any(Function)
    });
    expect(logs).toEqual(["All eligible Tistory posts completed"]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("does not create a Sheets client for a workspace without linked manifests", async () => {
    const createSheetsClient = vi.fn();
    const pendingJob = createJob("pending");

    const code = await main(runArgs(), {
      findSheetSources: vi.fn(async () => []),
      createSheetsClient,
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => createAutomation({ ok: true }),
      runPosts: vi.fn(async () => ({ stopped: false, message: "complete" }))
    });

    expect(code).toBe(0);
    expect(createSheetsClient).not.toHaveBeenCalled();
  });

  it("syncs a linked Sheet workspace before and after a successful run", async () => {
    const pendingJob = createJob("pending");
    const syncCompleted = vi.fn()
      .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [linkedSource()] })
      .mockResolvedValueOnce({ synced: 1, alreadyDone: 0, pending: [] });
    const client = createSheetsClient();

    const code = await main(runArgs(), {
      findSheetSources: vi.fn(async () => [linkedSource()]),
      createSheetsClient: () => client,
      syncCompletedSheetPosts: syncCompleted,
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => createAutomation({ ok: true }),
      runPosts: vi.fn(async () => ({ stopped: false, message: "complete" }))
    });

    expect(code).toBe(0);
    expect(syncCompleted).toHaveBeenNthCalledWith(1, "C:\\blog-workspace", client, expect.any(Function));
    expect(syncCompleted).toHaveBeenNthCalledWith(2, "C:\\blog-workspace", client, expect.any(Function));
  });

  it("does not post-sync a linked workspace after the orchestrator stops", async () => {
    const pendingJob = createJob("pending");
    const syncCompleted = vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [linkedSource()] }));

    const code = await main(runArgs(), {
      findSheetSources: vi.fn(async () => [linkedSource()]),
      createSheetsClient,
      syncCompletedSheetPosts: syncCompleted,
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => createAutomation({ ok: true }),
      runPosts: vi.fn(async () => ({ stopped: true, reason: "needs_review" as const, message: "Review it." }))
    });

    expect(code).toBe(1);
    expect(syncCompleted).toHaveBeenCalledOnce();
  });

  it("reports a post-run Sheet sync failure for retry on the next invocation", async () => {
    const errors: string[] = [];
    const pendingJob = createJob("pending");
    const syncCompleted = vi.fn()
      .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [linkedSource()] })
      .mockRejectedValueOnce(new Error("Sheets offline"));

    const code = await main(runArgs(), {
      findSheetSources: vi.fn(async () => [linkedSource()]),
      createSheetsClient,
      syncCompletedSheetPosts: syncCompleted,
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => createAutomation({ ok: true }),
      runPosts: vi.fn(async () => ({ stopped: false, message: "complete" })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Sheets offline"]);
  });

  it("returns a failure while linked Sheet completion remains pending", async () => {
    const errors: string[] = [];
    const pendingJob = createJob("pending");
    const source = linkedSource();
    const syncCompleted = vi.fn()
      .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [source] })
      .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [source] });

    const code = await main(runArgs(), {
      findSheetSources: vi.fn(async () => [source]),
      createSheetsClient,
      syncCompletedSheetPosts: syncCompleted,
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => createAutomation({ ok: true }),
      runPosts: vi.fn(async () => ({ stopped: false, message: "complete" })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual([
      "Sheet completion pending for row 2; retry this command to resume the done write."
    ]);
  });

  it("returns a failure when the orchestrator stops", async () => {
    const errors: string[] = [];
    const pendingJob = createJob("pending");
    const automation = createAutomation({ ok: true });

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => automation,
      runPosts: vi.fn(async () => ({ stopped: true, reason: "editor" as const, message: "Editor stopped." })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Editor stopped."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });
});

function runArgs(): string[] {
  return [
    "run",
    "--workspace",
    "C:\\blog-workspace",
    "--blog-url",
    "sample.tistory.com"
  ];
}

function createAutomation(verification: SessionVerificationResult): AutomationEngine & {
  close: ReturnType<typeof vi.fn>;
} {
  return {
    verifySession: vi.fn(async () => verification),
    saveDraft: vi.fn(async () => ({
      outcome: "confirmed" as const,
      status: "draft_saved" as const
    })),
    close: vi.fn(async () => undefined)
  };
}

function createJob(
  status: PostJob["status"],
  errors: PostJob["parsed"]["errors"] = []
): PostJob {
  return {
    id: "001-post",
    folderPath: "C:\\blog-workspace\\posts\\001-post",
    contentPath: "C:\\blog-workspace\\posts\\001-post\\content.txt",
    status,
    parsed: {
      title: "A",
      metadata: {
        publication: "draft",
        category: null,
        tags: [],
        scheduledAt: null
      },
      events: [{ type: "setTitle", text: "A" }],
      errors
    }
  };
}

function createSheetsClient(): GoogleSheetsClient {
  return {
    readQueue: vi.fn(async () => ({ values: [], rowCount: 0 })),
    readSourceRow: vi.fn(async () => ({ keyword: "keyword", result: "", keywordColumn: 1, resultColumn: 2 })),
    writeDone: vi.fn(async () => undefined)
  };
}

function linkedSource(): LinkedSheetSource {
  return {
    postFolder: "C:\\blog-workspace\\posts\\000002-keyword",
    source: {
      version: 1,
      spreadsheetId: "spreadsheet-id",
      sheetName: "시트1",
      rowNumber: 2,
      keywordHeader: "keyword",
      resultHeader: "result",
      keyword: "keyword"
    }
  };
}
