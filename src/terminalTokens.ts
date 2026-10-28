export const terminalColors = {
  prompt: '#70d6b6', command: '#7dcfff', option: '#bb9af7', string: '#e5c07b',
  error: '#ff7b86', warning: '#e7bd65', success: '#88d498', info: '#79b8f3',
  address: '#c5a6f7', path: '#88c9db'
} as const;
export type TerminalToken = { start: number; end: number; kind: keyof typeof terminalColors };

// Recognize familiar prompts without assuming that every output line is a command.
const prompt = /^(?:\([^)\r\n]+\)\s*)?(?:[^\s@]+@[^\s:]+:[^\r\n]*?[$#%]|\[[^\]\r\n]*@[^\]\r\n]+\][$#%]|PS\s+[^>\r\n]*>|[A-Za-z]:\\[^>\r\n]*>|[$#%])(?:\s+|$)/u;
const words: [RegExp, TerminalToken['kind']][] = [
  [/(?<![\p{L}\p{N}_])(?:errors?|fatal|critical|failed|failure|exception|traceback|denied|panic|not found|hata|başar[ıi]s[ıi]z)(?![\p{L}\p{N}_])/giu, 'error'],
  [/(?<![\p{L}\p{N}_])(?:warn(?:ing)?|deprecated|uyar[ıi])(?![\p{L}\p{N}_])/giu, 'warning'],
  [/(?<![\p{L}\p{N}_])(?:ok|success(?:ful(?:ly)?)?|succeeded|passed|done|completed|başar[ıi]l[ıi]|tamamland[ıi])(?![\p{L}\p{N}_])/giu, 'success'],
  [/(?<![\p{L}\p{N}_])(?:info|bilgi)(?![\p{L}\p{N}_])/giu, 'info']
];

// Script output often opens with an upper-case status: "YONETICI ATANDI   Örnek Kullanıcı -> …", "ESLENMEDI aksesuar", "SISTEM: prod".
// The label is coloured by meaning; column headers such as "NAME   READY   STATUS" are left alone.
const labelWord = '[\\p{Lu}][\\p{Lu}\\p{N}_]+';
const labelPattern = new RegExp(`^\\s{0,4}(${labelWord}(?: ${labelWord}){0,3})`, 'u');
const capsWord = new RegExp(`^${labelWord}$`, 'u');
const errorLabel = /(?:HATA|BA[ŞS]ARISIZ|ERROR|FAIL(?:ED|URE)?|FATAL|[İI]PTAL|REDDED[İI]LD[İI]|DENIED)/u;
const warningLabel = /(?:ATLANDI|SKIP(?:PED)?|UYARI|WARN(?:ING)?|\bYOK\b|EKS[İI]K|BEKL[İI]YOR|BULUNAMADI|M[EA]D[IİI](?=\s|$))/u;
const successLabel = /(?:\bTAMAM\b|\bOK\b|BA[ŞS]ARILI|\bDONE\b|SUCCESS|PASS(?:ED)?|[DT][IİUÜ]$)/u;
function statusLabel(text: string): TerminalToken | null {
  const match = labelPattern.exec(text);
  if (!match) return null;
  const label = match[1], start = match[0].length - label.length, end = match[0].length, rest = text.slice(end);
  if (label.replace(/[^\p{L}]/gu, '').length < 2 || (rest && !/^[\s:|]/.test(rest)) || /^\s*[=(.[]/.test(rest)) return null;
  const next = rest.match(/^\s+(\S+)/)?.[1];
  if (next && capsWord.test(next)) return null;
  const kind = errorLabel.test(label) ? 'error' : warningLabel.test(label) ? 'warning' : successLabel.test(label) ? 'success' : 'info';
  if (!rest.trim() && kind === 'info') return null;
  return { start, end, kind };
}

export function terminalTokens(text: string): TerminalToken[] {
  const tokens: TerminalToken[] = [];
  const add = (start: number, end: number, kind: TerminalToken['kind']) => {
    if (end > start && tokens.length < 256) tokens.push({ start, end, kind });
  };
  const matched = prompt.exec(text);
  if (matched) {
    add(0, matched[0].trimEnd().length, 'prompt');
    const offset = matched[0].length;
    const command = text.slice(offset);
    const lexemes = /"(?:\\.|[^"\\])*"?|'[^']*'?|[|;&]{1,2}|(?:\\.|[^\s|;&])+/g;
    let wantCommand = true, optionValue = false;
    for (const item of command.matchAll(lexemes)) {
      const word = item[0], start = offset + item.index!;
      if (/^[|;&]+$/.test(word)) { wantCommand = true; optionValue = false; continue; }
      if (/^['"]/.test(word)) { add(start, start + word.length, 'string'); if (wantCommand && !optionValue) wantCommand = false; optionValue = false; continue; }
      if (/^-{1,2}[\p{L}?]/u.test(word)) {
        add(start, start + (word.includes('=') ? word.indexOf('=') : word.length), 'option');
        optionValue = wantCommand && ['-u', '-g', '-h', '--user', '--group', '--host'].includes(word);
        continue;
      }
      if (optionValue) { optionValue = false; continue; }
      if (wantCommand && !/^[A-Za-z_]\w*=/.test(word)) {
        add(start, start + word.length, 'command');
        wantCommand = ['sudo', 'doas', 'env', 'command', 'nohup', 'exec'].includes(word);
      }
    }
    for (const item of command.matchAll(/\$(?:\{[^}\r\n]+\}|[A-Za-z_]\w*|[?#!@$0-9])/g)) add(offset + item.index!, offset + item.index! + item[0].length, 'option');
  } else {
    const label = statusLabel(text);
    if (label) add(label.start, label.end, label.kind);
    for (const [pattern, kind] of words) for (const item of text.matchAll(pattern)) add(item.index!, item.index! + item[0].length, kind);
  }
  for (const item of text.matchAll(/https?:\/\/[^\s<>"']+/g)) add(item.index!, item.index! + item[0].length, 'info');
  for (const item of text.matchAll(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g)) {
    if (item[0].split('.').every(n => Number(n) <= 255)) add(item.index!, item.index! + item[0].length, 'address');
  }
  for (const item of text.matchAll(/(?:^|[\s=(])((?:~?\/|[A-Za-z]:\\)[^\s<>"'|;,]*)/g)) {
    const start = item.index! + item[0].length - item[1].length;
    add(start, start + item[1].length, 'path');
  }
  return tokens;
}
