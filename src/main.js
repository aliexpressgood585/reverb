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

canvas.addEventListener('click', () => {
  if (game.state === 'play' && !input.locked) input.requestLock();
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
