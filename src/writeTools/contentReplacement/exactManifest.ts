import type {
  ExactTargetProof,
  ReplacementDiscovery,
  ReplacementItemRef,
} from "./types";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const LEAF_DOMAIN = "content-replacement-exact-ref\u0000sha256-merkle\u00001\u0000";
const NODE_DOMAIN = "content-replacement-exact-node\u0000sha256-merkle\u00001\u0000";

export async function createExactTargetManifest(
  targets: readonly ReplacementItemRef[],
): Promise<{ root: string; proofs: ExactTargetProof[] }> {
  if (targets.length < 1) throw new RangeError("Exact target manifests require at least one target.");
  const levels: string[][] = [await Promise.all(targets.map(hashLeaf))];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(await hashNode(current[index], current[index + 1] ?? current[index]));
    }
    levels.push(next);
  }
  const root = levels[levels.length - 1][0];
  return {
    root,
    proofs: targets.map((_target, targetIndex) => {
      const siblingHashes: string[] = [];
      let index = targetIndex;
      for (let level = 0; level < levels.length - 1; level += 1) {
        const hashes = levels[level];
        siblingHashes.push(hashes[index ^ 1] ?? hashes[index]);
        index = Math.floor(index / 2);
      }
      return {
        algorithm: "sha256-merkle",
        version: 1,
        targetCount: targets.length,
        targetIndex,
        manifestRoot: root,
        siblingHashes,
      };
    }),
  };
}

export async function verifyExactTargetProof(
  target: ReplacementItemRef,
  value: unknown,
  discovery: ReplacementDiscovery,
): Promise<boolean> {
  const proof = normalizeExactTargetProof(value);
  if (!proof || discovery.mode !== "exact" ||
    proof.targetCount !== discovery.targetCount ||
    proof.manifestRoot !== discovery.targetDigest) return false;
  let digest = await hashLeaf(target);
  let index = proof.targetIndex;
  for (const sibling of proof.siblingHashes) {
    digest = index % 2 === 0
      ? await hashNode(digest, sibling)
      : await hashNode(sibling, digest);
    index = Math.floor(index / 2);
  }
  return digest === proof.manifestRoot;
}

export function normalizeExactTargetProof(value: unknown): ExactTargetProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 6 || ![
    "algorithm", "version", "targetCount", "targetIndex", "manifestRoot", "siblingHashes",
  ].every((key) => keys.includes(key)) ||
    record.algorithm !== "sha256-merkle" || record.version !== 1 ||
    !isPositiveSafeInteger(record.targetCount) ||
    !isNonNegativeSafeInteger(record.targetIndex) ||
    record.targetIndex >= record.targetCount ||
    typeof record.manifestRoot !== "string" || !DIGEST_PATTERN.test(record.manifestRoot) ||
    !Array.isArray(record.siblingHashes) ||
    record.siblingHashes.length !== proofDepth(record.targetCount) ||
    !record.siblingHashes.every((hash) => typeof hash === "string" && DIGEST_PATTERN.test(hash))) {
    return null;
  }
  return {
    algorithm: "sha256-merkle",
    version: 1,
    targetCount: record.targetCount,
    targetIndex: record.targetIndex,
    manifestRoot: record.manifestRoot,
    siblingHashes: [...record.siblingHashes] as string[],
  };
}

export function canonicalReplacementRefKey(ref: ReplacementItemRef): string {
  if (ref.kind === "answer") return `answer:${padId(ref.questionId)}:${padId(ref.answerId)}`;
  if (ref.kind === "article") return `article:${padId(ref.articleId)}`;
  return `question:${padId(ref.questionId)}`;
}

function proofDepth(targetCount: number): number {
  let width = targetCount;
  let depth = 0;
  while (width > 1) {
    width = Math.ceil(width / 2);
    depth += 1;
  }
  return depth;
}

function padId(id: number): string {
  return String(id).padStart(16, "0");
}

async function hashLeaf(target: ReplacementItemRef): Promise<string> {
  return sha256(`${LEAF_DOMAIN}${canonicalReplacementRefKey(target)}`);
}

async function hashNode(left: string, right: string): Promise<string> {
  return sha256(`${NODE_DOMAIN}${left}${right}`);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
