using System;
using System.Collections.Generic;
using Windows.Foundation;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System.Runtime.InteropServices;
using WinRT.Interop;
using System.Threading.Tasks;
using System.Diagnostics;
using Windows.System;
using Microsoft.UI.Text;
using System.Threading;
using DispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue;
using Microsoft.UI;
using System.Net.Http;
using System.IO;
using System.Text;  

//  ╭━━━┳╮  ╭╮ ╭╮
//  ┃╭━━┫┃  ┃┃ ┃┃
//  ┃╰━━┫┃  ┃┃ ┃┃
//  ┃╭━━┫┃ ╭┫┃ ┃┃
//  ┃┃  ┃╰━╯┃╰━╯┃
//  ╰╯  ╰━━━┻━━━╯𝗔𝘂𝘁𝗼𝗖𝗹𝗶𝗰𝗸𝗲𝗿 [𝟭.𝟬]

namespace FluAutoClicker
{
    public static class DispatcherQueueExtensions
    {
        public static Task EnqueueAsync(this DispatcherQueue dispatcherQueue, Func<Task> callback)
        {
            var taskCompletionSource = new TaskCompletionSource();
            dispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    await callback();
                    taskCompletionSource.SetResult();
                }
                catch (Exception ex)
                {
                    taskCompletionSource.SetException(ex);
                }
            });
            return taskCompletionSource.Task;
        }
    }

    [Flags]
    public enum ModifierKeys : uint
    {
        None = 0x0000,
        Alt = 0x0001,
        Control = 0x0002,
        Shift = 0x0004,
        Win = 0x0008
    }

    public enum DWMWINDOWATTRIBUTE : uint
    {
        DWMWA_USE_IMMERSIVE_DARK_MODE = 20
    }

    public enum MouseButton
    {
        Left,
        Middle,
        Right
    }

    public enum RepeatMode
    {
        Infinite,
        Times,
        Seconds
    }

    public enum CursorPositionMode
    {
        Current,
        Fixed
    }

    public enum MouseButtonHoldClick
    {
        Click,
        Hold
    }

    public enum JigglerMode
    {
        Random, 
        Circular, 
        OZone     
    }   

    public enum ClickerMode
    {
        Single,
        MultiThread
    }

    public sealed partial class MainWindow : Window
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetPrivateProfileString(string section, string key, string defaultValue,StringBuilder retVal, int size, string filePath);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern long WritePrivateProfileString(string section, string key, string value, string filePath);
        [DllImport("user32.dll")]
        private static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);
        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);
        private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
        private static extern IntPtr SetWindowLongPtr32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll")]
        private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, DWMWINDOWATTRIBUTE attribute, ref int pvAttribute, int cbAttribute);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll")]
        private static extern int GetDpiForWindow(IntPtr hWnd);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("User32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern int SendMessage(IntPtr hWnd, uint msg, int wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        private static string ExeDirectory => Path.GetDirectoryName(Process.GetCurrentProcess().MainModule?.FileName ?? Environment.ProcessPath)!;
        public const int ICON_SMALL = 0;
        public const int ICON_BIG = 1;
        public const int ICON_SMALL2 = 2;
        public const int WM_GETICON = 0x007F;
        public const int WM_SETICON = 0x0080;
        private readonly string _iniPath = Path.Combine(ExeDirectory, "FluAutoClicker.ini");
        private bool _isClicking = false;
        private DispatcherTimer _clickTimer;
        private DispatcherTimer _countdownTimer;
        private Random _random = new Random();
        private Stopwatch _stopwatch = new Stopwatch();
        private int _clickCount = 0;
        private int _targetClicks = 0;
        private int _targetSeconds = 0;
        private int _countdownValue = 5;
        private bool _isCountingDown = false;
        private ClickerMode _clickerMode = ClickerMode.Single;
        private int _threadCount = 1;
        private List<Task> _clickerThreads = new List<Task>();
        private CancellationTokenSource _cancellationTokenSource;
        private JigglerMode _jiggleMode = JigglerMode.Random;
        private MouseButtonHoldClick _mouseButtonHoldClick = MouseButtonHoldClick.Click;
        private MouseButton _selectedMouseButton = MouseButton.Left;
        private RepeatMode _repeatMode = RepeatMode.Infinite;
        private CursorPositionMode _cursorMode = CursorPositionMode.Current;
        private Point _fixedCursorPosition = new Point(0, 0);
        private Point _oZoneCenterPoint = new Point(0, 0);
        private bool _oZoneCenterSet = false;
        private int _hours = 0;
        private int _minutes = 0;
        private int _seconds = 0;
        private int _milliseconds = 0;
        private int _randomOffset = 0;
        private bool _alwaysOnTop = false;
        private bool _jiggleEnabled = false;
        private int _jiggleRadius = 5;
        private double _circularAngle = 0;
        private VirtualKey _hotkeyKey = VirtualKey.F7;
        private ModifierKeys _hotkeyModifiers = ModifierKeys.None;
        private int _hotkeyId = 1;
        private bool _hotkeysRegistered = false;
        private const int WM_HOTKEY = 0x0312;
        private const int MOUSEEVENTF_LEFTDOWN = 0x02;
        private const int MOUSEEVENTF_LEFTUP = 0x04;
        private const int MOUSEEVENTF_MIDDLEDOWN = 0x20;
        private const int MOUSEEVENTF_MIDDLEUP = 0x40;
        private const int MOUSEEVENTF_RIGHTDOWN = 0x08;
        private const int MOUSEEVENTF_RIGHTUP = 0x10;
        private bool _updatingFromSlider = false;
        private bool _updatingFromTimeValues = false;
        private const int WM_NCLBUTTONDBLCLK = 0x00A3;
        private const int HTCAPTION = 2;
        private const int GWLP_WNDPROC = -4;
        private IntPtr _oldWndProc;
        private WndProcDelegate _newWndProc;
        private const int WS_SIZEBOX = 0x00040000;
        private const int WS_MAXIMIZEBOX = 0x00010000;
        private const int GWL_STYLE = -16;
        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOSIZE = 0x0001;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private bool _isInitialized = false;
        private bool _isDialogOpen = false;
        private bool _isHotkeyDialogOpen = false;
        private bool _isAboutDialogOpen = false;
        private const string _currentVersion = "1.0";
        private const string _versionCheckUrl = "https://raw.githubusercontent.com/Agzes/FluAutoClicker/refs/heads/main/version";
        private bool _updateAvailable = true;
        private string _latestVersion = _currentVersion;
        private bool _isButtonCurrentlyHeld = false;
        private CancellationTokenSource _holdCancellationTokenSource;

        private void SetupKeyboardAccelerators()
        {
            RegisterGlobalHotkey();
        }
        private void RegisterGlobalHotkey()
        {
            var hwnd = WindowNative.GetWindowHandle(this);
            if (_hotkeysRegistered)
            {
                UnregisterHotKey(hwnd, _hotkeyId);
                _hotkeysRegistered = false;
            }
            uint modifiers = (uint)_hotkeyModifiers;
            uint vk = (uint)_hotkeyKey;

            if (RegisterHotKey(hwnd, _hotkeyId, modifiers, vk))
            {
                _hotkeysRegistered = true;
            }
            else
            {
                ShowInfoBar("Hotkey Error", "Failed to register global hotkey. It may be in use by another application.", InfoBarSeverity.Error);
            }
        }
        private void NumberBox_Loaded(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
        {
            if (sender is not NumberBox numberBox ||
                VisualTreeHelper.GetChild(numberBox, 0) is not Grid grid ||
                VisualTreeHelper.GetChild(grid, 0) is not TextBox inputBox)
            {
                return;
            }
            inputBox.MinWidth = numberBox.ActualWidth;
        }
        private void CPS_Slider_ValueChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
        {
            if (CPSTextBlock == null || _updatingFromSlider) return;

            _updatingFromSlider = true;
            try
            {
                double value = CPS_Slider.Value;
                if (value >= 101)
                {
                    CPSTextBlock.Text = " ∞ CPS";
                    HoursBox.Value = 0;
                    MinutesBox.Value = 0;
                    SecondsBox.Value = 0;
                    MillisecondsBox.Value = 0;
                }
                else if (value <= 1)
                {
                    int baseInterval = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;
                    if (baseInterval <= 0) baseInterval = 1;

                    double defCPS = 1000.0 / baseInterval;
                    defCPS = Math.Round(defCPS, 2);

                    if (_randomOffset > 0)
                    {
                        int minInterval = baseInterval + _randomOffset;
                        int maxInterval = Math.Max(1, baseInterval - _randomOffset);
                        double minCPS = Math.Round(1000.0 / minInterval, 2);
                        double maxCPS = Math.Round(1000.0 / maxInterval, 2);

                        if (maxInterval < 10) maxCPS = Math.Min(maxCPS, 100.0);

                        CPSTextBlock.Text = baseInterval / 1000 > 1 
                            ? $" <1 CPS ({minCPS} - {maxCPS})" 
                            : $" {defCPS} CPS ({minCPS} - {maxCPS})";
                    }
                    else
                    {
                        CPSTextBlock.Text = baseInterval / 1000 > 1 ? " <1 CPS" : $" {defCPS} CPS";
                    }
                }
                else
                {
                    double roundedValue = Math.Round(value, 2);
                    int totalMs = (int)(1000 / value);

                    HoursBox.Value = 0;
                    MinutesBox.Value = 0;
                    SecondsBox.Value = totalMs / 1000;
                    MillisecondsBox.Value = totalMs % 1000;

                    _hours = 0;
                    _minutes = 0;
                    _seconds = totalMs / 1000;
                    _milliseconds = totalMs % 1000;

                    if (_randomOffset > 0)
                    {
                        int baseInterval = totalMs;
                        int minInterval = baseInterval + _randomOffset;
                        int maxInterval = Math.Max(1, baseInterval - _randomOffset);
                        double minCPS = Math.Round(1000.0 / minInterval, 2);
                        double maxCPS = Math.Round(1000.0 / maxInterval, 2);

                        if (maxInterval < 10) maxCPS = Math.Min(maxCPS, 100.0);

                        CPSTextBlock.Text = baseInterval / 1000 > 1 
                            ? $" <1 CPS ({minCPS} - {maxCPS})" 
                            : $" {roundedValue} CPS ({minCPS} - {maxCPS})";
                    }
                    else
                    {
                        CPSTextBlock.Text = totalMs / 1000 > 1 ? " <1 CPS" : $" {roundedValue} CPS";
                    }
                }
            }
            finally
            {
                _updatingFromSlider = false;
            }
        }
        private IntPtr NewWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == WM_HOTKEY && wParam.ToInt32() == _hotkeyId)
            {
                ToggleAutoClicker();
                return IntPtr.Zero;
            }

            if (msg == WM_NCLBUTTONDBLCLK && wParam.ToInt32() == HTCAPTION)
            {
                return IntPtr.Zero;
            }

            return CallWindowProc(_oldWndProc, hWnd, msg, wParam, lParam);
        }
        private void MainWindow_Activated(object sender, WindowActivatedEventArgs args)
        {
            if (!_isInitialized)
            {
                _isInitialized = true;
                _ = CheckForUpdatesAsync();
                IntPtr hWnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
                string sExe = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
                System.Drawing.Icon ico = System.Drawing.Icon.ExtractAssociatedIcon(sExe);
                SendMessage(hWnd, WM_SETICON, ICON_BIG, ico.Handle);
            }
        }
        public MainWindow()
        {
            this.InitializeComponent();
            this.Activated += MainWindow_Activated;

            this.Closed += (_, __) => SaveSettings();

            LoadSettings();

            ExtendsContentIntoTitleBar = true;

            var hwnd = WindowNative.GetWindowHandle(this);
            var dpi = GetDpiForWindow(hwnd);

            int currentStyle = GetWindowLong(hwnd, GWL_STYLE);
            currentStyle &= ~WS_SIZEBOX;
            SetWindowLong(hwnd, GWL_STYLE, currentStyle);

            SetWindowPos(hwnd, IntPtr.Zero, 100, 100, 500, 650, SWP_NOZORDER);

            currentStyle = GetWindowLong(hwnd, GWL_STYLE);
            currentStyle &= ~WS_MAXIMIZEBOX;
            SetWindowLong(hwnd, GWL_STYLE, currentStyle);

            int useDarkMode = 1;
            DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDarkMode, Marshal.SizeOf(typeof(int)));

            _newWndProc = new WndProcDelegate(NewWindowProc);
            _oldWndProc = SetWindowLongPtr(hwnd, GWLP_WNDPROC, Marshal.GetFunctionPointerForDelegate(_newWndProc));

            _clickTimer = new DispatcherTimer();
            _clickTimer.Tick += ClickTimer_Tick;

            _countdownTimer = new DispatcherTimer();
            _countdownTimer.Interval = TimeSpan.FromSeconds(1);
            _countdownTimer.Tick += CountdownTimer_Tick;

            InitializeUIElements();
            SetupKeyboardAccelerators();
        }
        private void LoadSettings()
        {
            var sb = new StringBuilder(256);

            GetPrivateProfileString("General", "HotkeyKey", "F7", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out VirtualKey hk))
                _hotkeyKey = hk;

            GetPrivateProfileString("General", "HotkeyModifiers", "0", sb, sb.Capacity, _iniPath);
            if (uint.TryParse(sb.ToString(), out uint mods))
                _hotkeyModifiers = (ModifierKeys)mods;

            GetPrivateProfileString("General", "AlwaysOnTop", "false", sb, sb.Capacity, _iniPath);
            if (bool.TryParse(sb.ToString(), out bool aot))
            {
                _alwaysOnTop = aot;
                ToggleAlwaysOnTop(_alwaysOnTop);
            }

            GetPrivateProfileString("Jiggler", "Enabled", "false", sb, sb.Capacity, _iniPath);
            bool.TryParse(sb.ToString(), out _jiggleEnabled);
            GetPrivateProfileString("Jiggler", "Radius", "5", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _jiggleRadius);
            GetPrivateProfileString("Jiggler", "Mode", "Random", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out JigglerMode jm))
                _jiggleMode = jm;

            GetPrivateProfileString("Clicker", "Mode", "Single", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out ClickerMode cm))
                _clickerMode = cm;
            GetPrivateProfileString("Clicker", "ThreadCount", "1", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _threadCount);

            GetPrivateProfileString("Timing", "Hours", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _hours);
            GetPrivateProfileString("Timing", "Minutes", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _minutes);
            GetPrivateProfileString("Timing", "Seconds", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _seconds);
            GetPrivateProfileString("Timing", "Milliseconds", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _milliseconds);
            GetPrivateProfileString("Timing", "RandomOffset", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out _randomOffset);

            GetPrivateProfileString("Repeat", "Mode", "Infinite", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out RepeatMode rm))
                _repeatMode = rm;
            GetPrivateProfileString("Repeat", "Value", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out int repeatVal);
            if (_repeatMode == RepeatMode.Times) _targetClicks = repeatVal;
            else if (_repeatMode == RepeatMode.Seconds) _targetSeconds = repeatVal;

            GetPrivateProfileString("Cursor", "Mode", "Current", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out CursorPositionMode cmode))
                _cursorMode = cmode;
            GetPrivateProfileString("Cursor", "FixedX", "0", sb, sb.Capacity, _iniPath);
            double.TryParse(sb.ToString(), out double fx);
            GetPrivateProfileString("Cursor", "FixedY", "0", sb, sb.Capacity, _iniPath);
            double.TryParse(sb.ToString(), out double fy);
            _fixedCursorPosition = new Point(fx, fy);

            GetPrivateProfileString("Mouse", "Button", "Left", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out MouseButton mb))
                _selectedMouseButton = mb;
            GetPrivateProfileString("Mouse", "HoldClick", "Click", sb, sb.Capacity, _iniPath);
            if (Enum.TryParse(sb.ToString(), out MouseButtonHoldClick mh))
                _mouseButtonHoldClick = mh;
            GetPrivateProfileString("Mouse", "HoldDuration", "0", sb, sb.Capacity, _iniPath);
            int.TryParse(sb.ToString(), out int holdMs);
            MouseButtonHoldBox.Value = holdMs;

            ApplySettingsToUI();
        }
        private void ApplySettingsToUI()
        {
            _updatingFromTimeValues = true;
            HoursBox.Value = _hours;
            MinutesBox.Value = _minutes;
            SecondsBox.Value = _seconds;
            MillisecondsBox.Value = _milliseconds;
            _updatingFromTimeValues = false;

            RandomOffsetBox.Value = _randomOffset;

            _updatingFromSlider = true;
            CPS_Slider.Value = CalculateCpsFromTime(_hours, _minutes, _seconds, _milliseconds, _randomOffset);
            _updatingFromSlider = false;
            CPS_Slider_ValueChanged(CPS_Slider, null);

            UpdateStartButtonText();

            MouseButtonComboBox.SelectedIndex = (int)_selectedMouseButton;
            MouseButtonHoldClickComboBox.SelectedIndex = (int)_mouseButtonHoldClick;
            UpdateClickHoldVisibility();
            MouseButtonHoldClickComboBox.IsEnabled = (_clickerMode == ClickerMode.Single);

            RepeatModeComboBox.SelectedIndex = (int)_repeatMode;
            UpdateRepeatModeVisibility();
            RepeatValueBox.Value = _repeatMode == RepeatMode.Times
                ? _targetClicks
                : _targetSeconds;

            CurrentLocationRadio.IsChecked = _cursorMode == CursorPositionMode.Current;
            FixedLocationRadio.IsChecked = _cursorMode == CursorPositionMode.Fixed;
            UpdateCursorPositionVisibility();
            XPositionBox.Value = _fixedCursorPosition.X;
            YPositionBox.Value = _fixedCursorPosition.Y;

            ToggleAlwaysOnTop(_alwaysOnTop);
        }
        private double CalculateCpsFromTime(int hours, int minutes, int seconds, int ms, int randomOffset)
        {
            int baseInterval = (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
            if (baseInterval <= 0) return 101; // ∞ CPS
            double cps = 1000.0 / baseInterval;
            return randomOffset > 0 && cps <= 1 ? 1 : Math.Min(Math.Round(cps, 2), 100);
        }
        private void SaveSettings()
        {
            WritePrivateProfileString("General", "HotkeyKey", _hotkeyKey.ToString(), _iniPath);
            WritePrivateProfileString("General", "HotkeyModifiers", ((uint)_hotkeyModifiers).ToString(), _iniPath);
            WritePrivateProfileString("General", "AlwaysOnTop", _alwaysOnTop.ToString(), _iniPath);
            WritePrivateProfileString("Jiggler", "Enabled", _jiggleEnabled.ToString(), _iniPath);
            WritePrivateProfileString("Jiggler", "Radius", _jiggleRadius.ToString(), _iniPath);
            WritePrivateProfileString("Jiggler", "Mode", _jiggleMode.ToString(), _iniPath);
            WritePrivateProfileString("Clicker", "Mode", _clickerMode.ToString(), _iniPath);
            WritePrivateProfileString("Clicker", "ThreadCount", _threadCount.ToString(), _iniPath);
            WritePrivateProfileString("Timing", "Hours", _hours.ToString(), _iniPath);
            WritePrivateProfileString("Timing", "Minutes", _minutes.ToString(), _iniPath);
            WritePrivateProfileString("Timing", "Seconds", _seconds.ToString(), _iniPath);
            WritePrivateProfileString("Timing", "Milliseconds", _milliseconds.ToString(), _iniPath);
            WritePrivateProfileString("Timing", "RandomOffset", _randomOffset.ToString(), _iniPath);
            WritePrivateProfileString("Repeat", "Mode", _repeatMode.ToString(), _iniPath);
            int repeatVal = _repeatMode == RepeatMode.Times ? _targetClicks : _targetSeconds;
            WritePrivateProfileString("Repeat", "Value", repeatVal.ToString(), _iniPath);
            WritePrivateProfileString("Cursor", "Mode", _cursorMode.ToString(), _iniPath);
            WritePrivateProfileString("Cursor", "FixedX", _fixedCursorPosition.X.ToString(), _iniPath);
            WritePrivateProfileString("Cursor", "FixedY", _fixedCursorPosition.Y.ToString(), _iniPath);
            WritePrivateProfileString("Mouse", "Button", _selectedMouseButton.ToString(), _iniPath);
            WritePrivateProfileString("Mouse", "HoldClick", _mouseButtonHoldClick.ToString(), _iniPath);
            WritePrivateProfileString("Mouse", "HoldDuration", MouseButtonHoldBox.Value.ToString(), _iniPath);
        }
        private bool IsCursorOverOwnWindow()
        {
            var hwnd = WindowNative.GetWindowHandle(this);

            if (IsIconic(hwnd))
                return false;

            if (!GetWindowRect(hwnd, out RECT rect))
                return false;

            GetCursorPos(out POINT p);

            return p.X >= rect.Left && p.X <= rect.Right &&
                   p.Y >= rect.Top && p.Y <= rect.Bottom;
        }
        private void InitializeUIElements()
        {
            HoursBox.ValueChanged += TimeValue_Changed;
            MinutesBox.ValueChanged += TimeValue_Changed;
            SecondsBox.ValueChanged += TimeValue_Changed;
            MillisecondsBox.ValueChanged += TimeValue_Changed;
            RandomOffsetBox.ValueChanged += RandomOffset_Changed;

            MouseButtonComboBox.SelectionChanged += MouseButtonComboBox_SelectionChanged;
            MouseButtonHoldClickComboBox.SelectionChanged += MouseButtonHoldClickComboBox_SelectionChanged;

            RepeatModeComboBox.SelectionChanged += RepeatModeComboBox_SelectionChanged;
            RepeatValueBox.ValueChanged += RepeatValue_Changed;

            CurrentLocationRadio.Checked += CursorPosition_Changed;
            FixedLocationRadio.Checked += CursorPosition_Changed;
            XPositionBox.ValueChanged += CursorPosition_ValueChanged;
            YPositionBox.ValueChanged += CursorPosition_ValueChanged;
            GetPositionButton.Click += GetPositionButton_Click;

            StartButton.Click += StartButton_Click;
            HotkeyButton.Click += HotkeyButton_Click;
            SettingsButton.Click += SettingsButton_Click;
            jigglerMenuButton.Click += JigglerMenuButton_Click;
            MultiThreadMenuButton.Click += MultiThreadMenuButton_Click;

            StatusBarText.Opacity = 0.7;
            StatusBarText.PointerEntered += (s, _) => StatusBarText.Opacity = 1;
            StatusBarText.PointerExited += (s, _) => { StatusBarText.Opacity = 0.7; };
            StatusBarText.Tapped += StatusBarText_Tapped;

            UpdateRepeatModeVisibility();
            UpdateCursorPositionVisibility();
            UpdateStartButtonText();
        }
        private async Task CheckForUpdatesAsync()
        {
            try
            {
                using HttpClient client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                string raw = await client.GetStringAsync(_versionCheckUrl);
                if (string.IsNullOrWhiteSpace(raw)) return;

                _latestVersion = raw.Trim();
                Version remote = new Version(_latestVersion);
                Version local = new Version(_currentVersion);

                if (remote > local)
                {
                    _updateAvailable = true;

                    await this.DispatcherQueue.EnqueueAsync(() =>
                    {
                        StatusBarText.Text = "Update Found • Click to Information";
                        StatusBarText.Foreground = new SolidColorBrush(Colors.Khaki);
                        StatusBarText.Opacity = 1;
                        return Task.CompletedTask;
                    });
                }
            }
            catch {}
        }
        private async void StatusBarText_Tapped(object sender, TappedRoutedEventArgs e)
        {
            if (_updateAvailable)
                await ShowUpdateDialog();
        }
        private async Task ShowUpdateDialog()
        {
            if (_isDialogOpen) return;
            _isDialogOpen = true;

            try
            {
                ContentDialog updateDialog = new ContentDialog
                {
                    Title = "Update Available!",
                    PrimaryButtonText = "Close",
                    XamlRoot = this.Content.XamlRoot,
                    Width = 420,
                    DefaultButton = ContentDialogButton.Primary
                };

                StackPanel panel = new StackPanel
                {
                    Spacing = 12,
                    Margin = new Thickness(20, 10, 20, 0)
                };

                panel.Children.Add(new TextBlock
                {
                    Text = $"A new version {_latestVersion} is available.\n ",
                    TextWrapping = TextWrapping.Wrap,
                    FontSize = 14,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(0, 0, 0, 6)
                });

                panel.Children.Add(new TextBlock
                {
                    Text = $"{_currentVersion} -> {_latestVersion}",
                    TextWrapping = TextWrapping.Wrap,
                    FontSize = 14,
                    FontWeight = FontWeights.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(0, 0, 0, 6)
                });

                Button repoBtn = new Button
                {
                    Content = "Open Repository",
                    HorizontalAlignment = HorizontalAlignment.Stretch
                };
                repoBtn.Click += async (_, __) =>
                {
                    await Launcher.LaunchUriAsync(
                        new Uri("https://github.com/Agzes/FluAutoClicker"));
                };

                Button dlBtn = new Button
                {
                    Content = "Direct Download",
                    HorizontalAlignment = HorizontalAlignment.Stretch
                };
                dlBtn.Click += async (_, __) =>
                {
                    await Launcher.LaunchUriAsync(
                        new Uri("https://github.com/Agzes/FluAutoClicker/releases/latest/download/FluAutoClicker.exe"));
                };

                panel.Children.Add(repoBtn);
                panel.Children.Add(dlBtn);

                updateDialog.Content = panel;
                await updateDialog.ShowAsync();
            }
            finally
            {
                _isDialogOpen = false;
            }
        }
        private void ToggleAlwaysOnTop(bool alwaysOnTop)
        {
            var hwnd = WindowNative.GetWindowHandle(this);
            SetWindowPos(hwnd, alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,SWP_NOMOVE | SWP_NOSIZE);
        }
        private void RandomOffset_Changed(object sender, NumberBoxValueChangedEventArgs e)
        {
            _randomOffset = (int)(RandomOffsetBox.Value);
            CPS_Slider_ValueChanged(CPS_Slider, null);
        }
        private async void TimeValue_Changed(object sender, NumberBoxValueChangedEventArgs e)
        {
            int totalMs = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;

            _hours = (int)HoursBox.Value;
            _minutes = (int)(MinutesBox.Value);
            _seconds = (int)(SecondsBox.Value);
            _milliseconds = (int)(MillisecondsBox.Value);

            int totalMs2 = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;

            if (totalMs2 > 0)
            {
                double cps = 1000.0 / totalMs2;

                if (Math.Abs(CPS_Slider.Value - cps) > 0.01 && cps <= 100)
                {
                    _updatingFromSlider = true;
                    CPS_Slider.Value = cps;
                    _updatingFromSlider = false;

                    double roundedValue = Math.Round(cps, 2);

                    if (_randomOffset > 0)
                    {
                        int minInterval = totalMs2 + _randomOffset;
                        int maxInterval = Math.Max(1, totalMs2 - _randomOffset);
                        double minCPS = Math.Round(1000.0 / minInterval, 2);
                        double maxCPS = Math.Round(1000.0 / maxInterval, 2);

                        if (maxInterval < 10) maxCPS = Math.Min(maxCPS, 100.0);

                        CPSTextBlock.Text = totalMs2 / 1000 > 1 
                            ? $" <1 CPS ({minCPS} - {maxCPS})" 
                            : $" {roundedValue} CPS ({minCPS} - {maxCPS})";
                    }
                    else
                    {
                        CPSTextBlock.Text = totalMs2 / 1000 > 1 ? " <1 CPS" : $" {roundedValue} CPS";
                    }
                }
                else if (cps > 100)
                {
                    _updatingFromSlider = true;
                    CPS_Slider.Value = 101;
                    _updatingFromSlider = false;
                    CPSTextBlock.Text = " ∞ CPS";
                }
            }
            else
            {
                _updatingFromSlider = true;
                CPS_Slider.Value = 101;
                _updatingFromSlider = false;
                CPSTextBlock.Text = " ∞ CPS";
            }
        }
        private void MouseButtonHoldClickComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _mouseButtonHoldClick = (MouseButtonHoldClick)MouseButtonHoldClickComboBox.SelectedIndex;
            UpdateClickHoldVisibility();
        }
        private void UpdateClickHoldVisibility()
        {
            if (_mouseButtonHoldClick == MouseButtonHoldClick.Click)
            {
                MouseButtonHoldBox.Visibility = Visibility.Collapsed;
                MouseButtonHoldMsText.Visibility = Visibility.Collapsed;
                MouseButtonHoldClickComboBox.Width = 167;
            }
            else
            {
                MouseButtonHoldBox.Visibility = Visibility.Visible;
                MouseButtonHoldMsText.Visibility = Visibility.Visible;
                MouseButtonHoldClickComboBox.Width = 110;
            }
        }
        private void MouseButtonComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _selectedMouseButton = (MouseButton)MouseButtonComboBox.SelectedIndex;
        }
        private void RepeatModeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _repeatMode = (RepeatMode)RepeatModeComboBox.SelectedIndex;
            UpdateRepeatModeVisibility();
        }
        private void UpdateRepeatModeVisibility()
        {
            if (_repeatMode == RepeatMode.Infinite)
            {
                RepeatValueBox.Visibility = Visibility.Collapsed;
                RepeatValueLabel.Visibility = Visibility.Collapsed;
                RepeatModeComboBox.Width = 439;
                RepeatModeComboBox.HorizontalAlignment = HorizontalAlignment.Stretch;
            }
            else
            {
                RepeatValueBox.Visibility = Visibility.Visible;
                RepeatValueLabel.Visibility = Visibility.Visible;
                RepeatModeComboBox.Width = 351;
                RepeatModeComboBox.HorizontalAlignment = HorizontalAlignment.Left;
                RepeatValueLabel.Text = _repeatMode == RepeatMode.Times ? "x:" : "s:";
            }
        }
        private void RepeatValue_Changed(object sender, NumberBoxValueChangedEventArgs e)
        {
            if (_repeatMode == RepeatMode.Times)
                _targetClicks = (int)(RepeatValueBox.Value);
            else if (_repeatMode == RepeatMode.Seconds)
                _targetSeconds = (int)(RepeatValueBox.Value);
        }
        private void CursorPosition_Changed(object sender, RoutedEventArgs e)
        {
            _cursorMode = CurrentLocationRadio.IsChecked == true 
                ? CursorPositionMode.Current
                : CursorPositionMode.Fixed;

            UpdateCursorPositionVisibility();
        }
        private void UpdateCursorPositionVisibility()
        {
            if (_cursorMode == CursorPositionMode.Current)
            {
                XPositionBox.Visibility = Visibility.Collapsed;
                YPositionBox.Visibility = Visibility.Collapsed;
                GetPositionButton.Visibility = Visibility.Collapsed;
            }
            else
            {
                XPositionBox.Visibility = Visibility.Visible;
                YPositionBox.Visibility = Visibility.Visible;
                GetPositionButton.Visibility = Visibility.Visible;
            }
        }
        private void CursorPosition_ValueChanged(object sender, NumberBoxValueChangedEventArgs e)
        {
            _fixedCursorPosition.X = XPositionBox.Value;
            _fixedCursorPosition.Y = YPositionBox.Value;
        }
        private void GetPositionButton_Click(object sender, RoutedEventArgs e)
        {
            if (_isCountingDown) return;

            _isCountingDown = true;
            _countdownValue = 5;
            UpdateGetPositionButtonText();
            _countdownTimer.Start();
        }
        private void CountdownTimer_Tick(object sender, object e)
        {
            _countdownValue--;

            if (_countdownValue <= 0)
            {
                _countdownTimer.Stop();
                _isCountingDown = false;

                GetCursorPos(out POINT point);
                XPositionBox.Value = point.X;
                YPositionBox.Value = point.Y;
                _fixedCursorPosition.X = point.X;
                _fixedCursorPosition.Y = point.Y;

                GetPositionButton.Content = "\uE8B0";
                GetPositionButton.FontFamily = PlayIcon.FontFamily;
            }
            else
            {
                UpdateGetPositionButtonText();
            }
        }
        private void UpdateGetPositionButtonText()
        {
            GetPositionButton.Content = $"{_countdownValue}";
            GetPositionButton.FontFamily = FontFamily.XamlAutoFontFamily;
        }
        private void StartButton_Click(object sender, RoutedEventArgs e)
        {
            ToggleAutoClicker();
        }
        private void ToggleAutoClicker()
        {
            if (_isClicking)
            {
                StopAutoClicker();
            }
            else
            {
                StartAutoClicker();
            }
        }
        private async void ClickTimer_Tick(object sender, object e)
        {
            if ((_repeatMode == RepeatMode.Times && _clickCount >= _targetClicks) ||
                (_repeatMode == RepeatMode.Seconds && _stopwatch.ElapsedMilliseconds >= _targetSeconds * 1000))
            {
                StopAutoClicker();
                return;
            }

            _clickTimer.Stop();

            if (!(_mouseButtonHoldClick == MouseButtonHoldClick.Hold && _isButtonCurrentlyHeld))
            {
                await PerformClickAsync();
                _clickCount++;
            }

            if (_randomOffset > 0)
            {
                int baseInterval = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;
                int randomizedInterval = baseInterval + _random.Next(-_randomOffset, _randomOffset + 1);
                if (randomizedInterval < 1) randomizedInterval = 1;
                _clickTimer.Interval = TimeSpan.FromMilliseconds(randomizedInterval);
            }

            if (_isClicking)
            {
                _clickTimer.Start();
            }
        }
        private async Task PerformClickAsync()
        {
            if (_cursorMode == CursorPositionMode.Current && IsCursorOverOwnWindow())
                return;

            if (_cursorMode == CursorPositionMode.Fixed)
            {
                SetCursorPos((int)_fixedCursorPosition.X, (int)_fixedCursorPosition.Y);
            }
            else if (_jiggleEnabled)
            {
                ApplyJiggle();
            }

            if (_mouseButtonHoldClick == MouseButtonHoldClick.Hold)
            {
                _holdCancellationTokenSource = new CancellationTokenSource();
                var token = _holdCancellationTokenSource.Token;

                try
                {
                    int downFlag = GetMouseDownFlag();
                    int upFlag = GetMouseUpFlag();

                    // Press the button down
                    mouse_event(downFlag, 0, 0, 0, 0);
                    _isButtonCurrentlyHeld = true;

                    try
                    {
                        await Task.Delay((int)MouseButtonHoldBox.Value, token);
                    }
                    catch (TaskCanceledException) {}

                    mouse_event(upFlag, 0, 0, 0, 0);
                    _isButtonCurrentlyHeld = false;
                }
                catch (Exception)
                {
                    mouse_event(GetMouseUpFlag(), 0, 0, 0, 0);
                    _isButtonCurrentlyHeld = false;
                }
            }
            else
            {
                mouse_event(GetMouseEventFlags(), 0, 0, 0, 0);
            }
        }
        private int GetMouseDownFlag()
        {
            return _selectedMouseButton switch
            {
                MouseButton.Left => MOUSEEVENTF_LEFTDOWN,
                MouseButton.Middle => MOUSEEVENTF_MIDDLEDOWN,
                MouseButton.Right => MOUSEEVENTF_RIGHTDOWN,
                _ => MOUSEEVENTF_LEFTDOWN
            };
        }
        private int GetMouseUpFlag()
        {
            return _selectedMouseButton switch
            {
                MouseButton.Left => MOUSEEVENTF_LEFTUP,
                MouseButton.Middle => MOUSEEVENTF_MIDDLEUP,
                MouseButton.Right => MOUSEEVENTF_RIGHTUP,
                _ => MOUSEEVENTF_LEFTUP
            };
        }
        private int GetMouseEventFlags()
        {
            return _selectedMouseButton switch
            {
                MouseButton.Left => MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP,
                MouseButton.Middle => MOUSEEVENTF_MIDDLEDOWN | MOUSEEVENTF_MIDDLEUP,
                MouseButton.Right => MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP,
                _ => MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP
            };
        }
        private void StartAutoClicker()
        {
            if (_isClicking) return;

            if (_clickerMode == ClickerMode.MultiThread)
            {
                StartMultiThreadClicker();
            }
            else
            {
                _isClicking = true;
                _clickCount = 0;
                UpdateStartButtonText();

                if (_cursorMode == CursorPositionMode.Current)
                {
                    _oZoneCenterSet = false;
                }

                int interval = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;
                if (interval <= 0) interval = 1;

                _clickTimer.Interval = TimeSpan.FromMilliseconds(interval);

                if (_repeatMode == RepeatMode.Seconds)
                {
                    _stopwatch.Reset();
                    _stopwatch.Start();
                }

                _clickTimer.Start();
            }
        }
        private void ReleaseHeldMouseButton()
        {
            if (_isButtonCurrentlyHeld && _mouseButtonHoldClick == MouseButtonHoldClick.Hold)
            {
                int releaseFlag = 0;

                switch (_selectedMouseButton)
                {
                    case MouseButton.Left:
                        releaseFlag = MOUSEEVENTF_LEFTUP;
                        break;
                    case MouseButton.Middle:
                        releaseFlag = MOUSEEVENTF_MIDDLEUP;
                        break;
                    case MouseButton.Right:
                        releaseFlag = MOUSEEVENTF_RIGHTUP;
                        break;
                }

                if (releaseFlag != 0)
                {
                    mouse_event(releaseFlag, 0, 0, 0, 0);
                    _isButtonCurrentlyHeld = false;
                }
            }
        }
        private void StopAutoClicker()
        {
            if (!_isClicking) return;

            if (_clickerMode == ClickerMode.MultiThread)
            {
                StopMultiThreadClicker();
            }
            else
            {
                _isClicking = false;
                _clickTimer.Stop();

                if (_holdCancellationTokenSource != null && !_holdCancellationTokenSource.IsCancellationRequested)
                {
                    _holdCancellationTokenSource.Cancel();
                }

                if (_isButtonCurrentlyHeld)
                {
                    mouse_event(GetMouseUpFlag(), 0, 0, 0, 0);
                    _isButtonCurrentlyHeld = false;
                }

                if (_repeatMode == RepeatMode.Seconds)
                    _stopwatch.Stop();

                UpdateStartButtonText();
            }
        }
        private async void SettingsButton_Click(object sender, RoutedEventArgs e)
        {
            if (_isDialogOpen) return;
            _isDialogOpen = true;

            try
            {
                ContentDialog settingsDialog = new ContentDialog
                {
                    Title = "Settings",
                    PrimaryButtonText = "Close",
                    DefaultButton = ContentDialogButton.Primary,
                    XamlRoot = this.Content.XamlRoot,
                    Width = 400
                };

                StackPanel contentPanel = new StackPanel
                {
                    Spacing = 12,
                    Margin = new Thickness(20, 10, 20, 0)
                };

                Button alwaysOnTopButton = new Button
                {
                    Content = _alwaysOnTop ? "Disable Always On Top" : "Enable Always On Top",
                    HorizontalAlignment = HorizontalAlignment.Stretch
                };

                alwaysOnTopButton.Click += (s, args) =>
                {
                    _alwaysOnTop = !_alwaysOnTop;
                    ToggleAlwaysOnTop(_alwaysOnTop);
                    alwaysOnTopButton.Content = _alwaysOnTop ? "Disable Always On Top" : "Enable Always On Top";
                    
                    ShowInfoBar(
                        _alwaysOnTop ? "Window is now always on top" : "Window is no longer always on top",
                        "",
                        _alwaysOnTop ? InfoBarSeverity.Success : InfoBarSeverity.Warning
                    );
                };

                Button aboutButton = new Button
                {
                    Content = "About FluAutoClicker",
                    HorizontalAlignment = HorizontalAlignment.Stretch
                };

                aboutButton.Click += async (s, args) =>
                {
                    _isDialogOpen = false;
                    settingsDialog.Hide();
                    await Task.Delay(100);
                    await ShowAboutDialog();
                };

                TextBlock noteText = new TextBlock
                {
                    Text = "Note: Settings are saved automatically.",
                    TextWrapping = TextWrapping.Wrap,
                    Opacity = 0.7,
                    Margin = new Thickness(0, 0, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Center
                };

                TextBlock infoText = new TextBlock
                {
                    Text = "The main part of the settings is in the main menu",
                    TextWrapping = TextWrapping.Wrap,
                    Opacity = 0.7,
                    Margin = new Thickness(0, 0, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Center
                };


                contentPanel.Children.Add(infoText);
                contentPanel.Children.Add(alwaysOnTopButton);
                contentPanel.Children.Add(aboutButton);
                contentPanel.Children.Add(noteText);

                settingsDialog.Content = contentPanel;
                await ShowDialogSafelyAsync(settingsDialog);
            }
            finally
            {
                _isDialogOpen = false;
            }
        }
        private async Task ShowAboutDialog()
        {
            if (_isAboutDialogOpen) return;
            _isAboutDialogOpen = true;

            try
            {

                ContentDialog aboutDialog = new ContentDialog
                {
                    Title = null, 
                    PrimaryButtonText = "OK",
                    DefaultButton = ContentDialogButton.Primary,
                    XamlRoot = this.Content.XamlRoot,
                    Width = 420,
                    MinHeight = 320
                };

                StackPanel titlePanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Spacing = 0,
                    Margin = new Thickness(-2, -5, 0, 0)
                };

                titlePanel.Children.Add(new TextBlock
                {
                    Text = "Flu",
                    Margin = new Thickness(0, 1, 0, 0),
                    Foreground = new SolidColorBrush(Colors.LightSkyBlue),
                    FontWeight = FontWeights.Bold,
                    FontSize = 28
                });
                titlePanel.Children.Add(new TextBlock
                {
                    Text = "AutoClicker ",
                    Margin = new Thickness(0, 1, 0, 0),
                    Foreground = new SolidColorBrush(Colors.LightGray),
                    FontSize = 28
                });
                titlePanel.Children.Add(new TextBlock
                {
                    Text = "1.0",
                    VerticalAlignment = VerticalAlignment.Top,
                    FontSize = 14,
                    Margin = new Thickness(0, 0, 0, 0),
                    Foreground = new SolidColorBrush(Colors.Gray)
                });

                StackPanel contentPanel = new StackPanel
                {
                    Spacing = 18,
                    Margin = new Thickness(20, 18, 20, 0)
                };
                contentPanel.Children.Add(titlePanel);

                contentPanel.Children.Add(new TextBlock
                {
                    Text = "A modern, fluent design auto clicker for Windows.",
                    FontSize = 16,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Colors.White),
                    Margin = new Thickness(0, 8, 0, 0)
                });

                contentPanel.Children.Add(new TextBlock
                {
                    Text = "Features:",
                    FontSize = 14,
                    FontWeight = FontWeights.Bold,
                    Margin = new Thickness(0, 10, 0, 0)
                });

                contentPanel.Children.Add(new TextBlock
                {
                    Text = "• Multi-thread clicking (Beta)\n" +
                           "• Customizable hotkeys\n" +
                           "• Mouse jiggler with 3 modes\n" +
                           "• Random intervals\n" +
                           "• Multiple click modes (Hold/Click)\n" +
                           "• Multiple buttons modes (LB/MB/RB)",
                    FontSize = 13,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(8, -10, 0, 0)
                });

                contentPanel.Children.Add(new TextBlock
                {
                    Text = "Developed by Agzes with WinUI 3 on C#",
                    FontStyle = Windows.UI.Text.FontStyle.Italic,
                    Opacity = 0.7,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(0, 18, 0, 0)
                });

                contentPanel.Children.Add(new TextBlock
                {
                    Text = "github.com/Agzes/FluAutoClicker",
                    Opacity = 0.7,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(0, 0, 0, 0)
                });

                aboutDialog.Content = contentPanel;
                await aboutDialog.ShowAsync();
            }
            finally
            {
                _isAboutDialogOpen = false;
            }
        }
        private async Task<ContentDialogResult> ShowDialogSafelyAsync(ContentDialog dialog)
        {
            try
            {
                return await dialog.ShowAsync();
            }
            catch (Exception)
            {
                _isDialogOpen = false;
                throw;
            }
        }
        private async void ShowInfoBar(string title, string message, InfoBarSeverity severity = InfoBarSeverity.Informational)
        {
            InfoBar infoBar = new InfoBar
            {
                Title = title,
                Message = message,
                Severity = severity,
                IsOpen = true,
                VerticalAlignment = VerticalAlignment.Top,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 30, 10, 0),
            };

            var rootGrid = (Grid)this.Content;

            for (int i = rootGrid.Children.Count - 1; i >= 0; i--)
            {
                if (rootGrid.Children[i] is InfoBar)
                {
                    rootGrid.Children.RemoveAt(i);
                }
            }

            rootGrid.Children.Add(infoBar);

            await Task.Delay(7000);
            infoBar.IsOpen = false;
            await Task.Delay(300);
            rootGrid.Children.Remove(infoBar);
        }
        private static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong)
        {
            if (IntPtr.Size == 8)
                return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
            else
                return SetWindowLongPtr32(hWnd, nIndex, dwNewLong);
        }
        private void ApplyJiggle()
        {
            if (!_jiggleEnabled) return;

            GetCursorPos(out POINT currentPos);
            int newX, newY;

            switch (_jiggleMode)
            {
                case JigglerMode.Random:
                    int offsetX = _random.Next(-_jiggleRadius, _jiggleRadius + 1);
                    int offsetY = _random.Next(-_jiggleRadius, _jiggleRadius + 1);
                    newX = currentPos.X + offsetX;
                    newY = currentPos.Y + offsetY;
                    break;

                case JigglerMode.Circular:
                    int circOffsetX = (int)(_jiggleRadius * Math.Cos(_circularAngle));
                    int circOffsetY = (int)(_jiggleRadius * Math.Sin(_circularAngle));
                    _circularAngle += Math.PI / 6;
                    if (_circularAngle >= 2 * Math.PI)
                        _circularAngle -= 2 * Math.PI;
                    newX = currentPos.X + circOffsetX;
                    newY = currentPos.Y + circOffsetY;
                    break;

                case JigglerMode.OZone:
                    if (!_oZoneCenterSet)
                    {
                        _oZoneCenterPoint = new Point(currentPos.X, currentPos.Y);
                        _oZoneCenterSet = true;
                    }

                    double randomAngle = _random.NextDouble() * 2 * Math.PI;
                    double randomFactor = Math.Sqrt(_random.NextDouble());
                    double randomDistance = randomFactor * _jiggleRadius;
                    newX = (int)(_oZoneCenterPoint.X + randomDistance * Math.Cos(randomAngle));
                    newY = (int)(_oZoneCenterPoint.Y + randomDistance * Math.Sin(randomAngle));
                    break;

                default:
                    int defOffsetX = _random.Next(-_jiggleRadius, _jiggleRadius + 1);
                    int defOffsetY = _random.Next(-_jiggleRadius, _jiggleRadius + 1);
                    newX = currentPos.X + defOffsetX;
                    newY = currentPos.Y + defOffsetY;
                    break;
            }

            SetCursorPos(newX, newY);
        }
        private async void JigglerMenuButton_Click(object sender, RoutedEventArgs e)
        {
            await ShowJigglerSettingsDialog();
        }
        private async void HotkeyButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                if (_isHotkeyDialogOpen) return;
                _isHotkeyDialogOpen = true;

                ContentDialog hotkeyDialog = new ContentDialog
                {
                    Title = "Hotkey Settings",
                    PrimaryButtonText = "Save",
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.Primary,
                    XamlRoot = this.Content.XamlRoot
                };

                StackPanel contentPanel = new StackPanel { Spacing = 10 };

                TextBlock instructionText = new TextBlock
                {
                    Text = "Press the key combination you want to use!",
                    Margin = new Thickness(0, 0, 0, 10),
                    TextWrapping = TextWrapping.Wrap
                };
                contentPanel.Children.Add(instructionText);

                VirtualKey newHotkeyKey = VirtualKey.None;
                ModifierKeys newHotkeyModifiers = ModifierKeys.None;

                TextBox hotkeyTextBox = new TextBox
                {   
                    PlaceholderText = "Click here and press your desired key combination",
                    IsReadOnly = true,
                    Text = GetHotkeyDisplayText(_hotkeyKey, _hotkeyModifiers)
                };
                contentPanel.Children.Add(hotkeyTextBox);

                hotkeyTextBox.KeyDown += (s, args) =>
                {
                    args.Handled = true;

                    ModifierKeys currentModifiers = ModifierKeys.None;
                    if (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
                        currentModifiers |= ModifierKeys.Control;
                    if (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Menu).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
                        currentModifiers |= ModifierKeys.Alt;
                    if (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
                        currentModifiers |= ModifierKeys.Shift;
                    if (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.LeftWindows).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down) ||
                        Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.RightWindows).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
                        currentModifiers |= ModifierKeys.Win;

                    if (args.Key == VirtualKey.Control || args.Key == VirtualKey.Menu ||
                        args.Key == VirtualKey.Shift || args.Key == VirtualKey.LeftWindows ||
                        args.Key == VirtualKey.RightWindows)
                    {
                        hotkeyTextBox.Text = BuildHotkeyDisplayText(newHotkeyKey, currentModifiers);
                        return;
                    }

                    newHotkeyKey = args.Key;
                    newHotkeyModifiers = currentModifiers;

                    hotkeyTextBox.Text = BuildHotkeyDisplayText(newHotkeyKey, newHotkeyModifiers);
                };

                string BuildHotkeyDisplayText(VirtualKey key, ModifierKeys modifiers)
                {
                    List<string> parts = new List<string>();

                    if ((modifiers & ModifierKeys.Control) != 0) parts.Add("Ctrl");
                    if ((modifiers & ModifierKeys.Alt) != 0) parts.Add("Alt");
                    if ((modifiers & ModifierKeys.Shift) != 0) parts.Add("Shift");
                    if ((modifiers & ModifierKeys.Win) != 0) parts.Add("Win");

                    if (key != VirtualKey.None &&
                        key != VirtualKey.Control && key != VirtualKey.Menu &&
                        key != VirtualKey.Shift && key != VirtualKey.LeftWindows &&
                        key != VirtualKey.RightWindows)
                    {
                        parts.Add(GetKeyName(key));
                    }

                    return string.Join(" + ", parts);
                }

                TextBlock warningText = new TextBlock
                {
                    Text = "Note: Some system key combinations may not be available for use.",
                    FontStyle = Windows.UI.Text.FontStyle.Italic,
                    TextWrapping = TextWrapping.Wrap,
                    Opacity = 0.7,
                    Margin = new Thickness(0, 10, 0, 0)
                };
                contentPanel.Children.Add(warningText);

                hotkeyDialog.Content = contentPanel;
                ContentDialogResult result = await ShowDialogSafelyAsync(hotkeyDialog);

                if (result == ContentDialogResult.Primary)
                {
                    if (newHotkeyKey != VirtualKey.None && !string.IsNullOrEmpty(hotkeyTextBox.Text))
                    {
                        _hotkeyKey = newHotkeyKey;
                        _hotkeyModifiers = newHotkeyModifiers;
                        RegisterGlobalHotkey();
                        UpdateStartButtonText();
                        ShowInfoBar("Hotkey Updated", $"New hotkey: {GetHotkeyDisplayText()}", InfoBarSeverity.Success);
                    }
                    else
                    {
                        ShowInfoBar("Hotkey Error", "Please select a key for the hotkey", InfoBarSeverity.Warning);
                    }
                }

                _isHotkeyDialogOpen = false;
            }
            catch (Exception ex)
            {
                _isHotkeyDialogOpen = false;
                ShowInfoBar("Hotkey Settings Error", ex.Message, InfoBarSeverity.Error);
            }
        }
        private string GetKeyName(VirtualKey key)
        {
            switch (key)
            {
                case VirtualKey.LeftButton: return "Left Mouse"; 
                case VirtualKey.RightButton: return "Right Mouse";
                case VirtualKey.Cancel: return "Cancel";
                case VirtualKey.MiddleButton: return "Middle Mouse";
                case VirtualKey.Back: return "Backspace";
                case VirtualKey.Tab: return "Tab";
                case VirtualKey.Clear: return "Clear";
                case VirtualKey.Enter: return "Enter";
                case VirtualKey.Pause: return "Pause";
                case VirtualKey.CapitalLock: return "Caps Lock";
                case VirtualKey.Escape: return "Esc";
                case VirtualKey.Space: return "Space";
                case VirtualKey.PageUp: return "Page Up";
                case VirtualKey.PageDown: return "Page Down";
                case VirtualKey.End: return "End";
                case VirtualKey.Home: return "Home";
                case VirtualKey.Left: return "Left";
                case VirtualKey.Up: return "Up";
                case VirtualKey.Right: return "Right";
                case VirtualKey.Down: return "Down";
                case VirtualKey.Select: return "Select";
                case VirtualKey.Print: return "Print";
                case VirtualKey.Execute: return "Execute";
                case VirtualKey.Snapshot: return "Print Screen";
                case VirtualKey.Insert: return "Insert";
                case VirtualKey.Delete: return "Delete";
                case VirtualKey.Help: return "Help";
                case VirtualKey.Number0: return "0";
                case VirtualKey.Number1: return "1";
                case VirtualKey.Number2: return "2";
                case VirtualKey.Number3: return "3";
                case VirtualKey.Number4: return "4";
                case VirtualKey.Number5: return "5";
                case VirtualKey.Number6: return "6";
                case VirtualKey.Number7: return "7";
                case VirtualKey.Number8: return "8";
                case VirtualKey.Number9: return "9";
                case VirtualKey.A: return "A";
                case VirtualKey.B: return "B";
                case VirtualKey.C: return "C";
                case VirtualKey.D: return "D";
                case VirtualKey.E: return "E";
                case VirtualKey.F: return "F";
                case VirtualKey.G: return "G";
                case VirtualKey.H: return "H";
                case VirtualKey.I: return "I";
                case VirtualKey.J: return "J";
                case VirtualKey.K: return "K";
                case VirtualKey.L: return "L";
                case VirtualKey.M: return "M";
                case VirtualKey.N: return "N";
                case VirtualKey.O: return "O";
                case VirtualKey.P: return "P";
                case VirtualKey.Q: return "Q";
                case VirtualKey.R: return "R";
                case VirtualKey.S: return "S";
                case VirtualKey.T: return "T";
                case VirtualKey.U: return "U";
                case VirtualKey.V: return "V";
                case VirtualKey.W: return "W";
                case VirtualKey.X: return "X";
                case VirtualKey.Y: return "Y";
                case VirtualKey.Z: return "Z";
                case VirtualKey.LeftWindows: return "Left Win";
                case VirtualKey.RightWindows: return "Right Win";
                case VirtualKey.Application: return "App";
                case VirtualKey.Sleep: return "Sleep";
                case VirtualKey.NumberPad0: return "NumPad 0";
                case VirtualKey.NumberPad1: return "NumPad 1";
                case VirtualKey.NumberPad2: return "NumPad 2";
                case VirtualKey.NumberPad3: return "NumPad 3";
                case VirtualKey.NumberPad4: return "NumPad 4";
                case VirtualKey.NumberPad5: return "NumPad 5";
                case VirtualKey.NumberPad6: return "NumPad 6";
                case VirtualKey.NumberPad7: return "NumPad 7";
                case VirtualKey.NumberPad8: return "NumPad 8";
                case VirtualKey.NumberPad9: return "NumPad 9";
                case VirtualKey.Multiply: return "NumPad *";
                case VirtualKey.Add: return "NumPad +";
                case VirtualKey.Separator: return "Separator";
                case VirtualKey.Subtract: return "NumPad -";
                case VirtualKey.Decimal: return "NumPad .";
                case VirtualKey.Divide: return "NumPad /";
                case VirtualKey.F1: return "F1";
                case VirtualKey.F2: return "F2";
                case VirtualKey.F3: return "F3";
                case VirtualKey.F4: return "F4";
                case VirtualKey.F5: return "F5";
                case VirtualKey.F6: return "F6";
                case VirtualKey.F7: return "F7";
                case VirtualKey.F8: return "F8";
                case VirtualKey.F9: return "F9";
                case VirtualKey.F10: return "F10";
                case VirtualKey.F11: return "F11";
                case VirtualKey.F12: return "F12";
                case VirtualKey.F13: return "F13";
                case VirtualKey.F14: return "F14";
                case VirtualKey.F15: return "F15";
                case VirtualKey.F16: return "F16";
                case VirtualKey.F17: return "F17";
                case VirtualKey.F18: return "F18";
                case VirtualKey.F19: return "F19";
                case VirtualKey.F20: return "F20";
                case VirtualKey.F21: return "F21";
                case VirtualKey.F22: return "F22";
                case VirtualKey.F23: return "F23";
                case VirtualKey.F24: return "F24";
                case VirtualKey.NavigationView: return "Navigation View";
                case VirtualKey.NavigationMenu: return "Navigation Menu";
                case VirtualKey.NavigationUp: return "Navigation Up";
                case VirtualKey.NavigationDown: return "Navigation Down";
                case VirtualKey.NavigationLeft: return "Navigation Left";
                case VirtualKey.NavigationRight: return "Navigation Right";
                case VirtualKey.NavigationAccept: return "Navigation Accept";
                case VirtualKey.NavigationCancel: return "Navigation Cancel";
                case VirtualKey.NumberKeyLock: return "Num Lock";
                case VirtualKey.Scroll: return "Scroll Lock";
                default: return key.ToString();
            }
        }
        private string GetHotkeyDisplayText(VirtualKey key = default, ModifierKeys modifiers = default)
        {
            if (key == default) key = _hotkeyKey;
            if (modifiers == default) modifiers = _hotkeyModifiers;

            if (key == VirtualKey.None)
                return "";

            List<string> parts = new List<string>();

            if ((modifiers & ModifierKeys.Control) != 0) parts.Add("Ctrl");
            if ((modifiers & ModifierKeys.Alt) != 0) parts.Add("Alt");
            if ((modifiers & ModifierKeys.Shift) != 0) parts.Add("Shift");
            if ((modifiers & ModifierKeys.Win) != 0) parts.Add("Win");

            if (key != VirtualKey.Control && key != VirtualKey.Menu &&
                key != VirtualKey.Shift && key != VirtualKey.LeftWindows &&
                key != VirtualKey.RightWindows)
            {
                string keyName = GetKeyName(key);
                parts.Add(keyName);
            }

            return string.Join(" + ", parts);
        }
        private void UpdateStartButtonText()
        {
            string hotkeyText = GetHotkeyDisplayText();

            StartButton.Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Children =
                {
                    new FontIcon
                    {
                        FontFamily = new FontFamily("Segoe Fluent Icons"),
                        Glyph = _isClicking ? "\uE71A" : "\uE768",
                        FontSize = 12,
                        Margin = new Thickness(0, 0, 5, 0)
                    },
                    new TextBlock
                    {
                        Text = $"{(_isClicking ? "Stop" : "Start")} • {GetHotkeyDisplayText()}",
                        VerticalAlignment = VerticalAlignment.Center,
                        FontWeight = FontWeights.SemiBold
                    }
                }
            };
        }
        private async Task ShowJigglerSettingsDialog()
        {
            ContentDialog jigglerDialog = new ContentDialog
            {
                Title = "Mouse Jiggler Settings",
                PrimaryButtonText = "Save",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
                XamlRoot = this.Content.XamlRoot,
                Width = 400
            };

            StackPanel contentPanel = new StackPanel
            {
                Spacing = 10,
                Margin = new Thickness(20, 10, 20, 0)
            };

            ToggleSwitch jigglerToggle = new ToggleSwitch
            {
                Header = "",
                OnContent = "ON | Mouse Jiggler",
                OffContent = "OFF | Mouse Jiggler",
                IsOn = _jiggleEnabled,
                Margin = new Thickness(0, -10, 0, 10),
                HorizontalAlignment = HorizontalAlignment.Center
            };

            ComboBox modeComboBox = new ComboBox
            {
                Header = "Jiggler Movement Pattern",
                Width = 200,
                IsEnabled = _jiggleEnabled,
                Margin = new Thickness(0, 0, 0, 10),
                HorizontalAlignment = HorizontalAlignment.Center
            };

            modeComboBox.Items.Add(new ComboBoxItem { Content = "Random Movement", Tag = JigglerMode.Random });
            modeComboBox.Items.Add(new ComboBoxItem { Content = "Circular Movement", Tag = JigglerMode.Circular });
            modeComboBox.Items.Add(new ComboBoxItem { Content = "O-Zone Movement", Tag = JigglerMode.OZone });

            modeComboBox.SelectedIndex = (int)_jiggleMode;

            NumberBox radiusBox = new NumberBox
            {
                Header = "Jiggle Radius (pixels)",
                Value = _jiggleRadius,
                Minimum = 1,
                Maximum = 999,
                SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
                Width = 200,
                IsEnabled = _jiggleEnabled,
                Margin = new Thickness(0, 0, 0, 10)
            };

            Button resetOZoneCenterButton = new Button
            {
                Content = "Reset O-Zone Center",
                IsEnabled = _jiggleEnabled && _jiggleMode == JigglerMode.OZone,
                Margin = new Thickness(0, 0, 0, 10),
                HorizontalAlignment = HorizontalAlignment.Center
            };

            resetOZoneCenterButton.Click += (s, e) => {
                _oZoneCenterSet = false;
                ShowInfoBar("O-Zone Reset", "Center point will be set at next click position", InfoBarSeverity.Success);
            };

            TextBlock descriptionText = new TextBlock
            {
                Text = "The mouse jiggler moves the cursor to avoid detection.\n" +
                      "Random: Moves fully randomly\n" +
                      "Circular: Moves in a circle around current position\n" +
                      "O-Zone: Moves randomly in fixed circular zone",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 10, 0, 0),
                Opacity = 0.7
            };

            jigglerToggle.Toggled += (s, e) =>
            {
                bool isEnabled = jigglerToggle.IsOn;
                radiusBox.IsEnabled = isEnabled;
                modeComboBox.IsEnabled = isEnabled;
                resetOZoneCenterButton.IsEnabled = isEnabled &&
                                                  (modeComboBox.SelectedItem as ComboBoxItem)?.Tag is JigglerMode mode &&
                                                  mode == JigglerMode.OZone;
            };

            modeComboBox.SelectionChanged += (s, e) =>
            {
                if ((modeComboBox.SelectedItem as ComboBoxItem)?.Tag is JigglerMode mode)
                {
                    resetOZoneCenterButton.IsEnabled = jigglerToggle.IsOn && mode == JigglerMode.OZone;
                    if (mode == JigglerMode.OZone)
                        _oZoneCenterSet = false;
                }
            };

            contentPanel.Children.Add(jigglerToggle);
            contentPanel.Children.Add(modeComboBox);
            contentPanel.Children.Add(radiusBox);
            contentPanel.Children.Add(resetOZoneCenterButton);
            contentPanel.Children.Add(descriptionText);

            jigglerDialog.Content = contentPanel;
            ContentDialogResult result = await jigglerDialog.ShowAsync();

            if (result == ContentDialogResult.Primary)
            {
                bool wasEnabled = _jiggleEnabled;
                JigglerMode oldMode = _jiggleMode;

                _jiggleEnabled = jigglerToggle.IsOn;
                _jiggleRadius = (int)radiusBox.Value;

                if (modeComboBox.SelectedItem is ComboBoxItem selectedItem &&
                    selectedItem.Tag is JigglerMode mode)
                {
                    _jiggleMode = mode;

                    if (_jiggleMode == JigglerMode.Circular && oldMode != JigglerMode.Circular)
                        _circularAngle = 0;

                    if ((_jiggleMode == JigglerMode.OZone && oldMode != JigglerMode.OZone) ||
                        (_jiggleMode == JigglerMode.OZone && !wasEnabled && _jiggleEnabled))
                        _oZoneCenterSet = false;
                }
            }
        }
        private async void MultiThreadMenuButton_Click(object sender, RoutedEventArgs e)
        {
            if (_isDialogOpen) return;
            _isDialogOpen = true;

            try
            {
                async Task ShowSettingsDialogAsync()
                {
                    var settingsDialog = new ContentDialog
                    {
                        Title = "Multi‑Thread Settings",
                        PrimaryButtonText = "Save",
                        CloseButtonText = "Cancel",
                        DefaultButton = ContentDialogButton.Primary,
                        Width = 400,
                        XamlRoot = this.Content.XamlRoot
                    };

                    var content = new StackPanel
                    {
                        Spacing = 10,
                        Margin = new Thickness(20, 10, 20, 0)
                    };

                    var toggle = new ToggleSwitch
                    {
                        Header = "",
                        OnContent = "ON! | Multi‑Thread",
                        OffContent = "OFF | Multi‑Thread",
                        IsOn = (_clickerMode == ClickerMode.MultiThread),
                        Margin = new Thickness(0, -10, 0, 10),
                        HorizontalAlignment = HorizontalAlignment.Center
                    };

                    var threadCountBox = new NumberBox
                    {
                        Header = "Number of Threads",
                        Value = _threadCount,
                        Minimum = 1,
                        Maximum = 4,
                        SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
                        Width = 200,
                        IsEnabled = (_clickerMode == ClickerMode.MultiThread),
                        Margin = new Thickness(0, 0, 0, 10)
                    };

                    var description = new TextBlock
                    {
                        Text = "Multi‑Thread (Beta) allows running multiple clicker\n" +
                               "threads simultaneously to up CPS.\n\n" +
                               "⚠️ WARNING: Using more than 2 threads with very low\n" +
                               "intervals (<3 ms) MAY cause:\n" +
                               "• System instability\n" +
                               "• High CPU usage\n" +
                               "• Mouse input lag\n" +
                               "• Application crashes\n\n" +
                               "Note: Hold mode is not supported in Multi‑Thread mode.",
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 10, 0, 0),
                        Opacity = 0.7
                    };

                    async void ToggleHandler(object? s, RoutedEventArgs _)
                    {
                        if (toggle.IsOn)
                        {
                            toggle.Toggled -= ToggleHandler;

                            toggle.IsOn = false;

                            settingsDialog.Hide();

                            var warn = BuildWarningDialog();
                            var res = await warn.ShowAsync();

                            if (res == ContentDialogResult.Primary)
                            {
                                _clickerMode = ClickerMode.MultiThread;
                                _threadCount = (int)threadCountBox.Value;
                                MouseButtonHoldClickComboBox.IsEnabled = false;
                                MouseButtonHoldClickComboBox.SelectedIndex = 0;
                                await ShowSettingsDialogAsync();
                            }
                            else
                            {
                                _clickerMode = ClickerMode.Single;
                                MouseButtonHoldClickComboBox.IsEnabled = true;
                            }
                        }
                        else
                        {
                            _clickerMode = ClickerMode.Single;
                            MouseButtonHoldClickComboBox.IsEnabled = true;
                            threadCountBox.IsEnabled = false;
                        }
                    }

                    toggle.Toggled += ToggleHandler;

                    content.Children.Add(toggle);
                    content.Children.Add(threadCountBox);
                    content.Children.Add(description);

                    settingsDialog.Content = content;

                    var resDialog = await settingsDialog.ShowAsync();

                    if (resDialog == ContentDialogResult.Primary)
                    {
                        _threadCount = (int)threadCountBox.Value;
                        if (!toggle.IsOn) 
                        {
                            _clickerMode = ClickerMode.Single;
                            MouseButtonHoldClickComboBox.IsEnabled = true;
                        }
                    }
                }

                await ShowSettingsDialogAsync();
            }
            finally
            {
                _isDialogOpen = false;
            }
        }
        private ContentDialog BuildWarningDialog()
        {
            var warnDlg = new ContentDialog
            {
                Title = "⚠️ WARNING: Multi‑Thread Mode",
                PrimaryButtonText = "I understand the risks",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
                XamlRoot = this.Content.XamlRoot,
                Width = 400
            };

            var panel = new StackPanel { Spacing = 10 };

            panel.Children.Add(new TextBlock
            {
                Text = "Multi‑Thread mode can cause:\n\n" +
                       "• System instability and crashes\n" +
                       "• High CPU and memory usage\n" +
                       "• Mouse input lag and unresponsiveness\n" +
                       "• Potential damage to your hardware\n\n" +
                       "Type 'I UNDERSTAND THE RISKS!' to continue:",
                TextWrapping = TextWrapping.Wrap
            });

            var confirmBox = new TextBox
            {
                PlaceholderText = "Enter confirmation text here",
                Width = 400
            };

            warnDlg.PrimaryButtonClick += (s, e) =>
            {
                if (confirmBox.Text != "I UNDERSTAND THE RISKS!")
                {
                    e.Cancel = true;
                    confirmBox.Text = "";
                    confirmBox.PlaceholderText = "Please type exactly: I UNDERSTAND THE RISKS!";
                }
            };

            panel.Children.Add(confirmBox);
            warnDlg.Content = panel;
            return warnDlg;
        }
        private async void StartMultiThreadClicker()
        {
            if (_isClicking) return;

            _isClicking = true;
            _clickCount = 0;
            _cancellationTokenSource = new CancellationTokenSource();
            UpdateStartButtonText();

            if (_cursorMode == CursorPositionMode.Current)
            {
                _oZoneCenterSet = false;
            }

            int interval = (_hours * 3600 + _minutes * 60 + _seconds) * 1000 + _milliseconds;
            if (interval <= 0) interval = 1;

            if (_repeatMode == RepeatMode.Seconds)
            {
                _stopwatch.Reset();
                _stopwatch.Start();
            }

            _clickerThreads = new List<Task>();
            for (int i = 0; i < _threadCount; i++)
            {
                _clickerThreads.Add(Task.Run(() => ClickerTaskWorker(interval, _cancellationTokenSource.Token)));
            }
        }
        private async Task ClickerTaskWorker(int baseInterval, CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if ((_repeatMode == RepeatMode.Times && Interlocked.Increment(ref _clickCount) > _targetClicks) ||
                    (_repeatMode == RepeatMode.Seconds && _stopwatch.ElapsedMilliseconds >= _targetSeconds * 1000))
                {
                    break;
                }

                Debug.WriteLine($"Clicking... Count: {_clickCount}");

                if (_cursorMode == CursorPositionMode.Current && IsCursorOverOwnWindow())
                {
                    await Task.Delay(baseInterval);
                    continue;
                }

                if (_cursorMode == CursorPositionMode.Fixed)
                {
                    SetCursorPos((int)_fixedCursorPosition.X, (int)_fixedCursorPosition.Y);
                }
                else if (_jiggleEnabled)
                {
                    ApplyJiggle();
                }

                mouse_event(GetMouseEventFlags(), 0, 0, 0, 0);

                await Task.Delay(baseInterval);
            }

            Debug.WriteLine("ClickerTaskWorker ended.");
        }
        private void StopMultiThreadClicker()
        {
            if (!_isClicking) return;

            _cancellationTokenSource?.Cancel();

            _cancellationTokenSource = null;

            if (_repeatMode == RepeatMode.Seconds)
            {
                try
                {
                    _stopwatch.Stop();
                }
                catch (Exception ex)
                {
                    ShowInfoBar("Error", $"StopMultiThreadClicker() > {ex.Message}", InfoBarSeverity.Error);
                }
            }

            _isClicking = false;
            UpdateStartButtonText();
        }
    }
}

// Made with ❤️ by Agzes!