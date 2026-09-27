# Stock — Control de inventario

App de control de stock por área (Cocina, Barra, Piso) con login por PIN,
conteo mensual comparado contra el último aprobado, aprobación de
discrepancias y de productos nuevos con foto. Corre como sitio estático
(HTML/CSS/JS puro, sin build) con Firebase como backend.

## Estructura del proyecto

```
index.html                  → página única, monta la app
css/styles.css               → estilos (tema claro/oscuro automático)
js/app.js                    → toda la lógica de negocio (pantallas, login, conteos)
js/firebase-adapter.js       → traduce la lógica a llamadas reales de Firebase
js/firebase-config.js        → tus credenciales del proyecto de Firebase (completar)
firestore.rules               → reglas de seguridad de la base de datos
storage.rules                 → reglas de seguridad de las fotos
```

`app.js` no sabe nada de Firebase: llama a `state.db` y `state.assets` como si
fueran una base de datos genérica. Todo el trabajo de hablar con Firebase
vive en `firebase-adapter.js`, así que si el día de mañana cambiás de
backend, ese es el único archivo que hay que reescribir.

## 1. Crear el proyecto de Firebase

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) y creá un proyecto nuevo.
2. En el menú lateral, **Build > Firestore Database** → "Crear base de datos" → modo producción → elegí una región.
3. **Build > Storage** → "Empezar" → modo producción.
4. **Build > Authentication** → pestaña "Sign-in method" → habilitá **Anónimo**.
   (La app usa esto solo para que Firestore sepa que la visita "vino de la app real"; el PIN que ve el personal es un dato de la propia app, no de Firebase.)
5. En **Configuración del proyecto** (ícono de engranaje) → "Tus apps" → ícono `</>` (Web) → registrá una app.
6. Copiá el objeto `firebaseConfig` que te muestra y pegalo en `js/firebase-config.js`, reemplazando los valores de ejemplo.

## 2. Publicar las reglas de seguridad

Desde la consola de Firebase:
- **Firestore Database > Reglas**: pegá el contenido de `firestore.rules` y publicá.
- **Storage > Reglas**: pegá el contenido de `storage.rules` y publicá.

(Si preferís la línea de comandos: instalá `npm install -g firebase-tools`, `firebase login`, `firebase init` eligiendo Firestore y Storage sin sobrescribir estos archivos, y `firebase deploy --only firestore:rules,storage`.)

## 3. Subir el proyecto a GitHub

```bash
cd stock-inventario
git init
git add .
git commit -m "Primera versión: app de control de stock con Firebase"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

`js/firebase-config.js` **no es secreto** — está pensado para ser público
(la seguridad real la dan `firestore.rules` y `storage.rules`, no ocultar
esta config), así que no hace falta un `.gitignore` para él.

## 4. Publicar el sitio (GitHub Pages)

1. En el repo de GitHub: **Settings > Pages**.
2. En "Source" elegí la rama `main` y la carpeta `/ (root)`.
3. Guardá. En un minuto te va a dar una URL tipo `https://TU_USUARIO.github.io/TU_REPO/`.

Esa es la URL que le vas a pasar al personal desde sus celulares.

## 5. Primer uso

Al abrir la URL por primera vez, como no hay usuarios todavía, te va a pedir
crear el primer administrador (nombre + PIN de 4 dígitos). Desde ahí, igual
que en las pruebas que ya hiciste: agregás al personal de cada área desde
**Personal**, cargás el catálogo inicial desde **Catálogo**, y cada
encargado entra con su PIN a cargar su conteo mensual.

## Sobre la seguridad de este esquema

Es importante que lo tengas claro: al mover esto fuera de Anthropic, el
control de acceso pasa a depender enteramente de las reglas que pegaste en
el paso 2. Con la regla simple que armamos (`request.auth != null`),
cualquiera que abra la URL queda habilitado a leer y escribir — el PIN
identifica a la persona a nivel de uso dentro de la app, pero no es una
barrera de seguridad real a nivel de base de datos. Para un inventario
interno de bajo riesgo esto suele ser un trade-off razonable, en línea con
lo que ya habíamos aceptado con los PIN en texto plano. Si más adelante
querés subir el nivel de seguridad (por ejemplo, que cada rol solo pueda
escribir su propia área, o habilitar Firebase App Check), avisame y lo
armamos como una segunda vuelta.

## Costos

Firebase tiene un plan gratuito (Spark) con cuotas diarias que, para el
volumen de un solo restaurante (unas decenas de productos, un conteo por
área al mes, algunas fotos), difícilmente vayas a superar. Si en algún
momento ves un aviso de cuota, es momento de revisar el plan de precios,
pero no debería ser necesario para arrancar.
