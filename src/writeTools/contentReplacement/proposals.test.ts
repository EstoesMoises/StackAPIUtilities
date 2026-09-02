import { describe, expect, it } from "vitest";
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
  stableSerialize,
  toReplacementWireRequestModel,
} from "./proposals";
import { createExactTargetSelection } from "./discovery";
import type {
  ReplacementRequestModel,
  ReplacementWireRequestModel,
} from "./types";

describe("replacement proposals", () => {
  it("copies only exact editable request fields into a metadata-free recovery wire model", () => {
    const local: ReplacementRequestModel = {
      kind: "question",
      ref: { kind: "question", questionId: 42 },
      request: { title: "Title", body: "Body", tags: ["product"] },
      metadata: { webUrl: "https://demo.stackenterprise.co/q/42" },
    };

    const wire = toReplacementWireRequestModel(local);

    expect(wire).toEqual({
      kind: "question",
      ref: { kind: "question", questionId: 42 },
      request: { title: "Title", body: "Body", tags: ["product"] },
    });
    expect(wire).not.toBe(local);
    expect(wire.ref).not.toBe(local.ref);
    expect(wire.request).not.toBe(local.request);
    if (wire.kind !== "question" || local.kind !== "question") throw new Error("Expected question models.");
    expect(wire.request.tags).not.toBe(local.request.tags);

    if (false) {
      // @ts-expect-error Metadata-bearing local evidence requires explicit wire conversion.
      const invalidWire: ReplacementWireRequestModel = local;
      void invalidWire;
    }
  });
  it("changes only allowed question fields and keeps tag names", async () => {
    const proposal = await buildReplacementProposal(
      {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "TermA setup", body: "Use TermA.", tags: ["support", "product"] },
        metadata: { webUrl: "https://demo.stackenterprise.co/questions/42" },
      },
      {
        target: { kind: "enterprise-main" },
        contentTypes: { questions: true, answers: true, articles: true },
        discovery: { mode: "full" },
        rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
        options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
      },
    );

    expect(proposal?.after.request).toEqual({
      title: "TermB setup",
      body: "Use TermB.",
      tags: ["support", "product"],
    });
    expect(proposal?.changedOccurrences).toEqual([
      expect.objectContaining({ field: "title", before: "TermA", after: "TermB" }),
      expect.objectContaining({ field: "body", before: "TermA", after: "TermB" }),
    ]);
    expect(proposal?.appliedRuleIds).toEqual(["r1"]);
  });

  it("includes permissions and expiration in article stale detection", async () => {
    const first = await checksumRequestModel({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: {
        title: "TermA",
        body: "TermA",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [8] },
      },
    });
    const second = await checksumRequestModel({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: {
        title: "TermA",
        body: "TermA",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [9] },
      },
    });
    expect(first).not.toBe(second);
  });

  it("fingerprints instance, target, rules, options, and content types", async () => {
    const base = {
      baseUrl: "https://demo.stackenterprise.co",
      scanCompatibility: "current" as const,
      configuration: {
        target: { kind: "enterprise-main" as const },
        contentTypes: { questions: true, answers: true, articles: true },
        discovery: { mode: "targeted" as const },
        rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
        options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
      },
    };
    expect(await createJobFingerprint(base)).not.toBe(
      await createJobFingerprint({
        ...base,
        configuration: { ...base.configuration, options: { ...base.configuration.options, wholeTerm: false } },
      }),
    );
  });

  it("checksums only the ordered PUT request object, not item identity or evidence metadata", async () => {
    const request = { title: "TermA", body: "TermA", tags: ["support", "product"] };
    await expect(
      checksumRequestModel({
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request,
        metadata: { webUrl: "https://example.test/questions/42" },
      }),
    ).resolves.toBe(
      await checksumRequestModel({
        kind: "question",
        ref: { kind: "question", questionId: 99 },
        request,
        metadata: { webUrl: "https://example.test/questions/99", lastActivityDate: "2026-09-01" },
      }),
    );
    await expect(
      checksumRequestModel({ kind: "question", ref: { kind: "question", questionId: 42 }, request: { ...request, tags: ["product", "support"] } }),
    ).resolves.not.toBe(await checksumRequestModel({ kind: "question", ref: { kind: "question", questionId: 42 }, request }));
  });

  it("uses semantic rule pairs and normalized base URLs for job fingerprints", async () => {
    const configuration = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: false, articles: true },
      discovery: { mode: "targeted" as const },
      rules: [
        { id: "first", sourceRow: 2, find: "TermA", replace: "TermB" },
        { id: "second", sourceRow: 3, find: "CPR", replace: "Benefits" },
      ],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };

    await expect(createJobFingerprint({
      baseUrl: " https://demo.stackenterprise.co/path ",
      configuration,
      scanCompatibility: "current",
    })).resolves.toBe(
      await createJobFingerprint({
        baseUrl: "https://demo.stackenterprise.co",
        scanCompatibility: "current",
        configuration: {
          ...configuration,
          rules: [
            { id: "renamed", sourceRow: 17, find: "CPR", replace: "Benefits" },
            { id: "another", sourceRow: 18, find: "TermA", replace: "TermB" },
          ],
        },
      }),
    );
  });

  it("fingerprints discovery mode and normalized exact targets", async () => {
    const targeted = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "targeted" as const },
      rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };
    const exactSelection = await createExactTargetSelection([{ kind: "question", questionId: 42 }]);

    await expect(createJobFingerprint({
      baseUrl: "https://demo.stackenterprise.co",
      configuration: targeted,
      scanCompatibility: "current",
    })).resolves.not.toBe(
      await createJobFingerprint({
        baseUrl: "https://demo.stackenterprise.co",
        configuration: { ...targeted, discovery: exactSelection.discovery },
        scanCompatibility: "current",
      }),
    );
  });

  it("binds scan compatibility provenance into job fingerprints", async () => {
    const configuration = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" as const },
      rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };

    await expect(createJobFingerprint({
      baseUrl: "https://demo.stackenterprise.co",
      configuration,
      scanCompatibility: "current",
    })).resolves.not.toBe(await createJobFingerprint({
      baseUrl: "https://demo.stackenterprise.co",
      configuration,
      scanCompatibility: "legacy-restart-required",
    }));
  });

  it("returns no proposal when neither editable field changes", async () => {
    await expect(
      buildReplacementProposal(
        {
          kind: "answer",
          ref: { kind: "answer", questionId: 1, answerId: 2 },
          request: { body: "`TermA`" },
        },
        {
          target: { kind: "enterprise-main" },
          contentTypes: { questions: true, answers: true, articles: true },
          discovery: { mode: "full" },
          rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
          options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
        },
      ),
    ).resolves.toBeNull();
  });

  it("uses literal case and whole-term matching for titles without parsing Markdown", async () => {
    const proposal = await buildReplacementProposal(
      {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "[terma] TermA2 TermA", body: "TermA", tags: [] },
      },
      {
        target: { kind: "enterprise-main" },
        contentTypes: { questions: true, answers: true, articles: true },
        discovery: { mode: "full" },
        rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
        options: { caseSensitive: false, wholeTerm: true, replaceInCode: false },
      },
    );

    expect(proposal?.fields.title?.afterMarkdown).toBe("[TermB] TermA2 TermB");
    expect(proposal?.changedOccurrences.filter((occurrence) => occurrence.field === "title")).toHaveLength(2);
  });

  it("binds proposal fingerprints to item identity and semantic configuration", async () => {
    const configuration = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" as const },
      rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };
    const model = {
      kind: "question" as const,
      ref: { kind: "question" as const, questionId: 42 },
      request: { title: "TermA", body: "TermA", tags: [] },
    };
    const sameContentDifferentItem = { ...model, ref: { kind: "question" as const, questionId: 43 } };

    const proposal = await buildReplacementProposal(model, configuration);
    const differentItem = await buildReplacementProposal(sameContentDifferentItem, configuration);
    const differentConfiguration = await buildReplacementProposal(model, {
      ...configuration,
      options: { ...configuration.options, wholeTerm: false },
    });

    expect(proposal?.proposalFingerprint).not.toBe(differentItem?.proposalFingerprint);
    expect(proposal?.proposalFingerprint).not.toBe(differentConfiguration?.proposalFingerprint);
  });

  it("requires and retains a valid Exact manifest proof in proposal evidence and fingerprints", async () => {
    const selection = await createExactTargetSelection([{ kind: "question", questionId: 42 }]);
    const configuration = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: false, articles: false },
      discovery: selection.discovery,
      rules: [{ id: "r1", find: "LegacyProduct", replace: "NewProduct" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };
    const model = {
      kind: "question" as const,
      ref: selection.targets[0] as Extract<(typeof selection.targets)[number], { kind: "question" }>,
      request: { title: "LegacyProduct", body: "Safe", tags: [] },
    };

    const proposal = await buildReplacementProposal(model, configuration, selection.proofs[0]);

    expect(proposal?.exactProof).toEqual(selection.proofs[0]);
    await expect(buildReplacementProposal(model, configuration)).rejects.toThrow("Exact manifest proof");
    await expect(buildReplacementProposal(model, configuration, {
      ...selection.proofs[0],
      targetIndex: 1,
    })).rejects.toThrow("Exact manifest proof");
  });

  it("rejects Exact proof material for Targeted and Full proposals", async () => {
    const selection = await createExactTargetSelection([{ kind: "question", questionId: 42 }]);
    const model = {
      kind: "question" as const,
      ref: selection.targets[0] as Extract<(typeof selection.targets)[number], { kind: "question" }>,
      request: { title: "LegacyProduct", body: "Safe", tags: [] },
    };
    const base = {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: false, articles: false },
      rules: [{ id: "r1", find: "LegacyProduct", replace: "NewProduct" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    };

    await expect(buildReplacementProposal(model, {
      ...base,
      discovery: { mode: "targeted" },
    }, selection.proofs[0])).rejects.toThrow("only valid for Exact");
    await expect(buildReplacementProposal(model, {
      ...base,
      discovery: { mode: "full" },
    }, selection.proofs[0])).rejects.toThrow("only valid for Exact");
  });

  it("serializes object keys deterministically without reordering arrays", () => {
    expect(stableSerialize({ zebra: [{ b: 2, a: 1 }, 3, 1], alpha: { d: true, c: false } })).toBe(
      '{"alpha":{"c":false,"d":true},"zebra":[{"a":1,"b":2},3,1]}',
    );
  });
});
