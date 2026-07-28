/**
 * There is no HUD.
 *
 * What exists: one thin arc at the bottom edge that shows how far the sound you
 * just made travelled, and a single line of text that appears rarely and then
 * leaves. No health bar, no ammo counter, no crosshair, no boxes, no numbers.
 */
export class Hud {
  constructor() {
    this.canvas = document.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.line = document.getElementById('line');
    this.reach = 0;
    this.reachTarget = 0;
    this.decay = 0;
    this.pulseAge = 99;
    this.lineTimer = 0;
    this.visible = true;
    this.resize();
  }

  resize() {
    const d = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * d;
    this.canvas.height = innerHeight * d;
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  setVisible(v) {
    this.visible = v;
    this.canvas.style.display = v ? '' : 'none';
    this.line.style.display = v ? '' : 'none';
  }

  flashLine(text) {
    this.line.textContent = text;
    this.line.classList.remove('show');
    void this.line.offsetWidth;
    this.line.classList.add('show');
    this.lineTimer = 3.4;
  }

  update({ player, dt }) {
    if (!this.visible) return;

    if (player.lastStepReach > 0 && player.stepEcho > this.decay) {
      this.reachTarget = Math.min(1, player.lastStepReach / 4.0);
      this.pulseAge = 0;
    }
    this.decay = player.stepEcho;
    this.pulseAge += dt;

    const alive = Math.max(0, 1 - this.pulseAge / 1.5);
    this.reach += (this.reachTarget - this.reach) * Math.min(1, dt * 12);

    const w = innerWidth, h = innerHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    if (alive > 0.001 && this.reach > 0.01) {
      // An arc struck from far below the frame, so only its crown is on screen.
      const cx = w * 0.5;
      const cy = h + w * 0.62;
      const r = w * 0.62 + h * 0.06;
      const sweep = 0.22 + this.reach * 0.72;
      const a0 = -Math.PI / 2 - sweep * 0.55;
      const a1 = -Math.PI / 2 + sweep * 0.55;

      const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
      const a = alive * (0.30 + this.reach * 0.55);
      grad.addColorStop(0, 'rgba(220,227,232,0)');
      grad.addColorStop(0.5, `rgba(220,227,232,${a.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(220,227,232,0)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();

      // A second, wider ghost arc for the loudest sounds only.
      if (this.reach > 0.55) {
        ctx.globalAlpha = (this.reach - 0.55) * 0.9 * alive;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 9, a0 * 1.04, a1 * 1.04);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Being hurt: two short ticks at the lower corners, in time with the heart.
    if (player.health < 3 && !player.dead) {
      const t = performance.now() / 1000;
      const beat = Math.pow(Math.max(0, Math.sin(t * 3.1)), 8);
      const a = 0.10 + beat * 0.5;
      ctx.strokeStyle = `rgba(196,82,42,${a.toFixed(3)})`;
      ctx.lineWidth = 1;
      const y = h - 26;
      for (let i = 0; i < 3 - player.health; i++) {
        const x = w * 0.5 - 14 + i * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
      }
    }

    if (this.lineTimer > 0) this.lineTimer -= dt;
  }
}
