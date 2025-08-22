export type PromptVars = Record<string, string | number | undefined | null>;

export function applyPromptTemplate(text: string, vars: PromptVars): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

