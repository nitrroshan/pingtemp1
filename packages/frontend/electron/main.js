
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#020617', // nexus-950
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // Crucial for the Agent Browser capability
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // In production, this would load the build file.
  // In development, it loads the dev server url (e.g. localhost:3000)
  // For this demo, we'll try to load index.html if packaged, or localhost if dev.
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  
  // If running from file:
  // mainWindow.loadFile(path.join(__dirname, '../index.html'));
  
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
