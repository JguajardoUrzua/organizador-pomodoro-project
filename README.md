# Tareas · Pomodoro

Temporizador Pomodoro con tareas, bitácora, notas, calendario y música. Es una página estática: no necesita servidor ni base de datos, y se puede instalar como app (PWA) y usar sin conexión.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página (estructura). |
| `css/styles.css` | Todo el diseño. |
| `js/app.js` | Toda la lógica de la app. |
| `img/fondos/` | Las fotos de fondo. Para agregar una, ver más abajo. |
| `icons/` | Íconos de la app (pestaña, escritorio, celular). |
| `manifest.webmanifest` | Le dice al navegador que es una app instalable: nombre, colores e íconos. |
| `sw.js` | *Service worker*: guarda los archivos para que la app abra sin internet. |
| `.nojekyll` | Le pide a GitHub Pages que publique los archivos tal cual. |
| `.gitignore` | Evita que subas por error tus respaldos (`*respaldo*.json`, etc.). |

## 1. Probarla en tu computador

La PWA necesita abrirse desde un servidor, no con doble clic. Desde esta carpeta:

```bash
python -m http.server 8000
```

Luego abre <http://localhost:8000>. Para detenerlo, usa Ctrl+C en la terminal.

## 2. Crear el repositorio en GitHub

1. En GitHub, toca **New repository**.
2. Ponle un nombre (por ejemplo `tareas`), déjalo **Public** y no marques "Add a README".
3. Crea el repositorio.

## 3. Subir los archivos

Desde esta carpeta, en la terminal:

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/tareas.git
git push -u origin main
```

Si prefieres no usar la terminal, en la página del repositorio puedes usar **Add file → Upload files** y arrastrar el contenido de la carpeta. Ojo: los archivos que empiezan con punto (`.nojekyll`, `.gitignore`) a veces no se ven al arrastrar.

## 4. Activar GitHub Pages

1. En el repositorio, ve a **Settings → Pages**.
2. En **Build and deployment**, elige **Deploy from a branch**.
3. En la rama, elige `main` y la carpeta `/ (root)`, y guarda.
4. Espera uno o dos minutos. La dirección será `https://TU-USUARIO.github.io/tareas/`.

## 5. Pasar tus datos a la nueva dirección

Cada dirección guarda sus propios datos en el navegador, así que la versión publicada parte vacía.

1. En tu versión actual: **Ajustes → Respaldo → Descargar respaldo ahora**.
2. En la nueva: **Ajustes → Respaldo → Importar respaldo…** y elige ese archivo.

## 6. Instalarla como app

- **Chrome o Edge (computador):** el ícono de instalar aparece al lado derecho de la barra de direcciones.
- **Android (Chrome):** menú ⋮ → **Agregar a pantalla principal** o **Instalar app**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.

## Publicar una nueva versión

1. Reemplaza los archivos que cambiaron.
2. En `sw.js`, sube el número de `VERSION`, por ejemplo de `"v1"` a `"v2"`. Si no lo cambias, algunos navegadores seguirán mostrando la versión anterior guardada.
3. Haz commit y push:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

## Cambiar el nombre de la app

Cuando elijas el nombre definitivo, cámbialo en:

- `index.html`: `<title>`, `apple-mobile-web-app-title` y el `<h1>`.
- `manifest.webmanifest`: `name` y `short_name`.

## Usar tu propio dominio

En **Settings → Pages → Custom domain**, escribe tu dominio. Luego, en tu proveedor de dominio, crea el registro DNS que GitHub te indique. Después marca **Enforce HTTPS**.

## Agregar un fondo

1. Copia la foto en `img/fondos/`, por ejemplo `lago.jpg`. Lo ideal es 1920 × 1080 o más grande, en JPG de 300 a 700 KB.
2. En `js/app.js`, busca `const BGS=[` y agrega una línea como esta:
   `{id:"lago",name:"Lago",src:"img/fondos/lago.jpg"},`
3. En `sw.js`, agrega `"img/fondos/lago.jpg"` a la lista `FILES` y sube `VERSION`.

## Privacidad

Tus tareas, notas y bitácora se guardan solo en tu navegador. Quien abra el enlace ve la app vacía, con sus propios datos. No subas tus respaldos (`.json`) al repositorio, porque es público. El `.gitignore` ya bloquea los nombres habituales.
