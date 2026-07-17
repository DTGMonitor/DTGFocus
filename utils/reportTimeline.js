/**
 * Deformation timeline trimming for radar reports.
 *
 * A resolved chain runs root → current and can be arbitrarily long. A report
 * only wants what changed recently, plus enough context to read it:
 *
 *   the current node
 * + every node detected within the last 24h
 * + exactly ONE node immediately before that recent set
 *
 * Worked examples (D = current):
 *   A→B→C→D, C and D recent  →  B→C→D   (C,D recent, B is the context node)
 *   A→B→C→D, only D recent   →  C→D     (D recent, C is the context node)
 *
 * Pure: no React, no Supabase, no clock access — `now` is supplied.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const detectedMs = (node) => new Date(node?.created_at).getTime();

/**
 * @param {object[]} chain     Ordered root → current.
 * @param {Date|number} now
 * @param {number} [windowMs]  "Recent" horizon; defaults to 24h.
 * @returns {object[]} A contiguous suffix of `chain`, always including its tail.
 */
export function trimChain(chain, now, windowMs = DAY_MS) {
  if (!Array.isArray(chain) || chain.length === 0) return [];
  if (chain.length === 1) return [...chain];

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const cutoff = nowMs - windowMs;

  // Walk back from the tail while nodes are still recent. Scanning from the tail
  // (rather than filtering) keeps the result contiguous even if timestamps are
  // out of order — a node with a stale date can't punch a hole in the chain.
  let recentStartIdx = chain.length - 1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const ms = detectedMs(chain[i]);
    if (Number.isFinite(ms) && ms >= cutoff) recentStartIdx = i;
    else break;
  }

  const tailIsRecent = Number.isFinite(detectedMs(chain[chain.length - 1]))
    && detectedMs(chain[chain.length - 1]) >= cutoff;

  // Nothing recent at all (a quiet slope): show the current node and one before
  // it, so the reader still sees what it followed.
  if (!tailIsRecent) return chain.slice(-2);

  // One node of context before the earliest recent node.
  return chain.slice(Math.max(0, recentStartIdx - 1));
}

/**
 * Whether the trimmed chain's head is the true root of the full chain.
 *
 * The timeline UI derives its Root/Current badges positionally (`index === 0`),
 * which is wrong after trimming — index 0 of a trimmed chain is usually just the
 * context node. Use this instead, or the report will claim a mid-chain event is
 * the root.
 */
export function isTrimmedHeadTrueRoot(chain, trimmed) {
  if (!Array.isArray(chain) || !Array.isArray(trimmed)) return false;
  if (chain.length === 0 || trimmed.length === 0) return false;
  return chain[0] === trimmed[0];
}

export { DAY_MS };
