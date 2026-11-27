/**
 * First-run wizard for the studio owner (T6.58), Spanish. Admin-only, like
 * es.help.ts. Structure and limits: app/lib/wizard.ts. Button and tab names
 * are never typed here: `{name}` placeholders are filled with the real label
 * of the dictionary. Only typographic quotes anywhere in the dictionaries
 * (check:bundles parser).
 */
export const esWizard = {
  "admin.nav.wizard": "Empezar",
  "admin.meta.wizard": "Primeros pasos",
  "admin.wizard.title": "Primeros pasos",
  "admin.wizard.intro":
    "Seis pasos cortos para dejar todo listo. Podés saltear los que no necesites y volver cuando quieras.",
  "admin.wizard.steps": "Todos los pasos",
  "admin.wizard.progress": "Paso {n} de {total}",
  "admin.wizard.state.done": "Hecho",
  "admin.wizard.state.todo": "Pendiente",
  "admin.wizard.state.optional": "Opcional",
  "admin.wizard.state.read": "Para leer",
  "admin.wizard.back": "Atrás",
  "admin.wizard.next": "Siguiente",
  "admin.wizard.skip": "Saltar este paso",
  "admin.wizard.finish": "Terminar",
  "admin.wizard.goStep": "Ir al paso {n}",
  "admin.wizard.moreHelp": "Más ayuda: {title}",
  "admin.wizard.helpLink": "¿Primera vez acá? Seguí la guía de primeros pasos.",
  "admin.wizard.banner.title": "Primeros pasos",
  "admin.wizard.banner.text":
    "Te mostramos en seis pasos cortos cómo conectar Drive, crear tu primer cliente y tu primera galería, y mandar el enlace.",
  "admin.wizard.banner.open": "Ver la guía",
  "admin.wizard.banner.dismiss": "No mostrar más",

  "admin.wizard.drive.connected": "Google Drive está conectado.",
  "admin.wizard.drive.notConnected": "Todavía no conectaste Google Drive.",
  "admin.wizard.drive.root": "Carpeta elegida: {root}",
  "admin.wizard.drive.noRoot": "Falta elegir la carpeta de tus sesiones.",
  "admin.wizard.drive.openSettings": "Abrir Ajustes",
  "admin.wizard.drive.title": "Conectá Google Drive",
  "admin.wizard.drive.a":
    "Ahí guardás tus fotos. La app solo las mira: nunca las cambia ni las borra.",
  "admin.wizard.drive.l1": "Tocá {connect} y aceptá el permiso de Google.",
  "admin.wizard.drive.l2":
    "Después, en {settings}, pegá el enlace de tu carpeta de sesiones en {rootLabel}.",
  "admin.wizard.drive.l3": "Tocá {rootSave}.",

  "admin.wizard.folders.title": "Preparás tus carpetas en Capture One",
  "admin.wizard.folders.a":
    "Cada sesión es una carpeta dentro de tu carpeta de Drive. Adentro, Capture One guarda una carpeta por cada tamaño de foto.",
  "admin.wizard.folders.l1": "Una carpeta por sesión, por ejemplo `Boda-Ana`.",
  "admin.wizard.folders.l2":
    "Adentro, solo `high-res` es obligatoria: es la foto grande.",
  "admin.wizard.folders.l3":
    "`web` y `thumb` hacen que cargue más rápido, e `ig` suma la descarga para Instagram.",
  "admin.wizard.folders.l4":
    "Para una galería de prueba sumá `preview-wm`: son las fotos con marca de agua.",

  "admin.wizard.client.title": "Creá tu primer cliente",
  "admin.wizard.client.a":
    "Un cliente junta todas sus galerías bajo una misma dirección. Es opcional: si no lo necesitás, saltá este paso.",
  "admin.wizard.client.l1":
    "Escribí el nombre de tu cliente, por ejemplo Ana y Martín.",
  "admin.wizard.client.l2":
    "Después ponés cada galería en su cliente desde {details}, en {clientFolder}.",
  "admin.wizard.client.hint": "Es el nombre que vas a ver en tu lista.",
  "admin.wizard.client.none": "Todavía no creaste ningún cliente.",
  "admin.wizard.client.some.one": "Ya tenés {count} cliente.",
  "admin.wizard.client.some.other": "Ya tenés {count} clientes.",

  "admin.wizard.gallery.title": "Creá tu primera galería",
  "admin.wizard.gallery.a":
    "No se crea a mano: cada carpeta nueva de Drive pasa a ser una galería. La app revisa Drive sola cada {syncMinutes} minutos.",
  "admin.wizard.gallery.l1":
    "Exportá las fotos de una sesión desde Capture One a tu carpeta de Drive.",
  "admin.wizard.gallery.l2": "Si no querés esperar, tocá {syncNow}.",
  "admin.wizard.gallery.l3":
    "La galería nueva empieza como {draft}: nadie la ve hasta que la publiques.",
  "admin.wizard.gallery.none": "Todavía no apareció ninguna galería.",
  "admin.wizard.gallery.some.one": "Encontramos {count} galería:",
  "admin.wizard.gallery.some.other": "Encontramos {count} galerías:",
  "admin.wizard.gallery.more": "y {count} más",
  "admin.wizard.gallery.needDrive":
    "Primero conectá Google Drive, así la app puede ver tus carpetas.",

  "admin.wizard.settings.title": "Elegí los ajustes más importantes",
  "admin.wizard.settings.a":
    "Se cambian dentro de la galería, en la pestaña {details}. Cada línea muestra cómo está hoy.",
  "admin.wizard.settings.l1":
    "Publicar: con {publish} el cliente ya puede ver la galería.",
  "admin.wizard.settings.l2":
    "PIN: una clave de {pinMin} a {pinMax} caracteres para entrar.",
  "admin.wizard.settings.l3":
    "{proofing} lleva marca de agua y no deja descargar; {delivery} entrega las fotos limpias.",
  "admin.wizard.settings.l4":
    "Descargas: elegís qué tamaños puede bajar el cliente, en {options}.",
  "admin.wizard.settings.l5":
    "Vencimiento: con {expiresDate}, después de ese día la galería deja de verse.",
  "admin.wizard.settings.noGallery":
    "Todavía no hay ninguna galería para configurar.",
  "admin.wizard.settings.for": "Galería: {title}",
  "admin.wizard.settings.open": "Abrir la galería",
  "admin.wizard.settings.now": "Ahora: {value}",
  "admin.wizard.val.pinOn": "con PIN",
  "admin.wizard.val.pinOff": "sin PIN",
  "admin.wizard.val.dlOn": "descargas permitidas",
  "admin.wizard.val.dlOff": "sin descargas",
  "admin.wizard.val.expiryNone": "no vence",
  "admin.wizard.val.expiryAt": "vence el {date}",

  "admin.wizard.share.title": "Mandale el enlace a tu cliente",
  "admin.wizard.share.a":
    "Cuando la galería esté publicada, copiá su enlace y mandalo por WhatsApp o por mail.",
  "admin.wizard.share.l1": "El enlace de la galería abre solo esa galería.",
  "admin.wizard.share.l2":
    "Si usás un cliente, su página junta todas sus galerías publicadas.",
  "admin.wizard.share.l3":
    "El QR y la tarjeta para imprimir están en {share}, dentro de la galería.",
  "admin.wizard.share.noGallery":
    "Todavía no hay ninguna galería para compartir.",
  "admin.wizard.share.draft":
    "Esta galería sigue en borrador: publicala antes de mandar el enlace.",
  "admin.wizard.share.linkLabel": "Enlace de la galería",
  "admin.wizard.share.clientLinkLabel": "Enlace de la página del cliente",
} as const;
