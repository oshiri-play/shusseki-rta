/* Original low-poly lecture hall. Each rigid object is one vertex-coloured mesh,
   so separate glasses, fingers and shirt buttons do not add draw calls. */
window.buildLectureModels = function buildLectureModels(THREE, scene) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const buckets = new Map();
  const palette = new Map();
  const cache = new Map();
  const transform = new THREE.Object3D();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  function joint(parent, name, x = 0, y = 0, z = 0) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    if (parent) parent.add(group);
    return group;
  }

  function geometry(key, create) {
    if (!cache.has(key)) {
      const source = create();
      const shape = source.index ? source.toNonIndexed() : source;
      shape.computeVertexNormals();
      cache.set(key, shape);
      if (shape !== source) source.dispose();
    }
    return cache.get(key);
  }

  function add(group, shape, colour, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    if (!buckets.has(group)) buckets.set(group, { positions: [], normals: [], colours: [] });
    const batch = buckets.get(group);
    if (!palette.has(colour)) palette.set(colour, new THREE.Color(colour));
    const paint = palette.get(colour);
    transform.position.set(x, y, z);
    transform.scale.set(w, h, d);
    transform.rotation.set(rx, ry, rz);
    transform.updateMatrix();
    normalMatrix.getNormalMatrix(transform.matrix);
    const positions = shape.attributes.position;
    const normals = shape.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform.matrix);
      normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      batch.positions.push(point.x, point.y, point.z);
      batch.normals.push(normal.x, normal.y, normal.z);
      batch.colours.push(paint.r, paint.g, paint.b);
    }
  }

  const unitBox = geometry("box", () => new THREE.BoxGeometry());
  const oval = geometry("oval", () => new THREE.SphereGeometry(1, 12, 8));
  const smallOval = geometry("small oval", () => new THREE.SphereGeometry(1, 9, 6));
  function box(group, colour, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    add(group, unitBox, colour, x, y, z, w, h, d, rx, ry, rz);
  }
  function ball(group, colour, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    add(group, Math.max(w, h, d) < .11 ? smallOval : oval, colour, x, y, z, w, h, d, rx, ry, rz);
  }

  // A rounded rectangle in XY, extruded along Z. The outer dimensions include the bevel.
  function panel(group, colour, x, y, z, w, h, d, radius, rx = 0, ry = 0, rz = 0) {
    const shape = geometry(["panel", w, h, d, radius].join("/"), () => {
      const outline = new THREE.Shape();
      const a = w / 2, b = h / 2;
      const r = Math.min(radius, a, b);
      outline.moveTo(-a + r, -b);
      outline.lineTo(a - r, -b);
      outline.quadraticCurveTo(a, -b, a, -b + r);
      outline.lineTo(a, b - r);
      outline.quadraticCurveTo(a, b, a - r, b);
      outline.lineTo(-a + r, b);
      outline.quadraticCurveTo(-a, b, -a, b - r);
      outline.lineTo(-a, -b + r);
      outline.quadraticCurveTo(-a, -b, -a + r, -b);
      const rim = Math.min(.012, d * .18, radius * .24);
      const result = new THREE.ExtrudeGeometry(outline, {
        depth: d - rim * 2, bevelEnabled: true, bevelSize: rim,
        bevelThickness: rim, bevelSegments: 1, curveSegments: 3
      });
      return result.translate(0, 0, -d / 2 + rim);
    });
    add(group, shape, colour, x, y, z, 1, 1, 1, rx, ry, rz);
  }

  function rod(group, colour, start, end, radiusA, radiusB = radiusA, sides = 8) {
    const delta = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
    const length = delta.length();
    const shape = geometry(["rod", radiusA, radiusB, sides].join("/"), () =>
      new THREE.CylinderGeometry(radiusB, radiusA, 1, sides));
    const axis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    const rotation = new THREE.Euler().setFromQuaternion(axis);
    add(group, shape, colour, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2, 1, length, 1, rotation.x, rotation.y, rotation.z);
  }

  // Layered elliptical cross-sections allow shaped cheeks, hair, waist and shoulders.
  // Each ring is [y, x radius, z radius, x offset, z offset].
  function loft(group, colour, rings, sides = 12) {
    const vertices = [];
    function vertex(r, i) {
      const angle = i / sides * Math.PI * 2 + Math.PI / sides;
      return [(r[3] || 0) + Math.sin(angle) * r[1], r[0], (r[4] || 0) + Math.cos(angle) * r[2]];
    }
    for (let j = 1; j < rings.length; j++) {
      const low = rings[j - 1], high = rings[j];
      for (let i = 0; i < sides; i++) {
        const a = vertex(low, i), b = vertex(low, i + 1);
        const c = vertex(high, i), d = vertex(high, i + 1);
        vertices.push(...a, ...b, ...c, ...c, ...b, ...d);
      }
    }
    for (let i = 1; i < sides - 1; i++) {
      vertices.push(...vertex(rings[0], 0), ...vertex(rings[0], i + 1), ...vertex(rings[0], i));
      const top = rings[rings.length - 1];
      vertices.push(...vertex(top, 0), ...vertex(top, i), ...vertex(top, i + 1));
    }
    raw(group, colour, vertices);
  }

  function raw(group, colour, vertices) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    shape.computeVertexNormals();
    add(group, shape, colour, 0, 0, 0, 1, 1, 1);
    shape.dispose();
  }
  function triangle(group, colour, a, b, c) {
    raw(group, colour, [...a, ...b, ...c, ...c, ...b, ...a]);
  }

  const room = joint(scene, "Lecture hall architecture");
  const furniture = joint(scene, "Lecture room furniture");
  const wood = "#b88053", maple = "#dfb184", edge = "#7b5848", steel = "#53636b";
  const cream = "#f0dec0", peach = "#d7bb96", trim = "#877a66";
  const wallZ = -.56;
  box(room, "#bdac93", 0, -.115, 4.5, 12.1, .22, 11);
  box(room, cream, 0, 2.35, wallZ, 12, 4.7, .16);
  box(room, "#e5cfac", 5.95, 2.35, 4.4, .16, 4.7, 10);
  box(room, "#f4e5cf", -5.95, 2.35, 4.4, .16, 4.7, 10);
  box(room, "#d3c7b0", 0, 4.7, 4.4, 12.1, .14, 10.1);
  for (let x = -6; x <= 6; x += 1.2) {
    box(room, "#a79d89", x, 4.618, 4.4, .022, .015, 10);
    box(room, "#a3927d", x, -.001, 4.4, .012, .014, 10);
  }
  for (let z = 0; z < 10; z += 1.2) {
    box(room, "#ad9f8d", 0, -.001, z, 12, .014, .013);
    box(room, "#b5a993", 0, 4.62, z, 12, .015, .022);
  }
  for (const x of [-3.45, .1, 3.5]) {
    for (const z of [.9, 3.6, 6.4]) {
      box(room, "#918c7f", x, 4.585, z, 1.84, .09, .38);
      box(room, "#fff2d8", x, 4.53, z, 1.69, .03, .29);
    }
  }
  // Ash veneer below the display, cream acoustic panels above. Alternating boards
  // take the window light differently and give a cubic classroom a human scale.
  box(room, "#ae8765", 0, .68, -.43, 11.9, 1.36, .12);
  for (let i = 0; i < 61; i++) {
    const x = -5.8 + i * .194;
    box(room, ["#c89d75", "#cfaa80", "#c3a079"][i % 3], x, .68, -.351, .181, 1.32, .045);
  }
  box(room, trim, 0, 1.36, -.36, 11.94, .055, .16);
  box(room, "#766e60", 0, .07, -.345, 11.94, .14, .15);
  box(room, "#a99b86", 0, 4.4, -.36, 11.95, .24, .22);
  for (let x = -5.5; x < 6; x += 1.1) {
    box(room, "#cebea3", x, 2.88, -.468, .012, 2.92, .016);
  }
  // Front corner glazing; the panes show layered treetops and sunlit buildings.
  box(room, "#81998e", -4.71, 2.75, -.35, 1.94, 2.64, .12);
  box(room, "#b9dce0", -4.71, 2.75, -.27, 1.82, 2.51, .035);
  for (const [x, h, tint] of [[-5.39, .85, "#b6c9c4"], [-5.0, .6, "#c3d2c9"], [-4.56, 1.02, "#a5bec1"], [-4.14,.66,"#c0c9bc"]]) {
    box(room, tint, x, 1.52 + h / 2, -.239, .37, h, .025);
    box(room, "#e3e7d9", x, 1.52 + h, -.218, .4, .035, .018);
  }
  for (let i = 0; i < 7; i++) {
    ball(room, ["#7b9a83", "#91ad8f", "#a3b593"][i % 3], -5.47 + .244 * i, 1.7 + Math.sin(i) * .06, -.19, .28, .29, .07);
  }
  for (const x of [-5.65, -4.73, -3.77]) box(room, "#d7d3be", x, 2.75, -.09, .068, 2.65, .15);
  for (const y of [1.46, 2.64, 4.03]) box(room, "#d9d7c7", -4.71, y, -.09, 1.97, .072, .15);
  box(room, "#edcea6", -4.71, 1.405, -.04, 2.06, .10, .28);
  for (const z of [1.6, 4.2, 6.8]) {
    box(room, "#83a0a0", -5.82, 2.65, z, .12, 2.28, 2.28);
    box(room, "#c6e2da", -5.74, 2.65, z, .04, 2.14, 2.14);
    for (const dy of [-1.1, .02, 1.1]) box(room, "#e5dcc8", -5.67, 2.65 + dy, z, .13, .07, 2.31);
    box(room, "#d0cbb8", -5.67, 2.65, z, .13, 2.3, .065);
    box(room, peach, -5.66, 1.47, z, .34, .10, 2.45);
  }
  // Classroom door with a narrow safety-glass window and a lever handle.
  box(room, "#8e7d68", 4.12, 1.36, -.22, 1.73, 2.72, .17);
  box(room, "#ba986e", 4.12, 1.30, -.105, 1.56, 2.56, .08);
  box(room, "#3c5055", 3.81, 1.75, -.051, .40, 1.17, .035);
  box(room, "#8aa69f", 3.81, 1.78, -.022, .33, 1.04, .028);
  box(room, "#c0c7ac", 3.81, 1.96, -.002, .32, .46, .014);
  box(room, "#5a5a55", 4.67, 1.06, -.033, .105, .28, .043);
  rod(room, "#d0c5a6", [4.68, 1.12, .037], [4.47, 1.12, .037], .031);
  for (let i = 0; i < 4; i++) box(room, "#947c60", 4.08, .29 + i * .07, -.041, .64, .023, .012);
  // Analogue clock, including all twelve ticks and the minute hand.
  rod(room, "#554e4c", [2.26, 3.67, -.43], [2.26, 3.67, -.27], .337, .337, 32);
  rod(room, "#f9eed5", [2.26, 3.67, -.26], [2.26, 3.67, -.24], .307, .307, 32);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    box(room, "#676967", 2.26 + Math.sin(a) * .258, 3.67 + Math.cos(a) * .258,
      -.219, i % 3 === 0 ? .022 : .013, i % 3 === 0 ? .05 : .026, .014, 0, 0, -a);
  }
  rod(room, "#47525c", [2.26, 3.67, -.197], [2.15, 3.79, -.197], .012);
  rod(room, "#905c43", [2.26, 3.67, -.187], [2.42, 3.79, -.187], .011);
  for (const x of [-3.61, .64]) {
    panel(room, "#434747", x, 3.56, -.22, .26, .45, .19, .032);
    for (let i = 0; i < 6; i++) box(room, "#252d31", x, 3.43 + .048 * i, -.105, .19, .014, .011);
  }

  const monitorWidth = 3.55, monitorHeight = 1.86;
  const monitorGroup = joint(scene, "Wall-mounted LCD", -1.55, 2.8, 0);
  box(monitorGroup, "#5d605c", 0, -.05, -.32, 1.54, .81, .33);
  panel(monitorGroup, "#272e35", 0, -.02, -.11, 3.68, 2.00, .15, .045);
  panel(monitorGroup, "#101c26", 0, -.003, -.028, 3.59, 1.91, .042, .026);
  box(monitorGroup, "#5c6468", 0, -.997, -.019, 3.53, .017, .028);
  ball(monitorGroup, "#8fddb1", 1.53, -.969, .002, .016, .008, .006);
  const monitorFace = new THREE.Mesh(new THREE.PlaneGeometry(monitorWidth, monitorHeight),
    new THREE.MeshBasicMaterial({ color: 0x263344 }));
  monitorGroup.add(monitorFace);

  // Aisles and desks. A low eye line sees the bevels, steel feet and chair backs.
  function studentDesk(x, z, width, chair) {
    box(furniture, edge, x, .723, z, width, .075, .75);
    box(furniture, maple, x, .766, z, width, .038, .75);
    box(furniture, "#75807c", x, .60, z - .25, width - .12, .15, .06);
    for (const sign of [-1, 1]) {
      const legX = x + sign * (width / 2 - .13);
      for (const offset of [-.26, .26]) box(furniture, steel, legX, .38, z + offset, .052, .67, .053);
      box(furniture, "#585e60", legX, .06, z, .083, .07, .66);
    }
    if (chair) {
      const cz = z + .63;
      box(furniture, "#a26848", x, .46, cz, .56, .063, .47);
      box(furniture, "#cb9063", x, .74, cz + .21, .57, .28, .046, -.09);
      for (const sign of [-1, 1]) {
        rod(furniture, steel, [x + sign * .20, .04, cz + .17], [x + sign * .20, .86, cz + .22], .025);
        rod(furniture, steel, [x + sign * .20, .04, cz - .18], [x + sign * .20, .46, cz - .13], .025);
      }
    }
  }
  for (const z of [2.65, 4.3, 6.15]) {
    studentDesk(-3.88, z, 2.55, true);
    studentDesk(3.83, z, 2.49, true);
  }
  studentDesk(.05, 4.24, 2.86, false);
  // A notebook on the player's desk, with handwritten rulings and a pencil.
  box(furniture, "#73574c", -.89, .798, 4.08, .43, .028, .54, 0, -.12);
  box(furniture, "#eee1bf", -.89, .817, 4.08, .415, .014, .525, 0, -.12);
  for (let i = 0; i < 6; i++) box(furniture, "#b7b9a9", -.89 - i * .004, .826, 3.90 + i * .063, .33, .004, .006, 0, -.12);
  rod(furniture, "#b57b35", [-.58, .808, 3.91], [-.52, .808, 4.32], .013, .013, 6);

  const desk = joint(scene, "Professor's lectern", 1.25, 0, 1.12);
  box(desk, "#584c44", 0, .065, .03, 1.46, .13, .69);
  box(desk, "#a67955", 0, .55, .025, 1.39, .88, .60);
  box(desk, "#bc8d61", 0, .56, .339, 1.30, .74, .035);
  for (let i = 0; i < 15; i++) {
    box(desk, i % 3 === 0 ? "#c79e70" : "#bf9064", -.606 + i * .086, .56, .364, .071, .69, .024);
  }
  box(desk, "#74523e", 0, .97, 0, 1.59, .086, .80);
  box(desk, "#d8a575", 0, 1.029, 0, 1.66, .063, .84);
  box(desk, "#e6bf90", 0, 1.058, 0, 1.60, .012, .79);
  // AV controls and a stack of handouts.
  box(desk, "#454f53", .46, .90, .345, .26, .084, .055);
  for (let i = 0; i < 3; i++) ball(desk, i === 2 ? "#b3ddb5" : "#798c89", .39 + i * .07, .90, .377, .017, .013, .011);
  box(desk, "#a55141", .49, 1.082, .02, .32, .038, .42, 0, .1);
  box(desk, "#f2e7c9", .49, 1.107, .02, .30, .021, .405, 0, .1);
  box(desk, "#fff1cc", .50, 1.122, .03, .31, .009, .40, 0, .18);
  const laptop = joint(desk, "Laptop", -.486, 1.069, .015);
  box(laptop, "#57616b", 0, .014, 0, .45, .028, .33);
  box(laptop, "#2d3844", 0, .033, -.025, .38, .009, .18);
  box(laptop, "#778187", 0, .035, .112, .14, .009, .062);
  const lid = joint(laptop, "Laptop lid", 0, .027, .145);
  lid.rotation.x = .23;
  panel(lid, "#445462", 0, .145, 0, .46, .291, .029, .014);
  box(lid, "#758997", 0, .15, -.018, .407, .236, .010);
  for (let i = 0; i < 3; i++) box(lid, ["#e9ce81", "#c77351", "#8eaca9"][i], -.022 + i * .021,
    .157 + (i % 2) * .015, .023, .02, .032, .007, 0, 0, -.25);

  const professor = joint(scene, "Professor", 1.25, 0, .65);
  const torso = joint(professor, "Torso", 0, 1.01, 0);
  const head = joint(torso, "Head", 0, .705, .02);
  const skin = "#e8a679", skinLight = "#f1b68a", skinShadow = "#c38262";
  const tweed = "#b7824e", lapel = "#c6955d", wool = "#3b6669";
  const ivory = "#fff0cc", hair = "#c9c4b4", hairShadow = "#87888b", glasses = "#38323b";
  for (const sign of [-1, 1]) {
    rod(professor, "#48505a", [sign * .12, .12, -.02], [sign * .13, 1.07, -.01], .109, .157);
    ball(professor, "#514342", sign * .125, .09, .08, .114, .076, .197);
  }
  loft(torso, tweed, [
    [-.06,.276,.177], [.18,.292,.189], [.48,.347,.196], [.575,.335,.166],
    [.632,.199,.123]
  ]);
  // The shirt, waistcoat and broad notched lapels sit on distinct planes.
  triangle(torso, ivory, [-.143,.623,.099], [.143,.623,.099], [0,.418,.221]);
  triangle(torso, wool, [-.20,.54,.175], [0,.423,.226], [0,.045,.201]);
  triangle(torso, wool, [.20,.54,.175], [0,.045,.201], [0,.423,.226]);
  triangle(torso, wool, [-.20,.54,.175], [0,.045,.201], [-.155,.07,.182]);
  triangle(torso, wool, [.20,.54,.175], [.155,.07,.182], [0,.045,.201]);
  for (const sign of [-1, 1]) {
    triangle(torso, lapel, [sign * .162,.623,.115], [sign * .272,.527,.125], [sign * .150,.482,.196]);
    triangle(torso, "#ce9d66", [sign * .225,.468,.171], [sign * .152,.517,.191], [sign * .025,.073,.21]);
    triangle(torso, lapel, [sign * .152,.517,.191], [sign * .158,.619,.134], [sign * .025,.073,.21]);
  }
  for (const y of [.13, .235, .338]) ball(torso, "#d9b784", .012, y, .218, .017, .017, .009);
  box(torso, "#8a6248", .237, .31, .145, .115, .022, .032, 0, .29, .08);
  rod(torso, "#405568", [.229,.33,.146], [.229,.394,.14], .012);
  rod(torso, "#ddb77c", [.245,.33,.145], [.242,.379,.142], .008);
  rod(torso, skinShadow, [0,.572,.02], [0,.76,.025], .115, .128);
  for (const sign of [-1, 1]) {
    triangle(torso, ivory, [sign * .144,.645,.084], [sign * .016,.565,.184], [sign * .123,.526,.18]);
    ball(torso, "#b44832", sign * .071, .571, .177, .084, .049, .035, 0, sign * .12, sign * .21);
  }
  ball(torso, "#853f37", 0,.567,.209,.038,.041,.026);

  loft(head, skin, [
    [-.023,.085,.078,0,.025],[.025,.162,.135,0,.043],[.102,.234,.177,0,.044],
    [.211,.286,.223,0,.025],[.33,.303,.234],[.433,.288,.223],
    [.53,.23,.181],[.564,.138,.117]
  ], 16);
  for (const sign of [-1, 1]) {
    ball(head, skinShadow, sign * .294,.243,-.013,.075,.091,.059,0,0,sign * -.16);
    ball(head, skinLight, sign * .302,.252,.001,.061,.076,.057);
    ball(head, "#c18770", sign * .319,.249,.045,.025,.042,.012);
    ball(head, "#e9a37e", sign * .175,.196,.182,.09,.044,.032,0,sign * .43);
  }
  // Swept-back silver hair, sculpted as a cap and a handful of large polygonal locks.
  loft(head, hairShadow, [
    [.355,.286,.221,0,-.019],[.437,.305,.24,0,-.025],[.555,.27,.216,-.014,-.025],
    [.607,.16,.151,-.043,-.023],[.608,.071,.085,-.059,-.019]
  ], 14);
  ball(head, hair, -.10,.491,.111,.210,.091,.101,0,-.16,-.29);
  ball(head, "#dfd9c5", -.043,.548,.084,.188,.064,.110,0,-.25,-.22);
  ball(head, "#c1beb2", .151,.490,.073,.151,.075,.143,0,.37,.39);
  for (const sign of [-1, 1]) {
    ball(head, hairShadow, sign * .262,.364,.008,.062,.128,.140,0,0,sign * .16);
    ball(head, hair, sign * .288,.376,-.011,.07,.074,.121,0,0,sign * .38);
    rod(head, hair, [sign * .254,.405,-.042], [sign * .383,.431,-.125], .066, .008, 5);
    rod(head, "#b9b9ac", [sign * .258,.375,-.084], [sign * .373,.353,-.153], .061,.008,5);
  }
  const eyelids = [], brows = [];
  for (const sign of [-1, 1]) {
    const eye = joint(head, "Eye", sign * .133,.307,.227);
    eye.rotation.y = sign * .15;
    eyelids.push(eye);
    ball(eye, ivory, 0,0,0,.088,.063,.032);
    ball(eye, "#5e6051", -.004,-.001,.031,.033,.041,.012);
    ball(eye, "#282630", -.004,-.001,.041,.020,.032,.009);
    ball(eye, "#fff7dc", -.013,.014,.048,.009,.010,.003);
    const brow = joint(head, "Eyebrow", sign * .137,.392,.218);
    brows.push(brow);
    ball(brow, "#66646a", 0,0,0,.091,.025,.027,0,0,sign * .18);
    ball(brow, "#b7b6aa", 0,.009,.012,.083,.015,.019,0,0,sign * .18);
    // Eight pieces make an octagonal horn-rim; open frames keep the pupils bright.
    const cx = sign * .139, cy = .306;
    const corners = [[-.083,-.065],[.071,-.065],[.101,-.038],[.106,.039],
      [.080,.069],[-.070,.071],[-.103,.047],[-.106,-.036]];
    const ring = corners.map(([dx,dy]) => [cx + dx, cy + dy, .271 - Math.abs(cx + dx) * .125]);
    for (let i = 0; i < ring.length; i++) rod(head, glasses, ring[i], ring[(i + 1) % ring.length], .012, .012, 6);
    rod(head, glasses, [sign * .234,.325,.234], [sign * .303,.286,.002], .011,.012,6);
  }
  rod(head, glasses, [-.047,.322,.263], [.046,.322,.263], .011);
  ball(head, skinLight, 0,.261,.257,.060,.078,.062);
  ball(head, "#eda882", 0,.226,.293,.077,.052,.075);
  for (const sign of [-1, 1]) {
    ball(head, "#aa715e", sign * .045,.204,.323,.015,.007,.008);
    ball(head, hair, sign * .054,.167,.238,.073,.021,.028,0,sign * .15,sign * .12);
  }
  const mouth = joint(head, "Speaking mouth", 0,.133,.224);
  ball(mouth, "#6c3636", 0,0,0,.069,.018,.016);
  ball(mouth, "#f9dfc3", 0,.009,.010,.054,.006,.008);
  ball(mouth, "#d78379", 0,-.009,.009,.038,.005,.008);
  ball(head, "#df9f79", 0,.062,.184,.097,.040,.034);

  function makeArm(sign) {
    const arm = joint(torso, "Upper arm", sign * .293,.549,.015);
    const elbow = [sign * .088,-.268,.074];
    ball(arm, tweed, sign * .022,-.043,0,.112,.129,.114,0,0,sign * .12);
    rod(arm, tweed, [sign * .025,-.053,0], elbow,.101,.085,10);
    ball(arm, "#a6764d", ...elbow,.086,.086,.09);
    const forearm = joint(arm, "Forearm", ...elbow);
    rod(forearm, tweed, [0,0,0], [sign * -.067,-.13,.175],.085,.066,10);
    rod(forearm, ivory, [sign * -.060,-.119,.161], [sign * -.074,-.15,.194],.067,.061,10);
    ball(forearm, skinLight, sign * -.092,-.156,.228,.077,.059,.091,0,sign * -.26);
    for (let i = 0; i < 4; i++) {
      ball(forearm, skin, sign * (-.153 + i * .034),-.162,.283 - Math.abs(i - 1.5) * .012,
        .019,.025,.047,-.12);
    }
    ball(forearm, skinLight, sign * -.161,-.137,.225,.033,.035,.057);
    return [arm,forearm];
  }
  const [leftArm,leftForearm] = makeArm(1);
  const [rightArm,rightForearm] = makeArm(-1);

  // Player's two-handed grip. The central glass surface remains clear for HTML keys.
  const phoneRig = joint(null, "Player's hands and phone");
  const phone = joint(phoneRig, "Phone");
  panel(phone, "#384450", 0,0,0,.77,1.27,.088,.075);
  panel(phone, "#181e29", 0,0,.037,.747,1.243,.030,.062);
  panel(phone, "#2b3645", 0,0,.051,.700,1.158,.007,.045);
  panel(phone, "#121b22", 0,.601,.052,.111,.012,.007,.005);
  ball(phone, "#304c58", .103,.602,.053,.014,.014,.006);
  box(phone, "#798287", -.390,.209,-.001,.011,.156,.029);
  box(phone, "#798287", .390,.119,-.001,.011,.111,.029);
  const phoneFace = new THREE.Mesh(new THREE.PlaneGeometry(.687, 1.12),
    new THREE.MeshBasicMaterial({ color: 0x263741 }));
  phoneFace.position.set(0,-.004,.057);
  phone.add(phoneFace);
  const wrists = [];
  for (const sign of [-1, 1]) {
    const hand = joint(phoneRig, "Player wrist");
    wrists.push(hand);
    const wrist = [sign * .536,-.55,-.028];
    const sleeveEnd = [sign * .79,-.82,-.13];
    rod(hand, "#405769", [sign * 1.69,-1.75,-.41], sleeveEnd,.273,.173,11);
    rod(hand, "#3c5266", sleeveEnd, [sign * .638,-.68,-.076],.176,.137,11);
    rod(hand, "#526d7b", [sign * .673,-.703,-.092],[sign * .606,-.642,-.067],.151,.138,12);
    rod(hand, "#304453", [sign * .621,-.655,-.068],[sign * .596,-.631,-.061],.136,.132,12);
    rod(hand, "#db9d76", [sign * .616,-.663,-.077],wrist,.119,.117,10);
    ball(hand, "#e0a37b", sign * .507,-.41,-.038,.157,.245,.107,0,sign * .20,-sign * .22);
    ball(hand, "#da9973", sign * .490,-.265,-.072,.115,.173,.086);
    for (let i = 0; i < 4; i++) {
      const y = -.377 + i * .122;
      const reach = .07 - Math.abs(i - 1.8) * .012;
      rod(hand, "#e9ad84", [sign * .497,y - .047,-.073],[sign * .442,y,.005],.054,.051,9);
      ball(hand, "#ebb189", sign * .428,y,.008,.060,.052,.059,0,sign * -.4);
      rod(hand, "#e6a77f", [sign * .444,y,.014],[sign * (.412 - reach * .43),y + .002,.047],
        .052,.039,9);
      ball(hand, "#edb38d", sign * (.409 - reach * .39),y,.050,.037,.039,.034);
    }
    // The broad thumb pad sits just outside the keypad, laid over the near bezel.
    rod(hand, "#e5a27a", [sign * .533,-.45,.020],[sign * .464,-.31,.105],.090,.064,10);
    rod(hand, "#efb389", [sign * .465,-.315,.104],[sign * .380,-.209,.113],.067,.051,10);
    ball(hand, "#efb58e", sign * .377,-.204,.112,.055,.071,.050,0,0,-sign * .59);
    ball(hand, "#f6c8a5", sign * .372,-.191,.147,.030,.036,.011,0,0,-sign * .60);
  }

  for (const [group, batch] of buckets) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    shape.setAttribute("normal", new THREE.Float32BufferAttribute(batch.normals, 3));
    shape.setAttribute("color", new THREE.Float32BufferAttribute(batch.colours, 3));
    shape.computeBoundingSphere();
    const mesh = new THREE.Mesh(shape, material);
    mesh.name = group.name + " geometry";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const shape of cache.values()) shape.dispose();

  return {
    professor, torso, head, mouth, eyelids, brows, leftArm, rightArm, leftForearm, rightForearm,
    phoneRig, phone, phoneFace, wrists, monitorGroup, monitorFace, monitorWidth, monitorHeight,
    laptop, desk, room, furniture
  };
};
