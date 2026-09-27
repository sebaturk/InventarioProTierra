// Adaptador de Firebase.
// Traduce llamadas simples de tipo "colección/documento" (las que ya usa app.js)
// a la API real de Firebase Firestore/Storage/Auth. Así reutilizamos toda la
// lógica de negocio (login, conteos, aprobaciones) sin reescribirla.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, orderBy, limit as fbLimit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// ---- doc() shim: misma forma que usa app.js (path tipo "coleccion/id") ----
function docShim(path) {
  const parts = path.split('/');
  const ref = doc(firestore, ...parts);
  return {
    id: parts[parts.length - 1],
    async get() {
      const snap = await getDoc(ref);
      return { exists: snap.exists(), id: snap.id, data: () => snap.data() };
    },
    async set(data) { await setDoc(ref, data); },
    async update(data) { await updateDoc(ref, data); },
  };
}

// ---- collection() shim: soporta .where().orderBy().limit().get() / .add() / .doc() ----
function collectionShim(path) {
  const constraints = [];
  const api = {
    where(field, op, value) { constraints.push(where(field, op, value)); return api; },
    orderBy(field, dir) { constraints.push(orderBy(field, dir || 'asc')); return api; },
    limit(n) { constraints.push(fbLimit(n)); return api; },
    async get() {
      const q = query(collection(firestore, path), ...constraints);
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
      return { empty: docs.length === 0, docs };
    },
    doc(id) { return docShim(path + '/' + id); },
    async add(data) {
      const ref = await addDoc(collection(firestore, path), data);
      return docShim(path + '/' + ref.id);
    },
  };
  return api;
}

const dbShim = {
  doc: docShim,
  collection: collectionShim,
};

// ---- assets: sube a Firebase Storage y devuelve un id reconstruible sin token ----
const assetsShim = {
  async upload(blob, options) {
    const id = 'photos/' + Date.now() + '_' + Math.random().toString(36).slice(2, 9) + '.jpg';
    const sref = storageRef(storage, id);
    await uploadBytes(sref, blob, { contentType: (options && options.type) || blob.type || 'image/jpeg' });
    return { id, sizeBytes: blob.size, contentType: (options && options.type) || blob.type };
  },
};

// Requiere que las reglas de Storage permitan lectura pública (ver storage.rules);
// así no hace falta pedir un token de descarga por cada foto en cada pantalla.
function photoUrl(photoId) {
  return 'https://firebasestorage.googleapis.com/v0/b/' + firebaseConfig.storageBucket +
    '/o/' + encodeURIComponent(photoId) + '?alt=media';
}

// Login anónimo: no identifica a la persona (eso lo hace el PIN dentro de la app),
// pero le da a Firestore/Storage un request.auth != null para poder exigirlo en las reglas.
const ready = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
  signInAnonymously(auth).catch(reject);
});

window.__firebaseReady = ready;
window.__firebaseDb = dbShim;
window.__firebaseAssets = assetsShim;
window.__firebasePhotoUrl = photoUrl;
