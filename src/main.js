import { Game } from './core/game.js';
import { Input } from './core/input.js';

const canvas = document.getElementById('view');
const input = new Input(canvas);
const game = new Game(canvas, input);

// Any first interaction unlocks the audio context. Nothing in REVERB is visible
// until audio is running, so this is not an afterthought.
const wake = () => game.sound.init();
addEventListener('pointerdown', wake, { once: true });
addEventListener('keydown', wake, { once: true });

// Outside the game itself the mouse is not captured, so a click has to stand in
// for ENTER — otherwise the title screen looks like it has stopped responding.
addEventListener('pointerdown', () => {
  if (game.state === 'play') {
    if (!input.locked) input.requestLock();
  } else {
    input.synth('confirm', true);
    setTimeout(() => input.synth('confirm', false), 60);
  }
});

let raf;
function tick() {
  raf = requestAnimationFrame(tick);
  try {
    game.frame();
  } catch (err) {
    cancelAnimationFrame(raf);
    console.error(err);
    throw err;
  }
}
tick();

// Headless capture rig and console poking.
window.REVERB = game;
