# Renderer Server — Infrastructure Analysis

## Kontekst

Analiza architektury renderer-server pod kątem deploymentu na instancje z GPU i/lub mocnym CPU.
Renderer-server to headless Node.js (Express + headless-gl + canvas) owijający `@fourthwall/product-renderer` (Three.js 0.158.0).

---

## 1. Model workerów i kolejkowania

### Architektura
```
POST /render → Express (główny proces) → kolejka (in-memory) → worker 1..N (fork) → PNG
                 ↑ zawsze dostępne              ↑ MAX_QUEUE_DEPTH=500
```

- **`child_process.fork()`** — każdy worker to osobny proces OS z własnym V8 + EGL display
- Nie `worker_threads` — native modules (canvas, gl) wymagają izolowanych procesów
- **1 render na raz per worker** — GL context jest single-threaded, `readPixels` blokuje
- N workerów = N równoległych renderów (prawdziwy paralelizm)

### API nie jest blokowane przez render
Express server działa w głównym procesie. Workery renderują asynchronicznie w child processach.
Przy pełnej kolejce zwraca 503. Timeout startuje gdy worker **zaczyna** job (nie w kolejce).

### Parametry konfiguracyjne
| Parametr | Domyślna wartość | Opis |
|----------|-----------------|------|
| `WORKER_COUNT` | 1 | Liczba procesów renderujących |
| `JOB_TIMEOUT_MS` | 120000 | Timeout per job (od momentu podjęcia) |
| `MAX_QUEUE_DEPTH` | 500 | Max jobów w kolejce (powyżej → 503) |
| `NODE_HEAP_LIMIT_MB` | 512 | V8 heap limit per worker |
| `CANVAS_SIZE` | 2048 | Rozmiar wyjściowego canvasa |

---

## 2. Pamięć i zasoby

### Stałe render targets (alokowane raz przy init, NIGDY nie zwalniane)
| RT | Rozmiar | Pamięć RGBA |
|----|---------|-------------|
| textures.buffer | 4096×4096 | ~64MB |
| textures.background | 4096×4096 | ~64MB |
| textures.embroidery | 4096×4096 | ~64MB |
| textures.processed | 1024×1024 | ~4MB |
| textures.blurred | 1024×1024 | ~4MB |
| EffectComposer RT ×2 | 1024×1024 Float | ~32MB |
| **Suma stała** | | **~232MB** |

### Per-generator (ładowane na żądanie, cache'owane)
| Zasób | Typowy rozmiar disk | Rozmiar w pamięci |
|-------|--------------------|--------------------|
| Mesh GLB (per view) | 100-300KB | 5-20MB (geometry buffers) |
| Texture MAIN (per view, 4096×4096 RGBA) | 20-100KB JPEG | ~64MB |
| Texture MASK (per view, 4096×4096 RGBA) | 20-100KB JPEG | ~64MB |
| Typowy generator (2 views, MAIN+MASK) | ~1MB disk | **~300-500MB** |

### RSS per worker process
| Składnik | ~MB |
|----------|-----|
| Node.js V8 baseline | 80 |
| GL framebuffer 2048×2048 | 16 |
| Stałe render targets | 232 |
| Per-generator tekstury (1 gen) | 256-500 |
| LRU in-memory cache (max) | 600 |
| **Steady state (1 generator)** | **400-600** |
| **Z pełnym cache** | **600-900** |

### Cache hierarchy (3-tier fetch)
```
1. Negative cache (404s, 60s TTL)
2. In-memory LRU (texture: 50 entries/500MB, mesh: 30 entries/100MB, 30min TTL)
3. Disk cache (./assets/cdn/, przeżywa restart)
4. CDN fetch (https://cdn.fourthwall.com)
```

---

## 3. Cold start vs warm render timing

### Cold start (pierwszy boot, generatory lokalne)
```
1. Server start + env load                    → ~100ms
2. Fork N workerów                            → ~500ms per worker
3. HeadlessRenderer.initialize() per worker:
   a. Canvas + GL context                     → ~200-500ms
   b. Polyfille DOM                           → ~50ms
   c. ProductRendererV2 constructor           → ~100ms
4. Jeśli GENERATOR_CONFIG_PATH:
   d. ProductRendererV2.setup()               →
      - setContexts + setRenderer             → ~100ms
      - setCameras                            → ~10ms
      - loadTextures (heather)                → ~200ms
      - GeneratorInstance.setup()             →
        - setMeshes (GLB parse, Promise.all)  → 500ms-3s per gen (sieć/disk)
        - setUniform                          → ~10ms
        - setPreviewPlane                     → ~10ms
      - setTextures (MAIN+MASK per view)      → 500ms-5s per gen (sieć/disk + initTexture)
   e. patchComposerRenderTargets              → ~50ms
   f. hideSobelProcessingPlane                → ~10ms

TOTAL z siecią: 5-30 sekund
TOTAL z dysku lokalnego: 2-8 sekund
```

### Warm render (cache hit)
```
Single render: ~180-610ms (brak I/O)
Batch 4 kolory × 4 widoki = 16 obrazów: ~600-1100ms
```

---

## 4. Generator fixtures
```
DTG.json            127KB
UV.json              49KB
KNITTED.json         41KB
PRINTED.json         32KB
EMBROIDERY.json      28KB
ALL_OVER_PRINT.json  25KB
SUBLIMATION.json     22KB
TOTAL               ~324KB (JSON metadata only)
```

Prawdziwy koszt to assety CDN: ~1MB download per generator → 300-500MB w pamięci po dekompresji tekstur.

---

## 5. Opcje deployment

### A: GPU na naszej infrastrukturze (GCP always-on)
- 1 staging + 2 prod za LB
- Szacowany koszt: ~$2,052/mies per instancja (n1-standard-4 + T4) × 3 = **~$6,156/mies**
- Zalety: najniższa latencja, prosta architektura
- Wady: overprovisioning, koszt 24/7

### B: GPU poza infrastrukturą (Lambda/Vast/RunPod)
- Proxy na GCP + zewnętrzne GPU workery
- Wymaga async queue (Redis/PubSub) + callback
- Zalety: tańsze GPU, elastyczne skalowanie
- Wady: latencja sieciowa, złożoność proxy, ruch poza siecią

### C: Scale-to-zero GPU (Cloud Run GPU, GKE Autopilot)
- Instancje wstają na żądanie
- Cold start: **5-30+ sekund** — za dużo dla order flow
- Mitygacja: pre-bake assetów w image

### D: Hybrid (rekomendacja)
- 1× always-on GPU (preemptible T4: ~$0.29/h = ~$210/mies)
- Burst: Cloud Run GPU dla batchów (cold start akceptowalny)
- Staging: 1× mała instancja
- **Szacowany koszt: ~$300-500/mies**

### E: CPU-only (mocny CPU, Mesa/LLVMPipe)
- Bez GPU — wszystko w CPU RAM, brak PCIe transfer
- Tańsze instancje (c3-standard-8: ~$250/mies)
- Rendering wolniejszy (software rasterization)
- Szczegóły w sekcji 6

---

## 6. CPU-only deployment (Mesa/LLVMPipe) — cold start analysis

Przy LIBGL_ALWAYS_SOFTWARE=1 (obecna konfiguracja Docker), "GPU" to LLVMPipe.
Wszystkie operacje GL są wykonywane na CPU. Nie ma VRAM — wszystko jest w RAM.

### Co się dzieje na cold start z lokalnymi generatorami

**Faza 1: Inicjalizacja workera (~500-800ms)**
```
Canvas creation (createCanvas 2048×2048)       → ~50ms
GL context (headless-gl via Mesa EGL)           → ~200-500ms
  - Mesa inicjalizuje LLVMPipe driver
  - Alokuje framebuffer 2048×2048 RGBA = ~16MB RAM
DOM polyfills                                   → ~50ms
ProductRendererV2 constructor                   → ~10ms
```

**Faza 2: setup() — WebGLRenderer + EffectComposer (~200-400ms)**
```
WebGL1Renderer creation                         → ~50ms
EffectComposer creation                         → ~50ms
  - Tworzy 2× WebGLRenderTarget 1024×1024
  - W software GL: alokacja RAM bufferów
Camera setup (5 kamer)                          → ~10ms
Stałe render targets (setTextures):
  - 3× 4096×4096 RGBA = 192MB RAM              → ~100-200ms (memcpy/zerowanie)
  - 2× 1024×1024 RGBA = 8MB RAM                → ~10ms
patchComposerRenderTargets (FloatType)          → ~50ms
```

**Faza 3: Generator loading z lokalnego dysku (per generator, ~1-3s)**
```
setMeshes() — Promise.all(views.map(meshLoader)):
  Per view (np. 4 views dla DTG):
    - Odczyt GLB z dysku (SSD)                  → ~5-20ms per file
    - GLTFLoader.parse() (geometria, materiały)  → ~50-200ms per mesh
    - Dodanie do scenes.buffer + processing      → ~5ms
  Subtotal (4 views parallel):                   → ~200-500ms

GeneratorInstance.setTextures() — per view:
  Per texture (MAIN + MASK, opcjonalnie OPTIONAL_MASK):
    - Odczyt JPEG z dysku                        → ~5-10ms per file
    - JPEG decode → raw RGBA 4096×4096           → ~100-200ms per texture
      (node-canvas ImageLoader, CPU-bound libjpeg)
    - renderer.initTexture(texture)              → ~20-50ms per texture
      (w Mesa/LLVMPipe: memcpy RGBA do wewnętrznych
       buforów tekstur LLVMPipe, ~64MB per texture)
  Subtotal (2 views × 2 textures = 4):          → ~500-1000ms

Shader compilation (LLVM JIT):
  - Pierwszy render każdego typu shaderu:
    GLSL → Mesa IR → LLVM IR → x86 machine code  → ~200-500ms per shader
  - Typy shaderów: model, sobel, blur, embroidery, blend, base
  - Kompilacja lazy (przy pierwszym użyciu)
  Subtotal (pierwsze użycie):                    → ~500-1500ms
```

### Szacunkowy cold start — CPU z lokalnymi assetami

| Scenariusz | Czas |
|------------|------|
| 1 worker + 1 generator (DTG, 4 views) | **~2-4 sekund** |
| 1 worker + 3 generatory | **~5-10 sekund** |
| 1 worker + 7 generatorów (wszystkie fixture) | **~10-20 sekund** |
| 2 workery + 7 generatorów (sekwencyjny init) | **~20-40 sekund** |
| 2 workery + 1 generator (minimalny start) | **~3-5 sekund** |

### Breakdown: Co dokładnie kosztuje czas

```
OPERACJA                           CPU TIME    RAM IMPACT
─────────────────────────────────────────────────────────
GL context creation (Mesa/EGL)     200-500ms   ~16MB
Render targets allocation          100-200ms   ~232MB
JPEG decode (per texture)          100-200ms   ~64MB per texture
renderer.initTexture() (memcpy)     20-50ms    ~0 (już policzony w texturze)
GLB parse (per mesh)                50-200ms   ~5-20MB per mesh
Shader compilation (LLVM JIT)      200-500ms   ~5MB per program (negligible)
─────────────────────────────────────────────────────────

Bottlenecki (w kolejności):
1. Shader compilation — LLVM JIT jest najwolniejszy element, ale jednorazowy
2. JPEG decode — libjpeg na 4096×4096 to ~100-200ms per obraz
3. GLB parse — Three.js GLTFLoader w Node jest CPU-bound
4. GL context — Mesa/LLVMPipe init
```

### Optymalizacje możliwe dla CPU cold start

1. **Pre-decode tekstur**: cache RGBA bufferów zamiast JPEG
   - Eliminuje JPEG decode (~100-200ms × N tekstur)
   - Ale: RGBA buffer 4096×4096 = 64MB vs JPEG 50KB → ogromny wzrost storage

2. **Pre-compile shaders**: Mesa wspiera shader cache (`MESA_SHADER_CACHE_DIR`)
   - Shader binaries przeżywają restart przy tym samym Mesa version
   - Eliminuje LLVM JIT overhead (~500-1500ms na cold start)
   - Potencjalnie najważniejsza optymalizacja

3. **Mniejsze tekstury**: gdyby bufferSize zmniejszyć z 4096 na 2048
   - JPEG decode 4× szybszy
   - initTexture 4× szybszy
   - RT allokacja 4× mniej RAM
   - Ale: niższa jakość renderów

4. **Parallel worker init**: fork wszystkich workerów jednocześnie
   - Już zaimplementowane w WorkerPoolManager (sekwencyjny fork, ale parallel init)
   - Ale: konkurencja o CPU/RAM podczas init

5. **Lazy generator loading**: nie ładuj wszystkich generatorów na start
   - Ładuj pierwszy generator → worker ready
   - Kolejne generatory w tle po starcie
   - Kompromis: pierwsze rendery różnych produktów wolniejsze

---

## 7. Kluczowe pliki

| Plik | Rola |
|------|------|
| `apps/renderer-server/Dockerfile` | Obecny CPU build (Mesa + xvfb) |
| `apps/renderer-server/src/workers/WorkerPoolManager.ts` | Pool management, memory validation, queue |
| `apps/renderer-server/src/rendering/HeadlessRenderer.ts` | GL context, cache, polyfille |
| `apps/renderer-server/src/server.ts` | Express entry, asset proxy, health |
| `apps/renderer-server/src/api/routes/health.ts` | K8s probes, memory pressure |
| `node_modules/@fourthwall/product-renderer/dist/ProductRendererV2.js` | Renderer core |
| `node_modules/@fourthwall/product-renderer/dist/GeneratorInstance.js` | Generator loading |
| `node_modules/@fourthwall/product-renderer/dist/constants.js` | Buffer sizes (4096, 1024) |
