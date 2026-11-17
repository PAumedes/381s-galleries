# Guía de despliegue — 381 Studios Galerías

Todo se hace desde el navegador: **nunca necesitás compilar ni instalar nada en tu PC**. El despliegue lo hace GitHub Actions.

## 0. Qué vas a necesitar

- Cuenta de **Cloudflare** con el dominio `381studios.ar` (el DNS ya está ahí).
- Cuenta de **Google** (la misma donde está tu Drive) y cuenta de **GitHub** con este repositorio.
- **Google Drive para escritorio** y **Capture One** (solo para el paso 7).

**Costo:** todo es gratis (Cloudflare Workers, D1, R2, Access hasta 50 usuarios, Google Cloud sin facturación). **Workers Paid (USD 5/mes)** solo hace falta si la sincronización choca con los límites del plan gratis (ver Problemas comunes).

Los valores se guardan como **secrets de GitHub**: en el repositorio, **Settings → Secrets and variables → Actions → New repository secret**. Nunca los pegues en el código.

## 1. Google Cloud (acceso a Drive)

1. Entrá a <https://console.cloud.google.com> y creá un proyecto (por ej. "381studios").
2. **APIs y servicios → Biblioteca** → **Google Drive API** → **Habilitar**.
3. Abrí **Google Auth Platform** (menú ☰ → Google Auth Platform) y completá:
   - **Branding:** nombre de la app `381 Studios Galerías`, tu email de soporte y de contacto.
   - **Audience (Público):** tipo **External**. Tocá **Publish app → In production**. (Sin verificar: Google muestra el aviso "app no verificada". Es normal para uso personal.)
   - **Data Access (Acceso a los datos):** **Add or remove scopes** → agregá `https://www.googleapis.com/auth/drive.readonly` y guardá.
   - **Clients (Clientes):** **Create client** → tipo **Web application**. En **Authorized redirect URIs** poné exactamente:
     `https://session.381studios.ar/admin/google/callback`
4. Copiá el **Client ID** y el **Client secret**.
5. En GitHub, creá los secrets `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

**Verificá:** la app figura "In production" y el cliente tiene la URI de redirección.

## 2. Cloudflare Access (login del admin)

1. Cloudflare → **Zero Trust** → **Access controls** → **Applications**. Si es la primera vez, te pide un **team name** (por ejemplo `381studios`) y un plan: elegí **Free** (hasta 50 usuarios). Tu **team domain** es `<equipo>.cloudflareaccess.com`.
2. **Create new application** → **Self-hosted and private**. Nombre: `381 Galerías Admin`.
3. **Add public hostname**: subdominio `session`, dominio `381studios.ar` (desplegable), path `admin`. Volvé a tocar **Add public hostname** para un segundo: `session` / `381studios.ar` / path `api/admin`. Agregá un tercero: `session` / `381studios.ar` / path `admin.data` (lo usa la app al navegar a "Galerías" sin recargar). Los tres en **la misma aplicación**.
4. **Access policies** → crear una nueva: nombre `Solo yo`, acción **Allow**, regla **Include → Emails** = tu email. (Todo lo demás queda denegado por defecto.)
5. Autenticación: las organizaciones nuevas usan **Cloudflare** como método de login (entrás con tu cuenta de Cloudflare); no hace falta configurar nada más. Usá en la policy (paso 4) y en `ADMIN_EMAIL` el **mismo email de tu cuenta de Cloudflare**. Opcional: para entrar con un código por email, agregá **One-time PIN** en **Zero Trust → Integrations → Identity providers → Add new identity provider**.
6. **Session Duration**: 24 horas → **Create**.
7. En la lista, **Configure** en `381 Galerías Admin` → pestaña **Basic information** → copiá el **Application Audience (AUD) Tag**.
8. En GitHub, creá los secrets:
   - `ADMIN_EMAIL`: tu email (el mismo de la policy).
   - `ACCESS_TEAM_DOMAIN`: `<equipo>.cloudflareaccess.com` (sin `https://`).
   - `ACCESS_AUD`: el AUD tag.

> **Nunca** cargues `ALLOW_DEV_ADMIN` (desactiva el login del admin). Si existiera en producción, el workflow Setup lo borra y avisa.

## 3. Token de API de Cloudflare

1. Cloudflare → ícono de perfil → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permisos exactos:
   - **Account → Workers Scripts → Edit**
   - **Account → D1 → Edit**
   - **Account → Workers R2 Storage → Edit**
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit**
   - **Zone → DNS → Edit**
   - **Zone → Zone → Read**
3. **Account Resources:** Include → tu cuenta. **Zone Resources:** Include → Specific zone → `381studios.ar`.
4. Creá el token y copialo (se muestra una sola vez).
5. **Account ID:** Cloudflare → **Workers & Pages** → **Account details** (o la barra lateral derecha) → copiá el Account ID.
6. En GitHub, creá los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.

## 4. Ejecutar Setup

1. En GitHub, pestaña **Actions → Setup → Run workflow** (rama `main`).
2. El workflow: corre las verificaciones, crea la base D1 y el bucket R2 si faltan, escribe el `database_id` en `wrangler.jsonc` (commit "Set D1 database id" del bot), despliega (migraciones + build) y recién después carga los secrets.
3. Abrí la ejecución y leé el **resumen de secrets** (solo nombres): `present`, `created`, `uploaded` o `MISSING`. Si falta alguno, agregalo como secret de GitHub y **volvé a ejecutar Setup**.

Es seguro repetirlo: los secretos aleatorios (`SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`) se generan solo la primera vez y nunca se regeneran (hacerlo cerraría las sesiones y obligaría a reconectar Google). Los de los pasos 1–2 se vuelven a cargar en cada Setup si están definidos en GitHub.

**Verificá:** abrí <https://session.381studios.ar>: debe verse la página con el logo. El Worker no responde en `workers.dev` a propósito.

## 5. Ajustes de seguridad del dominio (una sola vez)


En el panel de Cloudflare, dominio `381studios.ar`:

| Dónde | Qué |
|---|---|
| SSL/TLS → Edge Certificates | **Always Use HTTPS**: activado. **HSTS**: activado (max-age 6 meses, incluir subdominios). Dejá "preload" apagado salvo que estés seguro. |
| Speed → Optimization (o Content Optimization) | **Rocket Loader**: apagado. |
| Scrape Shield | **Email Address Obfuscation**: apagado. |
| Web Analytics / Zaraz | No los actives para este subdominio. |

Por qué: la app envía una política de seguridad (CSP) que solo permite sus propios scripts. Rocket Loader, la ofuscación de emails, Zaraz y la analítica automática inyectan scripts propios de Cloudflare y el navegador los bloquearía (la galería podría no funcionar bien).

## 6. Primer uso

1. Abrí `https://session.381studios.ar/admin`. Cloudflare Access te pide tu email y te manda un código; ingresalo.
2. **Ajustes → Conectar Google**. Va a aparecer "Google no verificó esta app": tocá **Avanzado → Ir a 381 Studios Galerías (no seguro)** y aceptá el permiso de solo lectura.
3. Pegá el **link de la carpeta `381studios`** de Drive y **Guardar carpeta**.
4. **Sincronizar ahora**. Las galerías aparecen como borradores.
5. Abrí una galería → **Publicar** → en **Compartir** copiá el link o descargá/imprimí el QR.

**Verificá:** el link público (`https://session.381studios.ar/<slug>`) abre la galería en una ventana de incógnito.

## 7. Capture One y Drive para escritorio


Creá cinco recetas de proceso (Process Recipes), todas habilitadas, formato **JPEG**, perfil **sRGB**:

| Receta (carpeta) | Tamaño | Calidad sugerida | Notas |
|---|---|---|---|
| `high-res` | 2048 px lado largo | 90 | obligatoria |
| `web` | 1200 px lado largo | 85 | |
| `ig` | 1080 px lado largo | 85 | opcional (sin ella no hay descarga Instagram) |
| `thumb` | 600 px lado largo | 75 | grilla |
| `preview-wm` | 2048 px lado largo | 90 | con marca de agua; opcional, solo se usa para ver |

**Ubicación de salida (Output Location)** de cada receta: elegí la carpeta `381studios` dentro de Drive para escritorio, y en **Sub Folder** escribí `[Session Name]` seguido de `/` y el nombre de la receta, por ejemplo `[Session Name]/high-res`. En Capture One el token se inserta con el botón de tokens (**Formatear**) junto al campo. Resultado: `…/381studios/<Sesión>/high-res`, `…/381studios/<Sesión>/web`, etc.

- **Sets:** para dividir una galería en secciones, usá una subcarpeta con el mismo nombre dentro de cada receta (`high-res/Ceremonia`, `web/Ceremonia`…). Los archivos sueltos van a "Highlights".
- Los **nombres de archivo deben ser idénticos en todas las recetas** (solo cambia la extensión si hace falta): así la app une cada foto con sus tamaños.
- Con todas las recetas habilitadas, un solo "Procesar" genera todo.

**Drive para escritorio:** sincronizá `Mi unidad/381studios` (modo espejo o streaming, ambos sirven). **Verificá:** la carpeta de la sesión aparece en drive.google.com con las subcarpetas de las recetas.

## 8. Actualizar la app

- **Cambios de código:** al hacer merge a `main`, el workflow **Deploy** despliega solo (corre lint, tipos y tests; aplica migraciones nuevas; publica). Si todavía no corriste Setup, Deploy avisa "Run the Setup workflow first" y no hace nada.
- **Cambiar un secret** (por ej. rotar el secreto de Google): actualizalo en GitHub y volvé a ejecutar **Setup**.

## 9. Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| Setup/Deploy falla con "Authentication error" o error 10000 | Al token le falta algún permiso. Revisá los siete del paso 3 (en especial **D1 Edit**, **Workers R2 Storage Edit** y **Account Settings Read**) y que el Account ID sea el correcto. |
| Error de dominio personalizado / "DNS record already exists" / "already has externally managed DNS records" | Ya hay un registro DNS para `session`. En Cloudflare → DNS → Records de `381studios.ar`, borrá el registro `session` y volvé a ejecutar Setup o Deploy. Comprobá también que el token tenga **Workers Routes Edit** y **DNS Edit** sobre la zona. |
| Deploy muestra "Run the Setup workflow first" | Todavía no se ejecutó Setup (el `database_id` es el de relleno). Actions → Setup → Run workflow. |
| Setup termina con secrets `MISSING` | Faltan secrets de GitHub (pasos 1 y 2). Agregalos y volvé a ejecutar Setup. |
| "Google no verificó esta app" | Es normal. **Avanzado → Ir a…**. Confirmá que la app esté "In production". |
| La sincronización dice "no root folder" / "Primero elegí una carpeta raíz" | Falta pegar el link de la carpeta `381studios` en Ajustes y guardar. Comprobá que sea la carpeta de tu cuenta conectada. |
| Access entra en bucle o da 403 | `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN` o `ADMIN_EMAIL` incorrectos (o email distinto al de la policy). Corregí el secret de GitHub y ejecutá Setup. Las rutas `admin` y `api/admin` deben estar bajo Access. |
| Error al navegar entre páginas del admin pero no al recargar | Actualizá la app (ya se resolvió) / agregá el path `admin.data` en Access. |
| Las imágenes no se ven | Falta el bucket R2 (`381s-galleries-cache`): ejecutá Setup de nuevo. |
| Error 429 / "rate limit" | Google limita las llamadas a Drive; esperá unos minutos y volvé a sincronizar. |
| Error de CPU o "too many subrequests" al sincronizar | Biblioteca muy grande para el plan gratis: pasá a **Workers Paid (USD 5/mes)**. La sincronización aborta sin dañar datos. |
| Setup falla en "Commit database id" (push rechazado) | Volvé a ejecutar Setup. Si sigue fallando, la protección de rama de `main` bloquea al bot: permití que `github-actions` haga push a `main` (o agregalo como excepción) y ejecutá Setup de nuevo. |
| Setup aparece como "cancelled" | Setup y Deploy comparten una cola (concurrency) y GitHub puede cancelar una ejecución pendiente cuando entra otra. Volvé a ejecutarlo. |
| Ver logs | Cloudflare → **Workers & Pages → 381s-galleries → Logs / Observability**. |

**Seguridad del repo:** los secrets de GitHub los pueden usar los workflows, así que solo vos deberías tener acceso de escritura al repositorio (cualquiera con escritura podría crear un workflow que los lea). Como refuerzo opcional, podés guardar los secrets en un **GitHub Environment** (Settings → Environments) con revisores requeridos y referenciarlo desde los workflows.

## 10. Copias de seguridad

- Los **originales y los tamaños** viven en tu Drive: la base solo guarda galerías, ajustes, visitas y favoritos.
- **D1 Time Travel** permite volver la base a cualquier momento de los últimos 30 días: `npx wrangler d1 time-travel info DB`.
- Exportar a un archivo:

```sh
npx wrangler d1 export DB --remote --output backup.sql
```

Guardá `backup.sql` fuera del repositorio.

## Apéndice: desde tu PC (opcional)

Solo si preferís no usar GitHub Actions. Requiere Node 22, pnpm y git.

```sh
git clone <URL-del-repositorio> 381s-galleries
cd 381s-galleries
pnpm install
npx wrangler login
npx wrangler d1 create 381s-galleries      # copiá el database_id en wrangler.jsonc
npx wrangler r2 bucket create 381s-galleries-cache
pnpm run deploy                            # con "run": `pnpm deploy` es un comando propio de pnpm
# Después del primer deploy, cargá cada secret (SESSION_SECRET, DOWNLOAD_SECRET, TOKEN_KEY,
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAIL, ACCESS_TEAM_DOMAIN, ACCESS_AUD):
npx wrangler secret put SESSION_SECRET
pnpm secrets:check                         # verifica los 8 secrets y que no exista ALLOW_DEV_ADMIN
```

Los tres secretos aleatorios se generan con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (uno distinto para cada uno). Para ver logs en vivo: `npx wrangler tail`.
