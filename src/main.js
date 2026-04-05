import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'

const scene = new THREE.Scene()
scene.background = null

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  3000
)
camera.position.set(120, 80, 150)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x000000, 0)
document.body.innerHTML = ''
document.body.style.margin = '0'
document.body.style.overflow = 'hidden'
document.body.appendChild(renderer.domElement)

const ambientLight = new THREE.AmbientLight(0xffffff, 1.22)
scene.add(ambientLight)

const dirLight = new THREE.DirectionalLight(0xffffff, 1.18)
dirLight.position.set(120, 140, 100)
scene.add(dirLight)

const fillLight = new THREE.DirectionalLight(0xffffff, 0.55)
fillLight.position.set(-80, 50, -60)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xe8f7ff, 0.58)
rimLight.position.set(-40, 120, 140)
scene.add(rimLight)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.enablePan = false
controls.minDistance = 30
controls.maxDistance = 400
controls.target.set(0, 0, 0)

const info = document.createElement('div')
info.innerText = '正在加载冰雕...'
info.style.position = 'fixed'
info.style.left = '20px'
info.style.top = '20px'
info.style.padding = '10px 14px'
info.style.background = 'rgba(255,255,255,0.82)'
info.style.borderRadius = '10px'
info.style.fontFamily = 'sans-serif'
info.style.zIndex = '10'
document.body.appendChild(info)

const rootGroup = new THREE.Group()
scene.add(rootGroup)

function makeNoiseTexture(size = 256, contrast = 1.0) {
  const data = new Uint8Array(size * size * 4)

  function rand(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
    return n - Math.floor(n)
  }

  function smoothNoise(x, y) {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = x0 + 1
    const y1 = y0 + 1

    const sx = x - x0
    const sy = y - y0

    const n00 = rand(x0, y0)
    const n10 = rand(x1, y0)
    const n01 = rand(x0, y1)
    const n11 = rand(x1, y1)

    const ix0 = n00 * (1 - sx) + n10 * sx
    const ix1 = n01 * (1 - sx) + n11 * sx
    return ix0 * (1 - sy) + ix1 * sy
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 组合多层低频噪声，做“大块起伏”
      const nx = x / size
      const ny = y / size

      const large =
        smoothNoise(nx * 6, ny * 6) * 0.55 +
        smoothNoise(nx * 12, ny * 12) * 0.30 +
        smoothNoise(nx * 24, ny * 24) * 0.15

      // 强化明暗对比，让起伏更“硬”
      let v = Math.pow(large, 1.6) * 255 * contrast

      // 再叠一点斜向冰裂感
      const ridge = Math.abs(Math.sin((nx * 8 + ny * 11) * Math.PI))
      v += ridge * 28

      v = Math.max(0, Math.min(255, v))

      const i = (y * size + x) * 4
      data[i + 0] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  return tex
}

const roughnessTex = makeNoiseTexture(256, 1.0)
const bumpTex = makeNoiseTexture(256, 1.0)

function createOuterIceMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xeaf8ff,
    transparent: true,
    opacity: 0.30,
    transmission: 0.34,
    roughness: 0.72,
    metalness: 0.0,
    thickness: 1.8,
    ior: 1.22,
    envMapIntensity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughnessMap: roughnessTex,
    bumpMap: bumpTex,
    bumpScale: 3.0
  })
}

function createIceFogMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe3f0f7,
    transparent: true,
    opacity: 0.010,
    transmission: 0.05,
    roughness: 1.0,
    metalness: 0.0,
    thickness: 0.8,
    ior: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false
  })
}


function createChiseledIceGeometry(sizeX, sizeY, sizeZ, seg = 18) {
  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ, seg, seg, seg)
  const pos = geometry.attributes.position

  function rand(x, y, z) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
    return n - Math.floor(n)
  }

  function lerp(a, b, t) {
    return a * (1 - t) + b * t
  }

  function smooth3(x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
    const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1
    const fx = x - x0, fy = y - y0, fz = z - z0

    const c000 = rand(x0, y0, z0)
    const c100 = rand(x1, y0, z0)
    const c010 = rand(x0, y1, z0)
    const c110 = rand(x1, y1, z0)
    const c001 = rand(x0, y0, z1)
    const c101 = rand(x1, y0, z1)
    const c011 = rand(x0, y1, z1)
    const c111 = rand(x1, y1, z1)

    const x00 = lerp(c000, c100, fx)
    const x10 = lerp(c010, c110, fx)
    const x01 = lerp(c001, c101, fx)
    const x11 = lerp(c011, c111, fx)

    const y0v = lerp(x00, x10, fy)
    const y1v = lerp(x01, x11, fy)

    return lerp(y0v, y1v, fz)
  }

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i)
    let y = pos.getY(i)
    let z = pos.getZ(i)

    // 归一化到盒子尺寸，保证不同方向起伏一致
    const nx = x / (sizeX * 0.5)
    const ny = y / (sizeY * 0.5)
    const nz = z / (sizeZ * 0.5)

    // 低频大块起伏
    const n1 = smooth3(nx * 3.2, ny * 3.2, nz * 3.2)
    const n2 = smooth3(nx * 6.4 + 4.1, ny * 6.4 + 1.7, nz * 6.4 + 8.3)

    // 棱面感：让部分区域更像冰面削切
    const ridge = Math.pow(Math.abs(n1 - 0.5) * 2.0, 1.6)

    const disp = (n1 * 0.9 + n2 * 0.45 + ridge * 0.55) - 0.55

    // 关键：不再沿“面法线”位移，而是沿“从中心向外”的统一方向位移
    let dx = nx
    let dy = ny
    let dz = nz
    const len = Math.hypot(dx, dy, dz) || 1
    dx /= len
    dy /= len
    dz /= len

    const strength = 1.15

    x += dx * disp * strength
    y += dy * disp * strength
    z += dz * disp * strength

    pos.setXYZ(i, x, y, z)
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}




function addOuterIceBlock(sizeX, sizeY, sizeZ) {
  const outerGeometry = createChiseledIceGeometry(sizeX, sizeY, sizeZ, 20)
  const outerMesh = new THREE.Mesh(outerGeometry, createOuterIceMaterial())
  rootGroup.add(outerMesh)

  // 内部雾层也跟着外壳走，但稍微小一点，避免穿帮
  const fogGeometry = createChiseledIceGeometry(sizeX * 0.992, sizeY * 0.992, sizeZ * 0.992, 16)
  const fogMesh = new THREE.Mesh(fogGeometry, createIceFogMaterial())
  rootGroup.add(fogMesh)
}

async function loadMeta() {
  const response = await fetch('/generated/scene_meta.json')
  return await response.json()
}

async function loadMetaAndCreateOuterBlock() {
  const meta = await loadMeta()

  const sizeX = meta.pointsX - 1
  const sizeY = meta.pointsY - 1
  const sizeZ = meta.pointsZ - 1

  addOuterIceBlock(sizeX, sizeY, sizeZ)
  return meta
}

function makeSliceTexture(width, height, fillFn) {
  const alphaMap = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      alphaMap[y * width + x] = fillFn(x, y)
    }
  }

  // 先做 5x5 高斯风格平滑，减少块感和脏感
  const kernel = [
    [1, 2, 3, 2, 1],
    [2, 4, 6, 4, 2],
    [3, 6, 9, 6, 3],
    [2, 4, 6, 4, 2],
    [1, 2, 3, 2, 1]
  ]

  const smoothMap = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0

      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          const nx = x + kx
          const ny = y + ky
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue

          const w = kernel[ky + 2][kx + 2]
          sum += alphaMap[ny * width + nx] * w
          weightSum += w
        }
      }

      smoothMap[y * width + x] = weightSum > 0 ? sum / weightSum : 0
    }
  }

  const slice = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = smoothMap[y * width + x]

      // 亮蓝色，但比之前更浓一点
      slice[i + 0] = 92
      slice[i + 1] = 205
      slice[i + 2] = 255
      slice[i + 3] = Math.min(235, Math.floor(a * 1.9))
    }
  }

  const tex = new THREE.DataTexture(slice, width, height, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return tex
}

function createSliceMaterial(tex, opacity = 0.22) {
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity,
    blending: THREE.NormalBlending
  })
}

async function loadPaintVolumeSlices(meta) {
  const response = await fetch('/generated/paint_volume.bin')
  const buffer = await response.arrayBuffer()
  const volume = new Uint8Array(buffer)

  const width = meta.paintWidth
  const height = meta.paintHeight
  const depth = meta.paintDepth

  const group = new THREE.Group()
  const idx = (x, y, z) => z * width * height + y * width + x

  // 3D 邻域平滑采样，减脏感
  function sampleSoft(x, y, z) {
    let sum = 0
    let weightSum = 0

    for (let oz = -1; oz <= 1; oz++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox
          const ny = y + oy
          const nz = z + oz

          if (
            nx < 0 || nx >= width ||
            ny < 0 || ny >= height ||
            nz < 0 || nz >= depth
          ) continue

          const w =
            ox === 0 && oy === 0 && oz === 0 ? 4 :
            (ox === 0 && oy === 0) || (ox === 0 && oz === 0) || (oy === 0 && oz === 0) ? 2 : 1

          sum += volume[idx(nx, ny, nz)] * w
          weightSum += w
        }
      }
    }

    return weightSum > 0 ? sum / weightSum : 0
  }

  // 主方向切片更多、更密，但透明度控制住，避免脏
  const zSliceCount = Math.min(depth, 52)
  for (let s = 0; s < zSliceCount; s++) {
    const zIndex = Math.floor((s / (zSliceCount - 1)) * (depth - 1))
    const tex = makeSliceTexture(width, height, (x, y) => {
      const v = sampleSoft(x, y, zIndex)
      return Math.min(190, Math.floor(v * 0.62))
    })

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      createSliceMaterial(tex, 0.21)
    )
    plane.position.z = zIndex - depth / 2
    group.add(plane)
  }

  // 侧向辅助切片：仍保留，但更柔
  const ySliceCount = Math.min(height, 28)
  for (let s = 0; s < ySliceCount; s++) {
    const yIndex = Math.floor((s / (ySliceCount - 1)) * (height - 1))
    const tex = makeSliceTexture(width, depth, (x, z) => {
      const v = sampleSoft(x, yIndex, z)
      return Math.min(120, Math.floor(v * 0.36))
    })

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      createSliceMaterial(tex, 0.10)
    )
    plane.rotation.x = Math.PI / 2
    plane.position.y = yIndex - height / 2
    group.add(plane)
  }

  const xSliceCount = Math.min(width, 28)
  for (let s = 0; s < xSliceCount; s++) {
    const xIndex = Math.floor((s / (xSliceCount - 1)) * (width - 1))
    const tex = makeSliceTexture(depth, height, (z, y) => {
      const v = sampleSoft(xIndex, y, z)
      return Math.min(120, Math.floor(v * 0.36))
    })

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(depth, height),
      createSliceMaterial(tex, 0.10)
    )
    plane.rotation.y = Math.PI / 2
    plane.position.x = xIndex - width / 2
    group.add(plane)
  }

  rootGroup.add(group)
}

async function loadInnerCarvingMesh() {
  const loader = new PLYLoader()

  return new Promise((resolve, reject) => {
    loader.load(
      '/generated/ice_surface.ply',
      (geometry) => {
        geometry.computeVertexNormals()

        // 本体略增强，但不变成实体块
        const carvingMesh = new THREE.Mesh(
          geometry,
          new THREE.MeshPhysicalMaterial({
            color: 0xf9fdff,
            transparent: true,
            opacity: 0.22,
            transmission: 0.06,
            roughness: 0.48,
            metalness: 0.0,
            thickness: 0.42,
            ior: 1.05,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        )
        rootGroup.add(carvingMesh)

        // 两层柔和轮廓壳，增强边缘，不加网格
        const shellMesh1 = new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: 0xf6fcff,
            transparent: true,
            opacity: 0.16,
            side: THREE.BackSide,
            depthWrite: false
          })
        )
        shellMesh1.scale.setScalar(1.018)
        rootGroup.add(shellMesh1)

        const shellMesh2 = new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: 0xeef8ff,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide,
            depthWrite: false
          })
        )
        shellMesh2.scale.setScalar(1.034)
        rootGroup.add(shellMesh2)

        resolve(carvingMesh)
      },
      undefined,
      reject
    )
  })
}

// function addGroundShadowHint(sizeX, sizeZ) {
//   const geometry = new THREE.PlaneGeometry(sizeX * 1.25, sizeZ * 1.25)
//   const material = new THREE.MeshBasicMaterial({
//     color: 0xd6e5ef,
//     transparent: true,
//     opacity: 0.06
//   })
//   const plane = new THREE.Mesh(geometry, material)
//   plane.rotation.x = -Math.PI / 2
//   plane.position.y = -22
//   rootGroup.add(plane)
// }

async function init() {
  try {
    const meta = await loadMetaAndCreateOuterBlock()
    await loadInnerCarvingMesh()
    await loadPaintVolumeSlices(meta)
    // addGroundShadowHint(meta.pointsX - 1, meta.pointsZ - 1)

    const maxDim = Math.max(meta.pointsX - 1, meta.pointsY - 1, meta.pointsZ - 1)
    camera.position.set(maxDim * 1.18, maxDim * 0.88, maxDim * 1.32)
    controls.update()

    info.innerText = '加载完成：增强轮廓 + 高密度亮蓝染色'
  } catch (err) {
    console.error(err)
    info.innerText = '加载失败，请检查 generated 文件'
  }
}

window.addEventListener('dblclick', () => {
  controls.target.set(0, 0, 0)
  camera.position.set(120, 80, 150)
  controls.update()
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

init()
animate()