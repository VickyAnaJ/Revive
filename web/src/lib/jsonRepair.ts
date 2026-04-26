// Vroom JSON repair, per design §6d C5d AgentBus citation
// (deep-dive-research.md L1721 to L1727).
//
// Gemini sometimes wraps JSON in markdown fences, prepends or appends prose,
// uses single quotes, or leaves trailing commas. This module performs a
// regex-based cleanup pass before JSON.parse so recoverable responses survive.
// Unrecoverable responses still throw; the caller (AgentBus) handles retry.

const FENCE_PATTERNS = [
  /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/m,
];

export function repairJson(raw: string): string {
  let s = raw.trim();

  for (const re of FENCE_PATTERNS) {
    const match = s.match(re);
    if (match) {
      s = match[1].trim();
      break;
    }
  }

  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  const firstBracket = s.indexOf('[');
  const lastBracket = s.lastIndexOf(']');

  let start = -1;
  let end = -1;
  if (firstBrace !== -1 && lastBrace !== -1) {
    start = firstBrace;
    end = lastBrace;
  }
  if (
    firstBracket !== -1 &&
    lastBracket !== -1 &&
    (start === -1 || firstBracket < start)
  ) {
    start = firstBracket;
    end = lastBracket;
  }
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  s = s.replace(/,\s*([}\]])/g, '$1');

  s = s.replace(/'([^'\n]*?)'(\s*[:,\]}])/g, '"$1"$2');
  s = s.replace(/([{,]\s*)'([^'\n]+?)'(\s*:)/g, '$1"$2"$3');

  return s;
}
