export type MacroActionType = "mouse" | "move" | "keyboard" | "sleep" | "scroll" | "raw_move";

export type MacroUiAction = {
    id: number;
    type: MacroActionType;
    name: string;
    details: string;
    detailKeys?: string[];
    detailSuffix?: string;
    icon: string;
};

export type MacroCapabilities = {
    supported_mouse_buttons: string[];
    recording_supported: boolean;
    recording_reason?: string | null;
    pick_delay_ms: number;
    playback_backend?: string;
    recording_backend?: string;
    smooth_move_supported?: boolean;
    cursor_pick_supported?: boolean;
};

export type MacroRecordingOptions = {
    record_mouse_clicks: boolean;
    record_mouse_moves: "off" | "instant" | "linear" | "smooth" | "raw";
    record_keyboard: boolean;
    record_delays: boolean;
    record_click_position: boolean;
    record_live_preview: boolean;
};

export type MacroRepeatState = {
    actions: number;
    repeat_mode: string;
};

export type MacroBackendAction = {
    id?: unknown;
    timestamp_ms?: number;
    config?: {
        type?: MacroActionType;
        button?: string;
        action?: unknown;
        position?: string | null;
        x?: number;
        y?: number;
        style?: string;
        key?: string;
        text?: string;
        modifiers?: unknown;
        duration_ms?: number;
        clicks?: number;
        points?: number;
        start?: string;
        end?: string;
    };
};

export type MacroMouseDraft = {
    button: string;
    action: "press" | "hold" | "down" | "up";
    clicks: number;
    positionMode: "current" | "custom";
    x: string;
    y: string;
    durationMs: number;
};

export type MacroMoveDraft = {
    x: string;
    y: string;
    style: "instant" | "linear" | "smooth";
};

export type MacroKeyboardDraft = {
    action: "press" | "hold" | "down" | "up";
    key: string;
    durationMs: number;
};

export type MacroSleepDraft = {
    durationMs: string;
};

export type MacroScrollDraft = {
    clicks: string;
};

export type MacroActionDraft = MacroMouseDraft | MacroMoveDraft | MacroKeyboardDraft | MacroSleepDraft | MacroScrollDraft;
