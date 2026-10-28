const { randomUUID } = require('node:crypto');
const { cleanProfile } = require('./store.cjs');
const layouts = new Set(['single', 'columns', 'rows', 'grid']);
function saveWorkspace(store, sessions, input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || !Array.isArray(input.sessionIds) || !input.sessionIds.length || input.sessionIds.length > 100) throw new Error('Çalışma alanına ad verin ve en az bir oturum açın.');
  const entries = input.sessionIds.map(id => { const s = sessions.get(id); return { profile: cleanProfile(s.profile), sourceId: id }; });
  const selected = Array.isArray(input.targets) ? input.targets : [];
  const workspace = { id: /^[a-z0-9-]{1,80}$/i.test(input.id || '') ? input.id : randomUUID(), name: input.name.trim().slice(0, 100), layout: layouts.has(input.layout) ? input.layout : 'single', entries: entries.map(e => e.profile), targets: selected.map(id => entries.findIndex(e => e.sourceId === id)).filter(n => n >= 0).slice(0, 4), active: Math.max(0, entries.findIndex(e => e.sourceId === input.active)) };
  store.data.workspaces ||= []; const index = store.data.workspaces.findIndex(w => w.id === workspace.id); if (index < 0) store.data.workspaces.push(workspace); else store.data.workspaces[index] = workspace;
  store.flush(); return workspace;
}
async function openWorkspace(store, sessions, id) {
  const workspace = store.data.workspaces?.find(w => w.id === id); if (!workspace) throw new Error('Çalışma alanı bulunamadı.');
  const opened = [], errors = [], ids = [];
  for (const snapshot of workspace.entries) {
    try { const profile = store.list().find(p => p.id === snapshot.id) || snapshot; const session = await sessions.open(profile); opened.push(session); ids.push(session.id); }
    catch (error) { ids.push(null); errors.push(`${snapshot.name}: ${error.message}`); }
  }
  return { sessions: opened, errors, layout: workspace.layout, targets: workspace.targets.map(i => ids[i]).filter(Boolean), active: ids[workspace.active] || opened[0]?.id || 'home' };
}
module.exports = { saveWorkspace, openWorkspace };
