// {name} placeholders in macros, the same rule as the main process: a name starts with a letter and the braces stand
// alone, so shell braces such as {{.Names}}, ${HOME} and '{print $1}' are left as they are.
const VARIABLE = /(?<![$\{])\{(\p{L}[\p{L}\p{N}_-]{0,39})\}(?!\})/gu;
export const macroVariables = (text: string) => [...new Set([...text.matchAll(VARIABLE)].map(m => m[1]))];
export const fillMacro = (text: string, values: Record<string, string>) => text.replace(VARIABLE, (whole, name: string) => values[name] || whole);
