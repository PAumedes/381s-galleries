# Guía de despliegue — 381 Studios Galerías

Seguí los pasos en orden. Cada paso dice qué hacer y cómo comprobar que funcionó.

> **Importante:** el comando es `pnpm run deploy` (con `run`). Solo `pnpm deploy` es un comando propio de pnpm y no hace lo que necesitás.

## 0. Qué vas a necesitar

- Cuenta de **Cloudflare** con el dominio `381studios.ar` (el DNS ya está ahí).
- Cuenta de **Google** (la misma donde está tu Drive).
- **Node 22** y **pnpm** en tu PC, y `git`.
- **Google Drive para escritorio** instalado.
- **Capture One**.

**Costo:** todo es gratis (Cloudflare Workers, D1, R2, Access hasta 50 usuarios, Google Cloud sin facturación). Lo único que podría costar es el almacenamiento de Google One si tu Drive se llena. **Workers Paid (USD 5/mes)** solo hace falta si la sincronización choca con los límites del plan gratis (ver sección 10).

## 1. Clonar e instalar

```sh
git clone <URL-del-repositorio> 381s-galleries
cd 381s-galleries
pnpm install
npx wrangler login
```

Se abre el navegador: aceptá el acceso. **Verificá:** `npx wrangler whoami` muestra tu cuenta.

## 2. Crear D1 y R2

```sh
npx wrangler d1 create 381s-galleries
npx wrangler r2 bucket create 381s-galleries-cache
```

El primer comando imprime un `database_id`. Copialo en `wrangler.jsonc`, en `d1_databases`, reemplazando `00000000-0000-0000-0000-000000000000`.

**Verificá:** `npx wrangler d1 list` y `npx wrangler r2 bucket list` muestran ambos.

## 3. Google Cloud (acceso a Drive)

1. Entrá a <https://console.cloud.google.com> y creá un proyecto (por ej. "381studios").
2. **APIs y servicios → Biblioteca** → buscá **Google Drive API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**. Nombre de la app: `381 Studios Galerías`. Tu email como contacto.
   - Permisos (scopes): agregá `https://www.googleapis.com/auth/drive.readonly`.
   - Publicá la app: **Publicar aplicación → En producción**. (Sin verificar: Google va a mostrar un aviso de "app no verificada". Es normal para uso personal.)
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo **Aplicación web**. En **URI de redireccionamiento autorizados** poné exactamente:
   `https://session.381studios.ar/admin/google/callback`
5. Guardá el **ID de cliente** y el **Secreto** (los vas a usar en el paso 5).

**Verificá:** la app figura "En producción" y el cliente tiene la URI de redirección.

## 4. Cloudflare Access (login del admin)

1. Cloudflare → **Zero Trust**. Si no tenés equipo, creá uno (plan **Free**, hasta 50 usuarios). Anotá el nombre: tu **team domain** es `<equipo>.cloudflareaccess.com`.
2. **Settings → Authentication → Login methods**: asegurate de que esté **One-time PIN** (te llega un código por email).
3. **Access → Applications → Add an application → Self-hosted**:
   - Nombre: `381 Galerías admin`.
   - Dominio `session.381studios.ar`, con dos rutas: `admin` y `api/admin` (podés crear una sola aplicación con las dos rutas, o dos aplicaciones).
   - **Policy**: acción **Allow**, regla **Emails** = tu email.
4. Abrí la aplicación → **Overview** y copiá el **Application Audience (AUD) Tag**.

Si hiciste dos aplicaciones, cada una tiene su AUD. Usá el de la aplicación de `admin` y verificá que el de `api/admin` sea el mismo; si no, usá una sola aplicación con las dos rutas.

Guardá: **AUD tag** y **team domain**.

## 5. Secrets

Los tres secretos aleatorios (mínimo 32 caracteres) se generan con este comando, que funciona en Windows, Mac y Linux. Corrélo **tres veces** y usá un valor distinto para cada uno:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Cargá cada secreto (el comando te pide el valor; pegalo y Enter):

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DOWNLOAD_SECRET
npx wrangler secret put TOKEN_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

| Nombre | Qué es | Tipo |
|---|---|---|
| `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY` | aleatorios de `node -e ...` (distintos entre sí) | secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | del paso 3 | secret |
| `ADMIN_EMAIL` | tu email (el mismo de la policy de Access) | secret |
| `ACCESS_TEAM_DOMAIN` | `<equipo>.cloudflareaccess.com` | secret |
| `ACCESS_AUD` | AUD tag del paso 4 | secret |
| `DRIVE_MODE`, `STUDIO_NAME`, `PUBLIC_ORIGIN` | ya están en `wrangler.jsonc` (var) | var |

> Si `wrangler secret put` dice que el Worker no existe, ejecutá primero `pnpm run deploy` (paso 6) y volvé a cargar los secretos.

> **Nunca** cargues `ALLOW_DEV_ADMIN` (ni como secret ni como var): desactiva el login del admin. Es solo para desarrollo local.

**Verificá:** `pnpm secrets:check`. Debe listar los 8 como `OK` y terminar con "Todo en orden". Si aparece `ALLOW_DEV_ADMIN`, borralo con `npx wrangler secret delete ALLOW_DEV_ADMIN`.

## 6. Desplegar

```sh
pnpm run deploy
```

Esto aplica las migraciones de la base remota, compila y publica el Worker. El `wrangler.jsonc` ya declara el dominio personalizado `session.381studios.ar`: Cloudflare crea el registro DNS solo durante el despliegue (puede tardar un minuto). El Worker no responde en `workers.dev` a propósito.

**Verificá:** abrí <https://session.381studios.ar>: debe verse la página con el logo.

### Ajustes de seguridad del dominio (una sola vez)

En el panel de Cloudflare, dominio `381studios.ar`:

| Dónde | Qué |
|---|---|
| SSL/TLS → Edge Certificates | **Always Use HTTPS**: activado. **HSTS**: activado (max-age 6 meses, incluir subdominios). Dejá "preload" apagado salvo que estés seguro. |
| Speed → Optimization (o Content Optimization) | **Rocket Loader**: apagado. |
| Scrape Shield | **Email Address Obfuscation**: apagado. |
| Web Analytics / Zaraz | No los actives para este subdominio. |

Por qué: la app envía una política de seguridad (CSP) que solo permite sus propios scripts. Rocket Loader, la ofuscación de emails, Zaraz y la analítica automática inyectan scripts propios de Cloudflare y el navegador los bloquearía (la galería podría no funcionar bien).

## 7. Primer uso

1. Abrí `https://session.381studios.ar/admin`. Cloudflare Access te pide tu email y te manda un código; ingresalo.
2. **Ajustes → Conectar Google**. Va a aparecer "Google no verificó esta app": tocá **Avanzado → Ir a 381 Studios Galerías (no seguro)** y aceptá el permiso de solo lectura.
3. Pegá el **link de la carpeta `381studios`** de Drive y **Guardar carpeta**.
4. **Sincronizar ahora**. Las galerías aparecen como borradores.
5. Abrí una galería → **Publicar** → en **Compartir** copiá el link o descargá/imprimí el QR.

**Verificá:** el link público (`https://session.381studios.ar/<slug>`) abre la galería en una ventana de incógnito.

## 8. Capture One

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

## 9. Actualizar la app

```sh
git pull
pnpm install
pnpm run deploy
```

Las migraciones nuevas se aplican solas dentro de `pnpm run deploy`.

**Opcional, automático:** en Cloudflare → Workers & Pages → tu Worker → **Settings → Builds**, conectá el repositorio de GitHub. Como comando de despliegue poné `pnpm run deploy`. El token de la build necesita permisos para aplicar migraciones D1 remotas (en el token de API: **Account → D1 → Edit**, además de Workers Scripts → Edit). Los secretos ya cargados se conservan.

## 10. Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| "Google no verificó esta app" | Es normal. **Avanzado → Ir a…**. Confirmá que la pantalla de consentimiento esté "En producción". |
| La sincronización dice "no root folder" / "Primero elegí una carpeta raíz" | Falta pegar el link de la carpeta `381studios` en Ajustes y guardar. Comprobá que sea la carpeta de tu cuenta conectada. |
| Access entra en bucle o da 403 | `ACCESS_AUD` o `ACCESS_TEAM_DOMAIN` incorrectos, o `ADMIN_EMAIL` distinto del email de la policy. Revisá con `pnpm secrets:check` y volvé a cargar el valor. Las rutas `admin` y `api/admin` deben estar bajo Access. |
| Las imágenes no se ven | Falta el bucket R2 (`381s-galleries-cache`) o el binding `CACHE` en `wrangler.jsonc`. Corré `npx wrangler r2 bucket list` y mirá `npx wrangler tail`. |
| Error 429 / "rate limit" | Google limita las llamadas a Drive; esperá unos minutos y volvé a sincronizar. |
| Error de CPU o "too many subrequests" al sincronizar | Biblioteca muy grande para el plan gratis: pasá a **Workers Paid (USD 5/mes)**. La sincronización aborta sin dañar datos. |
| Ver logs en vivo | `npx wrangler tail` |

## 11. Copias de seguridad

- Los **originales y los tamaños** viven en tu Drive: la base solo guarda galerías, ajustes, visitas y favoritos.
- **D1 Time Travel** permite volver la base a cualquier momento de los últimos 30 días: `npx wrangler d1 time-travel info DB`.
- Exportar a un archivo:

```sh
npx wrangler d1 export DB --remote --output backup.sql
```

Guardá `backup.sql` fuera del repositorio.
