const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

const createWindow = () => {

    mainWindow = new BrowserWindow({
        width: 1024,
        height: 720,
        autoHideMenuBar: true,
        resizable: false,
        frame: true,
        movable: true,
        backgroundColor: '#fff',
        icon: path.join(__dirname, 'dist-web', 'resources', 'images', 'logo.png'), // linux
        // icon: path.join(__dirname, 'dist-web', 'resources', 'images', 'logo.ico'), // windows
        // icon: path.join(__dirname, 'dist-web', 'resources', 'images', 'logo.icns'), // mac
        webPreferences: {
            nodeIntegration: true, // not used in electron v12
            contextIsolation: false, // required in electron v12
            enableRemoteModule: true,
        }
    });

    const zoom = {
        label: 'Zoom',
        visible: false,
        acceleratorWorksWhenHidden: true,
        submenu: [
            {
                label: 'Zoom In',
                // role: 'zoomIn',
                accelerator: 'CommandOrControl++',
            },
            {
                label: 'Zoom Out',
                // role: 'zoomOut',
                accelerator: 'CommandOrControl+-',
            },
            {
                label: 'Zoom Reset',
                // role: 'resetZoom',
                accelerator: 'CommandOrControl+0',
            },
        ]
    };

    const edit = {
        label: 'Edit',
        visible: true,
        submenu: [
            {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            },
            {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }
        ]
    };

    const topMenu = {
        label: app.getName(),
        submenu: [
            // { role: 'hide' },
            // { role: 'hideothers' },
            // { role: 'unhide' },
            // { type: 'separator' },
            { role: 'quit' }
        ]
    }

    const menuTemplate = [
        topMenu,
        zoom,
        edit
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);

    Menu.setApplicationMenu(menu);

    // mainWindow.loadURL('http://localhost:9999').catch(_error => null);
    mainWindow.loadFile('dist-web/index.html').catch(_error => null);
    // mainWindow.webContents.openDevTools()

    mainWindow.on('close', event => {
        event.preventDefault();

        if (mainWindow) {
            mainWindow.webContents.send('storeDataAndCloseApp') // eslint-disable-line
        } else {
            app.quit();
        }
    });
}

app.whenReady()
    .then(_response => {

        createWindow();

        ipcMain.handle('getLocale', () => { return app.getLocale() });
        ipcMain.handle('getPath', (_event, dir) => { return app.getPath(dir) }); // eslint-disable-line
        ipcMain.on('showSaveDialog', (event, options) => {
            event.returnValue = dialog.showSaveDialogSync(options); // eslint-disable-line
        });
    })
    .catch(_error => null);

/*
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow() }
});
*/

ipcMain.on('closeApp', () => {
    if (mainWindow) { mainWindow.removeAllListeners('close') }; // eslint-disable-line
    mainWindow = undefined;
    app.quit();
});
