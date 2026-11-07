import * as THREE from './assets/three.module.min.js';

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

export function createCoverOrbit(root, { records, imageFor, coverFor, initialIndex = 0, intro = false, onSelect, onOpen }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { /* Use the same controls with DOM covers when WebGL is unavailable. */ }
  let disposed = false, paused = false, frame = 0, position = initialIndex, target = initialIndex, selected = initialIndex;
  let pointer = null, blockClick = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let yaw = intro && !reduced.matches ? -0.23 : 0;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 1.85, -1.85, 0.1, 40);
  camera.position.z = 10;
  const canvas = renderer?.domElement || document.createElement('div');
  canvas.className = renderer ? 'orbit-canvas' : 'orbit-canvas orbit-fallback';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', '表紙の回転棚');
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Enter');
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  root.append(canvas);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc7beac, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.position.set(-3, 5, 7);
  scene.add(light);
  const geometry = new THREE.BoxGeometry(2, 3, 0.13);
  const loader = new THREE.TextureLoader();
  const cards = new Map();
  const addCard = (index) => {
    const record = records[index];
    if (!renderer) {
      const node = document.createElement('div');
      node.className = 'orbit-flat-cover';
      node.setAttribute('aria-hidden', 'true');
      node.innerHTML = coverFor(record.work);
      canvas.append(node);
      return { node };
    }
    const front = paperTexture(record.work), back = paperTexture(record.work, true);
    const card = { textures: [front, back], active: true };
    const edges = ['#dfd8c9', '#b5b19d', '#f1ece0', '#e3dcca'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    const materials = [...edges, new THREE.MeshBasicMaterial({ map: front }), new THREE.MeshStandardMaterial({ map: back, roughness: 0.85 })];
    const mesh = new THREE.Mesh(geometry, materials);
    scene.add(mesh);
    card.mesh = mesh;
    const image = imageFor(record.work);
    if (image) loader.load(image, texture => {
      if (disposed || !card.active) { texture.dispose(); return; }
      if (texture.image?.width < 5) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      card.textures.push(texture);
      materials[4].map = texture;
      materials[4].needsUpdate = true;
      canvas.dataset.loadedCovers = String(Number(canvas.dataset.loadedCovers || 0) + 1);
      schedule();
    }, undefined, () => {});
    return card;
  };
  const release = (card) => {
    if (card.node) { card.node.remove(); return; }
    card.active = false;
    scene.remove(card.mesh);
    card.mesh.material.forEach(material => material.dispose());
    card.textures.forEach(texture => texture.dispose());
  };
  let halfWidth = 2;
  const size = () => {
    const { width, height } = root.getBoundingClientRect();
    renderer?.setSize(Math.max(1, width), Math.max(1, height), false);
    halfWidth = 1.85 * Math.max(1, width) / Math.max(1, height);
    camera.left = -halfWidth; camera.right = halfWidth;
    camera.updateProjectionMatrix();
    schedule();
  };
  const choose = (index) => {
    target = records.length <= 2 ? (records.length === 1 ? 0 : wrap(index, 2)) : index;
    selected = wrap(Math.round(target), records.length);
    onSelect(records[selected], selected);
    canvas.dataset.selectedId = records[selected].id;
    schedule();
  };
  const step = direction => { if (records.length > 1) choose(Math.round(target) + direction); };
  const down = event => {
    if (event.button !== 0 || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position, lastX: event.clientX, lastTime: performance.now(), velocity: 0, horizontal: false };
    yaw = 0;
    blockClick = false;
  };
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.horizontal && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 9) { pointer = null; blockClick = true; return; }
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
    if (records.length === 2) target = Math.max(0, Math.min(1, target));
    if (records.length === 1) target = 0;
    schedule();
  };
  const up = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { horizontal, velocity, x: pointerStart } = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (horizontal) {
      const intended = Math.round(target - Math.max(-0.5, Math.min(0.5, velocity * 0.18)));
      const delta = event.clientX - pointerStart;
      if (records.length === 2 && Math.abs(delta) > 28) choose(1 - selected);
      else if (records.length > 2 && wrap(intended, records.length) === selected && Math.abs(delta) > 32)
        choose(Math.round(target) - Math.sign(delta));
      else choose(intended);
    }
  };
  const cancel = event => {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    choose(selected);
  };
  const click = event => {
    if (blockClick) { blockClick = false; return; }
    const rect = canvas.getBoundingClientRect();
    const offset = (event.clientX - rect.left) / rect.width;
    if (records.length > 1 && offset < 0.24) step(-1);
    else if (records.length > 1 && offset > 0.76) step(1);
    else onOpen(records[selected]);
  };
  const keys = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    if (event.key === 'Enter') onOpen(records[selected]);
  };
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, click, keydown: keys };
  Object.entries(listeners).forEach(([name, fn]) => canvas.addEventListener(name, fn));
  const schedule = () => {
    if (!disposed && !paused && !document.hidden && !frame) frame = requestAnimationFrame(draw);
  };
  const draw = () => {
    frame = 0;
    if (disposed || paused || document.hidden) return;
    position += (target - position) * (reduced.matches ? 1 : pointer?.horizontal ? 0.55 : 0.21);
    if (Math.abs(target - position) < 0.003) position = target;
    yaw = reduced.matches || Math.abs(yaw) < 0.004 ? 0 : yaw * 0.88;
    const visible = new Set();
    for (let offset = -2; offset <= 2; offset++) {
      const index = wrap(Math.round(position) + offset, records.length);
      const raw = index - position;
      const relative = records.length > 2 ? wrap(raw + records.length / 2, records.length) - records.length / 2 : raw;
      const distance = Math.abs(relative);
      if (distance >= 2.1 || visible.has(index)) continue;
      visible.add(index);
      if (!cards.has(index)) cards.set(index, addCard(index));
      const card = cards.get(index);
      const x = relative * Math.min(2.22, halfWidth * 0.89);
      const scale = 1 - Math.min(1.6, distance) * 0.25;
      const rotation = -relative * 0.48 + yaw * Math.max(0, 1 - distance);
      if (card.mesh) {
        card.mesh.position.set(x, -distance * 0.08, -distance * 1.3);
        card.mesh.scale.setScalar(scale);
        card.mesh.rotation.y = rotation;
      } else {
        card.node.style.transform = `translate(-50%, -50%) translateX(${x / halfWidth * root.clientWidth / 2}px) scale(${scale}) rotateY(${rotation}rad)`;
        card.node.style.zIndex = String(10 - Math.round(distance * 4));
      }
    }
    for (const [index, card] of cards) if (!visible.has(index)) { release(card); cards.delete(index); }
    canvas.dataset.visibleCovers = String(visible.size);
    canvas.dataset.frame = String(Number(canvas.dataset.frame || 0) + 1);
    renderer?.render(scene, camera);
    if (position !== target || yaw) schedule();
  };
  const resize = new ResizeObserver(size);
  resize.observe(root);
  size();
  choose(initialIndex);
  const halt = () => { cancelAnimationFrame(frame); frame = 0; };
  const visibility = () => { if (document.hidden) { halt(); yaw = 0; } else schedule(); };
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', schedule);
  return {
    step,
    pause(value) { paused = value; if (paused) { halt(); yaw = 0; } else schedule(); },
    dispose() {
      disposed = true;
      halt();
      resize.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', schedule);
      Object.entries(listeners).forEach(([name, fn]) => canvas.removeEventListener(name, fn));
      geometry.dispose();
      cards.forEach(release);
      renderer?.dispose();
      renderer?.forceContextLoss();
      canvas.remove();
    }
  };
}
