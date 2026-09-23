#[cfg(target_os = "linux")]
use evdev::uinput::VirtualDevice;
#[cfg(target_os = "linux")]
use evdev::{AbsInfo, AbsoluteAxisCode, AttributeSet, KeyCode, RelativeAxisCode, UinputAbsSetup};

#[cfg(target_os = "linux")]
pub fn setup_uinput() -> Option<VirtualDevice> {
    let mut keys = AttributeSet::<KeyCode>::new();
    keys.insert(KeyCode::BTN_LEFT);
    keys.insert(KeyCode::BTN_RIGHT);
    keys.insert(KeyCode::BTN_MIDDLE);
    keys.insert(KeyCode::BTN_SIDE);
    keys.insert(KeyCode::BTN_EXTRA);

    let mut rels = AttributeSet::<RelativeAxisCode>::new();
    rels.insert(RelativeAxisCode::REL_X);
    rels.insert(RelativeAxisCode::REL_Y);
    rels.insert(RelativeAxisCode::REL_WHEEL);

    let abs_info = AbsInfo::new(0, 0, 32767, 0, 0, 0);
    let abs_x = UinputAbsSetup::new(AbsoluteAxisCode::ABS_X, abs_info);
    let abs_y = UinputAbsSetup::new(AbsoluteAxisCode::ABS_Y, abs_info);

    VirtualDevice::builder()
        .ok()?
        .name("FluAutoClicker Virtual Mouse")
        .with_keys(&keys)
        .ok()?
        .with_absolute_axis(&abs_x)
        .ok()?
        .with_absolute_axis(&abs_y)
        .ok()?
        .with_relative_axes(&rels)
        .ok()?
        .build()
        .ok()
}
