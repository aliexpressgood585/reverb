const MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sneak', ShiftRight: 'sneak',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  Space: 'sprint',
  KeyQ: 'stone',
  KeyP: 'photo',
  KeyM: 'mute',
  KeyR: 'restart',
  Escape: 'pause',
  Enter: 'confirm',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, fired: false };
    this.locked = false;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      const a = MAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.state.has(a)) this.pressed.add(a);
      this.state.add(a);
    });
    addEventListener('keyup', (e) => {
      const a = MAP[e.code];
      if (a) this.state.delete(a);
    });
    addEventListener('blur', () => this.state.clear());

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.mouse.fired = true;
      if (this.locked && e.button === 2) this.pressed.add('stone');
    });
    addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    const r = this.canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  }

  down(a) { return this.state.has(a); }
  consume(a) {
    if (this.pressed.has(a)) { this.pressed.delete(a); return true; }
    return false;
  }
  takeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, fired: this.mouse.fired };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.fired = false;
    return m;
  }
  endFrame() { this.pressed.clear(); }

  /** Test hook: lets the headless capture rig drive the game without a mouse. */
  synth(action, downState) {
    if (downState) {
      if (!this.state.has(action)) this.pressed.add(action);
      this.state.add(action);
    } else this.state.delete(action);
  }
}
