const { contextBridge, ipcRenderer } = require('electron');

// Exponer APIs seguras al renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Obtener información del sistema
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getLocalDbPath: () => ipcRenderer.invoke('get-local-db-path'),

  // Exportar/Importar base de datos
  exportDatabase: () => ipcRenderer.invoke('export-database'),
  importDatabase: () => ipcRenderer.invoke('import-database'),

  // Abrir PDF con visor del sistema
  openPDF: (pdfData) => ipcRenderer.invoke('open-pdf', pdfData),

  // Información de la plataforma
  platform: process.platform,
  isElectron: true
});

console.log('Preload script loaded successfully');
