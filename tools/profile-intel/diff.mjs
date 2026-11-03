// Minimal line-based unified diff (LCS), for the dry-run artifacts and the
// weekly report. Inputs are a few hundred lines, so O(n*m) is fine.

export function unifiedDiff(a, b, { from = 'a', to = 'b', context = 3 } = {}) {
  if (a === b) return '';
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      ops.push([' ', x[i], i, j]);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      ops.push(['-', x[i], i, j]);
      i++;
    } else {
      ops.push(['+', y[j], i, j]);
      j++;
    }
  }
  while (i < n) ops.push(['-', x[i], i++, j]);
  while (j < m) ops.push(['+', y[j], i, j++]);

  const out = [`--- ${from}`, `+++ ${to}`];
  let k = 0;
  while (k < ops.length) {
    if (ops[k][0] === ' ') {
      k++;
      continue;
    }
    let s = Math.max(0, k - context);
    let e = k;
    // extend the hunk while changes are within 2*context lines of each other
    for (;;) {
      while (e < ops.length && ops[e][0] !== ' ') e++;
      let look = e;
      while (look < ops.length && ops[look][0] === ' ' && look - e < 2 * context) look++;
      if (look < ops.length && ops[look][0] !== ' ') {
        e = look;
        continue;
      }
      break;
    }
    const stop = Math.min(ops.length, e + context);
    const hunk = ops.slice(s, stop);
    const aStart = hunk[0][2] + 1;
    const bStart = hunk[0][3] + 1;
    const aLen = hunk.filter((o) => o[0] !== '+').length;
    const bLen = hunk.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) out.push(`${o[0]}${o[1]}`);
    k = stop;
  }
  return `${out.join('\n')}\n`;
}

export function diffStat(a, b) {
  const d = unifiedDiff(a, b);
  let added = 0;
  let removed = 0;
  for (const line of d.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}
