// Adaptador de Firebase.
// Traduce llamadas simples de tipo "colección/documento" (las que ya usa app.js)
// a la API real de Firebase Firestore/Auth. Así reutilizamos toda la lógica de
// negocio (login, conteos, aprobaciones) sin reescribirla.
//
// OJO: este proyecto NO usa Firebase Storage. Desde el 3/feb/2026, Cloud Storage
// for Firebase exige el plan de pago Blaze incluso para uso gratuito, y para
// esta app no vale la pena ese requisito solo por unas fotos de referencia que
// casi no cambian. En vez de subir las fotos a un bucket, se guardan directo
// como texto (base64) adentro del propio documento del producto en Firestore,
// que sigue siendo 100% gratis en el plan Spark. La contra: cada foto viaja
// dentro de la respuesta cada vez que se lee la lista de productos (un poco
// más de datos por visita); para el volumen de este catálogo no debería
// notarse. Si en algún momento pasan a Blaze, migrar a Storage es un cambio
// acotado a este archivo.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, orderBy, limit as fbLimit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
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

// ---- assets: en vez de subir a un bucket, devuelve la imagen como data URL ----
// (app.js ya comprime/redimensiona la foto antes de llamar a esto, así que
// llega liviana; ver el límite de tamaño más abajo como red de seguridad).
const MAX_PHOTO_BYTES = 700 * 1024; // deja margen bajo el límite de 1 MiB por documento de Firestore
const assetsShim = {
  async upload(blob) {
    if (blob.size > MAX_PHOTO_BYTES) {
      throw Object.assign(new Error('la foto pesa demasiado incluso comprimida'), { code: 'photo-too-large' });
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    // El "id" acá ES la imagen (un data: URL); no hay ningún archivo remoto que borrar o referenciar.
    return { id: dataUrl, sizeBytes: blob.size };
  },
};

// La foto ya viene guardada como data: URL completo; no hay que armar ninguna URL.
function photoUrl(photoId) {
  return photoId || '';
}

// Login anónimo: no identifica a la persona (eso lo hace el PIN dentro de la app),
// pero le da a Firestore un request.auth != null para poder exigirlo en las reglas.
const ready = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
  signInAnonymously(auth).catch(reject);
});

window.__firebaseReady = ready;
window.__firebaseDb = dbShim;
window.__firebaseAssets = assetsShim;
window.__firebasePhotoUrl = photoUrl;
