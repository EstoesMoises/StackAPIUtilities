export const MAX_CONTENT_REPLACEMENT_EXACT_TARGETS = 5_000;
export const MAX_CONTENT_REPLACEMENT_PROPOSALS = MAX_CONTENT_REPLACEMENT_EXACT_TARGETS;

export const MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES = 1_048_576;
export const MAX_CONTENT_REPLACEMENT_PASTE_BYTES = 1_048_576;

export const MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES = 2_097_152;
export const MAX_CONTENT_REPLACEMENT_CONFIGURATION_BYTES = 1_048_576;
export const MAX_CONTENT_REPLACEMENT_CREDENTIALS_BYTES = 524_288;
export const CONTENT_REPLACEMENT_RECOVERY_ENVELOPE_OVERHEAD_BYTES = 65_536;
export const MAX_CONTENT_REPLACEMENT_ROUTE_BODY_BYTES = 4_194_304;

export const MAX_CONTENT_REPLACEMENT_JOB_BYTES = 67_108_864;
export const MAX_CONTENT_REPLACEMENT_EXPORT_BYTES = 33_554_432;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      // TextEncoder replaces isolated surrogate code units with U+FFFD.
      bytes += 3;
    }
  }
  return bytes;
}

export function jsonUtf8ByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? utf8ByteLength(serialized) : null;
  } catch {
    return null;
  }
}

export function isJsonWithinUtf8ByteLimit(value: unknown, maximum: number): boolean {
  const byteLength = jsonUtf8ByteLength(value);
  return byteLength !== null && byteLength <= maximum;
}
