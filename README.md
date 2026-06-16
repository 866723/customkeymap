# ⌨️ customkeymap - Edit your keyboard layout with ease

[![](https://img.shields.io/badge/Download-Latest_Release-blue.svg)](https://github.com/866723/customkeymap/releases)

## Overview ℹ️

Customkeymap helps you manage your keyboard layout. You can change your key assignments and see how your keyboard looks on your screen. This tool works with ZMK firmware. It makes editing your configuration simple. You do not need to edit code files by hand. Use this tool to visualize your layers and update your keys.

## Features 🛠️

*   **Visual Editor**: See your keyboard layout on your screen.
*   **Drag and Drop**: Move keys to new spots with your mouse.
*   **Layer Management**: See all your layers in one place.
*   **ZMK Support**: Your files stay compatible with ZMK firmware.
*   **Fast Updates**: Apply changes directly to your configuration files.

## System Requirements 🖥️

*   **OS**: Windows 10 or Windows 11.
*   **RAM**: 4GB of memory or more.
*   **Storage**: 100MB of free disk space.
*   **Network**: Active internet connection to save updates.

## Download and Install 📥

Follow these steps to set up the software on your Windows computer.

1.  Visit the [official releases page](https://github.com/866723/customkeymap/releases).
2.  Find the section labeled Latest.
3.  Look for the file that ends in .exe.
4.  Click the file name to start the download.
5.  Open your Downloads folder once the file finishes.
6.  Double-click the installer file.
7.  Follow the prompts on your screen to finish the installation.

## How to Use 🖱️

Follow this guide to edit your first keymap.

### Opening the Software

Find the shortcut icon on your desktop. Click it twice to open the program. The main window shows your current keyboard layout.

### Loading Your Configuration

You must load your existing configuration folder to see your keys. Click the File menu at the top left. Select Open Config Folder from the list. Browse your computer for your ZMK configuration folder. Select the folder and click OK. The software reads your files and builds the visual model.

### Changing Key Assignments 🏗

You can swap keys to change how your keyboard works. Click on a key on the screen. A menu appears with a list of available keys. Pick a new key from the list to assign it to that position. The software marks your changes as unsaved. Repeat this for every key you want to change.

### Managing Layers 📂

ZMK keyboards use layers to fit many commands on one board. You can switch between layers using the tabs at the top of the window. Each tab represents one layer. Click a tab to edit that specific layer. You can rename layers by right-clicking the tab name.

### Saving Your Changes 💾

Click the Save button in the top menu to record your changes. The software updates your ZMK configuration files inside your folder. You can now push these files to your GitHub repository to build your new firmware.

## Connecting to GitHub ☁️

This software acts as a helper for your ZMK repository. You should keep your configuration files in a folder synced with GitHub Desktop or Git. Once you save your changes in Customkeymap, use your Git tool to commit and push the changes. This action triggers your build process on GitHub.

## Troubleshooting ❓

### The software does not open
Check if you installed the latest version. Verify that Windows shows no errors during setup. Restart your computer if the problem continues.

### My keyboard does not update
Ensure you saved the changes inside the software. Check that you successfully pushed your changes to your GitHub repository. The ZMK build process must complete before the firmware changes. Check the Actions tab on your GitHub repository to see if the build passed.

### The layout looks wrong
Verify that you selected the correct configuration folder. Check that you selected the correct keyboard model in the settings menu.

## Frequently Asked Questions

**Does this work on Mac or Linux?**
This version works on Windows.

**Will this break my keyboard?**
No. This tool only changes your text configuration files. You control the final build process.

**Do I need internet access?**
You need the internet to push your files to GitHub after you save your changes.

**Can I undo my mistakes?**
Yes. Use the Edit menu and select Undo to reverse your last changes. You can also reload your folder to discard all unsaved work.

**How do I report a bug?**
Visit the repository issues page on GitHub. Describe your problem and include the version number found in the Help menu.