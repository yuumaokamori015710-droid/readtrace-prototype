import * as THREE from './assets/three.module.min.js';

const TAU = Math.PI * 2;
const wrap = (value, count) => ((value % count) + count) % count;
const palette = ['#e1d9b8', '#bfd0c8', '#d3bec0', '#c8d2dd', '#d4c0aa'];

function paperTexture(work, back = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const hash = Array.from(work.title).reduce((n, c) => n + c.codePointAt(0), 0);
  ctx.fillStyle = palette[hash % palette.length];
  ctx.fillRect(0, 0, 512, 768);
  ctx.fillStyle = '#00000010';
  ctx.fillRect(0, 0, 17, 768);
  ctx.fillStyle = '#fff5';
  ctx.fillRect(18, 0, 3, 768);
  ctx.fillStyle = '#353a32';
  ctx.textAlign = 'center';
  ctx.font = '38px "Yu Mincho",serif';
  const lines = [];
  let line = '';
  for (const char of work.title) {
    if (ctx.measureText(line + char).width > 360) { lines.push(line); line = ''; }
    line += char;
  }
  if (line) lines.push(line);
  const top = back ? 150 : Math.max(160, 330 - lines.length * 27);
  lines.slice(0, 8).forEach((text, i) => ctx.fillText(text, 256, top + i * 57));
  ctx.fillRect(221, top - 60, 70, 2);
  ctx.font = '20px "Yu Gothic",sans-serif';
  const creator = Array.from(work.creator || 'ReadTrace');
  for (let i = 0; i < Math.min(creator.length, 48); i += 22) {
    ctx.fillText(creator.slice(i, i + 22).join(''), 256, Math.min(660, top + lines.length * 57 + 65) + i / 22 * 30);
  }
  if (back) {
    ctx.strokeStyle = '#353a3240';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(95, 440 + i * 22); ctx.lineTo(417 - (i % 3) * 40, 440 + i * 22); ctx.stroke();
    }
    ctx.font = '17px Georgia'; ctx.fillText('ReadTrace', 256, 712);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCoverOrbit(root, { records, imageFor, onSelect, onOpen, onUnavailable }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    onUnavailable();
    return null;
  }
  let disposed = false, frame = 0, position = 0, target = 0, selected = 0, spin = 0, spinTarget = 0;
  let pointer = null, blockClick = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  camera.position.set(0, 0.05, 6.2);
  const canvas = renderer.domElement;
  canvas.className = 'orbit-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '表紙の立体表示。左右の矢印で作品を切り替え、Enterで記録を開く');
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  root.append(canvas);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc7beac, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.position.set(-3, 5, 7);
  scene.add(light);
  const textures = new Set();
  const geometry = new THREE.BoxGeometry(2, 3, 0.13);
  const loader = new THREE.TextureLoader();
  const meshes = records.map(record => {
    const front = paperTexture(record.work), back = paperTexture(record.work, true);
    textures.add(front); textures.add(back);
    const edges = ['#dfd8c9', '#b5b19d', '#f1ece0', '#e3dcca'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    const materials = [...edges, new THREE.MeshBasicMaterial({ map: front }), new THREE.MeshStandardMaterial({ map: back, roughness: 0.85 })];
    const mesh = new THREE.Mesh(geometry, materials);
    scene.add(mesh);
    const image = imageFor(record.work);
    if (image) loader.load(image, texture => {
      if (disposed) { texture.dispose(); return; }
      if (texture.image?.width < 5) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures.add(texture);
      materials[4].map = texture;
      materials[4].needsUpdate = true;
      canvas.dataset.loadedCovers = String(Number(canvas.dataset.loadedCovers || 0) + 1);
    }, undefined, () => {});
    return mesh;
  });
  const size = () => {
    const { width, height } = root.getBoundingClientRect();
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  const resize = new ResizeObserver(size);
  resize.observe(root);
  size();
  const choose = (index, turn = true) => {
    target = index;
    selected = wrap(Math.round(index), records.length);
    if (turn && !reduced.matches) spinTarget += TAU;
    onSelect(records[selected], selected);
    canvas.dataset.selectedId = records[selected].id;
  };
  const step = direction => { if (records.length > 1) choose(Math.round(target) + direction); };
  const rotate = () => { if (!reduced.matches) spinTarget += TAU; };
  const down = event => {
    if (event.button !== 0 || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position, lastX: event.clientX, lastTime: performance.now(), velocity: 0, horizontal: false };
    blockClick = false;
  };
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.horizontal && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 9) { pointer = null; return; }
    if (Math.abs(dx) > 8 && !pointer.horizontal) {
      pointer.horizontal = true;
      canvas.setPointerCapture(event.pointerId);
    }
    if (!pointer.horizontal) return;
    blockClick = true;
    const now = performance.now();
    pointer.velocity = (event.clientX - pointer.lastX) / Math.max(1, now - pointer.lastTime);
    pointer.lastX = event.clientX; pointer.lastTime = now;
    const sensitivity = Math.max(135, root.clientWidth * 0.48);
    target = pointer.start - dx / sensitivity;
    if (records.length === 1) target = 0;
    if (!reduced.matches) spin = spinTarget + dx * 0.004;
  };
  const up = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { horizontal, velocity } = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (horizontal) choose(Math.round(target - Math.max(-0.6, Math.min(0.6, velocity * 0.22))), false);
  };
  const cancel = event => {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    choose(Math.round(target), false);
  };
  const click = event => {
    if (blockClick) { blockClick = false; return; }
    const rect = canvas.getBoundingClientRect();
    const offset = (event.clientX - rect.left) / rect.width;
    if (offset < 0.24) step(-1);
    else if (offset > 0.76) step(1);
    else onOpen(records[selected]);
  };
  const keys = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    if (event.key === 'Enter') onOpen(records[selected]);
    if (event.key === ' ') { event.preventDefault(); rotate(); }
  };
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, click, keydown: keys };
  Object.entries(listeners).forEach(([name, fn]) => canvas.addEventListener(name, fn));
  const draw = () => {
    if (disposed) return;
    position += (target - position) * (reduced.matches ? 1 : 0.15);
    spin += (spinTarget - spin) * (reduced.matches ? 1 : 0.1);
    meshes.forEach((mesh, index) => {
      let relative = index - position;
      if (records.length > 1) relative = wrap(relative + records.length / 2, records.length) - records.length / 2;
      mesh.visible = Math.abs(relative) < 2.5;
      mesh.position.set(relative * 2.35, -Math.abs(relative) * 0.08, -Math.abs(relative) * 1.05);
      mesh.rotation.set(0, -relative * 0.44 + spin * Math.max(0, 1 - Math.abs(relative)), 0);
    });
    canvas.dataset.orientation = meshes[selected].rotation.y.toFixed(3);
    canvas.dataset.frame = String(Number(canvas.dataset.frame || 0) + 1);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  };
  choose(0, true);
  draw();
  return {
    step, rotate,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      Object.entries(listeners).forEach(([name, fn]) => canvas.removeEventListener(name, fn));
      geometry.dispose();
      meshes.forEach(mesh => mesh.material.forEach(material => material.dispose()));
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    }
  };
}
