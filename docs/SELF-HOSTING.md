# Instalá tu propia copia de las galerías

Esta guía es para un fotógrafo o fotógrafa que quiere tener **su propia copia** de la app de galerías, con **sus propias cuentas** de Google, Cloudflare y GitHub. Tus fotos quedan en tu Google Drive, la app corre en tu cuenta de Cloudflare y nadie más tiene acceso.

- No hace falta saber programar. Todo se hace desde el navegador.
- Tiempo estimado: **1 a 2 horas** la primera vez.
- Versión en inglés: [SELF-HOSTING.en.md](SELF-HOSTING.en.md). Las dos dicen lo mismo.
- Si vas a usar un asistente de IA con acceso al navegador o a la terminal, pasale la sección **[Modo agente](#modo-agente)** del final.

> **Permiso de uso.** El código es privado y de uso reservado: "todos los derechos reservados" (ver el archivo `LICENSE` del repositorio). No podés copiarlo ni usarlo sin **permiso escrito del dueño del código**. Pedile ese permiso antes de empezar. Esto no es asesoramiento legal.

> **Versión del código.** Esta guía necesita una versión del código preparada para que otras personas la instalen (sin datos del dueño dentro de las pruebas automáticas). Si en el paso 8 la ejecución falla en **Checks** con una prueba llamada `has both custom-domain routes and the vars`, tu copia es anterior a esa preparación (la prueba actual lee tu dominio de `wrangler.jsonc` y no nombra el del dueño): avisale al dueño del código y esperá la versión nueva. Si no definís `STUDIO_NAME`, la app muestra el nombre neutro "Galleries".
>
> En palabras simples: esta guía solo funciona cuando las pruebas automáticas del propio repositorio ya no controlan el dominio del dueño original. Es una corrección de código que el dueño está decidiendo. **Agentes de IA:** antes del paso 8, verificá si el fork contiene esa corrección (preguntale al dueño o mirá el resultado de la ejecución de **CI**); si no la tiene, detenete y avisale a la persona.

---

## Índice

1. [Qué vas a necesitar](#0-qué-vas-a-necesitar)
2. [Cuánto cuesta](#cuánto-cuesta)
3. [Tus valores](#tus-valores)
4. Pasos: [1 Copia](#paso-1-tu-copia-del-código) · [2 Dominio](#paso-2-tu-dominio-en-cloudflare) · [3 Configuración](#paso-3-poné-tus-valores-en-la-configuración) · [4 Google](#paso-4-google-cloud-acceso-de-solo-lectura-a-tu-drive) · [5 Login del admin](#paso-5-cloudflare-access-el-login-del-panel) · [6 Token](#paso-6-token-de-cloudflare-y-activar-r2) · [7 Secrets](#paso-7-cargá-los-secrets-en-github) · [8 Setup](#paso-8-ejecutá-setup) · [9 Seguridad](#paso-9-ajustes-de-seguridad-del-dominio) · [10 Primer uso](#paso-10-primer-uso) · [11 Capture One](#paso-11-capture-one-y-drive-para-escritorio)
5. [Mantenimiento](#mantenimiento) · [Problemas comunes](#problemas-comunes) · [Modo agente](#modo-agente)

---

## 0. Qué vas a necesitar

Marcá cada punto antes de empezar:

- [ ] **Permiso escrito** del dueño del código (ver arriba).
- [ ] Una **cuenta de Google** con Google Drive (la misma donde van a estar tus fotos).
- [ ] Una **cuenta de Cloudflare** (gratis): <https://dash.cloudflare.com/sign-up>.
- [ ] Una **cuenta de GitHub** (gratis): <https://github.com/signup>.
- [ ] Un **dominio propio** (por ejemplo `tuestudio.com`) **administrado por Cloudflare**. Si ya tenés uno en otro lado, en el paso 2 lo pasás a Cloudflare (sigue siendo tuyo; solo cambia quién responde el DNS).
- [ ] Una **tarjeta** (o PayPal) para cargar como medio de pago en Cloudflare. El almacenamiento R2 lo pide para activarse, aunque uses solo la parte gratis (ver "Cuánto cuesta").
- [ ] **Capture One** y **Google Drive para escritorio** en tu computadora (solo para el paso 11).

**¿Y sin dominio propio, con la dirección gratis `workers.dev`?** Hoy **no funciona**. La app está configurada para no responder en `workers.dev` a propósito: el panel de administración confía en el login de Cloudflare Access, y en `workers.dev` Cloudflare solo ofrece proteger **todo** el sitio (eso bloquearía también a tus clientes, que tienen que ver sus galerías sin loguearse). Hace falta un dominio. Un dominio `.com` cuesta unos USD 10 a 15 por año; un `.com.ar` se registra en NIC Argentina.

## Cuánto cuesta

| Qué | Costo | Notas |
|---|---|---|
| Cloudflare Workers (la app) | **Gratis** | Plan gratis: 100.000 visitas por día. Si la sincronización de una biblioteca grande choca con los límites del plan gratis, **Workers Paid cuesta USD 5 por mes** (ver Problemas comunes). |
| Cloudflare D1 (la base de datos) | **Gratis** | 5 GB en el plan gratis; la app guarda poco (galerías, visitas, favoritos). |
| Cloudflare R2 (caché de imágenes) | **Gratis** hasta 10 GB | Después, USD 0,015 por GB por mes. Pide un medio de pago para activarse. |
| Cloudflare Access (login del panel) | **Gratis** | Hasta 50 usuarios. Vos sos 1. |
| Google Cloud (permiso para leer Drive) | **Gratis** | No hace falta activar facturación. |
| Google Drive | Lo que ya pagás | Las fotos ocupan espacio de tu Drive (15 GB gratis; más con Google One). |
| GitHub | **Gratis** | Repositorio público: Actions gratis. Privado: 2.000 minutos por mes gratis; cada despliegue usa unos pocos minutos. |
| Dominio | **USD 10–15 por año** aprox. | Según la terminación y el registrador. |

Los precios son orientativos y cambian: revisalos en la página de precios de Cloudflare antes de empezar.

## Tus valores

Elegí estos valores **una sola vez** y anotalos. En el resto de la guía aparecen entre `< >`: cada vez que veas, por ejemplo, `<GALLERY_HOST>`, reemplazalo por tu valor.

| Valor | Qué es | Ejemplo |
|---|---|---|
| `<TIMEZONE>` | Tu zona horaria como nombre IANA (lista: Wikipedia "tz database time zones"). | `America/Mexico_City` |
| `<STUDIO_NAME>` | Nombre de tu estudio, como lo ven tus clientes. Sin comillas dobles. | `Estudio Luz` |
| `<ROOT_DOMAIN>` | Tu dominio (sin `www`, sin `https://`). | `estudioluz.com` |
| `<GALLERY_HOST>` | La dirección de las galerías: un subdominio de tu dominio que **no uses** para otra cosa. | `fotos.estudioluz.com` |
| `<ADMIN_EMAIL>` | Tu email para entrar al panel. Usá **el mismo email de tu cuenta de Cloudflare**. | `hola@estudioluz.com` |
| `<DRIVE_FOLDER>` | Nombre de la carpeta de Drive donde van todas las galerías. | `galerias` |
| `<ACCESS_TEAM>` | Nombre de "equipo" en Cloudflare Zero Trust (letras y guiones). | `estudioluz` |
| `<GOOGLE_PROJECT>` | Nombre del proyecto en Google Cloud. | `estudioluz-galerias` |
| `<GITHUB_USER>` | Tu usuario de GitHub. | `estudioluz` |
| `<CONTACT_EMAIL>` | Opcional. Email público de contacto que se muestra en tu página `/privacy`. | `hola@estudioluz.com` |

**Secrets** (claves secretas). No los elegís vos: los copiás de Google y Cloudflare durante la guía y los pegás **directamente** en GitHub. **Nunca** los pegues en un chat, un email, un documento ni en el código.

| Secret de GitHub | De dónde sale | Paso |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud | 4 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud | 4 |
| `ADMIN_EMAIL` | Tu `<ADMIN_EMAIL>` | 5 |
| `ACCESS_TEAM_DOMAIN` | `<ACCESS_TEAM>.cloudflareaccess.com` | 5 |
| `ACCESS_AUD` | Cloudflare Access | 5 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | 6 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | 6 |

Hay tres secrets más (`SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`) que la app genera sola en el paso 8. No tenés que hacer nada con ellos.

---

## Paso 1. Tu copia del código

El dueño del código te da acceso al repositorio y te dice cómo copiarlo. Lo habitual es un **fork** (una copia en tu cuenta de GitHub que después se puede actualizar con un botón).

1. Iniciá sesión en GitHub y abrí la dirección del repositorio que te pasó el dueño.
2. Arriba a la derecha, tocá **Fork** → **Create fork**. Dejá marcado **Copy the main branch only**.
3. En tu copia, abrí la pestaña **Actions**. GitHub muestra "Workflows aren't being run on this forked repository": tocá **I understand my workflows, go ahead and enable them**.

**Qué deberías ver:** la dirección es `https://github.com/<GITHUB_USER>/<nombre-del-repo>` y la pestaña Actions lista **CI**, **Deploy** y **Setup**.

**Importante:**
- Si el dueño te quita el acceso al repositorio original y ese repositorio es privado, GitHub **borra tu fork**. Tu galería sigue funcionando en Cloudflare, pero perdés la copia del código.
- Solo vos deberías tener permiso de escritura en tu copia: los secrets que cargás en el paso 7 los puede leer cualquiera que pueda modificar los workflows.

## Paso 2. Tu dominio en Cloudflare

Si `<ROOT_DOMAIN>` ya aparece en tu panel de Cloudflare como **Active**, saltá al paso 3.

1. Cloudflare → **Add a domain** (o **Onboard a domain**) → escribí `<ROOT_DOMAIN>` → plan **Free**.
2. Cloudflare copia los registros DNS que encuentre. Revisá que estén los de tu web y tu email actuales.
3. Cloudflare te muestra **dos nameservers** (por ejemplo `xxx.ns.cloudflare.com`). Entrá al sitio donde compraste el dominio y reemplazá los nameservers por esos dos.
4. Esperá. Puede tardar de minutos a 24 horas.

**Cómo saber que funcionó:** en Cloudflare, el dominio figura como **Active** y te llega un email de confirmación.

**No crees** ningún registro DNS para `<GALLERY_HOST>`: la app lo crea sola en el paso 8. Si ya existe uno con ese nombre, borralo.

## Paso 3. Poné tus valores en la configuración

Vas a editar un solo archivo, `wrangler.jsonc`, desde el navegador.

1. En tu repositorio, abrí el archivo `wrangler.jsonc` y tocá el **lápiz** (Edit this file).
2. Buscá el bloque que empieza con `"routes": [` y termina con `],` (unas 5 líneas, incluida una línea de comentario que empieza con `//`). **Reemplazá todo ese bloque** (líneas de comentario incluidas) por estas cinco líneas, exactamente así (misma sangría, un elemento por línea):

   ```jsonc
     "routes": [
       {
         "pattern": "<GALLERY_HOST>",
         "custom_domain": true,
       },
     ],
   ```

3. Más abajo, dentro de `"vars"`, cambiá solo lo que está entre comillas a la derecha de estas tres líneas, para que queden así:

   ```jsonc
       "STUDIO_NAME": "<STUDIO_NAME>",
       "TIMEZONE": "<TIMEZONE>",
       "PUBLIC_ORIGIN": "https://<GALLERY_HOST>",
       "LEGACY_HOSTS": "",
   ```

   Opcional: si querés un email público de contacto en tu página `/privacy`, agregá una línea más en el mismo lugar, con una coma al final: `"PUBLIC_CONTACT_EMAIL": "<CONTACT_EMAIL>",`. Sin ella, `/privacy` muestra un texto genérico ("para consultas, contactá al estudio por los canales habituales") en lugar de un email.

4. **No toques** nada más (ni `database_id`: se completa solo en el paso 8). Respetá las comillas y las comas del final de cada línea.
5. Tocá **Commit changes…** → mensaje "Mis valores" → **Commit changes**.

**Qué vas a ver después:** en la pestaña **Actions** aparece una ejecución de **Deploy**. Puede fallar (cruz roja) hasta que hayas corrido Setup en el paso 8. Es esperable: puede fallar en **Checks** (ver Problemas comunes) o por un error de la base de datos (D1), porque la app todavía no está instalada del todo. No intentes arreglarlo ahora; seguí y juzgá el resultado después del paso 8.

**Tu nombre y tu logo (opcionales, podés hacerlos después):** `STUDIO_NAME` es el nombre que se muestra en las páginas públicas (como texto descriptivo del logo, en el pie y en la página de privacidad), en las vistas previas de los links, en el nombre de la app cuando un cliente agrega una galería a la pantalla de inicio y en el panel. También lo podés cambiar después en el panel (**Ajustes**), y ese valor tiene prioridad sobre el de `wrangler.jsonc`. **No cambia ninguna imagen ni archivo.** Hasta que subas un logo, las páginas muestran el nombre del estudio como texto (sin imagen). El nombre de la app (archivo `manifest.webmanifest`) se genera solo a partir de `STUDIO_NAME`. **Logo:** en el panel, **Ajustes → Logo**, subí una imagen para fondos claros y, si querés, otra para fondos oscuros; **Restablecer** vuelve al texto. **Íconos:** el ícono de la pestaña (`public/favicon.svg`, `public/favicon.ico`) y los de "agregar a pantalla de inicio" (`public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `public/apple-touch-icon.png`) son los del proyecto original. Un fork debería reemplazarlos por los suyos; podés partir del set neutro (apertura de cámara) de la carpeta `brand-neutral/` del repositorio (descargalo desde la página de GitHub). Para usar los tuyos, en GitHub abrí `public/icons` → **Add file → Upload files** → subí PNG **con esos mismos nombres y tamaños** (192, 512 y 512 maskable con ~20% de margen), y lo mismo con `public/apple-touch-icon.png` (180x180), `public/favicon.ico` y `public/favicon.svg`. Alguien con la computadora preparada también puede correr `node scripts/make-icons.mjs <carpeta>` tras editar el dibujo en el script (por defecto escribe en `brand-neutral/`).

## Paso 4. Google Cloud (acceso de solo lectura a tu Drive)

La app necesita permiso para **leer** tu Drive. Nunca escribe ni borra nada.

1. Entrá a <https://console.cloud.google.com> con tu cuenta de Google → selector de proyectos (arriba) → **New project** → nombre `<GOOGLE_PROJECT>` → **Create**. Asegurate de que quede seleccionado.
2. Menú ☰ → **APIs & Services → Library** → buscá **Google Drive API** → **Enable**.
3. Menú ☰ → **Google Auth Platform** (si te pide empezar, tocá **Get started**) y completá:
   - **Branding:** nombre de la app `<STUDIO_NAME> Galerías`, tu email como soporte y contacto. **Application home page:** `https://<GALLERY_HOST>`. **Privacy policy link:** `https://<GALLERY_HOST>/privacy`. En **Authorized domains** agregá `<ROOT_DOMAIN>`. Guardá.
   - **Audience:** tipo **External**. Tocá **Publish app** → confirmá **In production**.
   - **Data Access:** **Add or remove scopes** → en "Manually add scopes" pegá `https://www.googleapis.com/auth/drive.readonly` → **Add to table** → **Update** → **Save**.
   - **Clients:** **Create client** → tipo **Web application** → nombre `galerias`. En **Authorized redirect URIs** → **Add URI** → exactamente:
     `https://<GALLERY_HOST>/admin/google/callback`
     → **Create**.
4. Google muestra el **Client ID** y el **Client secret**. **Cargalos en GitHub ahora**, siguiendo el procedimiento del paso 7 (abrí GitHub en otra pestaña): creá `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y después cerrá la pestaña de Google. (Si la cerraste antes, el Client ID se ve en **Clients**; si perdiste el secret, creá uno nuevo desde el mismo cliente.)

**Cómo saber que funcionó:** en **Audience** dice **In production**, y en **Clients** tu cliente tiene la URI de redirección.

**Es normal** que Google diga que la app "no está verificada": la usás solo vos, con tus fotos. Ver paso 10.

## Paso 5. Cloudflare Access (el login del panel)

Esto protege el panel de administración (`/admin`): solo vos podés entrar. Las galerías de tus clientes siguen siendo públicas (con PIN si lo elegís).

1. Cloudflare → **Zero Trust**. Si es la primera vez, te pide un **team name**: poné `<ACCESS_TEAM>`, y elegí el plan **Free**. Tu "team domain" es `<ACCESS_TEAM>.cloudflareaccess.com`.
2. **Access controls → Applications → Create new application** (o **Add an application**) → **Self-hosted** (puede decir "Self-hosted and private").
3. Nombre: `<STUDIO_NAME> Admin`.
4. **Add public hostname** tres veces, todas en esta misma aplicación:
   - subdominio = la parte de `<GALLERY_HOST>` antes de tu dominio (en el ejemplo, `fotos`), dominio `<ROOT_DOMAIN>`, path `admin`
   - igual, path `api/admin`
   - igual, path `admin.data`
5. **Access policies** → crear una nueva: nombre `Solo yo`, acción **Allow**, regla **Include → Emails** = `<ADMIN_EMAIL>`.
6. **Login methods:** las cuentas nuevas traen el login con tu cuenta de Cloudflare; no hace falta configurar nada. Con ese login por defecto, el email permitido en la política (y el secret `ADMIN_EMAIL`) **tiene que ser el mismo email de tu cuenta de Cloudflare**, si no, no vas a poder entrar. (Opcional: **Integrations → Identity providers → Add → One-time PIN** para entrar con un código por email.)
7. **Session Duration:** 24 horas → **Create** (o **Save**).
8. En la lista de aplicaciones, **Configure** en `<STUDIO_NAME> Admin` → **Basic information** (o **Overview**) → copiá el **Application Audience (AUD) Tag**. Es el valor del secret `ACCESS_AUD`.
9. **Cargá en GitHub ahora**, siguiendo el procedimiento del paso 7: creá `ACCESS_AUD` (el AUD tag), `ADMIN_EMAIL` (tu `<ADMIN_EMAIL>`) y `ACCESS_TEAM_DOMAIN` (`<ACCESS_TEAM>.cloudflareaccess.com`, sin `https://`).

**Cómo saber que funcionó:** la aplicación figura en la lista con tres hostnames y la política `Solo yo`.

## Paso 6. Token de Cloudflare y activar R2

**6a. Activar R2:**

1. Cloudflare → **Storage & databases → R2** (o **R2 Object Storage**) → **Purchase R2 / Add R2 to plan**. Si te pide medio de pago, cargalo. El plan gratis no cobra mientras no pases los límites.

**Cómo saber que funcionó:** la página de R2 muestra la lista de buckets (vacía) sin pedirte activar nada.

**6b. Token de API** (una llave para que GitHub pueda instalar la app en tu Cloudflare):

1. Cloudflare → ícono de perfil → **My Profile → API Tokens → Create Token → Create Custom Token** (**Get started**).
2. Nombre: `galerias-github`. Permisos (tocá **+ Add more** para cada fila):
   - **Account → Workers Scripts → Edit**
   - **Account → D1 → Edit**
   - **Account → Workers R2 Storage → Edit**
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit**
   - **Zone → DNS → Edit**
   - **Zone → Zone → Read**
3. **Account Resources:** Include → tu cuenta. **Zone Resources:** Include → **Specific zone** → `<ROOT_DOMAIN>`.
4. **Continue to summary → Create Token.** Cloudflare muestra el token **una sola vez**: cargalo en GitHub ahora mismo (punto siguiente).
5. **Account ID:** Cloudflare → **Workers & Pages** → **Account details** (o la barra lateral derecha) → copiá el Account ID.
6. **Cargá en GitHub ahora**, siguiendo el procedimiento del paso 7: creá `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, y después cerrá la pestaña de Cloudflare que mostró el token.

## Paso 7. Cargá los secrets en GitHub

1. En tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
2. Creá uno por uno los secrets de la tabla de [Tus valores](#tus-valores), **al final de los pasos 4, 5 y 6** como te indican esos pasos (así ningún valor secreto queda abierto en pantalla mucho tiempo). Si lo hiciste, acá solo revisás la lista. En **Name** va el nombre exacto (en mayúsculas); en **Secret**, el valor copiado **directamente** de la pestaña de Google o Cloudflare. Para `ACCESS_TEAM_DOMAIN` poné `<ACCESS_TEAM>.cloudflareaccess.com` (sin `https://`).
3. Cuando termines, cerrá las pestañas de Google y Cloudflare que tenían valores secretos.

**Cómo saber que funcionó:** en **Repository secrets** ves los siete nombres. GitHub nunca vuelve a mostrar los valores; eso es lo esperado.

**Nunca** crees un secret llamado `ALLOW_DEV_ADMIN`: desactiva el login del panel. Si existiera, el paso 8 lo borra y avisa.

## Paso 8. Ejecutá Setup

1. Pestaña **Actions → Setup → Run workflow** → rama `main` → **Run workflow**.
2. Esperá de 3 a 8 minutos. Abrí la ejecución para ver el avance.
3. Lo que hace sola: corre las verificaciones, crea la base de datos D1 y el bucket R2, guarda el identificador de la base en `wrangler.jsonc` (un commit "Set D1 database id" del bot), publica la app en `https://<GALLERY_HOST>` (crea el DNS y el certificado) y carga los secrets en Cloudflare.
4. Al final, abrí el paso **Setup Cloudflare** y leé el **Secrets summary** (solo nombres, nunca valores). Cada uno debe decir `present (kept)`, `created` o `uploaded`. Si alguno dice `MISSING`, agregalo en GitHub (paso 7) y volvé a ejecutar Setup.

**Cómo saber que funcionó:**
- La ejecución tiene tilde verde.
- `https://<GALLERY_HOST>` abre una página. Muestra el logo que viene con el código hasta que subas el tuyo (paso 3), y tu `<STUDIO_NAME>` en los textos. La primera vez puede tardar unos minutos mientras se emite el certificado.
- `https://<GALLERY_HOST>/admin` te lleva a la pantalla de login de Cloudflare.

Si algo no coincide, mirá la fila correspondiente de [Problemas comunes](#problemas-comunes) ("abre pero muestra otro logo u otro nombre", "no abre", "el login entra en bucle").

Podés repetir Setup cuantas veces quieras: no borra nada y no cambia las claves generadas.

## Paso 9. Ajustes de seguridad del dominio

En Cloudflare, dominio `<ROOT_DOMAIN>`:

| Dónde | Qué |
|---|---|
| SSL/TLS → Edge Certificates | **Always Use HTTPS**: activado. **HSTS**: activado (max-age 6 meses, incluir subdominios), solo si **todos** tus subdominios funcionan con https. Dejá "preload" apagado. |
| Speed → Optimization (o Content Optimization) | **Rocket Loader**: apagado. |
| Scrape Shield | **Email Address Obfuscation**: apagado. |
| Web Analytics / Zaraz | No los actives para `<GALLERY_HOST>`. |

Por qué: la app solo permite sus propios scripts. Esas funciones de Cloudflare agregan scripts propios y el navegador los bloquearía (la galería podría funcionar mal).

## Paso 10. Primer uso

1. Abrí `https://<GALLERY_HOST>/admin` e iniciá sesión con `<ADMIN_EMAIL>`.
2. **Ajustes → Conectar Google.** Google dice "Google no verificó esta app": tocá **Avanzado → Ir a … (no seguro)** y aceptá el permiso de **solo lectura**. Es tu propia app; el aviso es porque no pasó la revisión de Google, que no hace falta para uso personal. (El panel tiene un selector ES/EN en la barra lateral.)
3. En tu Drive, creá la carpeta `<DRIVE_FOLDER>` (en **Mi unidad**). Copiá su enlace (clic derecho → **Compartir → Copiar vínculo**; no hace falta compartirla con nadie). En **Ajustes**, pegá el enlace → **Guardar carpeta**.
4. **Sincronizar ahora.** Cada subcarpeta de `<DRIVE_FOLDER>` aparece como una galería en borrador.
5. Abrí una galería → **Publicar** → en **Compartir**, copiá el link o descargá el QR.

**Cómo saber que funcionó:** el link `https://<GALLERY_HOST>/<nombre-de-la-galería>` abre la galería en una ventana de incógnito. Si no abre, mirá "El link de la galería no abre en una ventana de incógnito" en [Problemas comunes](#problemas-comunes).

Nota: el panel muestra las fechas y horas (vencimientos, actividad, exportación CSV) en la zona horaria del estudio, que se define con la variable `TIMEZONE` de `wrangler.jsonc` (un nombre IANA como `America/Mexico_City` o `Europe/Madrid`; el horario de verano se maneja solo). Si falta o es inválida, se usa la hora de Buenos Aires. Volvé a ejecutar Setup o Deploy después de cambiarla. La columna del CSV titulada "Fecha (AR)" también usa esta zona.

## Paso 11. Capture One y Drive para escritorio

Cada galería es una carpeta dentro de `<DRIVE_FOLDER>`, con una subcarpeta por tamaño. Capture One crea todo con un solo "Procesar".

Creá estas recetas de proceso (Process Recipes), todas habilitadas, formato **JPEG**, perfil **sRGB**:

| Receta (= nombre de carpeta) | Tamaño | Calidad sugerida | Para qué |
|---|---|---|---|
| `high-res` | 2048 px lado largo | 90 | **obligatoria** |
| `web` | 1200 px lado largo | 85 | |
| `ig` | 1080 px lado largo | 85 | opcional (sin ella no hay descarga "Instagram") |
| `thumb` | 600 px lado largo | 75 | grilla |
| `preview-wm` | 2048 px, con marca de agua | 90 | opcional: galerías en modo "Prueba" |
| `thumb-wm` | 600 px, con marca de agua | 75 | opcional: grilla en modo "Prueba" |

- **Output Location** de cada receta: la carpeta `<DRIVE_FOLDER>` dentro de Drive para escritorio. En **Sub Folder** escribí el token `[Session Name]` (botón de tokens junto al campo), una `/` y el nombre de la receta. Ejemplo: `[Session Name]/high-res`.
- Resultado: `<DRIVE_FOLDER>/<Sesión>/high-res`, `<DRIVE_FOLDER>/<Sesión>/web`, etc.
- **Sets** (secciones): una subcarpeta con el mismo nombre dentro de cada receta (`high-res/Ceremonia`, `web/Ceremonia`…). Los archivos sueltos van a "Highlights".
- Los **nombres de archivo** tienen que ser iguales en todas las recetas.

**Drive para escritorio:** sincronizá `Mi unidad/<DRIVE_FOLDER>` (espejo o streaming, los dos sirven).

**Cómo saber que funcionó:** la carpeta de la sesión aparece en drive.google.com con las subcarpetas de las recetas, y después de **Sincronizar ahora** (o de esperar hasta 15 minutos) la galería aparece en el panel.

---

## Mantenimiento

- **Actualizar la app:** cuando el dueño publique una versión nueva, en tu repositorio tocá **Sync fork → Update branch**. El workflow **Deploy** publica solo. Si GitHub ofrece **Discard commits**, **no** lo toques (borraría tus valores del paso 3): pedile ayuda al dueño.
- **Cambiar un secret** (por ejemplo, un Client secret nuevo de Google): actualizalo en GitHub (paso 7) y volvé a ejecutar **Setup**.
- **Copias de seguridad:** las fotos viven en tu Drive. La base de datos (galerías, ajustes, visitas, favoritos) se puede volver atrás con **D1 Time Travel**: 7 días en el plan gratis, 30 días en Workers Paid.
- **Ver errores:** Cloudflare → **Workers & Pages** → el Worker de la app → **Logs / Observability**.

## Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| Setup o Deploy falla en **Checks** con `has both custom-domain routes and the vars` | Tu copia del código todavía no está preparada para otras personas (ver "Versión del código" al principio). Avisale al dueño. |
| Falla en **Checks** con un error de formato (`prettier`, `Code style issues`) en `wrangler.jsonc` | La edición del paso 3 no quedó exacta. Revisá que `routes` tenga exactamente las cinco líneas del paso 3 (el objeto abierto en varias líneas, no apretado en una), sin espacios de más al final de las líneas, y que cada línea termine en coma. |
| Error "Authentication error" o código 10000 | Al token le falta un permiso o es de otra cuenta. Revisá las siete filas del paso 6b, que la zona sea `<ROOT_DOMAIN>` y que `CLOUDFLARE_ACCOUNT_ID` sea el de la misma cuenta. |
| Error que menciona R2 (por ejemplo, "enable R2") | Falta el paso 6a. Activá R2 y volvé a ejecutar Setup. |
| "DNS record already exists" / "externally managed DNS records" | Ya existe un registro DNS para `<GALLERY_HOST>`. Borralo en **DNS → Records** y volvé a ejecutar Setup. |
| Setup termina con algún `MISSING` | Falta ese secret en GitHub. Agregalo (paso 7) y volvé a ejecutar Setup. |
| Setup falla en "Commit database id" | Volvé a ejecutarlo. Si sigue, en **Settings → Branches** permití que `github-actions` haga push a `main`. |
| Setup aparece como "cancelled" | Volvé a ejecutarlo (Setup y Deploy comparten una cola). |
| La primera ejecución de Deploy tiene cruz roja | Puede pasar hasta que Setup se haya ejecutado (ver paso 3). Ejecutá Setup (paso 8) y juzgá el resultado de esa ejecución. Si Setup también falla, abrí el paso que falló y buscá su mensaje en esta tabla. |
| `https://<GALLERY_HOST>` abre, pero muestra otro logo u otro nombre | El logo y los íconos son los que vienen con el código hasta que subas los tuyos (paso 3). Para el nombre: revisá `STUDIO_NAME` en `wrangler.jsonc` y el nombre guardado en el panel (**Ajustes**), que tiene prioridad. Después ejecutá Setup o Deploy otra vez y refrescá con Ctrl+Shift+R. |
| El link de la galería no abre en una ventana de incógnito | La galería sigue en borrador, archivada o vencida: abrila en el panel y **Publicar**. Si pide un PIN, es normal. Revisá también que el link sea `https://<GALLERY_HOST>/<nombre-de-la-galería>` y que hayas hecho **Sincronizar ahora**. |
| `https://<GALLERY_HOST>` no abre | Esperá 10–15 minutos (certificado). Revisá que el dominio esté **Active** en Cloudflare. |
| El login de `/admin` entra en bucle o da 403 / "Unauthorized" | `ADMIN_EMAIL`, `ACCESS_AUD` o `ACCESS_TEAM_DOMAIN` no coinciden con el paso 5, o el email no es el de la política. Corregí el secret y volvé a ejecutar Setup. |
| Google dice `redirect_uri_mismatch` | La URI del paso 4 no es exactamente `https://<GALLERY_HOST>/admin/google/callback`. |
| "Google no verificó esta app" | Normal. **Avanzado → Ir a…** Confirmá que la app esté **In production** (en "Testing" la conexión se corta a los 7 días). |
| "Primero elegí una carpeta raíz" | Falta el paso 10.3. |
| Error de CPU, "too many subrequests" o "too many API requests" al sincronizar | Biblioteca grande para el plan gratis. Pasá a **Workers Paid (USD 5/mes)**. La sincronización se detiene sin dañar nada. |
| Error 429 / "rate limit" | Google limita las llamadas a Drive. Esperá unos minutos. |
| Las imágenes tardan la primera vez | Normal: la app las copia a R2 de a poco (unos minutos por galería nueva). |
| "Fotos en caché: N / M" no llega a M | Es el precalentamiento: una tarea programada (cron) de cada minuto (gratis, no consume tu cuota de Drive) copia las versiones chicas de cada foto nueva a R2, hasta 20 fotos por minuto. Una galería nueva tarda unos minutos en quedar lista; mientras tanto cada foto carga desde Drive en su primera visita. Si no avanza, revisá que existan ambos crons (`*/15 * * * *` y `* * * * *`) en Cloudflare → el Worker → **Settings → Triggers**. |
| Las imágenes no se ven | Falta el bucket R2 (el que figura en `r2_buckets` de `wrangler.jsonc`). Ejecutá Setup de nuevo; lo crea si no existe. |
| Error al navegar entre páginas del panel pero no al recargar | Falta el path `admin.data` en tu aplicación de Access (paso 5, punto 4). Agregalo como tercer public hostname. |

---

## Modo agente

Instrucciones para un agente de IA con acceso al navegador y/o a una terminal que ayuda a una persona a seguir esta guía. La persona es la dueña de todas las cuentas; el agente trabaja para ella.

### Reglas (siempre)

1. **Permiso:** antes de nada, preguntá si la persona tiene **permiso escrito** del dueño del código. Si no, **detenete**.
2. **Secrets:** nunca imprimas, registres, resumas ni repitas un secret (los siete del paso 7, el token, el Client secret, `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`). **Nunca** pidas que la persona pegue un secret en el chat. Los secrets van de la página del proveedor a la página de secrets de GitHub, copiados por la persona; o con `gh secret set <NOMBRE>` ejecutado **por la persona en su propia terminal**, dejando que `gh` pida el valor (la entrada queda oculta) o haciendo que la persona lo escriba. **Nunca** pases el valor con `--body` ni con `< archivo`. No uses `set -x`, `echo` de variables secretas ni archivos temporales con secrets.
3. **Consentimiento:** iniciar sesión, aceptar términos, cargar medios de pago, cambiar nameservers, publicar la app de Google ("In production") y aceptar el permiso de Google en el paso 10 los hace **la persona**. Podés guiar y mostrar dónde tocar, pero no lo hagas sin que ella lo confirme en el momento.
4. **No cambies código de la app** ni pruebas. El único archivo que editás es `wrangler.jsonc` (paso 3) y, si la persona lo pide, los logos. Nunca crees `ALLOW_DEV_ADMIN` en producción ni subas `.dev.vars`.
5. **Idempotencia:** antes de crear algo, verificá si ya existe. Setup se puede repetir.
6. **Al final**, entregá un informe con: dirección de las galerías, qué pasos quedaron hechos, verificaciones que pasaron y cualquier problema pendiente. Sin valores secretos.

### Paso 0 del agente: preguntar

Pedí a la persona (son datos no secretos) los valores de la tabla [Tus valores](#tus-valores): `<STUDIO_NAME>`, `<ROOT_DOMAIN>`, `<GALLERY_HOST>`, `<ADMIN_EMAIL>`, `<DRIVE_FOLDER>`, `<ACCESS_TEAM>`, `<GOOGLE_PROJECT>`, `<GITHUB_USER>`, opcionalmente `<CONTACT_EMAIL>`, y la dirección del repositorio original. Confirmá:
- `<GALLERY_HOST>` termina en `.<ROOT_DOMAIN>` y no está en uso.
- `<ADMIN_EMAIL>` es el email de su cuenta de Cloudflare.
- `<STUDIO_NAME>` no tiene comillas dobles ni barras invertidas.

### Quién hace qué

| Paso | Agente por CLI/API | Agente en el navegador (con la sesión de la persona) | Solo la persona |
|---|---|---|---|
| 1 Fork | **Preguntale primero a la persona** (esto crea un repositorio en su cuenta) y después `gh repo fork <owner>/<repo> --default-branch-only --clone=false` (tras `gh auth login` hecho por la persona) | Habilitar Actions en el fork | Login en GitHub |
| 2 Dominio | Verificar nameservers con `dig` | Agregar el dominio en Cloudflare | Cambiar nameservers en el registrador; medio de pago |
| 3 Config | Editar `wrangler.jsonc`, `prettier --check`, commit y push | o editar en la web de GitHub | — |
| 4 Google | `gcloud projects create <GOOGLE_PROJECT>` y `gcloud services enable drive.googleapis.com --project <GOOGLE_PROJECT>` (si la persona ya hizo `gcloud auth login`) | Branding, Audience, Data Access, Clients (no hay CLI para el cliente OAuth web) | **Publish app**; copiar Client ID/secret a GitHub |
| 5 Access | — | Crear la aplicación y la política | Elegir plan Free; copiar el AUD a GitHub |
| 6 Token/R2 | — | Guiar la creación del token con los 7 permisos | Activar R2 (medio de pago); copiar token y Account ID a GitHub |
| 7 Secrets | `gh secret list` (solo nombres) | — | Pegar los valores |
| 8 Setup | `gh workflow run setup.yml --ref main`, `gh run watch` | — | — |
| 9 Seguridad | — | Cambiar los cuatro ajustes | — |
| 10 Primer uso | Verificaciones con `curl` | Guiar | Login, aceptar el permiso de Google |
| 11 Capture One | — | — | Todo (es en su computadora) |

### Verificaciones (después de cada paso)

Reemplazá los valores entre `< >`. Ninguna de estas órdenes muestra secrets.

```sh
# 1: el fork existe y tiene los tres workflows
gh repo view <GITHUB_USER>/<repo> --json name,isFork
gh workflow list --repo <GITHUB_USER>/<repo>          # CI, Deploy, Setup

# 2: el dominio usa los nameservers de Cloudflare
dig +short NS <ROOT_DOMAIN>                            # termina en .ns.cloudflare.com.

# 3: la configuración es válida y tiene el formato esperado (en un clon local, con pnpm instalado)
pnpm install --frozen-lockfile && pnpm exec prettier --check wrangler.jsonc
grep -n '"routes"\|STUDIO_NAME\|PUBLIC_ORIGIN\|LEGACY_HOSTS' wrangler.jsonc

# 7: están los siete secrets (solo nombres)
gh secret list --repo <GITHUB_USER>/<repo>

# 8: Setup terminó bien y no hay MISSING
gh run list --repo <GITHUB_USER>/<repo> --workflow setup.yml --limit 1
gh run view <RUN_ID> --repo <GITHUB_USER>/<repo> --log | grep -E 'present|created|uploaded|MISSING|deleted'

# 8: la app responde, el panel está protegido
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/            # 200
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<GALLERY_HOST>/admin   # 302 hacia <ACCESS_TEAM>.cloudflareaccess.com
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/api/admin/sync # 302 o 403, nunca 200
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/privacy     # 200

# 9: https obligatorio
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://<GALLERY_HOST>/   # 301 hacia https
```

El log de Setup filtrado con `grep` solo muestra nombres de secrets y su estado; GitHub además enmascara los valores. **Siempre** pasá `gh run view --log` por `grep` como arriba y nunca imprimas el log completo.

### Condiciones para detenerse

Detenete y explicale a la persona qué pasó (sin secrets) si:

- No hay permiso escrito del dueño del código.
- El dominio no está **Active** en Cloudflare después de 24 horas.
- `prettier --check` falla después de dos intentos de editar `wrangler.jsonc`.
- Antes del paso 8, el fork no contiene la corrección de código descripta al principio (pruebas que ya no controlan el dominio del dueño original), o Setup falla en **Checks** por una prueba (no por formato): la copia del código necesita una versión nueva del dueño. No modifiques las pruebas.
- Setup falla dos veces seguidas con el mismo error de permisos de Cloudflare.
- Un paso pide algo que no está en esta guía (otro permiso, otro pago, otro tipo de cuenta).
- Cualquier herramienta está por mostrar un valor secreto.
- `https://<GALLERY_HOST>/admin` responde 200 sin pasar por el login de Cloudflare: **es una falla de seguridad**. Quitar el dominio del Worker (Cloudflare → Workers & Pages → el Worker → **Settings → Domains & Routes** → quitar `<GALLERY_HOST>`) es **un "preguntale primero a la persona" explícito**: explicale el problema, dejá que ella decida y lo haga, y pedile que avise al dueño del código.
