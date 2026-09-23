#[cfg(target_os = "linux")]
use evdev::uinput::VirtualDevice;
#[cfg(target_os = "linux")]
use evdev::AttributeSet;
#[cfg(target_os = "linux")]
use evdev::KeyCode;

#[cfg(target_os = "linux")]
pub fn setup_keyboard_uinput() -> Option<VirtualDevice> {
    let mut keys = AttributeSet::<KeyCode>::new();

    for i in 1..=12 {
        match i {
            1 => keys.insert(KeyCode::KEY_F1),
            2 => keys.insert(KeyCode::KEY_F2),
            3 => keys.insert(KeyCode::KEY_F3),
            4 => keys.insert(KeyCode::KEY_F4),
            5 => keys.insert(KeyCode::KEY_F5),
            6 => keys.insert(KeyCode::KEY_F6),
            7 => keys.insert(KeyCode::KEY_F7),
            8 => keys.insert(KeyCode::KEY_F8),
            9 => keys.insert(KeyCode::KEY_F9),
            10 => keys.insert(KeyCode::KEY_F10),
            11 => keys.insert(KeyCode::KEY_F11),
            12 => keys.insert(KeyCode::KEY_F12),
            _ => {}
        }
    }

    keys.insert(KeyCode::KEY_ESC);

    keys.insert(KeyCode::KEY_0);
    keys.insert(KeyCode::KEY_1);
    keys.insert(KeyCode::KEY_2);
    keys.insert(KeyCode::KEY_3);
    keys.insert(KeyCode::KEY_4);
    keys.insert(KeyCode::KEY_5);
    keys.insert(KeyCode::KEY_6);
    keys.insert(KeyCode::KEY_7);
    keys.insert(KeyCode::KEY_8);
    keys.insert(KeyCode::KEY_9);

    keys.insert(KeyCode::KEY_A);
    keys.insert(KeyCode::KEY_B);
    keys.insert(KeyCode::KEY_C);
    keys.insert(KeyCode::KEY_D);
    keys.insert(KeyCode::KEY_E);
    keys.insert(KeyCode::KEY_F);
    keys.insert(KeyCode::KEY_G);
    keys.insert(KeyCode::KEY_H);
    keys.insert(KeyCode::KEY_I);
    keys.insert(KeyCode::KEY_J);
    keys.insert(KeyCode::KEY_K);
    keys.insert(KeyCode::KEY_L);
    keys.insert(KeyCode::KEY_M);
    keys.insert(KeyCode::KEY_N);
    keys.insert(KeyCode::KEY_O);
    keys.insert(KeyCode::KEY_P);
    keys.insert(KeyCode::KEY_Q);
    keys.insert(KeyCode::KEY_R);
    keys.insert(KeyCode::KEY_S);
    keys.insert(KeyCode::KEY_T);
    keys.insert(KeyCode::KEY_U);
    keys.insert(KeyCode::KEY_V);
    keys.insert(KeyCode::KEY_W);
    keys.insert(KeyCode::KEY_X);
    keys.insert(KeyCode::KEY_Y);
    keys.insert(KeyCode::KEY_Z);

    keys.insert(KeyCode::KEY_LEFTCTRL);
    keys.insert(KeyCode::KEY_RIGHTCTRL);
    keys.insert(KeyCode::KEY_LEFTSHIFT);
    keys.insert(KeyCode::KEY_RIGHTSHIFT);
    keys.insert(KeyCode::KEY_LEFTALT);
    keys.insert(KeyCode::KEY_RIGHTALT);
    keys.insert(KeyCode::KEY_LEFTMETA);
    keys.insert(KeyCode::KEY_RIGHTMETA);

    keys.insert(KeyCode::KEY_SPACE);
    keys.insert(KeyCode::KEY_ENTER);
    keys.insert(KeyCode::KEY_TAB);
    keys.insert(KeyCode::KEY_BACKSPACE);
    keys.insert(KeyCode::KEY_DELETE);
    keys.insert(KeyCode::KEY_INSERT);
    keys.insert(KeyCode::KEY_HOME);
    keys.insert(KeyCode::KEY_END);
    keys.insert(KeyCode::KEY_PAGEUP);
    keys.insert(KeyCode::KEY_PAGEDOWN);

    keys.insert(KeyCode::KEY_UP);
    keys.insert(KeyCode::KEY_DOWN);
    keys.insert(KeyCode::KEY_LEFT);
    keys.insert(KeyCode::KEY_RIGHT);

    keys.insert(KeyCode::KEY_KP0);
    keys.insert(KeyCode::KEY_KP1);
    keys.insert(KeyCode::KEY_KP2);
    keys.insert(KeyCode::KEY_KP3);
    keys.insert(KeyCode::KEY_KP4);
    keys.insert(KeyCode::KEY_KP5);
    keys.insert(KeyCode::KEY_KP6);
    keys.insert(KeyCode::KEY_KP7);
    keys.insert(KeyCode::KEY_KP8);
    keys.insert(KeyCode::KEY_KP9);
    keys.insert(KeyCode::KEY_KPENTER);
    keys.insert(KeyCode::KEY_KPPLUS);
    keys.insert(KeyCode::KEY_KPMINUS);
    keys.insert(KeyCode::KEY_KPASTERISK);
    keys.insert(KeyCode::KEY_KPDOT);
    keys.insert(KeyCode::KEY_KPSLASH);
    keys.insert(KeyCode::KEY_NUMLOCK);
    keys.insert(KeyCode::KEY_CAPSLOCK);

    keys.insert(KeyCode::KEY_GRAVE);
    keys.insert(KeyCode::KEY_MINUS);
    keys.insert(KeyCode::KEY_EQUAL);
    keys.insert(KeyCode::KEY_LEFTBRACE);
    keys.insert(KeyCode::KEY_RIGHTBRACE);
    keys.insert(KeyCode::KEY_BACKSLASH);
    keys.insert(KeyCode::KEY_SEMICOLON);
    keys.insert(KeyCode::KEY_APOSTROPHE);
    keys.insert(KeyCode::KEY_COMMA);
    keys.insert(KeyCode::KEY_DOT);
    keys.insert(KeyCode::KEY_SLASH);

    VirtualDevice::builder()
        .ok()?
        .name("FluAutoClicker Virtual Keyboard")
        .with_keys(&keys)
        .ok()?
        .build()
        .ok()
}
