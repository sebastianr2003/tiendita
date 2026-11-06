import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getDocFromServer,
  doc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Intentar cargar configuración dinámica desde el backend
let dynamicConfig = null;
try {
  const resp = await fetch('/api/config');
  if (resp.ok) {
    const data = await resp.json();
    dynamicConfig = data.firebase;
  }
} catch (e) {
  console.warn("No se pudo cargar la configuración dinámica, usando hardcoded.");
}

export const firebaseConfig = dynamicConfig || {
  apiKey: "AIzaSyD4o8v98eDIoDr8nOCeLhfpS5eUiYDhwS4",
  authDomain: "round-monitor-wvd6f.firebaseapp.com",
  projectId: "round-monitor-wvd6f",
  storageBucket: "round-monitor-wvd6f.firebasestorage.app",
  messagingSenderId: "473043111847",
  appId: "1:473043111847:web:9732ed2167a3d20aa9f082",
  firestoreDatabaseId: "ai-studio-notadeventa-82ee0414-d6a9-42c4-9f23-395cfd0d7672"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Inicializar Firestore con Long Polling para máxima compatibilidad en AI Studio
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true
}, firebaseConfig.firestoreDatabaseId);

async function testConnection() {
  try {
    // Intentar una lectura directa del servidor para verificar conectividad
    await getDocFromServer(doc(db, 'Metadata', 'Correlativo'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error?.code === 'resource-exhausted' || (error instanceof Error && error.message.includes('Quota exceeded'))) {
      console.warn("Firestore quota exceeded. Operating in local/offline mode until quota resets.");
    } else if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Firestore is offline. Please check your Firebase configuration and network.");
    } else {
      console.warn("Firestore connection test notice:", error?.message || error);
    }
  }
}
testConnection();

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// Escuchar retorno de redirección OAuth si se utilizó en móviles/PWAs
try {
  getRedirectResult(auth).then((result) => {
    if (result && result.user) {
      console.log("Sesión restaurada desde redirección Google:", result.user.email);
    }
  }).catch((err) => {
    console.warn("Aviso retorno redirección Auth:", err);
  });
} catch (e) {}

// Directorio maestro de usuarios autorizados
export const USUARIOS_AUTORIZADOS_LISTA = [
  { email: "sebasrickytapia@gmail.com", nombre: "Sebastian Tapia", rol: "Administrador" },
  { email: "sebasrocktapia2016@gmail.com", nombre: "Sebas Rock", rol: "Administrador" },
  { email: "marcelamolinaescobar@gmail.com", nombre: "Marcela Molina", rol: "Administradora" },
  { email: "carolrosely23@gmail.com", nombre: "Carol Rosely", rol: "Administradora" },
  { email: "ricktapiakodak@gmail.com", nombre: "Rick Tapia", rol: "Administrador" },
  { email: "samantaetapiamolina@gmail.com", nombre: "Samanta Tapia", rol: "Administradora" },
  { email: "siberleandra@gmail.com", nombre: "Siber Leandra", rol: "Administradora" }
];

// Lista de correos autorizados en las Reglas de Firebase
export const EMAILS_AUTORIZADOS = USUARIOS_AUTORIZADOS_LISTA.map(u => u.email);
export const ADMIN_EMAILS = USUARIOS_AUTORIZADOS_LISTA.map(u => u.email);

export function esUsuarioAutorizado(user) {
  if (!user || !user.email) return false;
  const emailNorm = user.email.toLowerCase().trim();
  return EMAILS_AUTORIZADOS.some(e => e.toLowerCase().trim() === emailNorm) ||
         ADMIN_EMAILS.some(e => e.toLowerCase().trim() === emailNorm);
}

export function esAdmin(user) {
  if (!user || !user.email) return false;
  const emailNorm = user.email.toLowerCase().trim();
  return ADMIN_EMAILS.some(e => e.toLowerCase().trim() === emailNorm);
}

export async function iniciarSesionConGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Verificación estricta inmediata de correo autorizado
    if (!esAdmin(user) && !esUsuarioAutorizado(user)) {
      const emailNoAutorizado = user.email || "desconocido";
      await signOut(auth);
      try {
        localStorage.removeItem("usuario_admin_cache");
      } catch (e) {}
      alert(`⛔ Acceso no autorizado: La cuenta "${emailNoAutorizado}" no pertenece a la lista de usuarios autorizados.`);
      throw new Error(`Acceso denegado para el correo: ${emailNoAutorizado}`);
    }

    console.log("¡Bienvenido/a!", user.displayName || user.email);
    return user;
  } catch (error) {
    console.error("Error al iniciar sesión con Google:", error);
    // Intentar redirect si el popup fue bloqueado por navegador móvil / PWA
    if (error && (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request')) {
      console.log("Popup bloqueado en móvil/PWA. Probando signInWithRedirect...");
      try {
        await signInWithRedirect(auth, provider);
        return null;
      } catch (eRedirect) {
        console.error("Error en signInWithRedirect:", eRedirect);
      }
    }
    throw error;
  }
}

// Acceso directo y seguro para personal autorizado (en caso de offline o limitaciones de dominio en Google OAuth)
export function iniciarSesionDirectaAutorizada(email) {
  if (!email) throw new Error("Correo requerido.");
  const emailNorm = String(email).toLowerCase().trim();
  const info = USUARIOS_AUTORIZADOS_LISTA.find(u => u.email.toLowerCase().trim() === emailNorm);
  if (!info && !EMAILS_AUTORIZADOS.some(e => e.toLowerCase().trim() === emailNorm)) {
    throw new Error(`La cuenta ${emailNorm} no está en la lista de personal autorizado.`);
  }

  const nombre = info ? info.nombre : emailNorm.split("@")[0];
  const userObj = {
    email: emailNorm,
    displayName: nombre,
    photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=2563eb&color=fff`,
    uid: "usr_" + emailNorm.replace(/[^a-zA-Z0-9]/g, "_"),
    esLocalOffline: true
  };

  try {
    localStorage.setItem("usuario_admin_cache", JSON.stringify(userObj));
  } catch (e) {}

  return userObj;
}

export async function cerrarSesionGoogle() {
  try {
    try {
      localStorage.removeItem("usuario_admin_cache");
    } catch (e) {}
    await signOut(auth);
    console.log("Sesión cerrada correctamente.");
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    throw error;
  }
}

export async function asegurarAutenticacionFirebase() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    console.log("Sesión anónima iniciada como respaldo Firebase:", cred.user?.uid);
    return cred.user;
  } catch (err) {
    console.warn("Aviso autenticación Firebase fallback:", err);
    return null;
  }
}

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { onAuthStateChanged };

export default {
  app,
  auth,
  db,
  firebaseConfig,
  USUARIOS_AUTORIZADOS_LISTA,
  EMAILS_AUTORIZADOS,
  ADMIN_EMAILS,
  esUsuarioAutorizado,
  esAdmin,
  iniciarSesionConGoogle,
  iniciarSesionDirectaAutorizada,
  asegurarAutenticacionFirebase,
  cerrarSesionGoogle,
  onAuthStateChanged,
  handleFirestoreError,
  OperationType
};
