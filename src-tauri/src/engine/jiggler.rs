use crate::engine::state::{AppState, JigglerPattern};
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[cfg(not(target_os = "linux"))]
use enigo::{Coordinate, Enigo, Mouse, Settings};
#[cfg(target_os = "linux")]
use evdev::{EventType, InputEvent, RelativeAxisCode};
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};

fn random_point_in_circle(rng: &mut impl Rng, radius: i32) -> (i32, i32) {
    loop {
        let x = rng.gen_range(-radius..=radius);
        let y = rng.gen_range(-radius..=radius);
        if x * x + y * y <= radius * radius {
            return (x, y);
        }
    }
}

fn circle_points(radius: i32, num_points: usize) -> Vec<(i32, i32)> {
    let mut points = Vec::with_capacity(num_points);
    for i in 0..num_points {
        let angle = 2.0 * std::f64::consts::PI * (i as f64) / (num_points as f64);
        let x = (radius as f64 * angle.cos()) as i32;
        let y = (radius as f64 * angle.sin()) as i32;
        points.push((x, y));
    }
    points
}

fn next_jiggle(
    pattern: JigglerPattern,
    dist: i32,
    circle_step: &mut usize,
    rng: &mut impl Rng,
) -> Vec<(i32, i32)> {
    match pattern {
        JigglerPattern::Linear => vec![(dist, 0)],
        JigglerPattern::Circle => {
            let points = circle_points((dist / 2).max(1), 16);
            let (x, y) = points[*circle_step % 16];
            let prev_step = if *circle_step == 0 {
                15
            } else {
                *circle_step - 1
            };
            let (prev_x, prev_y) = points[prev_step % 16];
            *circle_step = (*circle_step + 1) % 16;
            vec![(x - prev_x, y - prev_y)]
        }
        JigglerPattern::OZone => {
            let (dx, dy) = random_point_in_circle(rng, dist);
            vec![(dx, dy)]
        }
        JigglerPattern::Random => {
            let delta = rng.gen_range(-dist..=dist);
            if rng.gen_bool(0.5) {
                vec![(delta, 0)]
            } else {
                vec![(0, delta)]
            }
        }
    }
}

#[cfg(target_os = "linux")]
async fn move_mouse(state: &AppState, dx: i32, dy: i32) {
    let mut device_guard = state.uinput_device.lock().await;
    if device_guard.is_none() {
        *device_guard = crate::engine::uinput::setup_uinput();
    }

    if let Some(ref mut device) = *device_guard {
        let _ = device.emit(&[
            InputEvent::new(EventType::RELATIVE.0, RelativeAxisCode::REL_X.0, dx),
            InputEvent::new(EventType::RELATIVE.0, RelativeAxisCode::REL_Y.0, dy),
            InputEvent::new(EventType::SYNCHRONIZATION.0, 0, 0),
        ]);
    }
}

#[cfg(not(target_os = "linux"))]
async fn move_mouse(enigo: &mut Option<Enigo>, dx: i32, dy: i32) {
    if enigo.is_none() {
        *enigo = Enigo::new(&Settings::default()).ok();
    }

    if let Some(input) = enigo.as_mut() {
        if input.move_mouse(dx, dy, Coordinate::Rel).is_err() {
            *enigo = None;
        }
    }
}

pub async fn jiggler_task(state: Arc<AppState>) {
    let mut circle_step = 0usize;
    let mut rng = SmallRng::from_entropy();
    #[cfg(not(target_os = "linux"))]
    let mut enigo = Enigo::new(&Settings::default()).ok();

    loop {
        if state.is_jiggler_active.load(Ordering::SeqCst) && state.is_running.load(Ordering::SeqCst)
        {
            let dist = (state.jiggler_distance.load(Ordering::SeqCst) as i32).max(1);
            let interval = state.jiggler_interval.load(Ordering::SeqCst).max(100);
            let pattern = *state.jiggler_pattern.lock().await;
            if pattern == JigglerPattern::OZone {
                tokio::time::sleep(tokio::time::Duration::from_millis(interval as u64)).await;
                continue;
            }
            let moves = next_jiggle(pattern, dist, &mut circle_step, &mut rng);

            for (dx, dy) in moves {
                #[cfg(target_os = "linux")]
                move_mouse(&state, dx, dy).await;
                #[cfg(not(target_os = "linux"))]
                move_mouse(&mut enigo, dx, dy).await;
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(interval as u64)).await;
        } else {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        }
    }
}
