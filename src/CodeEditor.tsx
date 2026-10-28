import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';

function language(filename: string) {
  const ext = filename.split('.').at(-1)?.toLowerCase();
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(ext || '')) return javascript({ typescript: ext === 'ts' || ext === 'tsx', jsx: ext === 'jsx' || ext === 'tsx' });
  if (ext === 'py') return python(); if (ext === 'json') return json(); if (ext === 'sql') return sql(); if (['html','htm'].includes(ext || '')) return html(); if (ext === 'css') return css(); if (['sh','bash','zsh'].includes(ext || '')) return StreamLanguage.define(shell); if (['yml','yaml'].includes(ext || '')) return StreamLanguage.define(yaml); return [];
}
const appearance = (dark: boolean) => EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Cascadia Code, Consolas, monospace', lineHeight: '1.6' }, '.cm-content': { padding: '12px 0' }, '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--line)' }, '.cm-cursor': { borderLeftColor: 'var(--accent)' }, '.cm-activeLine,.cm-activeLineGutter': { backgroundColor: 'var(--hover)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-bg)' }, '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' }, '.cm-textfield': { backgroundColor: 'var(--input)', color: 'var(--text)', borderColor: 'var(--line)' }, '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--raised)', color: 'var(--text)' } }, { dark });
export function CodeEditor({ path, text, theme, change, save }: { path: string; text: string; theme: string; change: (value: string) => void; save: () => void }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView|null>(null), callbacks = useRef({ change, save }), look = useRef(new Compartment()); callbacks.current = { change, save };
  useEffect(() => { if (!host.current) return; const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions: [EditorState.phrases.of({ 'Find': 'Ara', 'Replace': 'Değiştir', 'next': 'Sonraki', 'previous': 'Önceki', 'all': 'Tümü', 'match case': 'Büyük/küçük harf', 'regexp': 'Düzenli ifade', 'by word': 'Tam sözcük', 'replace': 'Değiştir', 'replace all': 'Tümünü değiştir', 'close': 'Kapat', 'Go to line': 'Satıra git', 'go': 'Git' }), basicSetup, language(path), look.current.of(appearance(theme !== 'light')), EditorView.contentAttributes.of({ 'aria-label': 'Dosya içeriği' }), keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.save(); return true; } }, indentWithTab]), EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.change(update.state.doc.toString()); })] }) }); view.current = editor; return () => { editor.destroy(); view.current = null; }; }, [path]);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } }); }, [text]);
  useEffect(() => { view.current?.dispatch({ effects: look.current.reconfigure(appearance(theme !== 'light')) }); }, [theme]);
  return <div className="code-editor" ref={host}/>;
}
