const fmt = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const GRADE_NOTE = {
  UNHEARD: 'nothing in the station knows you were here',
  QUIET: 'you were a rumour',
  HEARD: 'they know the shape of you now',
  LOUD: 'the whole line heard that',
};

export class Screens {
  constructor() {
    this.root = document.getElementById('screens');
  }

  hide() {
    this.root.className = '';
    this.root.innerHTML = '';
  }

  showTitle() {
    this.root.className = 'on title';
    this.root.innerHTML = `
      <div class="wavefront"><i></i><i></i><i></i></div>
      <h1>REVERB</h1>
      <p class="tag">MAKE NO SOUND</p>
      <p class="go">PRESS ENTER</p>
      <div class="keys">
        <span>WASD MOVE</span><span>SHIFT SNEAK</span><span>CTRL CROUCH</span>
        <span>SPACE RUN</span><span>Q STONE</span><span>LMB FIRE</span><span>P PHOTO</span>
      </div>`;
  }

  showLevelIntro(def) {
    this.root.className = 'on card';
    this.root.innerHTML = `
      <p class="idx">${String(def.id).padStart(2, '0')} / 05</p>
      <h2>${def.name}</h2>
      <p class="tag">${def.line}</p>
      <p class="hint">${def.hint}</p>`;
  }

  showResults(r) {
    this.root.className = 'on card';
    this.root.innerHTML = `
      <p class="idx">${String(r.level.id).padStart(2, '0')} CLEARED</p>
      <h2>${r.grade}</h2>
      <p class="tag">${GRADE_NOTE[r.grade]}</p>
      <dl>
        <div><dt>TIME</dt><dd>${fmt(r.time)}</dd></div>
        <div><dt>SHOTS</dt><dd>${r.shots}</dd></div>
        <div><dt>NOISE</dt><dd>${r.noise.toFixed(1)}</dd></div>
      </dl>
      <p class="go">${r.last ? 'PRESS ENTER' : 'PRESS ENTER TO DESCEND'}</p>`;
  }

  showDeath() {
    this.root.className = 'on card dead';
    this.root.innerHTML = `
      <h2>IT FOUND YOU</h2>
      <p class="tag">something you did made a sound</p>
      <p class="go">PRESS ENTER TO TRY AGAIN</p>`;
  }

  showEnding() {
    this.root.className = 'on title';
    this.root.innerHTML = `
      <div class="wavefront"><i></i><i></i><i></i></div>
      <h1>OUT</h1>
      <p class="tag">THE STATION IS BEHIND YOU</p>
      <p class="go">PRESS ENTER</p>`;
  }
}
