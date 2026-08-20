(() => {
  const ACCENT = '#D4B36A';
  const ORDER = ['welcome', 'license', 'location', 'progress', 'done'];
  const $ = (id) => document.getElementById(id);

  // ── Bridge (real Electron IPC, or a simulated shim for browser preview) ────
  const NATIVE = !!window.qx;
  const qx = window.qx || (() => {
    let cb = () => {};
    const files = [
      'core/quantum-engine.bin', 'core/lattice.dat', 'lib/render-pipeline.dll',
      'lib/neural-cache.pak', 'assets/textures/aurum.ktx2', 'assets/shaders/bloom.qsh',
      'assets/fonts/display.woff2', 'modules/sync-daemon', 'modules/telemetry-opt.plug',
      'locale/en-GB', 'docs/quickstart.qxd', 'bin/AppRuntime.exe'
    ];
    return {
      minimize() {}, close() { try { window.close(); } catch (_) {} },
      getInfo: () => Promise.resolve({ version: '2.0.0', defaultPath: 'C:\\Users\\You\\AppData\\Local\\Programs\\QuantumX', payloadReady: false }),
      pickFolder: () => Promise.resolve(null),
      finish() {},
      onProgress(fn) { cb = fn; return () => { cb = () => {}; }; },
      install() {
        return new Promise((res) => {
          let pct = 0, fi = 0, t = 0;
          const iv = setInterval(() => {
            t++;
            pct += (Math.random() * 1.8 + .3) * (pct > 82 ? .45 : 1);
            if (t % 6 === 0) fi = Math.min(files.length - 1, fi + 1);
            if (pct >= 100) {
              clearInterval(iv);
              cb({ pct: 100, file: 'Finalizing…', speed: '' });
              res({ success: true, installDir: 'C:\\Program Files\\QuantumX' });
            } else {
              cb({ pct: Math.min(99, pct), file: files[fi], speed: (8 + Math.random() * 16).toFixed(1) + ' MB/s' });
            }
          }, 90);
        });
      }
    };
  })();

  // ── State ──────────────────────────────────────────────────────────────────
  const state = { step: 'welcome', agreed: false, installDir: '' };

  function setStep(step) {
    state.step = step;
    ORDER.forEach(s => { $('step-' + s).hidden = s !== step; });
    updateDots();
  }

  function updateDots() {
    const idx = ORDER.indexOf(state.step);
    const spans = $('dots').children;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      s.style.cssText = 'width:7px;height:7px;border-radius:50%;transition:background .4s, box-shadow .4s;';
      s.style.background = i === idx ? ACCENT
        : (i < idx ? `color-mix(in oklab, ${ACCENT} 45%, transparent)` : 'rgba(255,255,255,.14)');
      s.style.boxShadow = i === idx ? `0 0 10px ${ACCENT}` : 'none';
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  $('btnMin').onclick = () => qx.minimize();
  $('btnClose').onclick = () => qx.close();
  document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => setStep(b.dataset.nav));

  $('btnBegin').onclick = () => setStep('license');

  const chkAgree = $('chkAgree'), licContinue = $('licContinue');
  chkAgree.onchange = () => {
    state.agreed = chkAgree.checked;
    licContinue.style.opacity = state.agreed ? '1' : '.35';
    licContinue.style.cursor = state.agreed ? 'pointer' : 'not-allowed';
  };
  licContinue.onclick = () => { if (state.agreed) setStep('location'); };

  $('btnBrowse').onclick = async () => {
    const p = await qx.pickFolder();
    if (p) $('pathInput').value = p;
  };

  $('btnInstall').onclick = () => startInstall();
  $('btnFinish').onclick = () => {
    const btn = $('btnFinish');
    const launch = $('chkLaunchAfter').checked;

    // Instant feedback — no dead pause before something visibly happens.
    btn.disabled = true;
    btn.style.opacity = '.6';
    btn.style.cursor = 'default';
    btn.textContent = launch ? 'Launching…' : 'Finishing…';
    $('chkLaunchAfter').disabled = true;

    // Fire the real work immediately (in parallel with the fade, not after it),
    // so total wall-clock time is the max of the two, not their sum.
    qx.finish({ launch, installDir: state.installDir });

    const stage = $('stage');
    if (stage) stage.style.opacity = '0';
  };

  // ── Progress ─────────────────────────────────────────────────────────────
  const bar = $('bar'), barDot = $('barDot'), pctText = $('pctText'), fileText = $('fileText'), speedText = $('speedText');
  qx.onProgress((d) => {
    const p = Math.min(100, d.pct || 0);
    pctText.textContent = Math.floor(p) + '%';
    bar.style.width = p + '%';
    barDot.style.left = p + '%';
    if (d.file != null) fileText.textContent = d.file;
    if (d.speed != null) speedText.textContent = d.speed;
  });

  async function startInstall() {
    setStep('progress');
    const opts = {
      path: $('pathInput').value.trim(),
      shortcut: $('chkShortcut').checked,
      launch: $('chkLaunch').checked
    };
    const res = await qx.install(opts);
    if (res && res.success) {
      state.installDir = res.installDir || opts.path;
      setTimeout(() => { setStep('done'); setTimeout(fireConfetti, 350); }, 700);
    } else {
      pctText.textContent = 'Error';
      fileText.textContent = (res && res.error) || 'Installation failed';
      fileText.style.color = '#ff8a80';
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  qx.getInfo().then((info) => {
    if (info.version) $('verText').textContent = 'v' + info.version;
    if (info.defaultPath) $('pathInput').value = info.defaultPath;
    $('sizeNote').textContent = info.payloadReady === false && NATIVE
      ? '⚠ payload not bundled — build the app first'
      : 'A secure, elegant setup · takes under a minute';
  });
  setStep('welcome');

  // ── Ambient particles ────────────────────────────────────────────────────
  (function particles() {
    const canvas = $('particles'), ctx = canvas.getContext('2d');
    const COUNT = 60;
    let parts = [];
    const dpr = () => window.devicePixelRatio || 1;
    const seed = () => {
      const w = canvas.width, h = canvas.height;
      parts = Array.from({ length: COUNT }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: .6 + Math.random() * 1.8,
        vy: -(.08 + Math.random() * .3), vx: (Math.random() - .5) * .12,
        tw: Math.random() * Math.PI * 2, ts: .008 + Math.random() * .02
      }));
    };
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr();
      canvas.height = canvas.clientHeight * dpr();
      seed();
    };
    resize();
    new ResizeObserver(resize).observe(canvas);
    (function tick() {
      const w = canvas.width, h = canvas.height, d = dpr();
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx * d; p.y += p.vy * d; p.tw += p.ts;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        ctx.globalAlpha = .12 + .45 * (0.5 + 0.5 * Math.sin(p.tw));
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * d, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    })();
  })();

  // ── Confetti ─────────────────────────────────────────────────────────────
  function fireConfetti() {
    const canvas = $('confetti');
    canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const colors = [ACCENT, '#F4EFE4', '#fff2d0', '#8a733f', '#ffffff'];
    const w = canvas.width, h = canvas.height;
    const pieces = Array.from({ length: 160 }, () => {
      const ang = -Math.PI / 2 + (Math.random() - .5) * 1.6;
      const v = (5 + Math.random() * 9) * dpr;
      return {
        x: w / 2 + (Math.random() - .5) * w * .2, y: h * .62,
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        s: (3 + Math.random() * 5) * dpr,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * .3,
        c: colors[Math.floor(Math.random() * colors.length)],
        life: 1, decay: .004 + Math.random() * .006
      };
    });
    const g = .18 * dpr;
    (function tick() {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of pieces) {
        if (p.life <= 0) continue;
        alive = true;
        p.vy += g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay; p.vx *= .992;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6);
        ctx.restore();
      }
      if (alive) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    })();
  }
})();
