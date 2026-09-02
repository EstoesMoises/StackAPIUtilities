import { describe, expect, it, vi } from "vitest";
import type {
  PersistedContentReplacementItem,
  ReplacementConfiguration,
  ReplacementProposal,
} from "../writeTools/contentReplacement/types";
import {
  createReplacementExceptionsCsv,
  createReplacementPreviewCsv,
  createReplacementResultsCsv,
  downloadReplacementPreview,
  downloadReplacementTemplate,
} from "./contentReplacementDownloads";
import { MAX_CONTENT_REPLACEMENT_EXPORT_BYTES } from "../writeTools/contentReplacement/limits";

const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  discovery: { mode: "full" },
  rules: [
    { id: "rule-10", find: "TermA", replace: "TermB" },
    { id: "rule-2", find: "old", replace: "new" },
  ],
  options: { caseSensitive: true, wholeTerm: false, replaceInCode: false },
};

describe("content replacement downloads", () => {
  it("exports complete preview data in deterministic numeric item order with RFC 4180 line endings", () => {
    const question = proposal("question", 10, {
      beforeTitle: "TermA title",
      afterTitle: "TermB title",
      beforeBody: "First line\nTermA, accessToken and \"authorization\"",
      afterBody: "First line\nTermB, accessToken and \"authorization\"",
    });
    const answer = proposal("answer", 2);

    const csv = createReplacementPreviewCsv([
      item(question, false),
      item(answer, true),
    ], configuration);

    expect(csv.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,ruleIds,fields,changedOccurrences,protectedOccurrences,beforeTitle,afterTitle,beforeBodyMarkdown,afterBodyMarkdown,caseSensitive,wholeTerm,replaceInCode,selected",
    );
    expect(csv.indexOf("answer,2,1")).toBeLessThan(csv.indexOf("question,10,"));
    expect(csv).toContain('"First line\nTermA, accessToken and ""authorization"""');
    expect(csv).toContain(",1 [code:1],");
    expect(csv).toContain(",true,false,false,");
    expect(csv).toMatch(/,false$/);
    expect(csv).not.toContain("scannedRequestChecksum");
    expect(csv).not.toContain("secret-checksum");
    expect(csv).toContain("selected\r\nanswer,2,1");
  });

  it("adds compact discovery evidence to preview, result, and exception rows without exact-target internals", () => {
    const exactConfiguration: ReplacementConfiguration = {
      ...configuration,
      discovery: { mode: "exact", targetCount: 2, targetDigest: "target-digest-not-for-export" },
    };
    const applied = item(proposal("question", 11, { beforeTitle: "Quoted, \"title\"" }), true, {
      status: "applied",
      result: { kind: "applied", observedRequestChecksum: "observed", completedAt: "2026-09-02T13:00:00.000Z" },
    });
    const failed = item(proposal("answer", 12), true, {
      status: "failed",
      failure: {
        category: "validation",
        message: "The item cannot be updated.",
        retryable: false,
        statusCode: 400,
        occurredAt: "2026-09-02T13:01:00.000Z",
      },
    });

    const preview = createReplacementPreviewCsv([applied], exactConfiguration);
    const results = createReplacementResultsCsv([applied], exactConfiguration);
    const exceptions = createReplacementExceptionsCsv([failed], exactConfiguration);

    expect(preview.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,ruleIds,fields,changedOccurrences,protectedOccurrences,beforeTitle,afterTitle,beforeBodyMarkdown,afterBodyMarkdown,caseSensitive,wholeTerm,replaceInCode,selected",
    );
    expect(results.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,status,outcome,attemptCount,changedOccurrences,protectedOccurrences,completedAt,observedRequestChecksum",
    );
    expect(exceptions.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,status,category,message,retryable,statusCode,occurredAt,observedRequestChecksum",
    );
    expect(preview).toContain('exact,Exact target list · complete for 2 supplied posts,2');
    expect(results).toContain('exact,Exact target list · complete for 2 supplied posts,2');
    expect(exceptions).toContain('exact,Exact target list · complete for 2 supplied posts,2');
    expect(preview).toContain('"Quoted, ""title"""');
    expect(`${preview}${results}${exceptions}`).not.toContain("target-digest-not-for-export");
    expect(`${preview}${results}${exceptions}`).not.toMatch(/inventoryQueue|detailQueue|targetRef/i);

    const targetedResults = createReplacementResultsCsv([applied], {
      ...configuration,
      discovery: { mode: "targeted" },
    });
    expect(targetedResults.split("\r\n")[1]).toContain(
      ",targeted,Search-assisted · may miss matches,,applied,",
    );
  });

  it("uses stable ordinal ordering for rule IDs and content with equal numeric IDs", () => {
    const article = proposal("article", 2);
    article.appliedRuleIds = ["rule-10", "rule-2"];
    const question = proposal("question", 2);

    const csv = createReplacementPreviewCsv([question, article], configuration);
    const rows = csv.split("\r\n");

    expect(rows[1].startsWith("question,2,")).toBe(true);
    expect(rows[2].startsWith("article,2,")).toBe(true);
    expect(rows[2]).toContain("rule-2; rule-10");
  });

  it("encodes the protected total and deterministic reason counts in the approved column", () => {
    const value = proposal("question", 4);
    value.protectedOccurrences = [
      { field: "body", ruleId: "rule-2", start: 12, end: 15, before: "old", reason: "destination" },
      { field: "body", ruleId: "rule-10", start: 0, end: 5, before: "code", reason: "code" },
      { field: "body", ruleId: "rule-2", start: 20, end: 23, before: "old", reason: "code" },
    ];

    const csv = createReplacementPreviewCsv([value], configuration);

    expect(csv.split("\r\n")[1]).toContain(",3 [code:2;destination:1],");
  });

  it("neutralizes spreadsheet formulas in titles, Markdown evidence, links, and exception messages", () => {
    const question = proposal("question", 41, {
      beforeTitle: "=TITLE",
      afterTitle: " \t@TITLE",
      beforeBody: "\u0001+BODY",
      afterBody: "\n-BODY",
    });
    question.metadata!.titleContext = "=CONTEXT";
    question.metadata!.webUrl = " \t@LINK";
    const failed = item(proposal("article", 42), true, {
      status: "failed",
      failure: {
        category: "validation",
        message: "\u0007=ERROR",
        retryable: false,
        occurredAt: "2026-09-02T13:01:00.000Z",
      },
    });

    const preview = createReplacementPreviewCsv([question], configuration);
    const exceptions = createReplacementExceptionsCsv([failed], configuration);

    expect(preview).toContain("'=CONTEXT");
    expect(preview).toContain("' \t@LINK");
    expect(preview).toContain("'=TITLE");
    expect(preview).toContain("' \t@TITLE");
    expect(preview).toContain("'\u0001+BODY");
    expect(preview).toContain("'\n-BODY");
    expect(exceptions).toContain("'\u0007=ERROR");
  });

  it("rejects an over-budget CSV before creating a Blob or download URL", () => {
    const beforeBody = `TermA ${"x".repeat(Math.ceil(MAX_CONTENT_REPLACEMENT_EXPORT_BYTES / 2))}`;
    const afterBody = beforeBody.replace("TermA", "TermB");
    const value = proposal("article", 43, { beforeBody, afterBody });
    const createObjectURL = vi.fn(() => "blob:oversized");

    expect(() => downloadReplacementPreview([value], configuration, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
      createAnchor: vi.fn(),
      appendAnchor: vi.fn(),
    })).toThrow("Content replacement CSV exceeds the 32 MiB export limit.");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("exports typed results and sanitized exceptions without raw payloads or recovery data", () => {
    const applied = item(proposal("question", 11), true, {
      status: "applied",
      attemptCount: 2,
      result: {
        kind: "applied",
        observedRequestChecksum: "secret-checksum",
        completedAt: "2026-09-02T13:00:00.000Z",
      },
    });
    const failed = item(proposal("answer", 3), true, {
      status: "failed",
      attemptCount: 1,
      failure: {
        category: "validation",
        message: "The post no longer accepts this update.",
        retryable: false,
        statusCode: 400,
        occurredAt: "2026-09-02T13:01:00.000Z",
      },
    });

    const results = createReplacementResultsCsv([applied, failed], configuration);
    const exceptions = createReplacementExceptionsCsv([applied, failed], configuration);

    expect(results.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,status,outcome,attemptCount,changedOccurrences,protectedOccurrences,completedAt,observedRequestChecksum",
    );
    expect(exceptions.split("\r\n")[0]).toBe(
      "contentType,itemId,questionId,title,webUrl,discoveryMode,coverage,suppliedTargetCount,status,category,message,retryable,statusCode,occurredAt,observedRequestChecksum",
    );
    expect(results).toContain("question,11,,Question 11,https://example.stackenterprise.co/q/11,full,Exhaustive · all accessible selected content,,applied,applied,2,1,1,2026-09-02T13:00:00.000Z,secret-checksum");
    expect(exceptions).toContain("answer,3,1,Answer context,https://example.stackenterprise.co/a/3,full,Exhaustive · all accessible selected content,,failed,validation,The post no longer accepts this update.,false,400,2026-09-02T13:01:00.000Z,");
    expect(exceptions).not.toContain("question,11");
    expect(`${results}${exceptions}`).not.toMatch(/priorRequestModel|recovery|authorization:/i);
  });

  it("exports stale and verification outcomes as safe exceptions without checksum material", () => {
    const stale = item(proposal("article", 9), true, {
      status: "stale",
      result: { kind: "stale", completedAt: "2026-09-02T13:02:00.000Z" },
    });
    const verification = item(proposal("question", 8), true, {
      status: "failed",
      result: {
        kind: "verification-failed",
        expectedRequestChecksum: "expected-secret",
        observedRequestChecksum: "observed-secret",
        completedAt: "2026-09-02T13:03:00.000Z",
      },
    });

    const csv = createReplacementExceptionsCsv([stale, verification], configuration);

    expect(csv).toContain("question,8,,Question 8,https://example.stackenterprise.co/q/8,full,Exhaustive · all accessible selected content,,failed,verification,The applied content could not be verified.,false,,2026-09-02T13:03:00.000Z,observed-secret");
    expect(csv).toContain("article,9,,Article 9,https://example.stackenterprise.co/a/9,full,Exhaustive · all accessible selected content,,stale,stale,The post changed after review and was not updated.,false,,2026-09-02T13:02:00.000Z,");
    expect(csv).not.toContain("expected-secret");
  });

  it.each([
    ["applied", "applied", "apply-at", "apply-observed"],
    ["unchanged", "unchanged", "unchanged-at", "unchanged-observed"],
    ["stale", "stale", "stale-at", ""],
    ["excluded", "excluded", "excluded-at", ""],
    ["verification-failed", "verification-failed", "verify-at", "verify-observed"],
    ["recovered", "recovered", "recovery-at", "recovery-observed"],
    ["conflict", "conflict", "conflict-at", "conflict-observed"],
    ["recovery-verification-failed", "verification-failed", "recovery-verify-at", "recovery-verify-observed"],
  ] as const)("projects the typed %s result deterministically", (caseName, outcome, completedAt, observed) => {
    const value = resultCase(caseName);
    const csv = createReplacementResultsCsv([value], configuration);

    expect(csv.split("\r\n")[1].split(",").slice(9)).toEqual([
      outcome,
      "1",
      "1",
      "1",
      completedAt,
      observed,
    ]);
  });

  it("uses nested recovery outcomes before retained apply results and distinguishes recovery causes", () => {
    const recovered = resultCase("recovered");
    const conflict = resultCase("conflict");
    const verification = resultCase("recovery-verification-failed");

    const results = createReplacementResultsCsv([recovered, conflict, verification], configuration);
    const exceptions = createReplacementExceptionsCsv([recovered, conflict, verification], configuration);

    expect(results).toContain(",recovered,recovered,1,1,1,recovery-at,recovery-observed");
    expect(results).not.toContain("apply-observed");
    expect(exceptions).not.toContain("question,21,");
    expect(exceptions).toContain(",recovery-conflict,The post changed after replacement and was not recovered.,false,,conflict-at,conflict-observed");
    expect(exceptions).toContain(",recovery-verification,The recovered content could not be verified.,false,,recovery-verify-at,recovery-verify-observed");
  });

  it.each([
    ["pending", null],
    ["excluded", null],
    ["ready-to-apply", null],
    ["applying", null],
    ["applied", null],
    ["stale", "stale"],
    ["failed", "unknown"],
    ["ready-to-recover", null],
    ["recovering", null],
    ["recovered", null],
    ["recovery-conflict", "recovery-conflict"],
    ["recovery-failed", "recovery-failed"],
  ] as const)("uses the exhaustive %s item-status fallback", (status, exceptionCategory) => {
    const value = item(proposal("article", 31), status !== "excluded", { status });

    const results = createReplacementResultsCsv([value], configuration);
    const exceptions = createReplacementExceptionsCsv([value], configuration);

    expect(results.split("\r\n")[1].split(",")[8]).toBe(status);
    if (exceptionCategory) {
      expect(exceptions.split("\r\n")[1].split(",")[9]).toBe(exceptionCategory);
    } else {
      expect(exceptions.split("\r\n")).toHaveLength(1);
    }
  });

  it("downloads the exact canonical template and always cleans up its anchor and URL", async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const append = vi.fn();
    const revokeObjectURL = vi.fn();
    let blob: Blob | undefined;
    const anchor = { href: "", download: "", click, remove };

    downloadReplacementTemplate({
      createObjectURL(received) {
        blob = received;
        return "blob:template";
      },
      revokeObjectURL,
      createAnchor: () => anchor,
      appendAnchor: append,
    });

    expect(anchor.download).toBe("content-replacement-template.csv");
    expect(anchor.href).toBe("blob:template");
    expect(blob?.size).toBe(12);
    expect(blob?.type).toBe("text/csv;charset=utf-8");
    expect(append).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:template");
  });

  it("removes the anchor and revokes the URL when clicking a download fails", () => {
    const remove = vi.fn();
    const revokeObjectURL = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click: () => { throw new Error("click failed"); },
      remove,
    };

    expect(() => downloadReplacementTemplate({
      createObjectURL: () => "blob:template",
      revokeObjectURL,
      createAnchor: () => anchor,
      appendAnchor: vi.fn(),
    })).toThrow("click failed");
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:template");
  });

  it("revokes the URL when anchor creation fails", () => {
    const revokeObjectURL = vi.fn();

    expect(() => downloadReplacementTemplate({
      createObjectURL: () => "blob:template",
      revokeObjectURL,
      createAnchor: () => { throw new Error("anchor failed"); },
      appendAnchor: vi.fn(),
    })).toThrow("anchor failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:template");
  });

  it("still revokes the URL when anchor cleanup fails", () => {
    const revokeObjectURL = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: () => { throw new Error("remove failed"); },
    };

    expect(() => downloadReplacementTemplate({
      createObjectURL: () => "blob:template",
      revokeObjectURL,
      createAnchor: () => anchor,
      appendAnchor: vi.fn(),
    })).toThrow("remove failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:template");
  });
});

function proposal(
  kind: "question" | "answer" | "article",
  id: number,
  content: {
    beforeTitle?: string;
    afterTitle?: string;
    beforeBody?: string;
    afterBody?: string;
  } = {},
): ReplacementProposal {
  const beforeBody = content.beforeBody ?? "Use TermA.";
  const afterBody = content.afterBody ?? "Use TermB.";
  const metadata = {
    titleContext: kind === "answer" ? "Answer context" : `${capitalize(kind)} ${id}`,
    webUrl: `https://example.stackenterprise.co/${kind[0]}/${id}`,
    owner: { id: 7, name: "Owner 7" },
    lastEditor: { id: 8, name: "Editor 8" },
    lastActivityDate: "2026-09-02T12:30:00.000Z",
  };
  const request = kind === "answer"
    ? { body: beforeBody }
    : kind === "question"
      ? { title: content.beforeTitle ?? `Question ${id}`, body: beforeBody, tags: ["tag"] }
      : {
          title: content.beforeTitle ?? `Article ${id}`,
          body: beforeBody,
          tags: ["tag"],
          type: "knowledgeArticle" as const,
          permissions: { editorUserIds: [], editorUserGroupIds: [] },
        };
  const afterRequest = kind === "answer"
    ? { body: afterBody }
    : { ...request, title: content.afterTitle ?? request.title, body: afterBody };
  const ref = kind === "answer"
    ? { kind, questionId: 1, answerId: id } as const
    : kind === "question"
      ? { kind, questionId: id } as const
      : { kind, articleId: id } as const;
  return {
    before: { kind, ref, request, metadata } as ReplacementProposal["before"],
    after: { kind, ref, request: afterRequest, metadata } as ReplacementProposal["after"],
    fields: {
      ...(kind === "answer" ? {} : {
        title: {
          beforeMarkdown: content.beforeTitle ?? `${capitalize(kind)} ${id}`,
          afterMarkdown: content.afterTitle ?? `${capitalize(kind)} ${id}`,
        },
      }),
      body: { beforeMarkdown: beforeBody, afterMarkdown: afterBody },
    },
    changedOccurrences: [{ field: "body", ruleId: "rule-10", start: 4, end: 9, before: "TermA", after: "TermB" }],
    protectedOccurrences: [{ field: "body", ruleId: "rule-10", start: 0, end: 5, before: "code", reason: "code" }],
    appliedRuleIds: ["rule-10"],
    metadata,
    scannedRequestChecksum: "secret-checksum",
    proposedRequestChecksum: "secret-checksum",
    proposalFingerprint: "secret-checksum",
  };
}

function item(
  value: ReplacementProposal,
  included: boolean,
  overrides: Partial<PersistedContentReplacementItem> = {},
): PersistedContentReplacementItem {
  return {
    proposal: value,
    included,
    attemptCount: 0,
    status: included ? "pending" : "excluded",
    ...overrides,
  };
}

function resultCase(
  kind:
    | "applied"
    | "unchanged"
    | "stale"
    | "excluded"
    | "verification-failed"
    | "recovered"
    | "conflict"
    | "recovery-verification-failed",
): PersistedContentReplacementItem {
  const id = kind === "recovered" ? 21 : kind === "conflict" ? 22 : kind === "recovery-verification-failed" ? 23 : 20;
  const base = item(proposal("question", id), kind !== "excluded", { attemptCount: 1 });
  if (kind === "applied" || kind === "unchanged") {
    return {
      ...base,
      status: "applied",
      result: { kind, completedAt: kind === "applied" ? "apply-at" : "unchanged-at", observedRequestChecksum: kind === "applied" ? "apply-observed" : "unchanged-observed" },
    };
  }
  if (kind === "stale" || kind === "excluded") {
    return { ...base, status: kind, result: { kind, completedAt: `${kind}-at` } };
  }
  if (kind === "verification-failed") {
    return {
      ...base,
      status: "failed",
      result: {
        kind,
        completedAt: "verify-at",
        expectedRequestChecksum: "verify-expected",
        observedRequestChecksum: "verify-observed",
      },
    };
  }
  const recoveryKind = kind === "recovery-verification-failed" ? "verification-failed" : kind;
  const auditPrefix = recoveryKind === "recovered"
    ? "recovery"
    : kind === "recovery-verification-failed"
      ? "recovery-verify"
      : recoveryKind;
  return {
    ...base,
    status: recoveryKind === "recovered" ? "recovered" : recoveryKind === "conflict" ? "recovery-conflict" : "recovery-failed",
    result: { kind: "applied", completedAt: "apply-at", observedRequestChecksum: "apply-observed" },
    recovery: {
      priorRequestModel: base.proposal.before,
      scannedRequestChecksum: "scan-secret",
      proposedRequestChecksum: "proposal-secret",
      proposalFingerprint: base.proposal.proposalFingerprint,
      status: recoveryKind === "recovered" ? "applied" : recoveryKind === "conflict" ? "conflict" : "failed",
      result: {
        kind: recoveryKind,
        observedRequestChecksum: `${auditPrefix}-observed`,
        sourceAttemptCount: 1,
        sourceApplyCompletedAt: "apply-at",
        completedAt: `${auditPrefix}-at`,
      },
    },
  };
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
