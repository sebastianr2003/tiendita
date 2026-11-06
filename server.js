import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración y sincronización automática de versión PWA (Single Source of Truth: public/version.json)
const VERSION_FILE = path.join(__dirname, 'public', 'version.json');

function obtenerConfiguracionVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
      const appVer = data.appVersion || '2.1.5';
      const cleanVer = appVer.replace(/[^a-zA-Z0-9]/g, '');
      const cacheVer = data.cacheVersion || `sistema-ventas-pwa-v${cleanVer}`;
      return {
        appVersion: appVer,
        cacheVersion: cacheVer,
        timestamp: data.timestamp || Date.now()
      };
    }
  } catch (err) {
    console.warn('[Version] Error al leer version.json:', err);
  }
  return {
    appVersion: '2.1.5',
    cacheVersion: 'sistema-ventas-pwa-v215',
    timestamp: Date.now()
  };
}

// Directorio y archivo para persistencia del catálogo maestro de productos y ventas diarias
// Directorio y archivo para persistencia del catálogo maestro de productos y ventas diarias
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos_master.json');
const VENTAS_FILE = path.join(DATA_DIR, 'ventas_master.json');
const TOMBSTONES_FILE = path.join(DATA_DIR, 'tombstones_ventas.json');
const VENTAS_DIARIAS_DIR = path.join(DATA_DIR, 'diarias');

// Asegurar que existan las carpetas data y diarias
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creando directorio data:', err);
  }
}

if (!fs.existsSync(VENTAS_DIARIAS_DIR)) {
  try {
    fs.mkdirSync(VENTAS_DIARIAS_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creando directorio de ventas diarias:', err);
  }
}

// Registro persistente de Tombstones (Notas eliminadas que jamás deben resucitar por sincronización)
const tombstonesMaster = new Set([
  '#nv-0938',
  'nv-0938',
  '#0938',
  '0938',
  'nv-938',
  '#nv-938'
]);

function cargarTombstonesMaster() {
  try {
    if (fs.existsSync(TOMBSTONES_FILE)) {
      const data = fs.readFileSync(TOMBSTONES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        parsed.forEach(k => {
          if (k) {
            const s = String(k).toLowerCase().trim();
            tombstonesMaster.add(s);
            tombstonesMaster.add(s.replace('#', ''));
          }
        });
      }
    }
  } catch (err) {
    console.warn('[Backend Tombstones] Error al leer tombstones_ventas.json:', err.message);
  }
  guardarTombstonesMasterEnDisco();
}

function guardarTombstonesMasterEnDisco() {
  try {
    fs.writeFileSync(TOMBSTONES_FILE, JSON.stringify(Array.from(tombstonesMaster), null, 2), 'utf-8');
  } catch (err) {
    console.error('[Backend Tombstones] Error guardando tombstones_ventas.json:', err);
  }
}

function registrarTombstoneBackend(clave) {
  if (!clave) return;
  const s = String(clave).toLowerCase().trim();
  tombstonesMaster.add(s);
  tombstonesMaster.add(s.replace('#', ''));
  if (!s.startsWith('#')) tombstonesMaster.add('#' + s);
  guardarTombstonesMasterEnDisco();
}

function esNotaTombstone(vOClave) {
  if (!vOClave) return false;
  if (typeof vOClave === 'string') {
    const s = vOClave.toLowerCase().trim();
    return tombstonesMaster.has(s) || tombstonesMaster.has(s.replace('#', '')) || tombstonesMaster.has('#' + s.replace('#', ''));
  }
  const cod = String(vOClave.CodigoNota || vOClave.codigoNota || vOClave.Lista || vOClave.lista || '').toLowerCase().trim();
  const id = String(vOClave.idDoc || vOClave.id || '').toLowerCase().trim();
  if (cod && (tombstonesMaster.has(cod) || tombstonesMaster.has(cod.replace('#', '')) || tombstonesMaster.has('#' + cod.replace('#', '')))) return true;
  if (id && tombstonesMaster.has(id)) return true;
  return false;
}

// Cargar tombstones al iniciar
cargarTombstonesMaster();

// Estructura en memoria del registro y respaldo maestro de ventas
let ventasMaster = {
  version: 1,
  ultimaActualizacion: new Date().toISOString(),
  ventas: []
};

function obtenerClaveFechaHoy() {
  const hoy = new Date();
  const a = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${a}_${m}_${d}`;
}

function cargarVentasMaster() {
  try {
    if (fs.existsSync(VENTAS_FILE)) {
      const data = fs.readFileSync(VENTAS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.ventas)) {
        // Filtrar inmediatamente cualquier nota que coincida con tombstones o notas corruptas
        const ventasLimpias = parsed.ventas.filter(v => !esNotaTombstone(v));
        ventasMaster = {
          version: Number(parsed.version) || 1,
          ultimaActualizacion: parsed.ultimaActualizacion || new Date().toISOString(),
          ventas: ventasLimpias
        };
        console.log(`[Backend Ventas] Registro cargado con ${ventasMaster.ventas.length} notas de venta (versión ${ventasMaster.version}).`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Backend Ventas] Error al leer ventas_master.json, iniciando registro nuevo:', err.message);
  }
  guardarVentasMasterEnDisco();
}

function purgarNotaEnTodosArchivosDiarios(codigoNota, idDoc) {
  try {
    if (!fs.existsSync(VENTAS_DIARIAS_DIR)) return;
    const archivos = fs.readdirSync(VENTAS_DIARIAS_DIR);
    const codLower = String(codigoNota || '').toLowerCase().trim();
    for (const arch of archivos) {
      if (!arch.endsWith('.json')) continue;
      const fullPath = path.join(VENTAS_DIARIAS_DIR, arch);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.ventas)) {
          const antes = parsed.ventas.length;
          parsed.ventas = parsed.ventas.filter(v => {
            if (idDoc && (v.idDoc === idDoc || v.id === idDoc)) return false;
            if (codLower) {
              const c = String(v.CodigoNota || v.codigoNota || v.Lista || v.lista || '').toLowerCase().trim();
              if (c === codLower || c === codLower.replace('#', '') || ('#' + c) === codLower) return false;
            }
            return !esNotaTombstone(v);
          });
          if (parsed.ventas.length !== antes) {
            parsed.totalVentas = parsed.ventas.length;
            parsed.ultimaActualizacion = new Date().toISOString();
            fs.writeFileSync(fullPath, JSON.stringify(parsed, null, 2), 'utf-8');
          }
        }
      } catch (errArch) {}
    }
  } catch (e) {}
}

function guardarVentasMasterEnDisco() {
  try {
    // Filtrar tombstones antes de persistir
    ventasMaster.ventas = ventasMaster.ventas.filter(v => !esNotaTombstone(v));
    fs.writeFileSync(VENTAS_FILE, JSON.stringify(ventasMaster, null, 2), 'utf-8');

    // Respaldo diario particionado por fecha YYYY_MM_DD
    const claveHoy = obtenerClaveFechaHoy();
    const archivoDiario = path.join(VENTAS_DIARIAS_DIR, `ventas_${claveHoy}.json`);
    const ventasHoy = ventasMaster.ventas.filter(v => esVentaDeHoyBackend(v) && !esNotaTombstone(v));
    const backupDiario = {
      fecha: claveHoy,
      totalVentas: ventasHoy.length,
      ultimaActualizacion: new Date().toISOString(),
      ventas: ventasHoy
    };
    fs.writeFileSync(archivoDiario, JSON.stringify(backupDiario, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Backend Ventas] Error al guardar ventas_master.json o respaldo diario:', err);
  }
}

function esVentaDeHoyBackend(v) {
  if (!v || typeof v !== 'object') return false;
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();

  const rawTs = v.timestamp ?? v.ts ?? v.FechaTimestamp ?? v.fechaTimestamp ?? v.SyncTimestamp;
  if (rawTs !== undefined && rawTs !== null && !isNaN(Number(rawTs)) && Number(rawTs) > 0) {
    const numTs = Number(rawTs);
    const tsMs = numTs > 1e11 ? numTs : numTs * 1000;
    const dt = new Date(tsMs);
    if (!isNaN(dt.getTime())) {
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }
  }

  const str = String(v.FechaTexto || v.fechaTexto || v.fecha || '').trim();
  if (str) {
    const matchDMY = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (matchDMY) {
      const dia = parseInt(matchDMY[1], 10);
      const mes = parseInt(matchDMY[2], 10) - 1;
      let anio = parseInt(matchDMY[3], 10);
      if (anio < 100) anio += 2000;
      if (dia === d && mes === m && anio === y) return true;
    }
    const matchYMD = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (matchYMD) {
      const anio = parseInt(matchYMD[1], 10);
      const mes = parseInt(matchYMD[2], 10) - 1;
      const dia = parseInt(matchYMD[3], 10);
      if (dia === d && mes === m && anio === y) return true;
    }
    const p = Date.parse(str);
    if (!isNaN(p)) {
      const dt = new Date(p);
      if (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) return true;
    }
  }
  return false;
}

function normalizarVentaBackend(v) {
  if (!v || typeof v !== 'object') return null;
  const ahora = new Date();
  const rawCodigo = String(v.CodigoNota || v.codigoNota || v.Lista || v.lista || '').trim();
  const codigo = rawCodigo || `#NV-${Date.now().toString().slice(-4)}`;
  const cliente = String(v.Cliente || v.cliente || 'CLIENTE').trim() || 'CLIENTE';
  const total = Number(v.Total !== undefined ? v.Total : (v.total || 0)) || 0;
  const items = Array.isArray(v.Items) ? v.Items : (Array.isArray(v.items) ? v.items : []);
  const fechaTexto = String(v.FechaTexto || v.fechaTexto || v.fecha || ahora.toLocaleString('es-ES')).trim();
  
  let rawTs = v.timestamp ?? v.ts ?? v.FechaTimestamp ?? v.fechaTimestamp;
  let timestamp = 0;
  if (rawTs !== undefined && rawTs !== null && !isNaN(Number(rawTs)) && Number(rawTs) > 0) {
    const n = Number(rawTs);
    timestamp = n > 1e11 ? n / 1000 : n;
  } else {
    timestamp = ahora.getTime() / 1000;
  }

  const idDoc = String(v.idDoc || v.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5))).trim();

  return {
    idDoc: idDoc,
    CodigoNota: codigo,
    codigoNota: codigo,
    Lista: codigo,
    lista: codigo,
    Cliente: cliente,
    cliente: cliente,
    Total: total,
    total: total,
    Items: items,
    items: items,
    FechaTexto: fechaTexto,
    fechaTexto: fechaTexto,
    fecha: fechaTexto,
    timestamp: timestamp,
    ts: timestamp * 1000,
    FechaTimestamp: timestamp * 1000,
    fechaTimestamp: timestamp * 1000,
    VendedorNombre: v.VendedorNombre || v.vendedorNombre || null,
    vendedorNombre: v.VendedorNombre || v.vendedorNombre || null,
    VendedorEmail: v.VendedorEmail || v.vendedorEmail || null,
    vendedorEmail: v.VendedorEmail || v.vendedorEmail || null,
    actualizadoEn: ahora.toISOString()
  };
}

// Inicializar almacenamiento de ventas al arrancar
cargarVentasMaster();

// Estructura en memoria del catálogo maestro de productos
let catalogoMaster = {
  version: 1,
  ultimaActualizacion: new Date().toISOString(),
  ultimaRevisionDiaria: new Date().toISOString(),
  productos: []
};

// Cargar catálogo existente o inicializar
function cargarCatalogoMaster() {
  try {
    if (fs.existsSync(PRODUCTOS_FILE)) {
      const data = fs.readFileSync(PRODUCTOS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.productos)) {
        catalogoMaster = {
          version: Number(parsed.version) || 1,
          ultimaActualizacion: parsed.ultimaActualizacion || new Date().toISOString(),
          ultimaRevisionDiaria: parsed.ultimaRevisionDiaria || new Date().toISOString(),
          productos: parsed.productos
        };
        console.log(`[Backend Productos] Catálogo cargado con ${catalogoMaster.productos.length} productos (versión ${catalogoMaster.version}).`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Backend Productos] Error al leer productos_master.json, iniciando catálogo nuevo:', err.message);
  }

  // Si no existe, guardar inicial
  guardarCatalogoMasterEnDisco();
}

function guardarCatalogoMasterEnDisco() {
  try {
    fs.writeFileSync(PRODUCTOS_FILE, JSON.stringify(catalogoMaster, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Backend Productos] Error al guardar productos_master.json:', err);
  }
}

// Función para limpiar nombres de productos y eliminar sufijos duplicados como (Caja), (Unidad)
function limpiarNombreProducto(nombre) {
  if (!nombre || typeof nombre !== 'string') return '';
  return nombre.replace(/\s*\((caja|unidad|u|pqte|paquete|lata|tira)\)/gi, '').trim();
}

/**
 * Función automática de backend que actualiza, limpia y consolida los productos
 * eliminando duplicados con sufijos (Caja), (Unidad) y unificando precios para todos.
 */
function ejecutarActualizacionDiariaProductosBackend(origen = 'CRON_AUTOMATICO') {
  try {
    console.log(`[Backend Job Diario] Iniciando consolidación y limpieza de catálogo (${origen})...`);

    const ahora = new Date();
    const mapaUnicos = new Map();

    // Normalizar, limpiar sufijos y desduplicar productos existentes
    for (const prod of catalogoMaster.productos) {
      if (!prod || !prod.Producto) continue;
      const nombreOriginal = String(prod.Producto).trim();
      const nombreLimpio = limpiarNombreProducto(nombreOriginal);
      if (!nombreLimpio) continue;

      const clave = nombreLimpio.toLowerCase();
      const esCaja = /\((caja|pqte|paquete)\)/i.test(nombreOriginal);
      const esUnidad = /\((unidad|u)\)/i.test(nombreOriginal);

      let precioCaja = Number(prod.PrecioCaja) >= 0 ? Number(prod.PrecioCaja) : 0;
      let precioUnidad = Number(prod.PrecioUnidad) >= 0 ? Number(prod.PrecioUnidad) : 0;

      // Si el sufijo era (Caja) y el precio estaba guardado en PrecioUnidad, asignarlo a PrecioCaja
      if (esCaja && precioCaja === 0 && precioUnidad > 0) {
        precioCaja = precioUnidad;
        precioUnidad = 0;
      }

      const tsEdicion = Number(prod.UltimaEdicion) || ahora.getTime();

      if (!mapaUnicos.has(clave)) {
        mapaUnicos.set(clave, {
          idDoc: prod.idDoc || ('prod_' + Buffer.from(clave).toString('hex').slice(0, 10)),
          Producto: nombreLimpio,
          PrecioCaja: precioCaja,
          PrecioUnidad: precioUnidad,
          FechaEdicionTexto: prod.FechaEdicionTexto || ahora.toLocaleString('es-ES'),
          UltimaEdicion: tsEdicion,
          actualizadoPor: prod.actualizadoPor || 'BackendConsolidacion'
        });
      } else {
        const existente = mapaUnicos.get(clave);
        // Transferir precio de caja si el nuevo tiene precio y el existente tenía 0, o si es más reciente
        if (precioCaja > 0 && (existente.PrecioCaja === 0 || tsEdicion > existente.UltimaEdicion)) {
          existente.PrecioCaja = precioCaja;
        }
        // Transferir precio de unidad si el nuevo tiene precio y el existente tenía 0, o si es más reciente
        if (precioUnidad > 0 && (existente.PrecioUnidad === 0 || tsEdicion > existente.UltimaEdicion)) {
          existente.PrecioUnidad = precioUnidad;
        }
        existente.UltimaEdicion = Math.max(existente.UltimaEdicion, tsEdicion);
        existente.Producto = nombreLimpio;
      }
    }

    catalogoMaster.productos = Array.from(mapaUnicos.values());
    catalogoMaster.version += 1;
    catalogoMaster.ultimaRevisionDiaria = ahora.toISOString();
    catalogoMaster.ultimaActualizacion = ahora.toISOString();

    guardarCatalogoMasterEnDisco();

    console.log(`[Backend Job Diario] ✅ Catálogo consolidado con éxito. Total productos únicos y limpios: ${catalogoMaster.productos.length}, Nueva versión catálogo: ${catalogoMaster.version}`);
    return {
      ok: true,
      mensaje: 'Consolidación de productos completada con éxito',
      totalProductos: catalogoMaster.productos.length,
      version: catalogoMaster.version,
      fecha: catalogoMaster.ultimaRevisionDiaria
    };
  } catch (err) {
    console.error('[Backend Job Diario] ❌ Error en consolidación de productos:', err);
    return { ok: false, error: err.message };
  }
}

// Programador diario: se ejecuta inmediatamente y luego cada 24 horas continuas
cargarCatalogoMaster();
ejecutarActualizacionDiariaProductosBackend('INICIO_SERVIDOR');

// Intervalo cada 24 horas (86,400,000 ms)
const INTERVALO_24_HORAS_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  ejecutarActualizacionDiariaProductosBackend('INTERVALO_24H');
}, INTERVALO_24_HORAS_MS);

// Además programar ejecución exacta al cambio de día (medianoche 00:00:05)
function programarMedianoche() {
  const ahora = new Date();
  const medianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 0, 0, 5);
  const msHastaMedianoche = medianoche.getTime() - ahora.getTime();

  setTimeout(() => {
    ejecutarActualizacionDiariaProductosBackend('MEDIANOCHE_DIARIA');
    programarMedianoche(); // reprogramar para la noche siguiente
  }, msHastaMedianoche);
}
programarMedianoche();

// Middleware para procesar cuerpos JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware CORS universal y robustez para PWA, Android WebView e iframes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Configurar encabezados para PWA (Service Worker, Manifest y prevención de caché estancada)
app.use((req, res, next) => {
  if (req.path === '/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  } else if (req.path === '/manifest.json') {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  } else if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (/\.(html|json|js|css)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  }
  next();
});

// Ruta explícita y directa para Service Worker con sincronización dinámica de caché
app.get(['/sw.js', '/sw'], (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');

  try {
    const { cacheVersion } = obtenerConfiguracionVersion();
    const swPath = path.join(__dirname, 'public', 'sw.js');
    const rawSw = fs.readFileSync(swPath, 'utf-8');
    const cleanId = cacheVersion.replace(/^sistema-ventas-pwa-/, '');

    // Inyección reactiva de versión del caché desde SSOT (version.json)
    const syncedSw = rawSw
      .replace(/const CACHE_NAME = ['"][^'"]+['"];/, `const CACHE_NAME = '${cacheVersion}';`)
      .replace(/const IMAGE_CACHE_NAME = ['"][^'"]+['"];/, `const IMAGE_CACHE_NAME = 'sistema-ventas-images-${cleanId}';`)
      .replace(/const SCRIPT_CACHE_NAME = ['"][^'"]+['"];/, `const SCRIPT_CACHE_NAME = 'sistema-ventas-scripts-${cleanId}';`);

    res.send(syncedSw);
  } catch (err) {
    console.error('[SW] Error en sincronización dinámica de sw.js:', err);
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
  }
});

// =========================================================================
// ENDPOINTS DE API: GESTIÓN Y SINCRONIZACIÓN AUTOMÁTICA DE PRODUCTOS Y VERSIÓN
// =========================================================================

// Endpoint de configuración para el frontend (inyecta variables de entorno y firebase-applet-config.json)
app.get('/api/config', (req, res) => {
  let appletConfig = {};
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      appletConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('[Config] Error al leer firebase-applet-config.json:', err);
  }

  res.json({
    firebase: {
      apiKey: process.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey || "AIzaSyD4o8v98eDIoDr8nOCeLhfpS5eUiYDhwS4",
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain || "round-monitor-wvd6f.firebaseapp.com",
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId || "round-monitor-wvd6f",
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket || "round-monitor-wvd6f.firebasestorage.app",
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId || "473043111847",
      appId: process.env.VITE_FIREBASE_APP_ID || appletConfig.appId || "1:473043111847:web:9732ed2167a3d20aa9f082",
      firestoreDatabaseId: process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || appletConfig.firestoreDatabaseId || "ai-studio-notadeventa-82ee0414-d6a9-42c4-9f23-395cfd0d7672"
    }
  });
});

// Endpoint de versión del sistema y estado de caché sincronizado
app.get('/api/version', (req, res) => {
  const versionInfo = obtenerConfiguracionVersion();
  res.json({
    appVersion: versionInfo.appVersion,
    cacheVersion: versionInfo.cacheVersion,
    catalogVersion: catalogoMaster.version,
    totalProductos: catalogoMaster.productos.length,
    ultimaActualizacion: catalogoMaster.ultimaActualizacion,
    ultimaRevisionDiaria: catalogoMaster.ultimaRevisionDiaria,
    timestamp: Date.now()
  });
});

// Obtener catálogo unificado de productos para cualquier usuario o dispositivo
app.get('/api/productos', (req, res) => {
  res.json({
    ok: true,
    version: catalogoMaster.version,
    ultimaActualizacion: catalogoMaster.ultimaActualizacion,
    ultimaRevisionDiaria: catalogoMaster.ultimaRevisionDiaria,
    total: catalogoMaster.productos.length,
    productos: catalogoMaster.productos
  });
});

// Sincronizar productos desde cualquier cliente/teléfono (recibe productos nuevos o modificados)
app.post('/api/productos/sync', (req, res) => {
  try {
    const { productos, source } = req.body;
    if (!Array.isArray(productos)) {
      return res.status(400).json({ ok: false, error: 'Se esperaba un arreglo en el campo "productos"' });
    }

    const ahora = new Date();
    let productosNuevosOActualizados = 0;
    const mapaActual = new Map();

    // Indexar productos existentes por nombre normalizado
    for (const p of catalogoMaster.productos) {
      if (p && p.Producto) {
        mapaActual.set(p.Producto.trim().toLowerCase(), p);
      }
    }

    // Fusionar productos entrantes desde el dispositivo
    for (const prod of productos) {
      if (!prod || !prod.Producto) continue;
      const nombreOriginal = String(prod.Producto).trim();
      const nombreLimpio = limpiarNombreProducto(nombreOriginal);
      if (!nombreLimpio) continue;
      const clave = nombreLimpio.toLowerCase();

      const esCaja = /\((caja|pqte|paquete)\)/i.test(nombreOriginal);
      const esUnidad = /\((unidad|u)\)/i.test(nombreOriginal);

      let precioCaja = Number(prod.PrecioCaja) >= 0 ? Number(prod.PrecioCaja) : 0;
      let precioUnidad = Number(prod.PrecioUnidad) >= 0 ? Number(prod.PrecioUnidad) : 0;

      if (esCaja && precioCaja === 0 && precioUnidad > 0) {
        precioCaja = precioUnidad;
        precioUnidad = 0;
      }

      const tsEdicion = Number(prod.UltimaEdicion) || ahora.getTime();

      const existente = mapaActual.get(clave);
      if (!existente) {
        const nuevoProd = {
          idDoc: prod.idDoc || ('prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          Producto: nombreLimpio,
          PrecioCaja: precioCaja,
          PrecioUnidad: precioUnidad,
          FechaEdicionTexto: prod.FechaEdicionTexto || ahora.toLocaleString('es-ES'),
          UltimaEdicion: tsEdicion,
          actualizadoPor: prod.actualizadoPor || source || 'DispositivoCliente'
        };
        mapaActual.set(clave, nuevoProd);
        productosNuevosOActualizados++;
      } else {
        const tsExistente = Number(existente.UltimaEdicion) || 0;
        if (tsEdicion >= tsExistente) {
          existente.PrecioCaja = precioCaja;
          existente.PrecioUnidad = precioUnidad;
          existente.Producto = nombreLimpio;
          existente.FechaEdicionTexto = prod.FechaEdicionTexto || ahora.toLocaleString('es-ES');
          existente.UltimaEdicion = tsEdicion;
          existente.actualizadoPor = prod.actualizadoPor || source || 'DispositivoCliente';
          productosNuevosOActualizados++;
        }
      }
    }

    if (productosNuevosOActualizados > 0) {
      catalogoMaster.productos = Array.from(mapaActual.values());
      catalogoMaster.version += 1;
      catalogoMaster.ultimaActualizacion = ahora.toISOString();
      guardarCatalogoMasterEnDisco();
      console.log(`[Backend Productos] Sincronizados ${productosNuevosOActualizados} cambios desde "${source || 'cliente'}". Total en catálogo: ${catalogoMaster.productos.length} (Versión: ${catalogoMaster.version})`);
    }

    res.json({
      ok: true,
      mensaje: `Sincronización exitosa. ${productosNuevosOActualizados} productos integrados.`,
      cambiosAplicados: productosNuevosOActualizados,
      version: catalogoMaster.version,
      total: catalogoMaster.productos.length,
      productos: catalogoMaster.productos
    });
  } catch (err) {
    console.error('[Backend Productos] Error en /api/productos/sync:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Eliminar producto del catálogo maestro si fue borrado en la UI
app.post('/api/productos/eliminar', (req, res) => {
  try {
    const { nombre, idDoc } = req.body;
    if (!nombre && !idDoc) {
      return res.status(400).json({ ok: false, error: 'Se requiere nombre o idDoc' });
    }

    const claveLower = (nombre || '').toLowerCase().trim();
    const totalInicial = catalogoMaster.productos.length;

    catalogoMaster.productos = catalogoMaster.productos.filter((p) => {
      if (idDoc && p.idDoc === idDoc) return false;
      if (claveLower && (p.Producto || '').toLowerCase().trim() === claveLower) return false;
      return true;
    });

    if (catalogoMaster.productos.length !== totalInicial) {
      catalogoMaster.version += 1;
      catalogoMaster.ultimaActualizacion = new Date().toISOString();
      guardarCatalogoMasterEnDisco();
      console.log(`[Backend Productos] Producto "${nombre || idDoc}" eliminado. Nuevo total: ${catalogoMaster.productos.length}`);
    }

    res.json({
      ok: true,
      version: catalogoMaster.version,
      total: catalogoMaster.productos.length,
      productos: catalogoMaster.productos
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para forzar o probar la actualización diaria desde backend
app.all('/api/productos/ejecutar-actualizacion-diaria', (req, res) => {
  const resultado = ejecutarActualizacionDiariaProductosBackend('DISPARADOR_API');
  res.json(resultado);
});

// ENDPOINTS DE API: GESTIÓN Y RESPALDO PERMANENTE DE VENTAS Y NOTAS DIARIAS
// =========================================================================

// Endpoint para consultar tombstones activos
app.get('/api/ventas/tombstones', (req, res) => {
  res.json({
    ok: true,
    total: tombstonesMaster.size,
    tombstones: Array.from(tombstonesMaster)
  });
});

// Obtener ventas (permite filtrar por día, ej. /api/ventas?dia=hoy o límite)
app.get('/api/ventas', (req, res) => {
  try {
    const { dia, limit } = req.query;
    let lista = ventasMaster.ventas.filter(v => !esNotaTombstone(v));

    if (dia === 'hoy') {
      lista = lista.filter(v => esVentaDeHoyBackend(v));
    } else if (dia && typeof dia === 'string') {
      // Filtrar por fecha específica (YYYY_MM_DD o DD/MM/AAAA)
      const diaNorm = dia.replace(/[\-\/]/g, '_');
      lista = lista.filter(v => {
        const str = String(v.FechaTexto || v.fecha || '').replace(/[\-\/]/g, '_');
        return str.includes(diaNorm);
      });
    }

    const maxItems = Math.min(Number(limit) || 200, 1000);
    const resultado = lista.slice(0, maxItems);
    const ventasHoy = lista.filter(v => esVentaDeHoyBackend(v));

    res.json({
      ok: true,
      total: lista.length,
      totalHoy: ventasHoy.length,
      totalRetornados: resultado.length,
      version: ventasMaster.version,
      ultimaActualizacion: ventasMaster.ultimaActualizacion,
      tombstones: Array.from(tombstonesMaster),
      ventas: resultado
    });
  } catch (err) {
    console.error('[Backend Ventas] Error en GET /api/ventas:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Obtener exclusivamente las notas del día actual con resumen
app.get('/api/ventas/hoy', (req, res) => {
  try {
    const ventasHoy = ventasMaster.ventas.filter(v => esVentaDeHoyBackend(v) && !esNotaTombstone(v));
    const totalMonto = ventasHoy.reduce((acc, v) => acc + (Number(v.Total) || 0), 0);
    res.json({
      ok: true,
      fecha: obtenerClaveFechaHoy(),
      total: ventasHoy.length,
      montoTotal: Number(totalMonto.toFixed(2)),
      version: ventasMaster.version,
      tombstones: Array.from(tombstonesMaster),
      ventas: ventasHoy
    });
  } catch (err) {
    console.error('[Backend Ventas] Error en GET /api/ventas/hoy:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Guardar o respaldar una nota de venta diaria (desde cualquier dispositivo o cliente PWA)
app.post('/api/ventas', (req, res) => {
  try {
    const ventaRaw = req.body;
    if (!ventaRaw || typeof ventaRaw !== 'object') {
      return res.status(400).json({ ok: false, error: 'Se esperaba un objeto de venta en el cuerpo' });
    }

    if (esNotaTombstone(ventaRaw)) {
      return res.status(400).json({ ok: false, error: 'Esta nota fue anulada/eliminada permanentemente (tombstone).' });
    }

    const ventaNorm = normalizarVentaBackend(ventaRaw);
    if (!ventaNorm) {
      return res.status(400).json({ ok: false, error: 'Datos de venta inválidos' });
    }

    // Regla Senior: Rechazar notas fantasma sin ítems o con monto cero/negativo
    const itemsValidos = Array.isArray(ventaNorm.Items) ? ventaNorm.Items.filter(it => it && String(it.producto || '').trim() && Number(it.cantidad || 0) > 0) : [];
    if (itemsValidos.length === 0 || Number(ventaNorm.Total || 0) <= 0) {
      console.warn(`[Backend Ventas] Rechazo de nota fantasma sin ítems o sin monto: ${ventaNorm.CodigoNota}`);
      return res.status(400).json({ ok: false, error: 'Nota rechazada: no contiene productos válidos o el total es cero.' });
    }

    const codBuscado = (ventaNorm.CodigoNota || '').trim().toLowerCase();
    const idDocBuscado = (ventaNorm.idDoc || '').trim();

    const idxExistente = ventasMaster.ventas.findIndex(v => {
      if (idDocBuscado && v.idDoc && v.idDoc === idDocBuscado) return true;
      if (codBuscado && (v.CodigoNota || '').trim().toLowerCase() === codBuscado) return true;
      if (codBuscado && (v.codigoNota || '').trim().toLowerCase() === codBuscado) return true;
      return false;
    });

    if (idxExistente !== -1) {
      ventasMaster.ventas[idxExistente] = {
        ...ventasMaster.ventas[idxExistente],
        ...ventaNorm,
        idDoc: ventasMaster.ventas[idxExistente].idDoc || ventaNorm.idDoc
      };
      console.log(`[Backend Ventas] Nota ${ventaNorm.CodigoNota} actualizada y respaldada en servidor.`);
    } else {
      ventasMaster.ventas.unshift(ventaNorm);
      console.log(`[Backend Ventas] Nueva nota ${ventaNorm.CodigoNota} (Bs. ${ventaNorm.Total}) resguardada con éxito.`);
    }

    ventasMaster.version += 1;
    ventasMaster.ultimaActualizacion = new Date().toISOString();
    guardarVentasMasterEnDisco();

    const ventasHoy = ventasMaster.ventas.filter(v => esVentaDeHoyBackend(v) && !esNotaTombstone(v));

    res.json({
      ok: true,
      mensaje: 'Nota de venta resguardada exitosamente en el servidor',
      version: ventasMaster.version,
      totalVentasHoy: ventasHoy.length,
      tombstones: Array.from(tombstonesMaster),
      venta: ventaNorm
    });
  } catch (err) {
    console.error('[Backend Ventas] Error en POST /api/ventas:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sincronización masiva de ventas locales con el servidor (backup bidireccional)
app.post('/api/ventas/sync', (req, res) => {
  try {
    const { ventas, source } = req.body;
    if (!Array.isArray(ventas)) {
      return res.status(400).json({ ok: false, error: 'Se esperaba un arreglo en el campo "ventas"' });
    }

    let notasNuevasOActualizadas = 0;
    const mapaPorCodigo = new Map();

    ventasMaster.ventas.forEach(v => {
      if (esNotaTombstone(v)) return;
      const k = (v.CodigoNota || v.codigoNota || v.idDoc || '').trim().toLowerCase();
      if (k) mapaPorCodigo.set(k, v);
    });

    for (const vRaw of ventas) {
      // Filtrar inmediatamente si fue eliminada previamente (anti-zombie)
      if (esNotaTombstone(vRaw)) continue;

      const vNorm = normalizarVentaBackend(vRaw);
      if (!vNorm) continue;

      // Filtrar notas fantasmas vacías
      const itemsVal = Array.isArray(vNorm.Items) ? vNorm.Items.filter(it => it && String(it.producto || '').trim() && Number(it.cantidad || 0) > 0) : [];
      if (itemsVal.length === 0 || Number(vNorm.Total || 0) <= 0) continue;

      const k = (vNorm.CodigoNota || vNorm.codigoNota || vNorm.idDoc || '').trim().toLowerCase();
      if (!k) continue;

      if (!mapaPorCodigo.has(k)) {
        mapaPorCodigo.set(k, vNorm);
        notasNuevasOActualizadas++;
      } else {
        const exist = mapaPorCodigo.get(k);
        if ((vNorm.timestamp || 0) >= (exist.timestamp || 0)) {
          mapaPorCodigo.set(k, { ...exist, ...vNorm });
          notasNuevasOActualizadas++;
        }
      }
    }

    if (notasNuevasOActualizadas > 0) {
      ventasMaster.ventas = Array.from(mapaPorCodigo.values()).filter(v => !esNotaTombstone(v));
      ventasMaster.ventas.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      ventasMaster.version += 1;
      ventasMaster.ultimaActualizacion = new Date().toISOString();
      guardarVentasMasterEnDisco();
      console.log(`[Backend Ventas Sync] Sincronizadas ${notasNuevasOActualizadas} notas desde ${source || 'cliente'}. Total: ${ventasMaster.ventas.length}`);
    }

    const ventasHoy = ventasMaster.ventas.filter(v => esVentaDeHoyBackend(v) && !esNotaTombstone(v));

    res.json({
      ok: true,
      mensaje: `Sincronización completada. ${notasNuevasOActualizadas} notas integradas en el respaldo.`,
      totalVentasHoy: ventasHoy.length,
      totalGeneral: ventasMaster.ventas.length,
      version: ventasMaster.version,
      tombstones: Array.from(tombstonesMaster),
      ventasHoy: ventasHoy
    });
  } catch (err) {
    console.error('[Backend Ventas Sync] Error en POST /api/ventas/sync:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Eliminar venta en el respaldo del servidor si fue anulada/eliminada
app.post('/api/ventas/eliminar', (req, res) => {
  try {
    const { codigoNota, idDoc } = req.body;
    if (!codigoNota && !idDoc) {
      return res.status(400).json({ ok: false, error: 'Se requiere codigoNota o idDoc' });
    }

    // Registrar en tombstones para que jamás vuelva a sincronizarse
    if (codigoNota) registrarTombstoneBackend(codigoNota);
    if (idDoc) registrarTombstoneBackend(idDoc);

    const codLower = (codigoNota || '').trim().toLowerCase();
    const totalInicial = ventasMaster.ventas.length;

    ventasMaster.ventas = ventasMaster.ventas.filter(v => {
      if (idDoc && (v.idDoc === idDoc || v.id === idDoc)) return false;
      if (codLower) {
        const c = (v.CodigoNota || v.codigoNota || v.Lista || v.lista || '').trim().toLowerCase();
        if (c === codLower || c === codLower.replace('#', '') || ('#' + c) === codLower) return false;
      }
      return !esNotaTombstone(v);
    });

    purgarNotaEnTodosArchivosDiarios(codigoNota, idDoc);

    if (ventasMaster.ventas.length !== totalInicial) {
      ventasMaster.version += 1;
      ventasMaster.ultimaActualizacion = new Date().toISOString();
      guardarVentasMasterEnDisco();
      console.log(`[Backend Ventas] Nota "${codigoNota || idDoc}" eliminada permanentemente del respaldo.`);
    }

    res.json({
      ok: true,
      eliminada: true,
      tombstones: Array.from(tombstonesMaster),
      total: ventasMaster.ventas.length,
      version: ventasMaster.version
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve html2canvas from public if requested
app.get('/html2canvas.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html2canvas.min.js'));
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  maxAge: '0',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));

// Route for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Avoid returning HTML for non-existent static assets (.js, .css, .png, etc.)
app.get(/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|map|woff|woff2|ttf|eot)$/, (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Fallback to index.html for SPA routing or direct access
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const v = obtenerConfiguracionVersion();
  console.log(`Server running on http://0.0.0.0:${PORT} (Version: ${v.appVersion}, Cache: ${v.cacheVersion})`);
});
