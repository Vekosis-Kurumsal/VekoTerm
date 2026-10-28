import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from './api';
import type { AuthChallenge } from './types';
export function AuthDialog({ challenge }: { challenge: AuthChallenge }) {
  const [answers, setAnswers] = useState(challenge.prompts.map(() => '')), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (value: string[]|null) => { setBusy(true); try { await api.answerAuth(challenge.id, value); } catch (e: any) { setError(e.message); setBusy(false); } };
  return <div className="modal-backdrop auth-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="SSH kimlik doğrulama"><header className="dialog-header"><h2><KeyRound size={18}/> {challenge.title || 'SSH kimlik doğrulama'}</h2></header><form onSubmit={e => { e.preventDefault(); void submit(answers); }}><div className="dialog-body">{challenge.instructions && <p>{challenge.instructions}</p>}{challenge.prompts.map((prompt, index) => <label key={index}>{prompt.prompt}<input autoFocus={index === 0} autoComplete="off" type={prompt.echo ? 'text' : 'password'} value={answers[index]} onChange={e => setAnswers(previous => previous.map((value, i) => i === index ? e.target.value : value))}/></label>)}{error && <div className="error-message" role="alert">{error}</div>}</div><footer className="dialog-footer"><button className="text-button" type="button" disabled={busy} onClick={() => submit(null)}>Vazgeç</button><button className="button primary" disabled={busy}>{busy ? 'Doğrulanıyor…' : 'Devam et'}</button></footer></form></section></div>;
}
