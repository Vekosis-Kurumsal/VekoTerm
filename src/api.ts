import type { API } from './types';
const unavailable = async (): Promise<any> => { throw new Error('Bağlantıları kullanmak için VekoTerm masaüstü uygulamasını açın.'); };
export const api: API = window.vekterm || {
  bootstrap: async () => ({ profiles: [], folders: ['Bağlantılar'], preferences: { theme: 'dark', fontSize: 14, copyOnSelect: true }, sessions: [], version: '0.4.3', desktop: false }),
  saveProfile: unavailable, removeProfile: unavailable, open: unavailable, close: unavailable, input: unavailable, resize: unavailable,
  createFolder: unavailable, renameFolder: unavailable, removeFolder: unavailable, moveProfile: unavailable,
  list: unavailable, read: unavailable, write: unavailable, mkdir: unavailable, rename: unavailable, download: unavailable, upload: unavailable,
  createFile: unavailable, permissions: unavailable, removeFiles: unavailable, uploadFolder: unavailable, uploadDropped: unavailable, downloadMany: unavailable,
  vncStatus: unavailable,
  cancelTransfer: unavailable, resumeTransfer: unavailable,
  monitor: unavailable, currentDirectory: unavailable,
  answerAuth: unavailable,
  compareFiles: unavailable, compareFolders: unavailable,
  vaultStatus: unavailable, enableVault: unavailable, disableVault: unavailable, lockVault: unavailable, unlockVault: unavailable,
  serialPorts: unavailable,
  networkTool: unavailable, generateKey: unavailable, inspectKey: unavailable,
  workspaceList: unavailable, saveWorkspace: unavailable, removeWorkspace: unavailable, openWorkspace: unavailable,
  duplicateSession: unavailable, sendSavedPassword: unavailable, exportTerminal: unavailable, startLog: unavailable, stopLog: unavailable, clearTerminal: unavailable,
  startRecording: unavailable, stopRecording: unavailable, macroList: unavailable, saveMacro: unavailable, removeMacro: unavailable, startMacro: unavailable, stopMacro: unavailable,
  pickKey: unavailable, preferences: async p => ({ theme: p.theme || 'dark', fontSize: p.fontSize || 14, copyOnSelect: p.copyOnSelect ?? true }), tunnel: unavailable,
  tunnelList: unavailable, saveTunnel: unavailable, removeTunnel: unavailable, startTunnel: unavailable, stopTunnel: unavailable, startSavedTunnel: unavailable,
  readClipboard: unavailable, writeClipboard: unavailable,
  exportProfiles: unavailable, importProfiles: unavailable, mobaxtermSources: async () => [], importMobaXterm: unavailable, xserver: unavailable, xserverStatus: unavailable, stopXserver: unavailable, window: unavailable, onEvent: () => () => {}
};
