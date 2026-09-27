// Pegá acá la configuración de tu proyecto de Firebase.
// La conseguís en: Firebase Console > Configuración del proyecto > Tus apps > (ícono web) > SDK setup and configuration.
// Este archivo NO es secreto: está pensado para ser público (la seguridad real la dan
// las reglas de Firestore/Storage, no ocultar esta config). Aun así, no subas acá
// ninguna clave de "service account" (esas sí son secretas y no se usan en este proyecto).

export const firebaseConfig = {
  apiKey: "AIzaSyAGiT6HKccMBuuVKaiqg2wEeZnbG6SeCz4",
  authDomain: "inventario-pro-120c6.firebaseapp.com",
  projectId: "inventario-pro-120c6",
  storageBucket: "inventario-pro-120c6.firebasestorage.app",
  messagingSenderId: "879046912389",
  appId: "1:879046912389:web:e04f2614797aebedcd3cec"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
