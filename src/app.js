import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ============ 配置（按需修改） ============
const CONFIG = {
  modelFile: 'model.glb',
  originalSketch: 'natural.png',
  title: '素描临摹 · 3D 参考模型',
  modelNumber: 'No. 1',
  defaultBackground: '#f5f3ee',
  shrinkMargin: 1.45,   // 取景留白系数：越大模型越小
  offsetX: 0.0,         // 默认屏幕水平偏移（正 = 模型左移）
  offsetY: 0.0,         // 默认屏幕垂直偏移（负 = 模型上移）
};

// ============ 场景 ============
const canvasContainer = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.defaultBackground);

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
canvasContainer.appendChild(renderer.domElement);

// IBL：让有贴图的模型更有质感
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// 灯光
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(0.7, 1.0, 0.7);
scene.add(keyLight);

// ============ 底盘（永远固定，模型站在上面） ============
const FLOOR_Y = -0.5;          // 底盘高度（模型脚下）
const chassisGroup = new THREE.Group();
scene.add(chassisGroup);

// 圆形基座 —— 模拟写生台 / 转盘
const baseDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.6, 0.04, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.15 })
);
baseDisc.position.y = FLOOR_Y + 0.02;
chassisGroup.add(baseDisc);

// 基座上沿高光圈
const baseRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.55, 0.012, 12, 96),
  new THREE.MeshStandardMaterial({ color: 0xc89d5e, roughness: 0.4, metalness: 0.6 })
);
baseRim.rotation.x = Math.PI / 2;
baseRim.position.y = FLOOR_Y + 0.04;
chassisGroup.add(baseRim);

// 大型地面网格 —— 永远可见，作为写生"地面"
let gridHelper = new THREE.GridHelper(4, 40, 0x6b6b6b, 0xbcbcbc);
gridHelper.position.y = FLOOR_Y;
gridHelper.material.opacity = 0.7;
gridHelper.material.transparent = true;
gridHelper.material.depthWrite = false;
chassisGroup.add(gridHelper);

// 主网格之外再叠一层更稀疏的次级网格，模拟无限远地面
const gridFar = new THREE.GridHelper(20, 20, 0x9c9c9c, 0xd6d6d6);
gridFar.position.y = FLOOR_Y - 0.001;
gridFar.material.opacity = 0.35;
gridFar.material.transparent = true;
gridFar.material.depthWrite = false;
chassisGroup.add(gridFar);

// 坐标轴（默认隐藏）
const axesHelper = new THREE.AxesHelper(0.3);
axesHelper.position.y = FLOOR_Y + 0.001;
scene.add(axesHelper);
axesHelper.visible = false;

// ============ 工具：自动找模型的"视觉中心" ============
// 思路 1：取模型"前 1/3"顶点的包围盒中心（脸的中心区域）
// 这样不会被头发、鼻子等局部细节拉偏，因为取的是最大边界
// 同时加一道保险：Z 越靠前权重略高，让脸的位置（最靠前）稍微被强调
function findVisualCenter(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  // 第一步：找"头部 + 脸"区域 = 顶部 60% + 前 50%
  const yThreshold = box.max.y - 0.6 * size.y;   // 顶部 60%（包含整个头 + 一点脖子）
  const zMax = box.max.z;
  const zThreshold = zMax - 0.5 * size.z;       // 前 50%（脸会在这里）

  // 第二步：在"头部 + 脸"区域内，统计加权重心
  // 权重：Z 越靠前越高（让脸的中心点更靠前）
  let totalX = 0, totalY = 0, totalZ = 0, totalW = 0;
  root.updateWorldMatrix(true, true);
  const v3 = new THREE.Vector3();
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
      const pos = obj.geometry.attributes.position;
      const m = obj.matrixWorld;
      for (let i = 0; i < pos.count; i++) {
        v3.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        if (v3.y > yThreshold && v3.z > zThreshold) {
          // Z 越靠前权重越大（脸的最前端最重）
          const zNorm = (zMax - v3.z) / (0.5 * size.z); // 0 在最前，1 在 ZThreshold
          const w = 1.5 - zNorm; // 最前 1.5，最浅 0.5
          totalX += v3.x * w; totalY += v3.y * w; totalZ += v3.z * w; totalW += w;
        }
      }
    }
  });
  if (totalW === 0) return null;
  return new THREE.Vector3(totalX / totalW, totalY / totalW, totalZ / totalW);
}

// ============ 工具：根据模型尺寸 + 画布宽高比，计算相机需要的距离 ============
function fitDistanceToModel(size, margin = 1.25) {
  const fovV = camera.fov * Math.PI / 180;
  const aspect = camera.aspect || 1;
  // 垂直方向装下模型需要的距离
  const distV = (size.y / 2) / Math.tan(fovV / 2);
  // 水平方向装下模型需要的距离
  const distH = (size.x / 2) / (Math.tan(fovV / 2) * aspect);
  // 取较大者保证两个方向都装得下，再加 25% 留白
  return Math.max(distV, distH, 0.5) * margin;
}

// ============ 临摹者视角（鼠标驱动相机） ============
const view = {
  enabled: true,
  baseAz: Math.PI * 0.18,
  baseEl: 0.18,
  baseDist: 1.6,
  mouseAz: 0,
  mouseEl: 0,
  mouseTargetAz: 0,
  mouseTargetEl: 0,
  sensitivity: 0.6,
  range: 0.7,
  damping: 0.10,
  curAz: Math.PI * 0.18,
  curEl: 0.18,
  curDist: 1.6,
  target: new THREE.Vector3(0, 0, 0),
  animating: false,
  animFrom: null,
  animTo: null,
  animT0: 0,
  animDur: 600,
};

function applyCameraFromAngles() {
  const az = view.curAz;
  const el = view.curEl;
  const d = view.curDist;
  camera.position.set(
    Math.sin(az) * Math.cos(el) * d,
    Math.sin(el) * d + view.target.y,
    Math.cos(az) * Math.cos(el) * d
  );
  camera.lookAt(view.target);
}

function setBaseView(az, el, dist, duration) {
  duration = duration || 0;
  if (duration <= 0) {
    view.baseAz = az; view.baseEl = el; view.baseDist = dist;
    view.curAz = az; view.curEl = el; view.curDist = dist;
    view.animating = false;
    return;
  }
  view.animating = true;
  view.animFrom = { az: view.curAz, el: view.curEl, dist: view.curDist };
  view.animTo = { az: az, el: el, dist: dist };
  view.animT0 = performance.now();
  view.animDur = duration;
}

// 把手动偏移（归一化值，1 = 半个可见区域）转成世界坐标，叠加到目标点上
// 这样无论画布尺寸/相机角度怎么变，X=某个值 始终代表相同的"屏幕相对位置"
function applyTargetOffset() {
  if (!view.modelBox) return;

  // 当前可见区域（在模型距离处）
  const fovV = camera.fov * Math.PI / 180;
  const dist = view.curDist;
  const visibleHeight = 2 * dist * Math.tan(fovV / 2);
  const visibleWidth = visibleHeight * camera.aspect;

  // targetOffset 里的 x/y 是"半个可见区域"的倍数
  // 1.0 = 把视点往右/上推半个可见区域（也就是模型视觉中心会偏到画布右半边的中点）
  // 用户调的 "1.0" 经过 WORLD_TO_NDC 换算成归一化值
  const worldOffsetX = view.targetOffset.x * (visibleWidth / 2) * WORLD_TO_NDC;
  const worldOffsetY = view.targetOffset.y * (visibleHeight / 2) * WORLD_TO_NDC;

  // 相机在"看向 view.target"时的右向量和上向量（世界空间）
  // 偏移应该走在相机的屏幕平面上，而不是世界 XY 平面 —— 这样无论怎么转视角都稳定
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); // 返回的是相机看的方向
  const worldUp = new THREE.Vector3(0, 1, 0);
  const camRight = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const camUp = new THREE.Vector3().crossVectors(camRight, forward).normalize();

  view.target.copy(view.modelBox.center);
  view.target.add(camRight.clone().multiplyScalar(worldOffsetX));
  view.target.add(camUp.clone().multiplyScalar(worldOffsetY));
}

// 用户 X=1.0 时实际希望"模型视觉中心偏到画布中心"
// 在窄画布里（约 visibleWidth=7.17）1 个世界单位 = 14% 半可见宽
// 在宽画布里（约 visibleWidth=9.56）同样 1 个世界单位 = 10% 半可见宽
// 我们把用户的"1.0"理解成"14% 半个可见宽"，这样画布变宽时世界偏移会自动变
// 14% = 1/7.17 ≈ 0.14
const WORLD_TO_NDC = 0.28;

// 鼠标/触控统一走 Pointer Events：桌面端可拖动旋转，手机端单指旋转、双指缩放。
const pointerGestures = {
  dragPointerId: null,
  lastX: 0,
  lastY: 0,
  pinchStartDistance: 0,
  pinchStartDist: view.baseDist,
  touches: new Map(),
};

function setMouseParallax(e) {
  const rect = canvasContainer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  const maxAngle = view.range * 0.9;
  view.mouseTargetAz = nx * maxAngle * view.sensitivity;
  view.mouseTargetEl = ny * maxAngle * view.sensitivity * 0.6;
  document.getElementById('tracer-reticle').classList.add('active');
}

function stopViewAnimation() {
  if (view.animating) {
    view.animating = false;
    view.baseAz = view.curAz;
    view.baseEl = view.curEl;
    view.baseDist = view.curDist;
  }
}

function getTouchDistance() {
  if (pointerGestures.touches.size < 2) return 0;
  const points = [...pointerGestures.touches.values()];
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function resetDragPointer(pointerId) {
  if (pointerGestures.dragPointerId !== null && pointerGestures.dragPointerId !== pointerId) return;
  pointerGestures.dragPointerId = null;
  if (pointerGestures.touches.size === 1) {
    const [id, point] = pointerGestures.touches.entries().next().value;
    pointerGestures.dragPointerId = id;
    pointerGestures.lastX = point.x;
    pointerGestures.lastY = point.y;
  }
}

canvasContainer.addEventListener('pointerdown', (e) => {
  if (!view.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  canvasContainer.setPointerCapture(e.pointerId);
  pointerGestures.dragPointerId = e.pointerId;
  pointerGestures.lastX = e.clientX;
  pointerGestures.lastY = e.clientY;
  view.mouseTargetAz = 0;
  view.mouseTargetEl = 0;
  document.getElementById('hint').classList.add('hidden');

  if (e.pointerType === 'touch') {
    pointerGestures.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointerGestures.touches.size >= 2) {
      pointerGestures.pinchStartDistance = getTouchDistance();
      pointerGestures.pinchStartDist = view.baseDist;
    }
  } else {
    setMouseParallax(e);
  }
}, { passive: false });

canvasContainer.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && pointerGestures.dragPointerId === null) {
    setMouseParallax(e);
    return;
  }
  if (pointerGestures.dragPointerId !== e.pointerId) return;
  e.preventDefault();
  stopViewAnimation();

  if (e.pointerType === 'touch') {
    pointerGestures.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointerGestures.touches.size >= 2) {
      const distance = getTouchDistance();
      if (pointerGestures.pinchStartDistance > 0 && distance > 0) {
        const factor = pointerGestures.pinchStartDistance / distance;
        view.baseDist = Math.max(0.3, Math.min(60, pointerGestures.pinchStartDist * factor));
        view.curDist = view.baseDist;
      }
      return;
    }
  }

  const rect = canvasContainer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dx = e.clientX - pointerGestures.lastX;
  const dy = e.clientY - pointerGestures.lastY;
  pointerGestures.lastX = e.clientX;
  pointerGestures.lastY = e.clientY;

  // 横滑整屏约旋转 108°，纵滑整屏约 81°，再受“灵敏度”滑块影响。
  view.baseAz -= (dx / rect.width) * Math.PI * view.sensitivity;
  view.baseEl = Math.max(-1.2, Math.min(1.2,
    view.baseEl - (dy / rect.height) * Math.PI * 0.75 * view.sensitivity
  ));
  view.mouseTargetAz = 0;
  view.mouseTargetEl = 0;
}, { passive: false });

function finishPointer(e) {
  if (pointerGestures.dragPointerId !== e.pointerId) return;
  if (e.pointerType === 'touch') pointerGestures.touches.delete(e.pointerId);
  pointerGestures.dragPointerId = null;
  if (canvasContainer.hasPointerCapture(e.pointerId)) {
    canvasContainer.releasePointerCapture(e.pointerId);
  }
  resetDragPointer(e.pointerId);
}

canvasContainer.addEventListener('pointerup', finishPointer, { passive: false });
canvasContainer.addEventListener('pointercancel', finishPointer, { passive: false });
canvasContainer.addEventListener('lostpointercapture', (e) => {
  pointerGestures.touches.delete(e.pointerId);
  if (pointerGestures.dragPointerId === e.pointerId) pointerGestures.dragPointerId = null;
});

canvasContainer.addEventListener('mouseleave', () => {
  if (pointerGestures.dragPointerId !== null) return;
  view.mouseTargetAz = 0;
  view.mouseTargetEl = 0;
  document.getElementById('tracer-reticle').classList.remove('active');
});

canvasContainer.addEventListener('wheel', (e) => {
  if (!view.enabled) return;
  e.preventDefault();
  stopViewAnimation();
  const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);
  const delta = e.deltaY * unit;
  const factor = Math.exp(delta * 0.001);
  // 上限拉到 60：很多扫描模型在 GLB 里单位很大，6 太近
  view.baseDist = Math.max(0.3, Math.min(60, view.baseDist * factor));
  view.curDist = view.baseDist;
}, { passive: false });

// ============ 加载模型 ============
const loader = new GLTFLoader();
let modelRoot = null;
let defaultCamAz = view.baseAz;
let defaultCamEl = view.baseEl;
let defaultCamDist = view.baseDist;

function onModelLoaded(gltf) {
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot.traverse((o) => {
      if (o.isMesh) {
        o.geometry && o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        mats.forEach((m) => m.dispose && m.dispose());
      }
    });
  }
  modelRoot = gltf.scene;
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // 把模型降到底盘上（模型底部贴齐 FLOOR_Y）
  modelRoot.position.x -= center.x;
  modelRoot.position.z -= center.z;
  modelRoot.position.y -= (center.y - size.y / 2) - FLOOR_Y;
  scene.add(modelRoot);

  // 相机目标点 = 模型包围盒中心（X/Y/Z 三轴都居中），整尊头像落在画面正中央。
  // 之前只对"脸"会让肩膀被挤到屏幕下方、整体看起来偏下；
  // 这里对准包围盒几何中心，左右上下留白对称。
  const modelCenterY = FLOOR_Y + size.y / 2;
  const worldCenter = new THREE.Vector3(0, modelCenterY, 0);
  view.target.copy(worldCenter);
  // 缓存
  view.modelCenterY = modelCenterY;
  view.modelBox = { size: size.clone(), center: worldCenter.clone(), geoCenter: new THREE.Vector3(0, modelCenterY, 0) };
  // 缓存手动偏移量（用默认左上偏移，加载后马上应用）
  view.targetOffset = new THREE.Vector3(CONFIG.offsetX, CONFIG.offsetY, 0);

  // 让偏移滑块显示默认值，与上面的 targetOffset 保持一致
  const ox = document.getElementById('offset-x');
  const oy = document.getElementById('offset-y');
  if (ox) { ox.value = CONFIG.offsetX; document.getElementById('offset-x-val').textContent = CONFIG.offsetX.toFixed(2); }
  if (oy) { oy.value = CONFIG.offsetY; document.getElementById('offset-y-val').textContent = CONFIG.offsetY.toFixed(2); }

  console.log('[中心] 对准包围盒中心 (0, ' + modelCenterY.toFixed(3) + ', 0)，默认偏移 (' + CONFIG.offsetX + ', ' + CONFIG.offsetY + ')');

  // 自动取景：根据 FOV + 画布宽高比，把整个模型装进画面（shrinkMargin 越大模型越小）
  const dist = fitDistanceToModel(size, CONFIG.shrinkMargin);
  defaultCamAz = Math.PI * 0.18;
  defaultCamEl = 0.15;
  defaultCamDist = dist;
  setBaseView(defaultCamAz, defaultCamEl, defaultCamDist, 0);

  // 立即定位相机并应用默认左上偏移（屏幕空间，转视角也不飘）
  applyCameraFromAngles();
  applyTargetOffset();

  document.getElementById('loader').classList.add('hidden');
}

function parseModelBuffer(buffer) {
  loader.parse(buffer, '', onModelLoaded, (err) => {
    console.error(err);
    document.getElementById('loader-text').innerHTML =
      '<strong style="color:#a33">解析失败</strong><br><small>' + (err.message || err) + '</small>';
  });
}

// ============ IndexedDB: 模型缓存 ============
class ModelCacheDB {
  constructor() {
    this.DB_NAME_PREFIX = 'sketch-ref-v1--';
    this.DB_VERSION = 1;
    this.STORES = ['models', 'artworks', 'meta'];
  }

  _dbName(userId) {
    return this.DB_NAME_PREFIX + userId;
  }

  async _open(userId) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName(userId), this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('models')) {
          const store = db.createObjectStore('models', { keyPath: 'id' });
          store.createIndex('lastAccessedAt', 'lastAccessedAt');
          store.createIndex('cachedAt', 'cachedAt');
        }
        if (!db.objectStoreNames.contains('artworks')) {
          const s2 = db.createObjectStore('artworks', { keyPath: 'id' });
          s2.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async putModel(userId, model) {
    try {
      const db = await this._open(userId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readwrite');
        tx.objectStore('models').put(model);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } catch (e) {
      console.error('[ModelCacheDB] putModel failed:', e);
      throw e;
    }
  }

  async getModel(userId, modelId) {
    try {
      const db = await this._open(userId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readonly');
        const req = tx.objectStore('models').get(modelId);
        req.onsuccess = () => {
          db.close();
          const m = req.result;
          if (m) {
            // update lastAccessedAt
            this.touchModel(userId, modelId).catch(() => {});
          }
          resolve(m || null);
        };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    } catch (e) {
      console.error('[ModelCacheDB] getModel failed:', e);
      return null;
    }
  }

  async touchModel(userId, modelId) {
    const db = await this._open(userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      const store = tx.objectStore('models');
      const req = store.get(modelId);
      req.onsuccess = () => {
        const m = req.result;
        if (m) {
          m.lastAccessedAt = Date.now();
          store.put(m);
        }
        db.close();
        resolve(true);
      };
      req.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async listModels(userId) {
    try {
      const db = await this._open(userId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readonly');
        const req = tx.objectStore('models').getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    } catch (e) {
      return [];
    }
  }

  async deleteModel(userId, modelId) {
    const db = await this._open(userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').delete(modelId);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async clearModels(userId) {
    const db = await this._open(userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').clear();
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async getUsage(userId) {
    if (!navigator.storage || !navigator.storage.estimate) {
      const models = await this.listModels(userId);
      return models.reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
    }
    const est = await navigator.storage.estimate();
    return est.usage || 0;
  }

  // Artworks (exported PNG)
  async putArtwork(userId, artwork) {
    const db = await this._open(userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('artworks', 'readwrite');
      tx.objectStore('artworks').put(artwork);
      tx.oncomplete = () => { db.close(); resolve(artwork.id); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async listArtworks(userId) {
    try {
      const db = await this._open(userId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('artworks', 'readonly');
        const req = tx.objectStore('artworks').getAll();
        req.onsuccess = () => { db.close(); resolve((req.result || []).sort((a,b) => b.createdAt - a.createdAt)); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    } catch (e) {
      return [];
    }
  }

  async deleteUser(userId) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this._dbName(userId));
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        console.warn('[ModelCacheDB] deleteUser blocked for', userId);
      };
    });
  }
}

const modelDB = new ModelCacheDB();

// ============ 模型加载（带缓存） ============
async function loadModelWithCache(modelFile, modelMeta) {
  const userId = userManager.currentUserId;
  // 尝试从 IDB 读取
  const cached = await modelDB.getModel(userId, modelFile);
  if (cached) {
    console.log('[ModelLoader] cache hit:', modelFile, 'size:', cached.sizeBytes);
    const url = URL.createObjectURL(cached.glbBlob);
    return { url, fromCache: true, sizeBytes: cached.sizeBytes };
  }
  // 走网络
  console.log('[ModelLoader] fetching:', modelFile);
  const res = await fetch(modelFile);
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  const blob = await res.blob();
  // 写入 IDB（fire-and-forget，不阻塞主流程）
  modelDB.putModel(userId, {
    id: modelFile,
    userId: userId,
    name: modelMeta?.name || modelFile,
    glbBlob: blob,
    sizeBytes: blob.size,
    triangleCount: modelMeta?.triangleCount || 0,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
  }).catch(e => console.warn('[ModelLoader] IDB cache write failed:', e));
  const url = URL.createObjectURL(blob);
  return { url, fromCache: false, sizeBytes: blob.size };
}

window.loadModelWithCache = loadModelWithCache;
window.modelDB = modelDB;

// ============ 初始化 ============

// ============ 新增模块: 用户系统 ============
class UserManager {
  constructor() {
    this.STORAGE_KEY = 'sketch-ref-users';
    this.CURRENT_KEY = 'sketch-ref-current-user';
    this.SCHEMA_KEY = 'sketch-ref-schema-version';
    this.users = this._loadUsers();
    this.currentUserId = localStorage.getItem(this.CURRENT_KEY);
    // 首次启动：创建默认用户
    if (this.users.length === 0) {
      const defaultUser = this._createUser('用户1', true);
      this.users = [defaultUser];
      this.currentUserId = defaultUser.id;
      this._saveUsers();
      localStorage.setItem(this.CURRENT_KEY, this.currentUserId);
      localStorage.setItem(this.SCHEMA_KEY, '1');
    }
    // 校验 currentUserId
    if (!this.users.find(u => u.id === this.currentUserId)) {
      this.currentUserId = this.users[0].id;
      localStorage.setItem(this.CURRENT_KEY, this.currentUserId);
    }
  }

  _loadUsers() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[UserManager] failed to load users:', e);
      return [];
    }
  }

  _saveUsers() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.users));
  }

  _createUser(displayName, isOwner = false) {
    const colors = ['#c89d5e', '#6b8db3', '#7ba888', '#8b7ba8', '#b38b6b', '#6bb38b'];
    return {
      id: 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      displayName: displayName,
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
      avatarChar: displayName.charAt(0),
      isOwner: isOwner,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      schemaVersion: 1,
    };
  }

  list() { return this.users; }
  getCurrent() { return this.users.find(u => u.id === this.currentUserId); }

  setCurrent(id) {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    this.currentUserId = id;
    user.lastActiveAt = Date.now();
    localStorage.setItem(this.CURRENT_KEY, id);
    this._saveUsers();
    return true;
  }

  create(displayName) {
    const user = this._createUser(displayName || '用户' + (this.users.length + 1));
    this.users.push(user);
    this._saveUsers();
    return user;
  }

  rename(id, newName) {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    user.displayName = newName;
    user.avatarChar = newName.charAt(0);
    this._saveUsers();
    return true;
  }

  delete(id) {
    if (this.users.length <= 1) return { error: '至少保留一个用户' };
    const user = this.users.find(u => u.id === id);
    if (user && user.isOwner) return { error: '设备主人不能直接删除，请先把其他人设为设备主人' };
    this.users = this.users.filter(u => u.id !== id);
    // v1.1: 同时清掉该用户的 prefs/timer/history/last-saved，避免泄漏
    ['sketch-ref-prefs-' + id, 'sketch-ref-prefs-' + id + '-last-saved',
     'sketch-ref-timer-' + id, 'sketch-ref-history-' + id].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    this._saveUsers();
    if (this.currentUserId === id) {
      this.currentUserId = this.users[0].id;
      localStorage.setItem(this.CURRENT_KEY, this.currentUserId);
    }
    return { ok: true };
  }

  exportCurrent() {
    const user = this.getCurrent();
    if (!user) return null;
    const prefsKey = 'sketch-ref-prefs-' + user.id;
    const prefs = localStorage.getItem(prefsKey);
    return {
      type: 'sketch-ref-user-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: user,
      prefs: prefs ? JSON.parse(prefs) : null,
    };
  }
}

const userManager = new UserManager();

// ============ 新增模块: 偏好存储 ============
class PrefsStore {
  constructor(userManager) {
    this.userManager = userManager;
    this.DEFAULT_PREFS = {
      schemaVersion: 1,
      light: { az: 0, el: 30, intensity: 1.0, ambient: 0.3 },
      view: { sensitivity: 0.5, range: 0.3, damping: 0.15, tracerEnabled: true },
      sketch: { color: '#1a1a1a', lineWidth: 4, opacity: 0.8, mode: 'view' },
      display: { showGround: true, showWireframe: false, showReticle: true, showCompare: false },
      model: { currentModelFile: 'model.glb' },
    };
    // 初始化时读 last-saved 标记（如果有）
    this._refreshLastSavedFromStorage();
  }

  _key(userId) {
    return 'sketch-ref-prefs-' + userId;
  }
  _lastSavedKey(userId) {
    return 'sketch-ref-prefs-' + userId + '-last-saved';
  }

  _refreshLastSavedFromStorage() {
    const user = this.userManager.getCurrent();
    if (!user) return;
    const raw = localStorage.getItem(this._lastSavedKey(user.id));
    const ts = raw ? parseInt(raw, 10) : null;
    this._renderLastSavedUI(ts);
  }

  _renderLastSavedUI(ts) {
    const el = document.getElementById('um-prefs-saved');
    if (!el) return;
    if (!ts || isNaN(ts)) {
      el.textContent = '上次保存 —';
      return;
    }
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    el.textContent = '上次保存 ' + hh + ':' + mm;
  }

  load() {
    const user = this.userManager.getCurrent();
    if (!user) return this.DEFAULT_PREFS;
    try {
      const raw = localStorage.getItem(this._key(user.id));
      if (!raw) return this.DEFAULT_PREFS;
      const stored = JSON.parse(raw);
      // 浅合并，保证新字段不丢
      return { ...this.DEFAULT_PREFS, ...stored, light: { ...this.DEFAULT_PREFS.light, ...(stored.light||{}) }, view: { ...this.DEFAULT_PREFS.view, ...(stored.view||{}) }, sketch: { ...this.DEFAULT_PREFS.sketch, ...(stored.sketch||{}) }, display: { ...this.DEFAULT_PREFS.display, ...(stored.display||{}) }, model: { ...this.DEFAULT_PREFS.model, ...(stored.model||{}) } };
    } catch (e) {
      console.error('[PrefsStore] load failed:', e);
      return this.DEFAULT_PREFS;
    }
  }

  save(prefs) {
    const user = this.userManager.getCurrent();
    if (!user) return;
    try {
      localStorage.setItem(this._key(user.id), JSON.stringify(prefs));
      const now = Date.now();
      localStorage.setItem(this._lastSavedKey(user.id), String(now));
      this._renderLastSavedUI(now);
    } catch (e) {
      console.warn('[PrefsStore] save failed:', e);
    }
  }

  updatePath(path, value) {
    const prefs = this.load();
    const parts = path.split('.');
    let obj = prefs;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    this.save(prefs);
    return prefs;
  }
}

const prefsStore = new PrefsStore(userManager);

// ============ 新增模块: 画板 ============

// 共用笔触渲染器（v1.1: SketchCanvas / AnnotationLayer / 历史查看器共用）
const StrokeRenderer = {
  renderTo(ctx, strokes, w, h) {
    const draw = (stroke) => {
      if (!stroke || !stroke.points || stroke.points.length < 1) return;
      ctx.strokeStyle = stroke.color;
      ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // 圆形：用 stroke 的 rect 字段画椭圆描边
      if (stroke.type === 'circle' && stroke.rect) {
        const r = stroke.rect;
        ctx.lineWidth = stroke.baseWidth || 2;
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        const w0 = stroke.baseWidth * (0.3 + 0.7 * Math.pow(p.pressure || 0.5, 0.6));
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, w0 / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      // 用二次贝塞尔平滑
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i + 1];
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const w = stroke.baseWidth * (0.3 + 0.7 * Math.pow(((p1.pressure || 0.5) + (p2.pressure || 0.5)) / 2, 0.6));
        ctx.lineWidth = w;
        ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    };
    strokes.forEach(draw);
    ctx.globalAlpha = 1;
  },
};

class SketchCanvas {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.strokes = []; // 当前可见的笔触
    this.undoStack = []; // 已撤销的笔触（用于重做）
    this.active = false;
    this.mode = 'view'; // view | sketch
    this.color = '#1a1a1a';
    this.lineWidth = 4;
    this.opacity = 0.8;
    this.currentStroke = null;
    this.dpr = window.devicePixelRatio || 1;
    this._resize();
    this._bindEvents();
    this._render();
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.scale(this.dpr, this.dpr);
  }

  _bindEvents() {
    const getPos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0)) - r.left;
      const y = (e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0)) - r.top;
      return { x, y };
    };

    const start = (e) => {
      if (this.mode !== 'sketch') return;
      // 批注模式激活时，画板交出指针事件给批注 canvas
      if (document.body.classList.contains('ann-active')) return;
      e.preventDefault();
      const pos = getPos(e);
      const pressure = (e.pressure !== undefined && e.pressure > 0 && e.pressure <= 1) ? e.pressure : 0.5;
      this.currentStroke = {
        color: this.color,
        baseWidth: this.lineWidth,
        opacity: this.opacity,
        points: [{ x: pos.x, y: pos.y, pressure }],
      };
      this.canvas.setPointerCapture && e.pointerId !== undefined && this.canvas.setPointerCapture(e.pointerId);
    };

    const move = (e) => {
      if (!this.currentStroke) return;
      e.preventDefault();
      const pos = getPos(e);
      const pressure = (e.pressure !== undefined && e.pressure > 0 && e.pressure <= 1) ? e.pressure : 0.5;
      const pts = this.currentStroke.points;
      // 简单采样（每点都存）
      pts.push({ x: pos.x, y: pos.y, pressure });
      this._render();
    };

    const end = (e) => {
      if (!this.currentStroke) return;
      // 至少 2 个点才算一笔
      if (this.currentStroke.points.length >= 2) {
        this.strokes.push(this.currentStroke);
        this.undoStack = []; // 新笔触清空 redo
        // 持久化（简化：保存点数 + JSON metadata，原始数据留在内存）
        prefsStore.updatePath('sketch.strokeCount', this.strokes.length);
      }
      this.currentStroke = null;
      this._render();
    };

    this.canvas.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', end);

    // ResizeObserver: 工具栏折叠时同步尺寸
    if (window.ResizeObserver) {
      new ResizeObserver(() => this._resize()).observe(this.container);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.classList.toggle('active', mode === 'sketch');
  }

  setColor(color) { this.color = color; }
  setLineWidth(w) { this.lineWidth = w; }
  setOpacity(o) { this.opacity = o; }

  undo() {
    if (this.strokes.length === 0) return;
    const s = this.strokes.pop();
    this.undoStack.push(s);
    prefsStore.updatePath('sketch.strokeCount', this.strokes.length);
    this._render();
  }

  redo() {
    if (this.undoStack.length === 0) return;
    const s = this.undoStack.pop();
    this.strokes.push(s);
    prefsStore.updatePath('sketch.strokeCount', this.strokes.length);
    this._render();
  }

  clear() {
    if (this.strokes.length === 0 && this.undoStack.length === 0) return;
    this.undoStack.push(...this.strokes);
    this.strokes = [];
    prefsStore.updatePath('sketch.strokeCount', 0);
    this._render();
  }

  exportPng() {
    // 把当前画板渲染到一个独立 canvas
    const r = this.canvas.getBoundingClientRect();
    const tmp = document.createElement('canvas');
    tmp.width = r.width * this.dpr;
    tmp.height = r.height * this.dpr;
    const tctx = tmp.getContext('2d');
    tctx.scale(this.dpr, this.dpr);
    // 渲染所有笔触
    this._renderTo(tctx, r.width, r.height);
    return tmp.toDataURL('image/png');
  }

  _render() {
    const r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const all = this.currentStroke ? this.strokes.concat([this.currentStroke]) : this.strokes;
    StrokeRenderer.renderTo(this.ctx, all, r.width, r.height);
  }

  _renderTo(ctx, w, h) {
    // 兼容旧调用（ExportService 内部会用到 offscreen canvas）
    const all = this.currentStroke ? this.strokes.concat([this.currentStroke]) : this.strokes;
    StrokeRenderer.renderTo(ctx, all, w, h);
  }
}




const sketchCanvasEl = document.getElementById('sketch-canvas');
const sketchCanvas = new SketchCanvas(sketchCanvasEl, canvasContainer);

// ============ v1.1: 批注图层（独立于画板，红色笔 / 红色圆圈） ============
class AnnotationLayer {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.undoStack = [];
    this.currentStroke = null;
    this.enabled = false; // 是否处于批注模式（打开开关后为 true）
    this.shape = 'pen'; // 'pen' | 'circle'
    this.color = '#d4604f';
    this.lineWidth = 3;
    this.opacity = 0.95;
    this.readOnly = false;
    this.dpr = window.devicePixelRatio || 1;
    this._resize();
    this._bindEvents();
    this._render();
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setEnabled(on) {
    this.enabled = !!on;
    document.body.classList.toggle('ann-active', this.enabled && !this.readOnly);
    const badge = document.getElementById('ann-badge');
    if (badge) badge.style.display = this.enabled ? 'inline-block' : 'none';
    const tgl = document.getElementById('ann-toggle');
    if (tgl) tgl.checked = this.enabled;
    this._render();
  }

  setShape(shape) {
    this.shape = shape;
    document.getElementById('ann-shape-pen')?.classList.toggle('active', shape === 'pen');
    document.getElementById('ann-shape-circle')?.classList.toggle('active', shape === 'circle');
  }

  setLineWidth(w) {
    this.lineWidth = w;
    const el = document.getElementById('ann-line-width-val');
    if (el) el.textContent = w + ' px';
  }

  undo() {
    if (this.strokes.length === 0) return;
    const s = this.strokes.pop();
    this.undoStack.push(s);
    this._render();
  }

  clear() {
    if (this.strokes.length === 0 && this.undoStack.length === 0) return;
    if (this.readOnly) { this.undoStack = []; this.strokes = []; this._render(); return; }
    this.undoStack.push(...this.strokes);
    this.strokes = [];
    this._render();
  }

  exportStrokes() {
    // 深拷贝，避免外部修改影响内部状态
    return JSON.parse(JSON.stringify(this.strokes));
  }

  importStrokes(strokes, { readOnly = false } = {}) {
    this.strokes = Array.isArray(strokes) ? strokes.map(s => JSON.parse(JSON.stringify(s))) : [];
    this.undoStack = [];
    this.readOnly = !!readOnly;
    document.body.classList.toggle('ann-active', this.enabled && !this.readOnly);
    this._render();
  }

  _render() {
    const r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const all = this.currentStroke ? this.strokes.concat([this.currentStroke]) : this.strokes;
    StrokeRenderer.renderTo(this.ctx, all, r.width, r.height);
  }

  _bindEvents() {
    const getPos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0)) - r.left;
      const y = (e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0)) - r.top;
      return { x, y };
    };

    const start = (e) => {
      if (!this.enabled || this.readOnly) return;
      const pos = getPos(e);
      e.preventDefault();
      if (this.shape === 'circle') {
        this.currentStroke = {
          type: 'circle',
          color: this.color,
          baseWidth: this.lineWidth,
          opacity: this.opacity,
          rect: { x: pos.x, y: pos.y, w: 0, h: 0 },
        };
      } else {
        const pressure = (e.pressure !== undefined && e.pressure > 0 && e.pressure <= 1) ? e.pressure : 0.5;
        this.currentStroke = {
          color: this.color,
          baseWidth: this.lineWidth,
          opacity: this.opacity,
          points: [{ x: pos.x, y: pos.y, pressure }],
        };
      }
      this.canvas.setPointerCapture && e.pointerId !== undefined && this.canvas.setPointerCapture(e.pointerId);
    };

    const move = (e) => {
      if (!this.currentStroke) return;
      e.preventDefault();
      const pos = getPos(e);
      if (this.currentStroke.type === 'circle') {
        const start = this.currentStroke.rect;
        this.currentStroke.rect = { x: start.x, y: start.y, w: pos.x - start.x, h: pos.y - start.y };
      } else {
        const pressure = (e.pressure !== undefined && e.pressure > 0 && e.pressure <= 1) ? e.pressure : 0.5;
        this.currentStroke.points.push({ x: pos.x, y: pos.y, pressure });
      }
      this._render();
    };

    const end = (e) => {
      if (!this.currentStroke) return;
      // 圆形：宽高过小视为点击，不入库
      if (this.currentStroke.type === 'circle') {
        const r = this.currentStroke.rect;
        if (Math.abs(r.w) >= 4 && Math.abs(r.h) >= 4) {
          this.strokes.push(this.currentStroke);
          this.undoStack = [];
        }
      } else {
        if (this.currentStroke.points.length >= 2) {
          this.strokes.push(this.currentStroke);
          this.undoStack = [];
        }
      }
      this.currentStroke = null;
      this._render();
    };

    this.canvas.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', end);

    if (window.ResizeObserver) {
      new ResizeObserver(() => this._resize()).observe(this.container);
    }
  }
}

const annotationCanvasEl = document.getElementById('annotation-canvas');
const annotationLayer = new AnnotationLayer(annotationCanvasEl, canvasContainer);

// ============ v1.1: 计时器状态机 ============
const POMODORO_WORK_MS = 25 * 60 * 1000;
const POMODORO_BREAK_MS = 5 * 60 * 1000;
const EXAM_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CUSTOM_MS = 45 * 60 * 1000; // 自定义时长默认值 45 分钟

class TimerStore {
  constructor(userManager) {
    this.userManager = userManager;
    this.mode = 'pomodoro';
    this._customDurationMs = DEFAULT_CUSTOM_MS;
    this.state = 'idle'; // idle | running | paused | finished
    this.durationMs = POMODORO_WORK_MS;
    this.remainingMs = POMODORO_WORK_MS;
    this.cycle = 1; // pomodoro: odd=work, even=break
    this.sessionStartedAt = null;
    this.finishedAt = null;
    this.lastTickAt = Date.now();
    this.listeners = { tick: [], state: [], finish: [] };
    this._persistHandle = null;
    this._rafId = null;
    this._loop = this._loop.bind(this);
    this._lastPersist = 0;
    this.load();
    this._renderUI();
    // 仅当 reload 时检测到 running 状态才启动 loop
    if (this.state === 'running') this._startLoop();
  }

  on(event, cb) {
    if (this.listeners[event]) this.listeners[event].push(cb);
  }
  _emit(event, payload) {
    (this.listeners[event] || []).forEach(cb => {
      try { cb(payload); } catch (e) { console.warn('[TimerStore]', event, e); }
    });
  }

  _key(userId) { return 'sketch-ref-timer-' + userId; }

  load() {
    const user = this.userManager.getCurrent();
    if (!user) return;
    try {
      const raw = localStorage.getItem(this._key(user.id));
      if (!raw) { this._resetForMode(true); return; }
      const s = JSON.parse(raw);
      if (!s || s.schemaVersion !== 1) { this._resetForMode(true); return; }
      this.mode = s.mode || 'pomodoro';
      this.state = s.state || 'idle';
      this.durationMs = s.durationMs || this._durationForMode(this.mode, s.cycle || 1);
      this.remainingMs = s.remainingMs != null ? s.remainingMs : this.durationMs;
      this.cycle = s.cycle || 1;
      this.sessionStartedAt = s.sessionStartedAt || null;
      this.finishedAt = s.finishedAt || null;
      this.lastTickAt = s.lastTickAt || Date.now();
      if (s.customDurationMs) this._customDurationMs = s.customDurationMs;

      // 补偿刷新漂移
      if (this.state === 'running') {
        const now = Date.now();
        const elapsed = now - this.lastTickAt;
        if (elapsed > 0) {
          this.remainingMs = Math.max(0, this.remainingMs - elapsed);
          this.lastTickAt = now;
          if (this.remainingMs <= 0) {
            this.state = 'finished';
            this.finishedAt = now;
            // 异步触发 finish（historyStore 可能尚未实例化）
            setTimeout(() => this._emit('finish', this.snapshotSession('auto')), 0);
          }
        }
      }
    } catch (e) {
      console.warn('[TimerStore] load failed:', e);
      this._resetForMode(true);
    }
    this._renderUI();
  }

  save() {
    const user = this.userManager.getCurrent();
    if (!user) return;
    const payload = {
      schemaVersion: 1,
      mode: this.mode,
      customDurationMs: this._customDurationMs,
      state: this.state,
      durationMs: this.durationMs,
      remainingMs: this.remainingMs,
      cycle: this.cycle,
      sessionStartedAt: this.sessionStartedAt,
      finishedAt: this.finishedAt,
      lastTickAt: this.lastTickAt,
    };
    try { localStorage.setItem(this._key(user.id), JSON.stringify(payload)); } catch (e) {}
  }

  _durationForMode(mode, cycle) {
    if (mode === 'pomodoro') return cycle % 2 === 1 ? POMODORO_WORK_MS : POMODORO_BREAK_MS;
    if (mode === 'exam') return EXAM_MS;
    if (mode === 'custom') return this._customDurationMs || DEFAULT_CUSTOM_MS;
    return 0; // free 模式无固定时长
  }

  _resetForMode(silent = false) {
    this.cycle = 1;
    this.durationMs = this._durationForMode(this.mode, this.cycle);
    this.remainingMs = (this.mode === 'free' || this.mode === 'custom') ? this.durationMs : this.durationMs;
    this.state = 'idle';
    this.sessionStartedAt = null;
    this.finishedAt = null;
    this.lastTickAt = Date.now();
    this.save();
    if (!silent) this._emit('state', this.getState());
    this._renderUI();
  }

  setMode(mode) {
    if (!['pomodoro', 'free', 'exam', 'custom'].includes(mode)) return;
    if (this.state === 'running') {
      if (!confirm('计时进行中，切换模式将重置当前计时，确定？')) return;
    }
    this.mode = mode;
    this._resetForMode();
  }

  // 自定义时长：UI 调用，分钟数 → ms。最小 1 分钟，最大 8 小时
  setCustomDuration(minutes) {
    const mins = Math.max(1, Math.min(8 * 60, Math.round(Number(minutes) || 0)));
    this._customDurationMs = mins * 60 * 1000;
    if (this.mode === 'custom' && this.state !== 'running') {
      this.durationMs = this._customDurationMs;
      this.remainingMs = this._customDurationMs;
      this.save();
      this._emit('state', this.getState());
      this._renderUI();
    }
  }

  start() {
    if (this.state === 'running') return;
    if (this.state === 'finished') {
      // finished 后再点 ▶：进入下一段（pomodoro work→break→work...）
      if (this.mode === 'pomodoro') {
        this.cycle += 1;
        this.durationMs = this._durationForMode(this.mode, this.cycle);
        this.remainingMs = this.durationMs;
      } else if (this.mode === 'custom') {
        this.durationMs = this._durationForMode(this.mode, this.cycle);
        this.remainingMs = this.durationMs;
      } else {
        this.remainingMs = this.mode === 'free' ? 0 : this.durationMs;
      }
    }
    if (this.mode === 'free' && this.state === 'idle') {
      // 自由计时：从 0 开始累计
      this.durationMs = 0;
      this.remainingMs = 0;
    }
    if (this.mode === 'custom' && this.state === 'idle') {
      // 自定义计时：从 durationMs 倒计时
      this.durationMs = this._durationForMode(this.mode, this.cycle);
      this.remainingMs = this.durationMs;
    }
    this.state = 'running';
    if (this.sessionStartedAt == null) this.sessionStartedAt = Date.now();
    this.lastTickAt = Date.now();
    this.save();
    this._emit('state', this.getState());
    this._renderUI();
    this._startLoop();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.lastTickAt = Date.now();
    this.save();
    this._emit('state', this.getState());
    this._renderUI();
    this._stopLoop();
  }

  toggle() {
    if (this.state === 'running') this.pause();
    else this.start();
  }

  reset() {
    this._resetForMode();
    showToast('已重置计时器', '');
  }

  // 返回一段"已完成 session"的快照（计时器/历史用）
  snapshotSession(mode = 'manual') {
    const user = this.userManager.getCurrent();
    const elapsed = this.sessionStartedAt ? Date.now() - this.sessionStartedAt : 0;
    return {
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(),
      durationMs: elapsed || this.durationMs,
      mode: mode === 'auto' ? this.mode : mode,
      userId: user ? user.id : null,
    };
  }

  getState() {
    return {
      mode: this.mode,
      state: this.state,
      durationMs: this.durationMs,
      remainingMs: this.remainingMs,
      cycle: this.cycle,
      sessionStartedAt: this.sessionStartedAt,
    };
  }

  // 主循环：仅在 running 时跑；finished/idle 时不浪费 RAF（减低空闲时的 TBT）
  _startLoop() {
    if (this._rafId != null) return;
    this._rafId = requestAnimationFrame(this._loop);
  }
  _stopLoop() {
    if (this._rafId != null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }
  _loop() {
    this._rafId = null;
    const now = Date.now();
    if (this.state === 'running') {
      const elapsed = now - this.lastTickAt;
      if (elapsed > 0) {
        this.remainingMs = Math.max(0, this.remainingMs - elapsed);
        this.lastTickAt = now;
        if (now - this._lastPersist > 5000) {
          this.save();
          this._lastPersist = now;
        }
        if (this.remainingMs <= 0) {
          this.state = 'finished';
          this.finishedAt = now;
          this.save();
          this._emit('finish', this.snapshotSession('auto'));
          this._renderUI();
          try { playChime(); } catch (e) {}
        } else {
          this._renderDisplay();
          this._emit('tick', this.getState());
        }
      }
    }
    // 仅当仍 running 时继续下一帧
    if (this.state === 'running') this._rafId = requestAnimationFrame(this._loop);
  }

  _formatMMSS(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  _renderDisplay() {
    const el = document.getElementById('tw-display');
    if (!el) return;
    el.textContent = this._formatMMSS(this.remainingMs);
  }

  _renderUI() {
    this._renderDisplay();
    const labelEl = document.getElementById('tw-mode-label');
    if (labelEl) {
      const labels = { pomodoro: '番茄钟', free: '自由计时', exam: '考试模拟', custom: '自定义计时' };
      labelEl.textContent = labels[this.mode] || this.mode;
    }
    document.querySelectorAll('[data-tw-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.twMode === this.mode);
    });
    // 自定义时长面板：仅在 custom 模式时显示，并把当前值同步到 input
    const customPanel = document.getElementById('tw-custom-panel');
    if (customPanel) {
      customPanel.hidden = this.mode !== 'custom';
      if (this.mode === 'custom') {
        const mins = Math.round((this._customDurationMs || DEFAULT_CUSTOM_MS) / 60000);
        const hEl = document.getElementById('tw-custom-hours');
        const mEl = document.getElementById('tw-custom-mins');
        if (hEl && document.activeElement !== hEl) hEl.value = Math.floor(mins / 60);
        if (mEl && document.activeElement !== mEl) mEl.value = mins % 60;
      }
    }
    const widget = document.getElementById('timer-widget');
    if (widget) {
      widget.classList.toggle('running', this.state === 'running');
      widget.classList.toggle('paused', this.state === 'paused');
      widget.classList.toggle('finished', this.state === 'finished');
    }
    const playBtn = document.getElementById('tw-play');
    if (playBtn) {
      playBtn.textContent = this.state === 'running' ? '⏸ 暂停' : (this.state === 'finished' ? '▶ 下一段' : '▶ 开始');
    }
  }
}

function playChime() {
  // 简单的 0.3s 蜂鸣，用 WebAudio 不引入新文件
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* 忽略音频失败 */ }
}

const timerStore = new TimerStore(userManager);

// ============ v1.1: 导出服务（PNG / PDF） ============
class ExportService {
  constructor({ renderer, scene, camera, sketchCanvas, annotationLayer, timerStore }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sketchCanvas = sketchCanvas;
    this.annotationLayer = annotationLayer;
    this.timerStore = timerStore;
    this._jspdfModule = null;
    this._jspdfFailed = false;
  }

  // 合成 PNG dataURL（3D + 画板 + 批注）
  takeCompositePng({ includeAnnotation = true, quality = 0.85, type = 'image/jpeg' } = {}) {
    if (!this.renderer) return null;
    this.renderer.render(this.scene, this.camera);
    const composite = document.createElement('canvas');
    composite.width = this.renderer.domElement.width;
    composite.height = this.renderer.domElement.height;
    const ctx = composite.getContext('2d');
    // 1. 3D
    ctx.drawImage(this.renderer.domElement, 0, 0);
    // 2. 画板
    if (this.sketchCanvas && this.sketchCanvas.strokes.length > 0) {
      ctx.globalAlpha = this.sketchCanvas.opacity;
      ctx.drawImage(this.sketchCanvas.canvas, 0, 0, composite.width, composite.height);
      ctx.globalAlpha = 1;
    }
    // 3. 批注（在画板之上，独立 layer）
    if (includeAnnotation && this.annotationLayer && this.annotationLayer.strokes.length > 0) {
      // 把批注渲染到 offscreen，再叠
      const off = document.createElement('canvas');
      const r = this.annotationLayer.canvas.getBoundingClientRect();
      off.width = r.width * (this.annotationLayer.dpr || 1);
      off.height = r.height * (this.annotationLayer.dpr || 1);
      const offCtx = off.getContext('2d');
      offCtx.scale(this.annotationLayer.dpr || 1, this.annotationLayer.dpr || 1);
      StrokeRenderer.renderTo(offCtx, this.annotationLayer.strokes, r.width, r.height);
      ctx.drawImage(off, 0, 0, composite.width, composite.height);
    }
    return composite.toDataURL(type, quality);
  }

  exportPng() {
    const dataUrl = this.takeCompositePng({ type: 'image/png' });
    if (!dataUrl) { showToast('3D 未就绪', 'error'); return; }
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = 'sketch-' + ts + '.png';
    a.href = dataUrl;
    a.click();
    showToast('已保存 PNG（含批注）', 'success');
  }

  async _getJsPdf() {
    if (this._jspdfModule) return this._jspdfModule;
    if (this._jspdfFailed) return null;
    try {
      this._jspdfModule = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
      return this._jspdfModule;
    } catch (e) {
      this._jspdfFailed = true;
      console.warn('[ExportService] jsPDF 加载失败', e);
      return null;
    }
  }

  async exportPdf({ caption = null } = {}) {
    const mod = await this._getJsPdf();
    if (!mod) {
      showToast('PDF 导出需要联网（jsPDF CDN 不可达）', 'error');
      return;
    }
    const dataUrl = this.takeCompositePng({ type: 'image/jpeg', quality: 0.85 });
    if (!dataUrl) { showToast('3D 未就绪', 'error'); return; }
    const { jsPDF } = mod;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const pageW = 297, pageH = 210;
    const margin = 12;
    const imgW = pageW - margin * 2;
    const imgH = imgW * 9 / 16; // 16:9 宽屏
    doc.addImage(dataUrl, 'JPEG', margin, margin, imgW, imgH);
    // 底部 caption
    const txt = caption || (() => {
      const d = new Date();
      const ts = d.toISOString().replace(/T/, ' ').slice(0, 19);
      const timer = this.timerStore ? this.timerStore.getState() : null;
      const modeLabel = timer ? ({ pomodoro: '番茄钟', free: '自由', exam: '考试', custom: '自定义' }[timer.mode] || timer.mode) : '';
      return ts + (modeLabel ? ' · ' + modeLabel : '');
    })();
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(txt, margin, pageH - margin);
    doc.save('sketch-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.pdf');
    showToast('已保存 PDF（含批注）', 'success');
  }
}

const exportService = new ExportService({
  renderer, scene, camera,
  sketchCanvas, annotationLayer, timerStore,
});

// ============ v1.1: 历史记录 ============
class HistoryStore {
  constructor(userManager, { cap = 50 } = {}) {
    this.userManager = userManager;
    this.cap = cap;
    this.records = [];
    this._loaded = false;
    this._listeners = [];
    this.load();
  }

  on(cb) { this._listeners.push(cb); }
  _emit() { this._listeners.forEach(cb => { try { cb(); } catch (e) {} }); }

  _key(userId) { return 'sketch-ref-history-' + userId; }

  load() {
    const user = this.userManager.getCurrent();
    if (!user) { this.records = []; this._loaded = true; return; }
    try {
      const raw = localStorage.getItem(this._key(user.id));
      this.records = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[HistoryStore] load failed', e);
      this.records = [];
    }
    this._loaded = true;
  }

  _save() {
    const user = this.userManager.getCurrent();
    if (!user) return false;
    try {
      localStorage.setItem(this._key(user.id), JSON.stringify(this.records));
      return true;
    } catch (e) {
      return false;
    }
  }

  list() {
    return this.records.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  getById(id) {
    return this.records.find(r => r.id === id);
  }

  add(record) {
    // record: 完整 HistoryRecord（已含 compositeJpegDataUrl 等）
    this.records.unshift(record);
    // LRU: 超过 cap 时弹掉最老的
    while (this.records.length > this.cap) this.records.pop();
    // 配额保护：失败 → 弹老 → 重试一次
    if (!this._save()) {
      this.records.pop();
      while (this.records.length > this.cap - 5) this.records.pop();
      if (!this._save()) {
        showToast('存储已满，无法保存', 'error');
        return false;
      }
    }
    this._emit();
    return true;
  }

  update(id, patch) {
    const rec = this.records.find(r => r.id === id);
    if (!rec) return false;
    Object.assign(rec, patch);
    const ok = this._save();
    this._emit();
    return ok;
  }

  remove(id) {
    const before = this.records.length;
    this.records = this.records.filter(r => r.id !== id);
    if (this.records.length < before) {
      this._save();
      this._emit();
      return true;
    }
    return false;
  }

  clear() {
    this.records = [];
    this._save();
    this._emit();
  }

  // ===== 聚合器 =====
  totalThisWeek() {
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // 周一 = 0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    return this.records
      .filter(r => r.createdAt >= monday.getTime())
      .reduce((sum, r) => sum + (r.durationMs || 0), 0);
  }

  modelsCovered() {
    const map = new Map();
    this.records.forEach(r => {
      const f = r.modelParams && r.modelParams.modelFile ? r.modelParams.modelFile : '未知';
      map.set(f, (map.get(f) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([modelFile, count]) => ({ modelFile, count }))
      .sort((a, b) => b.count - a.count);
  }

  totals() {
    let totalStrokes = 0;
    this.records.forEach(r => {
      if (Array.isArray(r.strokes)) totalStrokes += r.strokes.length;
    });
    return { totalStrokes, totalRecords: this.records.length };
  }

  currentStreakDays() {
    if (this.records.length === 0) return 0;
    // 把所有 createdAt 折算成 YYYY-MM-DD 集合
    const days = new Set();
    this.records.forEach(r => {
      const d = new Date(r.createdAt);
      days.add(d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate());
    });
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // 从今天往前数；如果今天没有，看昨天有没有（避免凌晨练习被判 0）
    if (!days.has(cursor.getFullYear() + '-' + cursor.getMonth() + '-' + cursor.getDate())) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(cursor.getFullYear() + '-' + cursor.getMonth() + '-' + cursor.getDate())) {
        return 0;
      }
    }
    while (days.has(cursor.getFullYear() + '-' + cursor.getMonth() + '-' + cursor.getDate())) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
}

const historyStore = new HistoryStore(userManager);

// ============ v1.1: 保存当前会话快照 ============
function buildCurrentSnapshotBase(mode = 'manual') {
  const ts = timerStore.snapshotSession(mode);
  const user = userManager.getCurrent();
  let view = null, light = null;
  try {
    view = (typeof view !== 'undefined' && view) ? { az: view.baseAz || 0, el: view.baseEl || 0, distance: view.baseDist || 1 } : null;
  } catch (e) {}
  try {
    light = (typeof keyLight !== 'undefined' && keyLight) ? {
      az: (typeof view !== 'undefined' && view) ? (view.baseAz || 0) : 0,
      el: (typeof view !== 'undefined' && view) ? (view.baseEl || 0) : 0,
      intensity: keyLight.intensity != null ? keyLight.intensity : 1,
      ambient: (typeof ambient !== 'undefined' && ambient) ? ambient.intensity : 0.3,
    } : null;
  } catch (e) {}
  return {
    ...ts,
    userId: user ? user.id : null,
    strokes: sketchCanvas.strokes.map(s => JSON.parse(JSON.stringify(s))),
    annotations: annotationLayer.strokes.map(s => JSON.parse(JSON.stringify(s))),
    modelParams: {
      modelFile: (typeof CONFIG !== 'undefined' && CONFIG.modelFile) || 'model.glb',
      view: view || { az: 0, el: 0, distance: 1 },
      light: light || { az: 0, el: 0, intensity: 1, ambient: 0.3 },
    },
    compositeJpegDataUrl: '',
  };
}

function saveCurrentSnapshot(mode = 'manual') {
  const rec = buildCurrentSnapshotBase(mode);
  // 生成 composite（可能略慢，给个 toast）
  showToast('正在保存…', '');
  setTimeout(() => {
    try {
      rec.compositeJpegDataUrl = exportService.takeCompositePng({ type: 'image/jpeg', quality: 0.85 });
    } catch (e) {
      console.warn('[saveCurrentSnapshot] composite failed', e);
    }
    const ok = historyStore.add(rec);
    if (ok) {
      showToast('已保存到历史记录', 'success');
      // 重置计时器的 sessionStartedAt，让"下一次"重新计时
      timerStore.sessionStartedAt = null;
      timerStore._resetForMode(true);
    }
  }, 50);
}

// 自动快照：计时器归零时
timerStore.on('finish', (session) => {
  // 把 snapshot 的 mode 换成 timer 当前的 mode
  saveCurrentSnapshot(session.mode || 'auto');
});

// ============ v1.1: 历史记录面板 ============
function fmtDuration(ms) {
  if (!ms || ms < 0) return '0 分钟';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + ' 分钟';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + ' 小时 ' + m + ' 分钟';
}
function fmtRelativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function modeLabel(mode) {
  return ({ pomodoro: '番茄钟', free: '自由', exam: '考试', custom: '自定义', manual: '手动' }[mode] || mode);
}

function renderHistoryGrid() {
  const grid = document.getElementById('history-grid');
  const empty = document.getElementById('history-empty');
  const count = document.getElementById('history-count');
  if (!grid) return;
  const records = historyStore.list();
  grid.innerHTML = '';
  count.textContent = records.length ? '（' + records.length + '）' : '';
  if (records.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  records.forEach(rec => {
    const card = document.createElement('div');
    card.className = 'history-thumb';
    card.dataset.recId = rec.id;
    if (rec.compositeJpegDataUrl) {
      const img = document.createElement('img');
      img.src = rec.compositeJpegDataUrl;
      img.alt = '历史记录';
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      const e = document.createElement('div');
      e.className = 'thumb-empty';
      e.textContent = '（空白）';
      card.appendChild(e);
    }
    const cap = document.createElement('div');
    cap.className = 'thumb-caption';
    cap.innerHTML = '<span>' + escapeHtml(fmtRelativeTime(rec.createdAt)) + '</span>' +
                    '<span class="thumb-mode">' + escapeHtml(modeLabel(rec.mode)) + '</span>';
    card.appendChild(cap);
    card.addEventListener('click', () => openHistoryViewer(rec.id));
    grid.appendChild(card);
  });
}

function openHistoryPanel() {
  renderHistoryGrid();
  document.getElementById('history-panel').classList.add('visible');
}
function closeHistoryPanel() {
  document.getElementById('history-panel').classList.remove('visible');
  closeHistoryViewer();
}
document.getElementById('close-history').addEventListener('click', closeHistoryPanel);

// ============ v1.1: 历史查看器 ============
let currentViewingRecId = null;

function openHistoryViewer(recId) {
  const rec = historyStore.getById(recId);
  if (!rec) return;
  currentViewingRecId = recId;
  const viewer = document.getElementById('history-viewer');
  const img = document.getElementById('mv-img');
  const meta = document.getElementById('mv-meta');
  const title = document.getElementById('mv-title');
  title.textContent = modeLabel(rec.mode) + ' · ' + fmtRelativeTime(rec.createdAt);
  img.src = rec.compositeJpegDataUrl || '';
  img.style.display = rec.compositeJpegDataUrl ? 'block' : 'none';
  const dur = fmtDuration(rec.durationMs);
  const model = rec.modelParams && rec.modelParams.modelFile ? rec.modelParams.modelFile.split('/').pop() : '?';
  meta.innerHTML =
    '<span>📅 ' + new Date(rec.createdAt).toLocaleString('zh-CN') + '</span>' +
    '<span>⏱ 时长 ' + dur + '</span>' +
    '<span>🎨 模型 ' + escapeHtml(model) + '</span>' +
    '<span>✏️ 批注 ' + (rec.annotations ? rec.annotations.length : 0) + ' 个</span>';
  viewer.classList.add('visible');
}

function closeHistoryViewer() {
  document.getElementById('history-viewer').classList.remove('visible');
  currentViewingRecId = null;
}
document.getElementById('mv-close').addEventListener('click', closeHistoryViewer);

document.getElementById('mv-delete').addEventListener('click', () => {
  if (!currentViewingRecId) return;
  if (!confirm('删除这条历史记录？')) return;
  historyStore.remove(currentViewingRecId);
  closeHistoryViewer();
  renderHistoryGrid();
  showToast('已删除', 'success');
});

document.getElementById('mv-export-pdf').addEventListener('click', async () => {
  const rec = currentViewingRecId ? historyStore.getById(currentViewingRecId) : null;
  if (!rec) return;
  const caption = new Date(rec.createdAt).toLocaleString('zh-CN') + ' · ' + modeLabel(rec.mode) + ' · ' + fmtDuration(rec.durationMs);
  await exportService.exportPdf({ caption });
});

document.getElementById('mv-edit-ann').addEventListener('click', () => {
  const rec = currentViewingRecId ? historyStore.getById(currentViewingRecId) : null;
  if (!rec) return;
  // 载入批注到当前画板批注层（开启批注模式）
  annotationLayer.importStrokes(rec.annotations || [], { readOnly: false });
  annotationLayer.setEnabled(true);
  closeHistoryViewer();
  closeHistoryPanel();
  showToast('批注已载入，开始编辑。完成后点"保存本次"会写入新历史记录', '');
});

// ============ v1.1: 进度看板 ============
function renderDashboard() {
  const recs = historyStore.list();
  document.getElementById('dash-week').textContent = fmtDuration(historyStore.totalThisWeek());
  const totals = historyStore.totals();
  document.getElementById('dash-totals').textContent = totals.totalStrokes + ' / ' + totals.totalRecords;
  document.getElementById('dash-streak').textContent = historyStore.currentStreakDays() + ' 天';
  const list = document.getElementById('dash-models');
  const models = historyStore.modelsCovered();
  list.innerHTML = '';
  if (models.length === 0) {
    const li = document.createElement('li');
    li.className = 'dash-empty';
    li.textContent = '暂无记录';
    list.appendChild(li);
  } else {
    models.forEach(m => {
      const li = document.createElement('li');
      const name = m.modelFile.split('/').pop();
      li.innerHTML = '<span>' + escapeHtml(name) + '</span><span class="value">' + m.count + ' 次</span>';
      list.appendChild(li);
    });
  }
}

function openDashboardPanel() {
  renderDashboard();
  document.getElementById('dashboard-panel').classList.add('visible');
}
function closeDashboardPanel() {
  document.getElementById('dashboard-panel').classList.remove('visible');
}
document.getElementById('close-dashboard').addEventListener('click', closeDashboardPanel);

// 历史 store 变更时，若面板打开则自动刷新
historyStore.on(() => {
  if (document.getElementById('history-panel').classList.contains('visible')) renderHistoryGrid();
  if (document.getElementById('dashboard-panel').classList.contains('visible')) renderDashboard();
});

// ============ 加载偏好并应用到 UI ============
function applyPrefsToUI(prefs) {
  // 光源（直接设置 slider 值，再触发 updateKeyLight）
  const azSlider = document.getElementById('light-azimuth');
  const elSlider = document.getElementById('light-elevation');
  const intSlider = document.getElementById('light-intensity');
  const ambSlider = document.getElementById('ambient');
  if (azSlider) azSlider.value = Math.round(prefs.light.az * 180 / Math.PI);
  if (elSlider) elSlider.value = Math.round(prefs.light.el * 180 / Math.PI);
  if (intSlider) intSlider.value = prefs.light.intensity;
  if (ambSlider) ambSlider.value = prefs.light.ambient;
  if (typeof updateKeyLight === 'function') updateKeyLight();
  // 视角
  if (view) {
    view.sensitivity = prefs.view.sensitivity;
    view.range = prefs.view.range;
    view.damping = prefs.view.damping;
  }
  const sensEl = document.getElementById('sensitivity');
  const rangeEl = document.getElementById('range-slider');
  const dampEl = document.getElementById('damping');
  if (sensEl) sensEl.value = Math.round(prefs.view.sensitivity * 100);
  if (rangeEl) rangeEl.value = Math.round(prefs.view.range * 100);
  if (dampEl) dampEl.value = Math.round(prefs.view.damping * 100);

  // 画板
  sketchCanvas.setColor(prefs.sketch.color);
  sketchCanvas.setLineWidth(prefs.sketch.lineWidth);
  sketchCanvas.setOpacity(prefs.sketch.opacity);
  sketchCanvas.setMode(prefs.sketch.mode);
  document.querySelectorAll('#sketch-colors .swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === prefs.sketch.color);
  });
  const lw = document.getElementById('line-width');
  const op = document.getElementById('sketch-opacity');
  if (lw) lw.value = prefs.sketch.lineWidth;
  if (op) op.value = Math.round(prefs.sketch.opacity * 100);
  document.getElementById('line-width-val').textContent = prefs.sketch.lineWidth + ' px';
  document.getElementById('sketch-opacity-val').textContent = Math.round(prefs.sketch.opacity * 100) + '%';
  document.getElementById('mode-view').classList.toggle('active', prefs.sketch.mode === 'view');
  document.getElementById('mode-sketch').classList.toggle('active', prefs.sketch.mode === 'sketch');
}


async function tryFetchModel() {
  try {
    // 1. 先试 IDB 缓存
    const cached = await modelDB.getModel(userManager.currentUserId, CONFIG.modelFile);
    if (cached && cached.glbBlob) {
      console.log('[ModelLoader] IDB cache hit:', CONFIG.modelFile);
      const buf = await cached.glbBlob.arrayBuffer();
      parseModelBuffer(buf);
      return true;
    }
    // 2. 走网络
    const res = await fetch(CONFIG.modelFile, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    parseModelBuffer(buf);
    // 3. 写入 IDB（后台）
    const blob = new Blob([buf]);
    modelDB.putModel(userManager.currentUserId, {
      id: CONFIG.modelFile,
      userId: userManager.currentUserId,
      name: CONFIG.modelFile,
      glbBlob: blob,
      sizeBytes: blob.size,
      triangleCount: 0,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
    }).then(() => console.log('[ModelLoader] cached to IDB:', CONFIG.modelFile))
      .catch(e => console.warn('[ModelLoader] IDB write failed:', e));
    return true;
  } catch (e) {
    return false;
  }
}

function showFilePicker(reason) {
  document.getElementById('file-picker-target').textContent = CONFIG.modelFile;
  document.getElementById('file-picker-reason').textContent = reason;
  document.getElementById('file-picker').classList.add('visible');
  document.getElementById('loader').classList.add('hidden');
}

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  loadModelFromFile(file);
  // 重置 input 以便再次选同一文件也能触发 change
  e.target.value = '';
});

document.getElementById('load-from-disk').addEventListener('click', triggerUpload);
document.getElementById('upload-model-header').addEventListener('click', triggerUpload);

const _fabUpload = document.getElementById('upload-model-fab');
const _fabShot = document.getElementById('screenshot-fab');
if (_fabUpload) _fabUpload.addEventListener('click', triggerUpload);
if (_fabShot) _fabShot.addEventListener('click', () => document.getElementById('screenshot').click());

// 集中处理“选文件”动作 + 移动端轻触反馈
function triggerUpload() {
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
  document.getElementById('file-input').click();
}

// ============ 桌面端：拖拽 GLB / GLTF 到画布直接加载 ============
const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0;
['dragenter','dragover'].forEach((evt) => {
  canvasContainer.addEventListener(evt, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    if (dropOverlay) dropOverlay.classList.add('visible');
  });
});
['dragleave','drop'].forEach((evt) => {
  canvasContainer.addEventListener(evt, (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && dropOverlay) dropOverlay.classList.remove('visible');
  });
});
canvasContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  if (dropOverlay) dropOverlay.classList.remove('visible');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const file = Array.from(files).find((f) => /.(glb|gltf)$/i.test(f.name)) || files[0];
  loadModelFromFile(file);
});

// 抽取出来以便拖拽 & 文件输入都能复用
function loadModelFromFile(file) {
  document.getElementById('file-picker').classList.remove('visible');
  document.getElementById('loader').classList.remove('hidden');
  document.getElementById('loader-text').textContent =
    '读取 ' + file.name + '（' + (file.size / 1e6).toFixed(1) + ' MB）...';
  const reader = new FileReader();
  reader.onload = () => {
    // 记住现在加载的文件名，下次 picker 默认显示它
    CONFIG.modelFile = file.name;
    parseModelBuffer(reader.result);
  };
  reader.onerror = () => {
    document.getElementById('loader').classList.add('hidden');
    showFilePicker('读取文件失败：' + reader.error);
  };
  reader.readAsArrayBuffer(file);
}


(async function () {
  const ok = await tryFetchModel();
  if (!ok) {
    const isFile = location.protocol === 'file:';
    const reason = isFile
      ? '检测到 file:// 协议，浏览器禁止自动加载本地模型。请手动选择一次。'
      : '自动加载失败，请手动选择模型文件。';
    showFilePicker(reason);
  } else {
    document.getElementById('loader-text').textContent = '正在解析模型...';
  }
})();

// ============ 预设视角（以球坐标设置） ============
const VIEWS = {
  front:                { az: 0,                el: 0.08, distScale: 1.0  },
  'three-quarter':      { az: Math.PI * 0.18,   el: 0.15, distScale: 1.0  },
  side:                 { az: Math.PI * 0.5,    el: 0.08, distScale: 1.0  },
  'three-quarter-back': { az: Math.PI * 0.82,   el: 0.15, distScale: 1.0  },
  back:                 { az: Math.PI,          el: 0.08, distScale: 1.0  },
  top:                  { az: 0.001,            el: Math.PI * 0.42, distScale: 1.2 },
};

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.view;
    if (v === 'reset') {
      setBaseView(defaultCamAz, defaultCamEl, defaultCamDist, 600);
    } else if (VIEWS[v]) {
      const c = VIEWS[v];
      setBaseView(c.az, c.el, defaultCamDist * c.distScale, 600);
    }
  });
});

document.getElementById('reset-view').addEventListener('click', () => {
  // 视角回正 + 重置手动偏移
  if (view.targetOffset) view.targetOffset.set(0, 0, 0);
  applyTargetOffset();
  setBaseView(defaultCamAz, defaultCamEl, defaultCamDist, 600);
});

// 把相机目标点平滑过渡到模型中心（不动视角），同时清零手动偏移
document.getElementById('recenter').addEventListener('click', () => {
  if (!view.modelBox) return;
  // 重置偏移滑块到 0
  if (view.targetOffset) view.targetOffset.set(0, 0, 0);
  const ox = document.getElementById('offset-x');
  const oy = document.getElementById('offset-y');
  if (ox) { ox.value = 0; document.getElementById('offset-x-val').textContent = '0.00'; }
  if (oy) { oy.value = 0; document.getElementById('offset-y-val').textContent = '0.00'; }
  const fromX = view.target.x, fromY = view.target.y, fromZ = view.target.z;
  const toX = view.modelBox.center.x, toY = view.modelBox.center.y, toZ = view.modelBox.center.z;
  const t0 = performance.now();
  const dur = 400;
  (function step() {
    const t = Math.min((performance.now() - t0) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    view.target.set(
      fromX + (toX - fromX) * e,
      fromY + (toY - fromY) * e,
      fromZ + (toZ - fromZ) * e
    );
    if (t < 1) requestAnimationFrame(step);
  })();
});

// 框选整个模型：根据包围盒自动算距离 + 把目标点对准中心
document.getElementById('frame-model').addEventListener('click', () => {
  if (!view.modelBox) return;
  // 重置手动偏移
  if (view.targetOffset) view.targetOffset.set(0, 0, 0);
  const fromTarget = view.target.clone();
  const toTarget = view.modelBox.center.clone();
  const fromDist = view.curDist;
  const toDist = fitDistanceToModel(view.modelBox.size);
  const fromAz = view.baseAz, fromEl = view.baseEl;
  const toAz = Math.PI * 0.18, toEl = 0.15;
  const t0 = performance.now();
  const dur = 600;
  (function step() {
    const t = Math.min((performance.now() - t0) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    view.target.lerpVectors(fromTarget, toTarget, e);
    view.curDist = fromDist + (toDist - fromDist) * e;
    view.baseDist = view.curDist;
    view.baseAz = fromAz + (toAz - fromAz) * e;
    view.baseEl = fromEl + (toEl - fromEl) * e;
    if (t >= 1) {
      // 同步到默认相机参数（让"视角回正"也回到这个合适的距离）
      defaultCamDist = toDist;
      defaultCamAz = toAz;
      defaultCamEl = toEl;
    }
    if (t < 1) requestAnimationFrame(step);
  })();
});

// 准星显示开关
document.getElementById('show-reticle').addEventListener('change', (e) => {
  const reticle = document.getElementById('tracer-reticle');
  reticle.style.display = e.target.checked ? '' : 'none';
});

// 手动偏移滑块
function setupOffsetSlider(id, axis) {
  const slider = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  slider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    valEl.textContent = v.toFixed(2);
    if (view.targetOffset) {
      view.targetOffset[axis] = v;
      applyTargetOffset();
    }
  });
}
setupOffsetSlider('offset-x', 'x');
setupOffsetSlider('offset-y', 'y');

// 焦点高度滑块：调整视觉焦点在模型顶部往下多少比例
document.getElementById('focus-h').addEventListener('input', (e) => {
  const pct = parseInt(e.target.value, 10);
  document.getElementById('focus-h-val').textContent = pct + '%';
  if (!view.modelBox) return;
  const size = view.modelBox.size;
  const focusPct = pct / 100;
  const newFocusY = FLOOR_Y + size.y * (1 - focusPct);
  // 平滑过渡到新的焦点 Y
  const fromY = view.target.y;
  const t0 = performance.now();
  const dur = 300;
  (function step() {
    const t = Math.min((performance.now() - t0) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    const y = fromY + (newFocusY - fromY) * e;
    view.modelBox.center.y = y;
    applyTargetOffset();
    if (t < 1) requestAnimationFrame(step);
  })();
});

// ============ 背景 ============
document.querySelectorAll('[data-bg]').forEach((el) => {
  el.addEventListener('click', () => {
    scene.background = new THREE.Color(el.dataset.bg);
    document.querySelectorAll('[data-bg]').forEach((x) => x.classList.remove('active'));
    el.classList.add('active');
  });
});

// ============ 灯光 ============
function updateKeyLight() {
  const az = parseFloat(document.getElementById('light-azimuth').value);
  const el = parseFloat(document.getElementById('light-elevation').value);
  const intensity = parseFloat(document.getElementById('light-intensity').value);
  const azR = (az * Math.PI) / 180;
  const elR = (el * Math.PI) / 180;
  const d = 2;
  keyLight.position.set(
    Math.cos(elR) * Math.cos(azR) * d,
    Math.sin(elR) * d,
    Math.cos(elR) * Math.sin(azR) * d
  );
  keyLight.intensity = intensity;
  document.getElementById('light-azimuth-val').textContent = Math.round(az) + '°';
  document.getElementById('light-elevation-val').textContent = Math.round(el) + '°';
  document.getElementById('light-intensity-val').textContent = intensity.toFixed(1);
}
['light-azimuth', 'light-elevation', 'light-intensity'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateKeyLight);
});
document.getElementById('ambient').addEventListener('input', (e) => {
  ambient.intensity = parseFloat(e.target.value);
  document.getElementById('ambient-val').textContent = parseFloat(e.target.value).toFixed(2);
});
['light-azimuth', 'light-elevation', 'light-intensity'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => {
    prefsStore.updatePath('light.' + id.replace('light-', ''), parseFloat(el.value));
  });
});
document.getElementById('ambient').addEventListener('input', (e) => {
  prefsStore.updatePath('light.ambient', parseFloat(e.target.value));
});
updateKeyLight();

// ============ 底盘 / 网格 / 基座 控制 ============
document.getElementById('show-grid').addEventListener('change', (e) => {
  gridHelper.visible = e.target.checked;
  gridFar.visible = e.target.checked;
});
document.getElementById('show-base').addEventListener('change', (e) => {
  baseDisc.visible = e.target.checked;
  baseRim.visible = e.target.checked;
});
document.getElementById('show-axes').addEventListener('change', (e) => { axesHelper.visible = e.target.checked; });

document.getElementById('grid-size').addEventListener('input', (e) => {
  const size = parseFloat(e.target.value);
  document.getElementById('grid-size-val').textContent = size.toFixed(1);
  chassisGroup.remove(gridHelper);
  const divs = Math.max(8, Math.round(size * 10));
  const newGrid = new THREE.GridHelper(size, divs, 0x6b6b6b, 0xbcbcbc);
  newGrid.position.y = FLOOR_Y;
  const op = parseInt(document.getElementById('grid-opacity').value, 10) / 100;
  newGrid.material.opacity = op * 0.9;
  newGrid.material.transparent = true;
  newGrid.material.depthWrite = false;
  newGrid.visible = document.getElementById('show-grid').checked;
  chassisGroup.add(newGrid);
  gridHelper = newGrid;
});

document.getElementById('grid-opacity').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10) / 100;
  document.getElementById('grid-opacity-val').textContent = Math.round(v * 100) + '%';
  gridHelper.material.opacity = v * 0.9;
  gridFar.material.opacity = v * 0.5;
});

document.getElementById('show-wireframe').addEventListener('change', (e) => {
  if (!modelRoot) return;
  const wf = e.target.checked;
  modelRoot.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { m.wireframe = wf; m.needsUpdate = true; });
    }
  });
});

document.getElementById('mirror').addEventListener('change', (e) => {
  if (!modelRoot) return;
  modelRoot.scale.x = e.target.checked ? -1 : 1;
});

document.getElementById('show-compare').addEventListener('change', (e) => {
  const panel = document.getElementById('compare-panel');
  panel.classList.toggle('visible', e.target.checked);
  if (e.target.checked) {
    refreshCompareSketch();
  }
});
document.getElementById('close-compare').addEventListener('click', () => {
  document.getElementById('compare-panel').classList.remove('visible');
  document.getElementById('show-compare').checked = false;
});

// 参考图透明度
const compareRefOpacity = document.getElementById('compare-ref-opacity');
const compareRefOpacityVal = document.getElementById('compare-ref-opacity-val');
if (compareRefOpacity) {
  compareRefOpacity.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const img = document.getElementById('compare-img');
    if (img) img.style.opacity = v / 100;
    if (compareRefOpacityVal) compareRefOpacityVal.textContent = v + '%';
  });
}

// 刷新对比画板：把 sketchCanvas 当前内容渲染到 compare-sketch-canvas
function refreshCompareSketch() {
  const wrap = document.getElementById('compare-sketch-wrap');
  const cmpCanvas = document.getElementById('compare-sketch-canvas');
  const emptyEl = document.getElementById('compare-sketch-empty');
  if (!cmpCanvas || !wrap) return;
  
  const w = 320, h = 320;
  cmpCanvas.width = w;
  cmpCanvas.height = h;
  cmpCanvas.style.width = '100%';
  cmpCanvas.style.height = '100%';
  const ctx = cmpCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  
  if (typeof sketchCanvas === 'undefined' || sketchCanvas.strokes.length === 0) {
    cmpCanvas.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  cmpCanvas.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';
  
  // 计算 sketchCanvas 的 bounding rect 和 cmpCanvas 的 bounding rect 之间的缩放
  const srcRect = sketchCanvas.canvas.getBoundingClientRect();
  const scaleX = w / (srcRect.width || 1);
  const scaleY = h / (srcRect.height || 1);
  
  ctx.save();
  ctx.scale(scaleX, scaleY);
  // 直接重绘所有笔触到 cmpCanvas
  sketchCanvas.strokes.forEach(stroke => {
    if (stroke.points.length < 1) return;
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      const sw = stroke.baseWidth * (0.3 + 0.7 * Math.pow(p.pressure, 0.6));
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, sw/2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i+1];
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const sw = stroke.baseWidth * (0.3 + 0.7 * Math.pow((p1.pressure + p2.pressure)/2, 0.6));
        ctx.lineWidth = sw;
        ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  });
  ctx.restore();
}
window.refreshCompareSketch = refreshCompareSketch;
document.getElementById('compare-refresh').addEventListener('click', () => {
  refreshCompareSketch();
  showToast('已刷新对比', 'success');
});

// ============ 鼠标视角控制 ============
document.getElementById('tracer-view').addEventListener('change', (e) => {
  view.enabled = e.target.checked;
  if (!view.enabled) {
    view.mouseTargetAz = 0;
    view.mouseTargetEl = 0;
  }
});
document.getElementById('sensitivity').addEventListener('input', (e) => {
  view.sensitivity = parseInt(e.target.value, 10) / 100;
  document.getElementById('sensitivity-val').textContent = Math.round(view.sensitivity * 100) + '%';
});
document.getElementById('sensitivity').addEventListener('input', (e) => { prefsStore.updatePath('view.sensitivity', parseInt(e.target.value, 10) / 100); });
document.getElementById('range-slider').addEventListener('input', (e) => {
  view.range = parseInt(e.target.value, 10) / 100;
  document.getElementById('range-val').textContent = Math.round(view.range * 100) + '%';
});
document.getElementById('range-slider').addEventListener('input', (e) => { prefsStore.updatePath('view.range', parseInt(e.target.value, 10) / 100); });
document.getElementById('damping').addEventListener('input', (e) => {
  view.damping = parseInt(e.target.value, 10) / 100;
  document.getElementById('damping-val').textContent = view.damping.toFixed(2);
});
document.getElementById('damping').addEventListener('input', (e) => { prefsStore.updatePath('view.damping', parseInt(e.target.value, 10) / 100); });

// ============ 截图 ============
document.getElementById('screenshot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = 'sketch-ref-' + ts + '.png';
  a.href = url;
  a.click();
});

// ============ 键盘快捷键 ============
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // 不抢 Ctrl+R / Cmd+R 等系统组合键
  const k = e.key.toLowerCase();
  if (k === 'f' || k === 's' || k === 't') {
    const name = k === 'f' ? 'front' : k === 's' ? 'side' : 'top';
    const btn = document.querySelector('[data-view="' + name + '"]');
    if (btn) btn.click();
  } else if (k === 'r') {
    // 视角回正（独立按钮 #reset-view，无 data-view 属性）
    document.getElementById('reset-view').click();
  } else if (k === 'w') {
    document.getElementById('show-wireframe').click();
  } else if (k === 'g') {
    document.getElementById('show-grid').click();
  }
});

// 工具栏折叠/展开
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  const app = document.getElementById('app');
  const btn = document.getElementById('toggle-sidebar');
  const collapsed = app.classList.toggle('collapsed');
  btn.textContent = collapsed ? '⇤' : '⇥';
  btn.title = collapsed ? '展开工具栏' : '折叠工具栏';
  // 重新计算渲染尺寸
  setTimeout(resize, 260);
});

// ============ 自适应 ============
function resize() {
  const r = canvasContainer.getBoundingClientRect();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  renderer.setSize(r.width, r.height);
  // 画布尺寸变了（折叠/展开工具栏、窗口缩放）后，重新归一化偏移，
  // 让模型在屏幕上的相对位置保持稳定 —— 折叠工具栏后依旧居中。
  applyTargetOffset();
}
window.addEventListener('resize', resize);
resize();

// ============ 渲染循环 ============
const viAz = document.getElementById('vi-az');
const viEl = document.getElementById('vi-el');
const viDist = document.getElementById('vi-dist');

function tick() {
  if (view.enabled) {
    const d = view.damping;
    view.mouseAz += (view.mouseTargetAz - view.mouseAz) * d;
    view.mouseEl += (view.mouseTargetEl - view.mouseEl) * d;
  } else {
    view.mouseAz += (0 - view.mouseAz) * view.damping;
    view.mouseEl += (0 - view.mouseEl) * view.damping;
  }

  if (view.animating) {
    const t = Math.min((performance.now() - view.animT0) / view.animDur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    view.curAz = view.animFrom.az + (view.animTo.az - view.animFrom.az) * e;
    view.curEl = view.animFrom.el + (view.animTo.el - view.animFrom.el) * e;
    view.curDist = view.animFrom.dist + (view.animTo.dist - view.animFrom.dist) * e;
    if (t >= 1) {
      view.animating = false;
      view.baseAz = view.curAz;
      view.baseEl = view.curEl;
      view.baseDist = view.curDist;
    }
  } else {
    view.curAz = view.baseAz + view.mouseAz;
    view.curEl = view.baseEl + view.mouseEl;
    view.curDist = view.baseDist;
  }

  applyCameraFromAngles();

  let azDeg = (view.curAz * 180 / Math.PI) % 360;
  if (azDeg < 0) azDeg += 360;
  viAz.textContent = Math.round(azDeg) + '°';
  viEl.textContent = Math.round(view.curEl * 180 / Math.PI) + '°';
  viDist.textContent = view.curDist.toFixed(2);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

canvasContainer.addEventListener('mouseenter', () => {
  document.getElementById('hint').classList.add('hidden');
}, { once: true });


// ============ 新增模块: 用户系统 / 偏好存储 / 画板 ============

const initialPrefs = prefsStore.load();
applyPrefsToUI(initialPrefs);

// ============ 用户头像 / 菜单 ============
function updateAvatarUI() {
  const user = userManager.getCurrent();
  if (!user) return;
  document.getElementById('user-avatar-btn').textContent = user.avatarChar;
  document.getElementById('user-avatar-btn').style.background = user.avatarColor;
  document.getElementById('um-avatar').textContent = user.avatarChar;
  document.getElementById('um-avatar').style.background = user.avatarColor;
  document.getElementById('um-name').textContent = user.displayName;
  document.getElementById('um-sub').textContent = user.isOwner ? '设备主人' : '访客';
  renderUserList();
}

function renderUserList() {
  const list = document.getElementById('um-user-list');
  list.innerHTML = '';
  userManager.list().forEach(u => {
    const item = document.createElement('div');
    item.className = 'um-item';
    item.innerHTML = '<div class="header-avatar sm" style="background:' + u.avatarColor + ';color:#1a1a1a;width:24px;height:24px;font-size:11px">' + u.avatarChar + '</div>' +
                     '<span>' + escapeHtml(u.displayName) + '</span>' +
                     (u.id === userManager.currentUserId ? '<span class="check">✓</span>' : '');
    item.addEventListener('click', () => switchUser(u.id));
    list.appendChild(item);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function switchUser(userId) {
  if (userId === userManager.currentUserId) {
    document.getElementById('user-menu').classList.remove('visible');
    return;
  }
  // 计时器运行中 → 确认是否切换
  if (typeof timerStore !== 'undefined' && timerStore.getState && timerStore.getState().state === 'running') {
    if (!confirm('当前计时未结束，是否切换用户并停止？')) return;
  }
  // 保存当前用户的画板
  // (简化：当前画板不持久化，因为还没做完)
  userManager.setCurrent(userId);
  showToast('已切换到 ' + userManager.getCurrent().displayName, 'success');
  document.getElementById('user-menu').classList.remove('visible');
  // 重新加载 prefs 并刷新 UI
  const newPrefs = prefsStore.load();
  applyPrefsToUI(newPrefs);
  // 重置批注层（用户数据隔离）
  if (typeof annotationLayer !== 'undefined') annotationLayer.importStrokes([], { readOnly: false });
  // 计时器重新载入（如果新用户有状态就续上）
  if (typeof timerStore !== 'undefined') timerStore.load();
  if (typeof prefsStore !== 'undefined') prefsStore._refreshLastSavedFromStorage();
  updateAvatarUI();
}

document.getElementById('user-avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('user-menu').classList.toggle('visible');
  updateAvatarUI();
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (!menu.contains(e.target) && e.target.id !== 'user-avatar-btn') {
    menu.classList.remove('visible');
  }
});

document.getElementById('um-add-user').addEventListener('click', () => {
  const name = prompt('新用户名称：', '用户' + (userManager.list().length + 1));
  if (name) {
    const user = userManager.create(name);
    userManager.setCurrent(user.id);
    showToast('已创建并切换到 ' + user.displayName, 'success');
    document.getElementById('user-menu').classList.remove('visible');
    updateAvatarUI();
    applyPrefsToUI(prefsStore.load());
  }
});

document.getElementById('um-delete').addEventListener('click', () => {
  const user = userManager.getCurrent();
  if (!confirm('确认删除用户「' + user.displayName + '」？\n此操作不可撤销。')) return;
  const r = userManager.delete(user.id);
  if (r.error) { showToast(r.error, 'error'); return; }
  showToast('已删除用户', 'success');
  document.getElementById('user-menu').classList.remove('visible');
  updateAvatarUI();
  applyPrefsToUI(prefsStore.load());
});

document.getElementById('um-export').addEventListener('click', () => {
  const data = userManager.exportCurrent();
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = 'sketch-user-' + data.user.displayName + '-' + Date.now() + '.json';
  a.href = URL.createObjectURL(blob);
  a.click();
  showToast('已导出 ' + data.user.displayName + ' 的数据', 'success');
});

// v1.1: 手动"保存偏好"按钮
document.getElementById('um-save-prefs').addEventListener('click', () => {
  prefsStore.save(prefsStore.load());
  showToast('偏好已保存', 'success');
  document.getElementById('user-menu').classList.remove('visible');
});

// v1.1: 导入数据（接 #um-import → 触发隐藏 file input → 读 JSON → 合并到 UserManager）
document.getElementById('um-import').addEventListener('click', () => {
  document.getElementById('um-import-file').click();
});
document.getElementById('um-import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data || data.type !== 'sketch-ref-user-export') {
        showToast('文件格式不对（应是 sketch-ref-user-export 导出）', 'error');
        return;
      }
      // 合并：用户不存在则新建；存在则更新显示名 / 头像色
      const incoming = data.user;
      if (!incoming || !incoming.id) {
        showToast('文件中缺少用户数据', 'error');
        return;
      }
      let target = userManager.list().find(u => u.id === incoming.id);
      if (!target) {
        // 复用 _createUser 保持 schema 一致，再覆盖关键字段
        target = userManager._createUser(incoming.displayName || '导入用户');
        target.id = incoming.id; // 保持 ID 一致 → 偏好键一致
        target.avatarChar = incoming.avatarChar || target.avatarChar;
        target.avatarColor = incoming.avatarColor || target.avatarColor;
        target.isOwner = !!incoming.isOwner;
        target.createdAt = incoming.createdAt || target.createdAt;
        userManager.users.push(target);
      } else {
        target.displayName = incoming.displayName || target.displayName;
        target.avatarChar = incoming.avatarChar || target.avatarChar;
        target.avatarColor = incoming.avatarColor || target.avatarColor;
      }
      userManager._saveUsers();
      // 写 prefs
      if (data.prefs && target.id) {
        try { localStorage.setItem('sketch-ref-prefs-' + target.id, JSON.stringify(data.prefs)); } catch (e) {}
      }
      // 切到导入的用户
      userManager.setCurrent(target.id);
      showToast('已导入「' + target.displayName + '」并切换', 'success');
      document.getElementById('user-menu').classList.remove('visible');
      applyPrefsToUI(prefsStore.load());
      updateAvatarUI();
    } catch (err) {
      showToast('导入失败：' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
});

// v1.1: 用户菜单 → 历史记录 / 进度看板
document.getElementById('um-open-history').addEventListener('click', () => {
  document.getElementById('user-menu').classList.remove('visible');
  if (typeof openHistoryPanel === 'function') openHistoryPanel();
});
document.getElementById('um-open-dashboard').addEventListener('click', () => {
  document.getElementById('user-menu').classList.remove('visible');
  if (typeof openDashboardPanel === 'function') openDashboardPanel();
});

// v1.1: 顶栏 → 历史 / 进度
document.getElementById('history-btn').addEventListener('click', () => {
  if (typeof openHistoryPanel === 'function') openHistoryPanel();
});
document.getElementById('dashboard-btn').addEventListener('click', () => {
  if (typeof openDashboardPanel === 'function') openDashboardPanel();
});



// ============ 模型库 ============
// 静态清单：列出可用的模型文件（fetch 需要 URL，所以是 URL 列表）
const MODEL_LIBRARY = [
  { id: 'default',     url: 'model.glb',                                    name: '默认头部',     tag: '手动',   size: '16 MB',  faces: '~10K' },
  { id: 'natural-v1',  url: 'models/head-sketch-natural-v1-simplified.glb', name: '素描头像 v1',   tag: 'Meshy',  size: '528 KB', faces: '30K' },
  { id: 'natural-v2',  url: 'models/head-sketch-natural-v2-simplified.glb', name: '素描头像 v2',   tag: 'Meshy',  size: '528 KB', faces: '30K' },
  { id: 'natural-v3',  url: 'models/head-sketch-natural-v3-simplified.glb', name: '素描头像 v3',   tag: 'Meshy',  size: '528 KB', faces: '30K' },
];

function renderModelLibList(currentUrl) {
  const list = document.getElementById('model-lib-list');
  if (!list) return;
  list.innerHTML = '';
  MODEL_LIBRARY.forEach(m => {
    const isCurrent = currentUrl === m.url;
    const item = document.createElement('div');
    item.className = 'model-lib-item' + (isCurrent ? ' current' : '');
    item.innerHTML =
      '<div class="name">' + escapeHtml(m.name) + '</div>' +
      '<div class="meta"><span>' + escapeHtml(m.size) + '</span><span class="badge">' + escapeHtml(m.tag) + '</span></div>' +
      (isCurrent ? '<span class="check">✓</span>' : '');
    if (!isCurrent) {
      item.addEventListener('click', () => switchModel(m));
    }
    list.appendChild(item);
  });
}

async function switchModel(model) {
  showToast('切换到: ' + model.name + '...', '');
  // 更新 CONFIG 触发 tryFetchModel 重载
  if (typeof CONFIG !== 'undefined') {
    CONFIG.modelFile = model.url;
  }
  // 触发重新加载
  if (typeof tryFetchModel === 'function') {
    const ok = await tryFetchModel();
    if (ok) {
      document.getElementById('model-lib-current-name').textContent = model.name;
      renderModelLibList(model.url);
      // 缓存到 IDB（如果需要）
      showToast('已切换到 ' + model.name, 'success');
    } else {
      showToast('切换失败：模型加载错误', 'error');
    }
  }
}

document.getElementById('model-lib-clear-cache').addEventListener('click', async () => {
  if (!confirm('确定要清除所有本地缓存的模型吗？\n（下次加载会重新从网络下载）')) return;
  if (!userManager.currentUserId) return;
  try {
    await modelDB.clearModels(userManager.currentUserId);
    showToast('已清除模型缓存', 'success');
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  }
});

// 初始化：把当前 CONFIG.modelFile 标为已选

// 初始化（脚本在 module 末尾，CONFIG 已定义）
(function initModelLib() {
  if (typeof CONFIG !== 'undefined' && document.getElementById('model-lib-list')) {
    document.getElementById('model-lib-current-name').textContent =
      MODEL_LIBRARY.find(m => m.url === CONFIG.modelFile)?.name || CONFIG.modelFile;
    renderModelLibList(CONFIG.modelFile);
  }
})();

// ============ Toast 工具 ============
let toastTimer = null;
function showToast(text, type = '') {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = text;
  toast.className = 'toast show ' + type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), type === 'error' ? 4000 : 2000);
}

// ============ 画板控件事件 ============
document.getElementById('mode-view').addEventListener('click', () => {
  sketchCanvas.setMode('view');
  document.getElementById('mode-view').classList.add('active');
  document.getElementById('mode-sketch').classList.remove('active');
  prefsStore.updatePath('sketch.mode', 'view');
});
document.getElementById('mode-sketch').addEventListener('click', () => {
  sketchCanvas.setMode('sketch');
  document.getElementById('mode-view').classList.remove('active');
  document.getElementById('mode-sketch').classList.add('active');
  prefsStore.updatePath('sketch.mode', 'sketch');
  showToast('画笔模式 · 按 B 切换', 'success');
});
document.querySelectorAll('#sketch-colors .swatch').forEach(s => {
  s.addEventListener('click', () => {
    document.querySelectorAll('#sketch-colors .swatch').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    sketchCanvas.setColor(s.dataset.color);
    prefsStore.updatePath('sketch.color', s.dataset.color);
  });
});
document.getElementById('line-width').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  sketchCanvas.setLineWidth(v);
  document.getElementById('line-width-val').textContent = v + ' px';
  prefsStore.updatePath('sketch.lineWidth', v);
});
document.getElementById('sketch-opacity').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10) / 100;
  sketchCanvas.setOpacity(v);
  document.getElementById('sketch-opacity-val').textContent = Math.round(v * 100) + '%';
  prefsStore.updatePath('sketch.opacity', v);
});
document.getElementById('sketch-undo').addEventListener('click', () => sketchCanvas.undo());
document.getElementById('sketch-redo').addEventListener('click', () => sketchCanvas.redo());
document.getElementById('sketch-clear').addEventListener('click', () => {
  if (sketchCanvas.strokes.length > 0 && confirm('清空画板？')) sketchCanvas.clear();
});

// ============ v1.1: 批注工具栏 ============
document.getElementById('ann-toggle').addEventListener('change', (e) => {
  annotationLayer.setEnabled(e.target.checked);
  if (e.target.checked) {
    showToast('批注模式 · 红色笔/圆圈', 'success');
    if (sketchCanvas.mode !== 'view') {
      // 切到 view 避免画板笔触干扰
      document.getElementById('mode-view').click();
    }
  }
});
document.getElementById('ann-shape-pen').addEventListener('click', () => annotationLayer.setShape('pen'));
document.getElementById('ann-shape-circle').addEventListener('click', () => annotationLayer.setShape('circle'));
document.getElementById('ann-line-width').addEventListener('input', (e) => {
  annotationLayer.setLineWidth(parseInt(e.target.value, 10));
});
document.getElementById('ann-undo').addEventListener('click', () => annotationLayer.undo());
document.getElementById('ann-clear').addEventListener('click', () => {
  if (annotationLayer.strokes.length > 0 && confirm('清空批注？')) annotationLayer.clear();
});

// ============ v1.1: 计时器控件 ============
document.getElementById('tw-toggle').addEventListener('click', () => {
  document.getElementById('timer-widget').classList.toggle('collapsed');
});
document.querySelectorAll('[data-tw-mode]').forEach(btn => {
  btn.addEventListener('click', () => timerStore.setMode(btn.dataset.twMode));
});
// 自定义时长"应用"按钮：把"时+分"换算成分钟 → setCustomDuration
document.getElementById('tw-custom-apply').addEventListener('click', () => {
  const h = Math.max(0, parseInt(document.getElementById('tw-custom-hours').value, 10) || 0);
  const m = Math.max(0, parseInt(document.getElementById('tw-custom-mins').value, 10) || 0);
  const total = h * 60 + m;
  if (total < 1) { showToast('至少 1 分钟', ''); return; }
  if (total > 8 * 60) { showToast('最长 8 小时', ''); return; }
  timerStore.setCustomDuration(total);
  showToast('自定义时长已设为 ' + (h ? h + ' 小时 ' : '') + m + ' 分', '');
});
// 输入框回车直接应用
['tw-custom-hours', 'tw-custom-mins'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('tw-custom-apply').click();
  });
});
document.getElementById('tw-play').addEventListener('click', () => timerStore.toggle());
document.getElementById('tw-reset').addEventListener('click', () => timerStore.reset());
// "保存本次" / "导出 PNG/PDF" 在 Phase 5/6 后接线（依赖 historyStore / exportService）
document.getElementById('tw-save-snapshot').addEventListener('click', () => {
  if (typeof saveCurrentSnapshot === 'function') saveCurrentSnapshot('manual');
});
document.getElementById('tw-export-png').addEventListener('click', () => {
  if (typeof exportService !== 'undefined') exportService.exportPng();
});
document.getElementById('tw-export-pdf').addEventListener('click', () => {
  if (typeof exportService !== 'undefined') exportService.exportPdf();
});

// 截图（含画板）—— 合成 3D canvas + sketch canvas
document.getElementById('screenshot-with-sketch').addEventListener('click', () => {
  if (!renderer) { showToast('3D 未就绪', 'error'); return; }
  renderer.render(scene, camera);
  // 创建一个新 canvas 合成
  const composite = document.createElement('canvas');
  composite.width = renderer.domElement.width;
  composite.height = renderer.domElement.height;
  const ctx = composite.getContext('2d');
  // 1. 画 3D canvas
  ctx.drawImage(renderer.domElement, 0, 0);
  // 2. 叠画板
  if (sketchCanvas.strokes.length > 0) {
    ctx.globalAlpha = sketchCanvas.opacity;
    ctx.drawImage(sketchCanvas.canvas, 0, 0, composite.width, composite.height);
    ctx.globalAlpha = 1;
  }
  composite.toBlob((blob) => {
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = 'sketch-' + ts + '.png';
    a.href = URL.createObjectURL(blob);
    a.click();
    showToast('已保存截图（含画板）', 'success');
  }, 'image/png');
});

// ============ 4 套经典布光预设 ============
const LIGHT_PRESETS = {
  flat:      { az: 0,   el: 30,  intensity: 0.6 },
  side:      { az: -45, el: 30,  intensity: 0.8 },
  top:       { az: 0,   el: 75,  intensity: 0.7 },
  rembrandt: { az: -45, el: 45,  intensity: 0.7 },
};
document.querySelectorAll('[data-light-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = LIGHT_PRESETS[btn.dataset.lightPreset];
    if (!p) return;
    // 更新光源 slider 值并触发 updateKeyLight
    const azSlider = document.getElementById('light-azimuth');
    const elSlider = document.getElementById('light-elevation');
    const intSlider = document.getElementById('light-intensity');
    if (azSlider) azSlider.value = p.az;
    if (elSlider) elSlider.value = p.el;
    if (intSlider) intSlider.value = p.intensity;
    if (typeof updateKeyLight === 'function') updateKeyLight();
    // 持久化
    prefsStore.updatePath('light.az', p.az);
    prefsStore.updatePath('light.el', p.el);
    prefsStore.updatePath('light.intensity', p.intensity);
    // 高亮选中
    document.querySelectorAll('[data-light-preset]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showToast('已切换到「' + btn.title.split('：')[0] + '」布光', 'success');
  });
});

// ============ 快捷键 ============
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // v1.1: 计时器播放/暂停
    if (typeof timerStore !== 'undefined') {
      timerStore.toggle();
      e.preventDefault();
    }
  } else if (k === 'b') {
    const isSketch = sketchCanvas.mode === 'sketch';
    document.getElementById(isSketch ? 'mode-view' : 'mode-sketch').click();
    e.preventDefault();
  } else if (k === 'z' && (e.ctrlKey || e.metaKey || sketchCanvas.mode === 'sketch')) {
    sketchCanvas.undo();
    e.preventDefault();
  } else if (k === 'y' && (e.ctrlKey || e.metaKey || sketchCanvas.mode === 'sketch')) {
    sketchCanvas.redo();
    e.preventDefault();
  }
});



// ============ PWA: 注册 Service Worker ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('[SW] registered:', reg.scope))
      .catch(err => console.warn('[SW] registration failed:', err));
  });
}

// ============ 初始化 UI ============
updateAvatarUI();
showToast('欢迎，' + userManager.getCurrent().displayName, 'success');

