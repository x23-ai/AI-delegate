// Minimal arithmetic evaluator with support for k/M/B suffixes, commas, currency symbols,
// and simple patterns like "X% of Y".

function toNumberWithSuffix(token: string): number {
  const clean = token.replace(/[,$_\s]/g, '').replace(/^\$/g, '');
  const m = clean.match(/^([+-]?[0-9]*\.?[0-9]+)([kKmMbB]|mm|bn)?$/i);
  if (m) {
    const n = parseFloat(m[1]);
    const s = m[2]?.toLowerCase();
    if (s === 'k') return n * 1e3;
    if (s === 'm' || s === 'mm') return n * 1e6;
    if (s === 'b' || s === 'bn') return n * 1e9;
    return n;
  }
  // Percent as standalone number (e.g., "5%") handled upstream in rewrite
  const asNum = Number(clean);
  if (Number.isFinite(asNum)) return asNum;
  throw new Error(`Unrecognized numeric token: ${token}`);
}

function rewritePercentOf(expr: string): string {
  // Replace patterns like "A% of B" with "(A/100)*B"
  return expr.replace(/([0-9]+(?:\.[0-9]+)?)\s*%\s*of\s*([0-9$,.kKmMbB_\s]+)/gi, (_m, p1, p2) => {
    try {
      const y = toNumberWithSuffix(p2.trim());
      const x = parseFloat(p1);
      return `(${x}/100*${y})`;
    } catch {
      return _m; // leave as-is if parse fails
    }
  });
}

function rewriteSuffixes(expr: string): string {
  // Replace tokens like 1.2M, 300k, 1B with their numeric expansions
  return expr.replace(/\$?[0-9][0-9$,_\.]*[kKmMbB]?/g, (tok) => {
    try {
      const n = toNumberWithSuffix(tok);
      return String(n);
    } catch {
      return tok;
    }
  });
}

function rewriteBps(expr: string): string {
  // Replace patterns like "50 bps" with (50/10000)
  return expr.replace(/([0-9]+(?:\.[0-9]+)?)\s*bps?\b/gi, (_m, p1) => {
    const x = parseFloat(p1);
    if (!isFinite(x)) return _m;
    return `(${x}/10000)`;
  });
}

function rewriteWordScales(expr: string): string {
  // Replace "1.2 million" → 1200000, "3 billion" → 3000000000, "5 thousand" → 5000
  return expr.replace(/([0-9]+(?:\.[0-9]+)?)\s*(million|billion|thousand)\b/gi, (_m, p1, scale) => {
    const n = parseFloat(p1);
    const s = String(scale).toLowerCase();
    if (s === 'million') return String(n * 1e6);
    if (s === 'billion') return String(n * 1e9);
    if (s === 'thousand') return String(n * 1e3);
    return _m;
  });
}

function rewriteAprToApy(expr: string): string {
  // Replace patterns like "APR 5% monthly" with numeric APY value.
  // APY = (1 + APR/n)^n - 1
  const map: Record<string, number> = {
    daily: 365,
    weekly: 52,
    monthly: 12,
    quarterly: 4,
    annually: 1,
    yearly: 1,
    annual: 1,
  };
  return expr.replace(/apr\s*([0-9]+(?:\.[0-9]+)?)%\s*(?:compounded\s*)?(daily|weekly|monthly|quarterly|annually|yearly|annual)\b/gi, (_m, aprStr, freqStr) => {
    try {
      const apr = parseFloat(aprStr) / 100;
      const n = map[String(freqStr).toLowerCase()] || 1;
      const apy = Math.pow(1 + apr / n, n) - 1;
      return String(apy);
    } catch {
      return _m;
    }
  }).replace(/apy\s*from\s*apr\s*([0-9]+(?:\.[0-9]+)?)%\s*(?:compounded\s*)?(daily|weekly|monthly|quarterly|annually|yearly|annual)\b/gi, (_m, aprStr, freqStr) => {
    try {
      const apr = parseFloat(aprStr) / 100;
      const n = map[String(freqStr).toLowerCase()] || 1;
      const apy = Math.pow(1 + apr / n, n) - 1;
      return String(apy);
    } catch {
      return _m;
    }
  });
}

function normalizeAsciiMath(s: string): string {
  if (!s) return '';
  // Normalize common Unicode math operators and punctuation to ASCII
  return String(s)
    .replace(/[\u2212\u2012-\u2015\u2013\u2014]/g, '-') // minus and dashes → '-'
    .replace(/[\u00D7\u2715\u2716\u22C5\u2219\u00B7]/g, '*') // multiplication signs/center dot → '*'
    .replace(/[\u00F7\u2044\u2215]/g, '/') // division signs/fraction slash → '/'
    .replace(/[\uFF08]/g, '(') // fullwidth (
    .replace(/[\uFF09]/g, ')') // fullwidth )
    .replace(/[\u2009\u202F\u200A\u200B\u2005\u00A0]/g, ' ') // thin/nb spaces → space
    .replace(/[^\x00-\x7F]/g, (ch) => ch); // leave other unicode as-is
}

export function evaluateExpression(input: string): number {
  // Basic normalization
  let expr = normalizeAsciiMath(input);
  expr = rewriteAprToApy(expr);
  expr = rewriteWordScales(expr);
  expr = rewriteBps(expr);
  expr = rewritePercentOf(expr);
  expr = rewriteSuffixes(expr);

  // Tokenize simple math
  const tokens: string[] = [];
  const re = /\d+\.?\d*|[()+\-*/]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) tokens.push(m[0]);

  // Shunting-yard to RPN
  const out: string[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const isOp = (t: string) => ['+', '-', '*', '/'].includes(t);
  for (const t of tokens) {
    if (/^\d/.test(t)) {
      out.push(t);
    } else if (isOp(t)) {
      while (ops.length && isOp(ops[ops.length - 1]) && prec[ops[ops.length - 1]] >= prec[t]) {
        out.push(ops.pop()!);
      }
      ops.push(t);
    } else if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      if (ops[ops.length - 1] === '(') ops.pop();
    }
  }
  while (ops.length) out.push(ops.pop()!);

  // Evaluate RPN
  const st: number[] = [];
  for (const t of out) {
    if (/^\d/.test(t)) {
      st.push(parseFloat(t));
    } else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Invalid expression');
      switch (t) {
        case '+':
          st.push(a + b);
          break;
        case '-':
          st.push(a - b);
          break;
        case '*':
          st.push(a * b);
          break;
        case '/':
          st.push(a / b);
          break;
      }
    }
  }
  if (st.length !== 1) throw new Error('Invalid expression');
  return st[0];
}

export function nearlyEqual(a: number, b: number, relTol = 1e-6, absTol = 1e-6): boolean {
  const diff = Math.abs(a - b);
  return diff <= Math.max(relTol * Math.max(Math.abs(a), Math.abs(b)), absTol);
}

export { normalizeAsciiMath };
