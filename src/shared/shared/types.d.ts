interface Window {
  electronAPI: {
    toggleLock:           () => Promise<boolean>;
    getLockState:         () => Promise<boolean>;
    closeApp:             () => void;
    minimizeApp:          () => void;
    resizeWindow:         (height: number) => void;
    startDrag:            (dx: number, dy: number) => void;
    captureScreen:        () => Promise<string | null>;
    hideStealthInput:     () => void;
    requestMicPermission: () => Promise<boolean>;
    getTogetherKey:       () => Promise<string>;
    // IPC listeners
    onTriggerOcr:         (cb: () => void) => void;
    onShowStealthInput:   (cb: () => void) => void;
    onHideStealthInput:   (cb: () => void) => void;
    onToggleAudio:        (cb: () => void) => void;
  };
}
