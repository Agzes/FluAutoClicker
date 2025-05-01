`last update: 01.05`


# FluAutoClicker – Build Instructions

This guide will walk you through setting up, building, and optionally publishing (Build .exe in 1 file (like release in github)) the **FluAutoClicker** WinUI 3 application.

---

## 1. Prerequisites

- **Visual Studio 2022** (latest version recommended)
- **.NET 8.0 SDK** (Windows 10.0.19041.0+)
- Internet connection for downloading dependencies

---

## 2. Create a New WinUI 3 Project

Follow the official Microsoft guide:  [Create your first WinUI 3 app](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/create-your-first-winui3-app)

- **Project Name:** `FluAutoClicker` (recommended to avoid namespace issues)
- **Framework:** `.NET 8.0 (Windows 10.0.19041.0+)`

---

## 3. Add Provided Code and Assets

1. Overwrite the following files in your project with the versions from this repository:
    - `App.xaml`
    - `App.xaml.cs`
    - `MainWindow.xaml`
    - `MainWindow.xaml.cs`
2. Place `logo.ico` and `logo.png` into the `Assets/` folder.

---

## 4. Install NuGet Packages and Configure Project

1. Add the following NuGet packages to your project:
    - `System.Drawing.Common`
    - `Microsoft.Windows.SDK.BuildTools`
    - `Microsoft.WindowsAppSDK`
2. (Optional, for self-contained single EXE publishing) Add these lines to your `.csproj`:
    ```xml
    <WindowsAppSDKSelfContained>true</WindowsAppSDKSelfContained>
    <WindowsPackageType>None</WindowsPackageType>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    ```
3. Remove the following line from your `.csproj` file if present:
    ```xml
    <WindowsPackageType>MSIX</WindowsPackageType>
    ```

---

## 5. Build and Run

1. In Visual Studio, select the **Release** configuration and your target platform (e.g., **x64**).
2. Press **F5** to run, or select **Build → Build Solution** to compile the application.

---

## 6. Publish (Optional)

To create a self-contained single executable (EXE) without packaging:

### Using Command Line

1. Open **Developer Command Prompt for VS 2022**.
2. Navigate to your project directory:
    ```bash
    cd path\to\FluAutoClicker
    ```
3. Run the following command:
    ```bash
    dotnet publish ^
      --configuration Release ^
      --framework net8.0-windows10.0.19041.0 ^
      --runtime win-x64 ^
      /p:PublishSingleFile=true ^
      /p:PublishTrimmed=true ^
      /p:PublishReadyToRun=true ^
      --self-contained true
    ```
4. The published files will be located in:
    ```
    bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\
    ```

### Using Visual Studio UI

1. Go to **Build → Publish**.
2. Configure the following settings:
    - **Publish method:** Folder
    - **Target framework:** .NET 8.0 (Windows 10.0.19041.0+)
    - **Target runtime:** win-x64
    - **Publish single file:** true
3. Click **Publish**

---

## License

This project is licensed under the [GNU General Public License](LICENSE).

