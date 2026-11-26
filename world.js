/* Lecture hall camera, LCD and articulated character. All coordinates are in metres. */
(() => {
  "use strict";
  const T = window.THREE;
  const room = document.getElementById("classroom");
  const canvas = document.getElementById("world");
  const phoneUI = document.getElementById("controls");
  if (!T || !canvas || !window.buildLectureModels) return;

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
  } catch {
    // The HTML display and keypad also work when WebGL is unavailable.
    return;
  }

  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  // Software WebGL executes the shadow filter on the CPU. Use a cheaper first frame
  // there, then adapt to observed frame times. This check stays on the device.
  const gl = renderer.getContext();
  const gpuInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const softwareGL = gpuInfo && /swiftshader|llvmpipe|software rasterizer|basic render driver/i
    .test(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL));
  const scene = new T.Scene();
  scene.background = new T.Color(0xdcd9c9);
  const camera = new T.PerspectiveCamera(42, 1, .04, 45);
  scene.add(camera);
  scene.add(new T.HemisphereLight(0xfff3dc, 0xc4abb0, 1.6));
  const sun = new T.DirectionalLight(0xffe1ac, 2.65);
  sun.position.set(-5, 7, 4);
  sun.target.position.set(0, 1, .8);
  scene.add(sun, sun.target);
  const sky = new T.DirectionalLight(0xc3e5ff, 1.05);
  sky.position.set(4, 3, -2);
  scene.add(sky);

  const model = window.buildLectureModels(T, scene);
  // The window light casts furniture and character silhouettes onto the room.
  // Only moving shots need frequent shadow updates; the phone stays outside this pass.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = softwareGL ? T.BasicShadowMap : T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  sun.castShadow = true;
  const shadowSize = softwareGL || Math.min(innerWidth, innerHeight) < 600 ? 512 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 5, bottom: -5, near: .4, far: 20 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .018;
  sun.shadow.bias = -.0003;
  for (const object of [model.furniture, model.professor, model.desk, model.laptop, model.monitorGroup]) {
    object.traverse(part => { if (part.isMesh) part.castShadow = true; });
  }
  camera.add(model.phoneRig);
  model.phoneRig.traverse(part => { part.receiveShadow = false; });
  const monitorOrigin = model.monitorGroup.position.clone();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = T.MathUtils.clamp;
  const mix = T.MathUtils.lerp;
  const smooth = (a, b, t) => T.MathUtils.smoothstep(t, a, b);
  const nowSeconds = () => performance.now() / 1000;
  let screen = "title";
  let entered = nowSeconds();
  let mood = "stern";
  let moodSince = entered;
  let urgent = false;
  let talking = false;
  let width = 1;
  let height = 1;
  let phoneRect = { x: .5, y: .78, w: .77, h: .46 };
  let raf = 0;
  let lastRender = -1;
  let lastShadow = -1;
  let slowFrames = 0;
  let resolutionLimit = softwareGL ? .90 : 1.55;
  let contextLost = false;

  function screenTexture(mesh, w, h) {
    const surface = document.createElement("canvas");
    surface.width = w;
    surface.height = h;
    const texture = new T.CanvasTexture(surface);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    mesh.material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
    return { ctx: surface.getContext("2d"), texture };
  }
  const lcd = screenTexture(model.monitorFace, 1024, 536);
  const phone = screenTexture(model.phoneFace, 384, 630);
  const font = '"Yu Gothic", Meiryo, sans-serif';
  function line(ctx, text, x, y, size, color, maxWidth, align = "left") {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.font = "900 " + size + "px " + font;
    ctx.fillText(text, x, y, maxWidth);
  }

  function paintPhone() {
    const { ctx, texture } = phone;
    const grad = ctx.createLinearGradient(0, 0, 384, 630);
    grad.addColorStop(0, "#233d49");
    grad.addColorStop(1, "#111c30");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 384, 630);
    line(ctx, "出席確認", 24, 62, 31, "#fff1d2", 300);
    ctx.fillStyle = "#f9c763";
    ctx.fillRect(24, 78, 336, 6);
    line(ctx, "受付待機中", 192, 180, 39, "#a6e3cb", 340, "center");
    for (let i = 0; i < 12; i++) {
      const x = 22 + i % 3 * 116;
      const y = 231 + Math.floor(i / 3) * 88;
      ctx.fillStyle = i === 11 ? "#f4c56b" : "#f4e8ce";
      ctx.fillRect(x, y, 105, 74);
      line(ctx, ["1","2","3","4","5","6","7","8","9","⌫","0","提出"][i], x + 52, y + 49, 31, "#273043", 95, "center");
    }
    texture.needsUpdate = true;
  }
  paintPhone();

  const gauge = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0x8af2c7, toneMapped: false }));
  model.monitorFace.add(gauge);
  gauge.position.set(0, -model.monitorHeight * .439, .006);
  gauge.scale.y = model.monitorHeight * .033;
  gauge.frustumCulled = false;
  function setGauge(value) {
    const full = model.monitorWidth * .89;
    gauge.scale.x = full * clamp(value, 0, 1);
    gauge.position.x = (gauge.scale.x - full) * .5;
  }

  function setDisplay(mode, label, text) {
    const { ctx, texture } = lcd;
    const dark = ["code", "ready", "wifi", "closed"].includes(mode);
    ctx.fillStyle = dark ? "#112733" : "#faf4df";
    ctx.fillRect(0, 0, 1024, 536);
    ctx.fillStyle = dark ? "#203e4a" : "#204951";
    ctx.fillRect(0, 0, 1024, 78);
    ctx.fillStyle = dark ? "#85e6c2" : "#f3bc59";
    ctx.fillRect(37, 23, 9, 33);
    line(ctx, label, 62, 55, 37, "#faf6e8", 870);
    gauge.visible = mode === "code";
    if (mode === "code" || mode === "ready") {
      ctx.fillStyle = "#ebfff6";
      ctx.font = "bold 142px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(text, 512, 345, 964);
      if (mode === "code") {
        ctx.fillStyle = "#374e55";
        ctx.fillRect(56, 495, 912, 18);
        setGauge(1);
      }
    } else if (mode === "announce") {
      line(ctx, "出席タイム", 512, 259, 120, "#be342f", 942, "center");
      line(ctx, "スタート！！", 512, 430, 137, "#be342f", 964, "center");
    } else if (mode === "opening" || mode === "title") {
      line(ctx, "本日の成績評価", 68, 207, 84, "#24444b", 890);
      ctx.fillStyle = "#dcab54";
      ctx.fillRect(70, 236, 880, 5);
      line(ctx, "出席回数", 76, 345, 61, "#344954", 530);
      line(ctx, "100％", 939, 346, 76, "#a64830", 300, "right");
      line(ctx, "授業の理解度", 76, 445, 55, "#344954", 530);
      line(ctx, "0％", 939, 445, 64, "#344954", 300, "right");
    } else {
      const [first, second] = text.split("\n");
      const color = dark ? "#ffedce" : "#24444b";
      line(ctx, first, 512, second ? 280 : 321, mode === "closed" ? 124 : 89, color, 925, "center");
      if (second) line(ctx, second, 512, 390, 53, dark ? "#ffc58b" : "#6e695e", 925, "center");
    }
    texture.needsUpdate = true;
  }

  function resize() {
    const stage = canvas.getBoundingClientRect();
    if (!stage.width || !stage.height) return;
    width = Math.round(stage.width);
    height = Math.round(stage.height);
    const rect = phoneUI.getBoundingClientRect();
    if (rect.width && rect.height) {
      phoneRect = {
        x: (rect.x - stage.x + rect.width / 2) / width,
        y: (rect.y - stage.y + rect.height / 2) / height,
        w: rect.width / width, h: rect.height / height,
      };
    }
    const ratio = Math.min(window.devicePixelRatio || 1, resolutionLimit, Math.sqrt(1050000 / (width * height)));
    if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / height;

    // Rehang the LCD slightly higher on a narrow screen, keeping all nine digits in view.
    const portrait = 1 - smooth(.75, 1.45, camera.aspect);
    model.monitorGroup.position.copy(monitorOrigin);
    model.monitorGroup.position.x += .68 * portrait;
    model.monitorGroup.position.y += .38 * portrait;
    model.monitorGroup.scale.setScalar(1 + .18 * portrait);
    refreshShots();
  }

  // Each shot defines an eye, a look target, the minimum visible span, and a
  // landmark held at a chosen screen height. The latter keeps the phone and LCD apart.
  function shot(eye, aim, span, minHeight, landmark, screenY) {
    return { eye: new T.Vector3(...eye), aim: new T.Vector3(...aim), span, minHeight,
      landmark: new T.Vector3(...landmark), screenY };
  }
  let establishing, close, slide, playing;
  function refreshShots() {
    const tv = model.monitorGroup.position;
    const top = tv.y + model.monitorHeight * model.monitorGroup.scale.y / 2;
    const narrow = 1 - smooth(.68, 1.45, camera.aspect);
    const midX = mix(-.78, -.43, narrow);
    establishing = shot([.84, 1.63, 6.2], [midX, 1.65, .05], 7.55, 4.3, [tv.x,top,0], .105);
    playing = shot([.04, 1.7, 5.72], [midX, 1.35, .06], 5.86, 5.35, [tv.x,top,0], .055);
    close = shot([1.5,1.75,3.18], [1.23,1.82,.72], 1.98, 1.95, [1.25,2.06,.75], .375);
    slide = shot([tv.x + .38,1.92,3.64], [tv.x, tv.y,0], model.monitorWidth * model.monitorGroup.scale.x * 1.17, 2.70, [tv.x,tv.y,0], .425);
  }
  const focus = new T.Vector3(), landmark = new T.Vector3();
  function frameShot(a, b, blend, time) {
    camera.position.lerpVectors(a.eye, b.eye, blend);
    focus.lerpVectors(a.aim, b.aim, blend);
    const isImpact = screen === "opening" || screen === "ending";
    const sinceImpact = time - (screen === "opening" ? 2 : .16);
    if (!reduced.matches && isImpact && sinceImpact >= 0 && sinceImpact < .34) {
      const kick = (1 - sinceImpact / .34) ** 2;
      camera.position.y += .045 * kick * Math.cos(sinceImpact * 91);
      focus.x += .035 * kick * Math.sin(sinceImpact * 103);
    }
    camera.lookAt(focus);
    const span = Math.max(mix(a.span, b.span, blend) / camera.aspect, mix(a.minHeight, b.minHeight, blend));
    camera.fov = T.MathUtils.radToDeg(2 * Math.atan(span / (2 * camera.position.distanceTo(focus))));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    landmark.lerpVectors(a.landmark, b.landmark, blend).project(camera);
    camera.projectionMatrix.elements[9] += landmark.y - (1 - 2 * mix(a.screenY, b.screenY, blend));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  function compose(time) {
    let a = playing, b = playing, blend = 0;
    let raised = 1, held = 1;
    if (screen === "title") {
      a = b = establishing;
      raised = 0;
    } else if (screen === "opening") {
      if (time < 1) a = b = establishing;
      else if (time < 2) { a = establishing; b = close; blend = smooth(1, 1.95, time); }
      else if (time < 4.78) a = b = close;
      else if (time < 5.35) { a = close; b = slide; blend = smooth(4.78, 5.35, time); }
      else if (time < 5.95) a = b = slide;
      else { a = slide; b = playing; blend = smooth(5.95, 7.33, time); }
      held = 1 - smooth(1, 1.65, time) + smooth(5.97, 6.85, time);
      raised = smooth(5.98, 7.4, time);
    }
    if (reduced.matches && screen === "opening") {
      a = b = time < 2 ? establishing : time < 5.15 ? close : time < 6.35 ? slide : playing;
      blend = 0;
      raised = time >= 6.35 ? 1 : 0;
      held = (time < 2 || time >= 6.35) ? 1 : 0;
    }
    frameShot(a, b, blend, time);

    const rig = model.phoneRig;
    rig.visible = held > .005;
    if (!rig.visible) return;
    // Keep the player's hands in front of the physical desk during the return dolly.
    // The perspective scale below preserves their screen size at this near distance.
    const depth = .24;
    const sx = camera.projectionMatrix.elements[0], sy = camera.projectionMatrix.elements[5];
    const smallWidth = Math.min(width * .42, height * .30);
    const faceW = mix(smallWidth / width, phoneRect.w, raised) * 2 * depth / sx;
    const faceH = mix(smallWidth * 1.64 / height, phoneRect.h, raised) * 2 * depth / sy;
    rig.scale.set(faceW / .78, faceH / 1.28, faceW / .78);
    const x = 2 * mix(.51, phoneRect.x, raised) - 1;
    const y = 1 - 2 * (mix(.865, phoneRect.y, raised) + (1 - held) * .55);
    rig.position.set(depth * (x + camera.projectionMatrix.elements[8]) / sx,
      depth * (y + camera.projectionMatrix.elements[9]) / sy, -depth - .055 * rig.scale.z);
    rig.rotation.set(-.48 * (1 - raised), .10 * (1 - raised), -.065 * (1 - raised));
  }

  const bindArms = [];
  function animateProfessor(t, life) {
    const sin = Math.sin;
    const breath = reduced.matches ? 0 : sin(life * 2);
    let lean = .025 + .017 * breath, nod = -.03 * breath, turn = -.09;
    let armL = -.16, armR = -.17, elbowL = -.10, elbowR = -.12;
    let tilt = 0, eyebrows = 0;
    let bodyTurn = 0, rightReach = 0;
    const age = Math.max(0, nowSeconds() - moodSince);
    const pulse = Math.exp(-2.8 * age) * Math.sin(age * 10);
    if ((screen === "opening" && t > 1.25) || screen === "ending") {
      const hit = screen === "ending" ? .16 : 2;
      const lift = smooth(hit - .48, hit - .12, t) * (1 - smooth(hit - .12, hit, t));
      const slam = smooth(hit - .11, hit + .015, t) * (1 - smooth(hit + .95, hit + 1.65, t));
      armL -= 1.68 * lift + .14 * slam;
      armR -= 1.43 * lift + .13 * slam;
      elbowL += .06 * slam - .48 * lift;
      elbowR += .08 * slam - .60 * lift;
      lean += -.19 * lift + .32 * slam;
      nod += .18 * lift - .08 * slam;
      turn = .04 * sin(life * 4);
      eyebrows = -.055 * slam;
      if (talking) { tilt = .045 * sin(life * 7); nod += .055 * sin(life * 8); }
    } else if (screen === "play") {
      if (mood === "happy") {
        nod += .30 * pulse;
        lean += .07 * pulse;
      } else if (mood === "slide") {
        lean += .24;
        bodyTurn = -.19;
        turn = -.42;
        nod += .23;
        armL -= .42 + .20 * sin(life * 24);
        rightReach = -.31;
        armR += .12 + .15 * sin(life * 24);
        elbowR += .07;
        eyebrows = .075;
      } else if (mood === "wifi" || mood === "surprise") {
        lean -= .11;
        tilt = -.15;
        elbowL -= .56;
        armR -= .55;
        eyebrows = .065;
      } else if (mood === "deadline") {
        armR -= .8 * Math.sin(Math.PI * clamp(age / .9, 0, 1));
        rightReach = -.68 * Math.sin(Math.PI * clamp(age / .9, 0, 1));
        elbowR -= .52;
        turn = -.22;
      } else if (urgent) {
        lean += .13;
        armL -= .42 + .32 * sin(life * 9);
        nod += .09 * sin(life * 8);
        eyebrows = -.055;
      } else {
        const press = Math.max(0, sin(life * 1.15)) ** 7;
        rightReach = -.28 * press;
        lean += .1 * press;
        armR += .12 * press;
        nod += .10 * press;
        turn -= .13 * press;
      }
    }
    const motion = reduced.matches ? .48 : 1;
    model.torso.rotation.x = lean * motion;
    model.torso.rotation.y = bodyTurn * motion;
    model.head.rotation.set(nod * motion, turn * motion, tilt * motion);
    model.leftArm.rotation.x = bindArms[0] + armL * motion;
    model.rightArm.rotation.x = bindArms[1] + armR * motion;
    model.rightArm.rotation.z = rightReach * motion;
    model.leftForearm.rotation.x = bindArms[2] + elbowL * motion;
    model.rightForearm.rotation.x = bindArms[3] + elbowR * motion;
    const blinkPhase = life % 4.3;
    const blink = reduced.matches ? 1 : 1 - .93 * Math.max(0, 1 - Math.abs(blinkPhase - 3.9) / .12);
    for (const eye of model.eyelids) eye.scale.y = blink;
    model.mouth.scale.y = talking ? 1.2 + 2.3 * Math.abs(sin(life * 14) * .65 + sin(life * 8) * .35) : mood === "wifi" || mood === "slide" ? 2.3 : 1;
    if (model.brows) model.brows.forEach((brow, i) => { brow.rotation.z = brow.userData.restRoll + (i === 0 ? 1 : -1) * eyebrows; });
  }
  bindArms.push(...[model.leftArm, model.rightArm, model.leftForearm, model.rightForearm].map(joint => joint.rotation.x));
  model.brows?.forEach(brow => { brow.userData.restRoll = brow.rotation.z; });

  function draw(ms) {
    raf = 0;
    if (contextLost || document.hidden || screen === "result") return;
    const time = ms / 1000;
    if (time - lastRender >= 1 / (softwareGL ? 24 : 32) || time < lastRender) {
      const frameTime = time - lastRender;
      slowFrames = lastRender > 0 && frameTime > .074 && frameTime < 3 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames >= 7 && renderer.getPixelRatio() > .73) {
        resolutionLimit = Math.max(.72, renderer.getPixelRatio() * .82);
        slowFrames = 0;
        resize();
      }
      lastRender = time;
      const elapsed = Math.max(0, time - entered);
      compose(elapsed);
      animateProfessor(elapsed, time);
      if (time - lastShadow >= (screen === "opening" || screen === "ending" ? .11 : .26) || lastShadow < 0) {
        renderer.shadowMap.needsUpdate = true;
        lastShadow = time;
      }
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(draw);
  }
  function wake() {
    lastRender = -1;
    if (!raf && !contextLost && !document.hidden && screen !== "result") raf = requestAnimationFrame(draw);
  }
  const observer = new ResizeObserver(() => {
    resize();
    // Changing the backing buffer clears it. Paint the new framing before presentation.
    cancelAnimationFrame(raf);
    lastRender = -1;
    draw(performance.now());
  });
  observer.observe(canvas);
  observer.observe(phoneUI);
  document.addEventListener("visibilitychange", wake);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    contextLost = true;
    room.classList.remove("has-world");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    room.classList.add("has-world");
    lcd.texture.needsUpdate = phone.texture.needsUpdate = true;
    resize();
    wake();
  });

  room.classList.add("has-world");
  resize();
  setDisplay("title", "講義資料", "");
  window.lectureWorld = {
    setScreen(next) {
      screen = next;
      entered = nowSeconds();
      mood = "stern";
      talking = false;
      resize();
      wake();
    },
    setDisplay, setGauge,
    setMood(next) { mood = next; moodSince = nowSeconds(); },
    setTalking(value) { talking = value; },
    setUrgent(value) { urgent = value; gauge.material.color.set(value ? 0xff9269 : 0x8af2c7); },
  };
  wake();
})();
