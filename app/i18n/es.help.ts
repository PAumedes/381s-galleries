/**
 * Help for the studio owner (T6.57), Spanish. Admin-only, like es.admin.ts.
 * Structure and limits: app/lib/help.ts. Button names are never typed here:
 * `{name}` placeholders are filled with the real label of the dictionary.
 * Only typographic quotes anywhere in the dictionaries (check:bundles parser).
 */
export const esHelp = {
  "admin.nav.help": "Ayuda",
  "admin.meta.help": "Ayuda",
  "admin.help.title": "Ayuda",
  "admin.help.intro":
    "Respuestas cortas para usar tu panel. Buscá una palabra o abrí una pregunta.",
  "admin.help.toc": "Secciones de la ayuda",
  "admin.help.search.label": "Buscar en la ayuda",
  "admin.help.search.placeholder": "Buscar, por ejemplo: PIN",
  "admin.help.search.submit": "Buscar",
  "admin.help.search.count.one": "{count} respuesta",
  "admin.help.search.count.other": "{count} respuestas",
  "admin.help.search.none": "No encontramos nada. Probá con otra palabra.",
  "admin.help.link": "Ayuda",

  "admin.help.section.start": "Empezar",
  "admin.help.section.drive": "Drive, Capture One y fotos nuevas",
  "admin.help.section.albums": "Álbumes, fotos y portada",
  "admin.help.section.access": "PIN y acceso",
  "admin.help.section.proof": "Prueba, descargas y favoritas",
  "admin.help.section.clients": "Clientes",
  "admin.help.section.versions": "Versiones y TIFF",
  "admin.help.section.trouble": "Algo no anda",

  // Empezar
  "admin.help.start-what.q": "¿Para qué sirve esta aplicación?",
  "admin.help.start-what.a":
    "Para entregar tus fotos a los clientes en una galería online con tu marca. Exportás las fotos desde Capture One a una carpeta de Google Drive y la app arma las galerías sola.",
  "admin.help.start-overview.q": "¿Cuáles son los pasos, de principio a fin?",
  "admin.help.start-overview.s1": "Conectá Google Drive en {settings}.",
  "admin.help.start-overview.s2":
    "Elegí la carpeta de Drive donde guardás tus sesiones.",
  "admin.help.start-overview.s3":
    "Exportá las fotos desde Capture One a esa carpeta.",
  "admin.help.start-overview.s4":
    "Esperá unos minutos o tocá {syncNow} para que aparezcan.",
  "admin.help.start-overview.s5":
    "Abrí el álbum, revisá las fotos y tocá {publish}.",
  "admin.help.start-overview.s6":
    "Copiá el enlace en {share} y mandáselo a tu cliente.",
  "admin.help.start-who-sees.q": "¿Qué ve el cliente y qué veo solo yo?",
  "admin.help.start-who-sees.a":
    "El cliente ve las fotos, puede marcar favoritas y descargarlas si lo permitís. Solo vos ves este panel, las visitas, las descargas, las favoritas de cada persona y los avisos.",
  "admin.help.start-language.q": "¿En qué idioma se ve todo?",
  "admin.help.start-language.a":
    "Este panel tiene un selector ES / EN abajo del menú. Tus clientes ven la galería en el idioma de su navegador y pueden cambiarlo al pie de la página.",
  "admin.help.start-brand.q": "¿Cómo cambio el nombre o el logo del estudio?",
  "admin.help.start-brand.a":
    "El logo puede ser PNG, JPEG, WebP o SVG simple, de hasta 512 KB. Sin logo se muestra el nombre del estudio.",
  "admin.help.start-brand.s1": "Entrá en {settings}.",
  "admin.help.start-brand.s2":
    "Escribí el nombre en {brandName} y tocá {saveName}.",
  "admin.help.start-brand.s3":
    "Para el logo, tocá {upload} y elegí el archivo.",

  // Drive, Capture One y fotos nuevas
  "admin.help.drive-connect.q": "¿Cómo conecto Google Drive?",
  "admin.help.drive-connect.a":
    "Se hace una sola vez. Si Google muestra un aviso de aplicación sin verificar, es normal: seguí adelante.",
  "admin.help.drive-connect.s1": "Entrá en {settings}.",
  "admin.help.drive-connect.s2": "En la sección Google Drive, tocá {connect}.",
  "admin.help.drive-connect.s3":
    "Elegí tu cuenta de Google y aceptá el permiso de solo lectura.",
  "admin.help.drive-connect.s4":
    "Volvés al panel y abajo del menú dice {connected}.",
  "admin.help.drive-readonly.q": "¿La app cambia o borra algo de mi Drive?",
  "admin.help.drive-readonly.a":
    "No. La app solo lee tu carpeta: nunca sube, cambia ni borra archivos. Tampoco achica ni edita las fotos: todos los tamaños salen de Capture One.",
  "admin.help.drive-root.q": "¿Cómo elijo la carpeta de Drive?",
  "admin.help.drive-root.a":
    "Cada carpeta que haya adentro pasa a ser un álbum.",
  "admin.help.drive-root.s1":
    "En Google Drive, abrí la carpeta donde guardás tus sesiones.",
  "admin.help.drive-root.s2": "Copiá su enlace desde la barra del navegador.",
  "admin.help.drive-root.s3": "En {settings}, pegalo en {rootLabel}.",
  "admin.help.drive-root.s4": "Tocá {rootSave}.",
  "admin.help.drive-root-change.q": "¿Qué pasa si cambio la carpeta de Drive?",
  "admin.help.drive-root-change.a":
    "Los álbumes que no estén en la nueva carpeta se archivan después de 1 hora. No se borran: los ves en {archived}. Si la carpeta vuelve, los álbumes vuelven solos.",
  "admin.help.drive-folders.q": "¿Qué carpetas tiene que crear Capture One?",
  "admin.help.drive-folders.a":
    "Una carpeta por cada tamaño, adentro de la carpeta del álbum. Solo `high-res` es obligatoria. Si falta `web` o `thumb`, se usa el tamaño más grande que haya.",
  "admin.help.drive-folders.s1":
    "`high-res`: 2048 px de lado largo. Es la foto grande.",
  "admin.help.drive-folders.s2":
    "`web`: 1200 px. Se ve en los celulares y es la descarga Web.",
  "admin.help.drive-folders.s3":
    "`thumb`: 600 px. Son las miniaturas de la grilla.",
  "admin.help.drive-folders.s4":
    "`ig`: 1080 px. Opcional: sin ella no hay descarga para Instagram.",
  "admin.help.drive-folders.s5":
    "`preview-wm`: 2048 px con marca de agua. Opcional: es lo que se ve en las galerías de prueba.",
  "admin.help.drive-folders.s6":
    "`thumb-wm`: 600 px con marca de agua. Opcional: miniaturas de las galerías de prueba.",
  "admin.help.drive-names.q": "¿Cómo ordeno y nombro los archivos en Drive?",
  "admin.help.drive-names.a":
    "Dentro de la carpeta raíz va una carpeta por álbum, y adentro una por tamaño. Cada foto tiene que llamarse igual en todas las carpetas, por ejemplo `IMG_001.jpg`. Así la app sabe cuáles archivos son la misma foto.",
  "admin.help.drive-captureone.q": "¿Cómo configuro Capture One una sola vez?",
  "admin.help.drive-captureone.s1":
    "Creá una receta de proceso por cada tamaño, en JPEG y perfil sRGB.",
  "admin.help.drive-captureone.s2": "Activá todas las recetas.",
  "admin.help.drive-captureone.s3":
    "Como ubicación de salida, elegí la carpeta raíz dentro de Drive para escritorio.",
  "admin.help.drive-captureone.s4":
    "En el campo de subcarpeta escribí `[Session Name]/high-res`, y lo mismo con cada receta.",
  "admin.help.drive-captureone.s5": "Procesá: sale todo de una vez.",
  "admin.help.drive-sets.q": "¿Cómo armo secciones dentro de un álbum?",
  "admin.help.drive-sets.a":
    "Creá subcarpetas con el mismo nombre dentro de cada tamaño, por ejemplo `high-res/Ceremonia` y `web/Ceremonia`. Cada una se ve como una sección con su pestaña. Las fotos sueltas quedan en la sección Highlights.",
  "admin.help.updates-when.q": "¿Cuándo aparecen las fotos nuevas?",
  "admin.help.updates-when.a":
    "La app revisa Drive sola cada 15 minutos. Si no querés esperar, tocá {syncNow} en {settings}. Los álbumes nuevos aparecen como {draft}. Antes, Drive para escritorio tiene que terminar de subir los archivos.",
  "admin.help.updates-issues.q": "¿Qué son los avisos de sincronización?",
  "admin.help.updates-issues.a":
    "Son archivos que la app no pudo usar: carpetas desconocidas, archivos que no son JPEG, nombres repetidos o tamaños que faltan. Los ves en la lista de álbumes y, dentro del álbum, en {photos}, sección {issues}. Nada se pierde en silencio.",

  // Álbumes, fotos y portada
  "admin.help.albums-create.q": "¿Cómo creo un álbum?",
  "admin.help.albums-create.a":
    "No se crea a mano: cada carpeta nueva dentro de la carpeta raíz de Drive pasa a ser un álbum cuando la app se actualiza. Empieza como {draft}, así nadie lo ve hasta que vos lo publiques.",
  "admin.help.albums-publish.q": "¿Cómo publico un álbum?",
  "admin.help.albums-publish.s1": "Abrí el álbum desde {galleries}.",
  "admin.help.albums-publish.s2":
    "Tocá {preview} para ver lo que va a ver el cliente.",
  "admin.help.albums-publish.s3":
    "En la pestaña {details}, sección {status}, tocá {publish}.",
  "admin.help.albums-publish.s4": "Copiá el enlace en {share} y mandáselo.",
  "admin.help.albums-hide.q": "¿Cómo oculto un álbum sin borrarlo?",
  "admin.help.albums-hide.a":
    "Tocá {toDraft}: el enlace deja de abrirse. {archive} lo guarda aparte y {restore} lo trae de vuelta. Los clientes solo ven los álbumes {published} que no hayan vencido.",
  "admin.help.albums-details.q":
    "¿Cómo cambio el título, la fecha o la dirección web?",
  "admin.help.albums-details.a":
    "Si cambiás la dirección web, los enlaces y códigos QR que ya enviaste dejan de funcionar.",
  "admin.help.albums-details.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.albums-details.s2":
    "Cambiá {title}, {eventDate} o {addressField}.",
  "admin.help.albums-details.s3": "Tocá {save}.",
  "admin.help.albums-expiry.q": "¿Cómo hago que un álbum venza?",
  "admin.help.albums-expiry.a":
    "Después de esa fecha, los clientes ven {unavailable}. Vacío significa que nunca vence; sin hora, vence a las 23:59.",
  "admin.help.albums-expiry.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.albums-expiry.s2":
    "Completá {expiresDate} y, si querés, {expiresTime}.",
  "admin.help.albums-expiry.s3": "Tocá {save}.",
  "admin.help.albums-expiry.s4":
    "Para reabrir un álbum vencido, poné otra fecha o dejala vacía y guardá.",
  "admin.help.albums-home.q": "¿Cómo muestro un álbum en la página de inicio?",
  "admin.help.albums-home.a":
    "Solo funciona con álbumes publicados, sin PIN y sin vencer.",
  "admin.help.albums-home.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.albums-home.s2": "En {homeSection}, marcá {homeLabel}.",
  "admin.help.albums-home.s3": "Tocá {homeSave}.",
  "admin.help.albums-share.q": "¿Cómo comparto el álbum con mi cliente?",
  "admin.help.albums-share.a":
    "El álbum tiene que estar publicado. Si tiene PIN, mandalo por separado.",
  "admin.help.albums-share.s1": "Abrí el álbum y entrá en {share}.",
  "admin.help.albums-share.s2": "Tocá {copy} para copiar el enlace.",
  "admin.help.albums-share.s3": "O tocá {whatsapp} para mandarlo por WhatsApp.",
  "admin.help.albums-share.s4":
    "Para imprimir, descargá el código QR con {qrSvg} o {qrPng}.",
  "admin.help.albums-share.s5":
    "O abrí {card}: trae el QR, el título y tu logo.",
  "admin.help.albums-design.q":
    "¿Cómo cambio los colores y el diseño de la galería?",
  "admin.help.albums-design.s1": "Abrí el álbum, pestaña {design}.",
  "admin.help.albums-design.s2":
    "Elegí {palette}, {coverLayout}, {grid} y {gap}.",
  "admin.help.albums-design.s3":
    "Mirá la vista previa: cambia al instante, antes de guardar.",
  "admin.help.albums-design.s4": "Tocá {saveDesign}.",
  "admin.help.albums-delete.q": "¿Cómo elimino un álbum?",
  "admin.help.albums-delete.a":
    "Se borran el álbum y todos sus datos: favoritas, visitas, descargas y PIN. Tus archivos de Drive no se tocan. No se puede deshacer.",
  "admin.help.albums-delete.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.albums-delete.s2": "Bajá hasta {danger}.",
  "admin.help.albums-delete.s3":
    "Escribí la dirección web del álbum para confirmar.",
  "admin.help.albums-delete.s4": "Tocá {deleteButton}.",
  "admin.help.albums-delete.s5":
    "Para crearlo de nuevo desde cero: en {settings}, sección {ignored}, tocá {reinclude}.",
  "admin.help.photos-order.q": "¿Cómo cambio el orden de las fotos?",
  "admin.help.photos-order.s1": "Abrí el álbum, pestaña {photos}.",
  "admin.help.photos-order.s2":
    "Arrastrá una miniatura, o elegila y movela con los botones de mover.",
  "admin.help.photos-order.s3": "O tocá {sortDate} u {sortName}.",
  "admin.help.photos-order.s4":
    "Tocá {saveOrder}: los cambios se aplican al guardar.",
  "admin.help.photos-cover.q": "¿Cómo elijo la foto de portada?",
  "admin.help.photos-cover.a": "Si no elegís ninguna, se usa la primera foto.",
  "admin.help.photos-cover.s1": "Abrí el álbum, pestaña {photos}.",
  "admin.help.photos-cover.s2":
    "Tocá una miniatura (en la computadora, pasá el cursor por encima).",
  "admin.help.photos-cover.s3": "Tocá {useCover}.",
  "admin.help.photos-focal.q": "¿Cómo evito que la portada corte una cara?",
  "admin.help.photos-focal.a":
    "El punto focal es la zona que siempre queda a la vista cuando la portada se recorta.",
  "admin.help.photos-focal.s1": "Abrí el álbum, pestaña {cover}.",
  "admin.help.photos-focal.s2": "Tocá la foto donde está lo importante.",
  "admin.help.photos-focal.s3":
    "Mirá abajo cómo queda en escritorio y en celular.",
  "admin.help.photos-focal.s4": "Tocá {saveFocal}.",
  "admin.help.photos-mobile-cover.q":
    "¿Puedo usar otra portada para el celular?",
  "admin.help.photos-mobile-cover.a":
    "Sí. En {cover}, elegí {mobileCover}, tocá {chooseMobile} y elegí una foto, que puede ser la misma. Si no elegís ninguna, en el celular se usa la de escritorio.",

  // PIN y acceso
  "admin.help.access-pin-album.q": "¿Cómo pongo un PIN a un álbum?",
  "admin.help.access-pin-album.a":
    "El PIN tiene entre {pinMin} y {pinMax} caracteres. Quien tenga el enlace tendrá que escribirlo para ver las fotos.",
  "admin.help.access-pin-album.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.access-pin-album.s2":
    "En {pinSection}, escribí el PIN en {pinNew}.",
  "admin.help.access-pin-album.s3":
    "Tocá {pinSave} (o {pinChange} si ya tenía uno).",
  "admin.help.access-pin-change.q": "¿Qué pasa si cambio o quito un PIN?",
  "admin.help.access-pin-change.a":
    "Quien ya había entrado tiene que escribir el PIN nuevo. Los enlaces de descarga que ya enviaste dejan de funcionar. Con {pinRemove}, el álbum queda abierto para cualquiera que tenga el enlace.",
  "admin.help.access-pin-client.q":
    "¿Cómo pongo un PIN a todos los álbumes de un cliente?",
  "admin.help.access-pin-client.a":
    "Quien escribe ese PIN una vez abre todos los álbumes del cliente. Si un álbum tiene su propio PIN, lo pide igual, después del PIN del cliente.",
  "admin.help.access-pin-client.s1": "Entrá en {clients} y abrí el cliente.",
  "admin.help.access-pin-client.s2": "En {clientPin}, escribí el PIN.",
  "admin.help.access-pin-client.s3": "Tocá {pinSave}.",
  "admin.help.access-email.q": "¿Puedo pedir el email de quien mira el álbum?",
  "admin.help.access-email.a":
    "Sí. En {options}, marcá {requireEmail} y tocá {saveOptions}. La primera vez que alguien descargue o marque una favorita, tendrá que dejar su email. Después lo ves en {activity} y {favorites}.",

  // Prueba, descargas y favoritas
  "admin.help.proof-modes.q":
    "¿Qué diferencia hay entre {delivery} y {proofing}?",
  "admin.help.proof-modes.s1":
    "{delivery}: las fotos van sin marca de agua y el cliente puede descargarlas.",
  "admin.help.proof-modes.s2":
    "{proofing}: todo lleva marca de agua y no hay descargas. El cliente solo elige favoritas.",
  "admin.help.proof-setup.q":
    "¿Cómo armo una galería de prueba con marca de agua?",
  "admin.help.proof-setup.a":
    "La marca de agua la pone Capture One, no la app. Un álbum nuevo que ya tenga la carpeta `preview-wm` empieza en {proofing}.",
  "admin.help.proof-setup.s1":
    "En Capture One, exportá la receta `preview-wm` con tu marca de agua.",
  "admin.help.proof-setup.s2":
    "Si querés, exportá también `thumb-wm` (miniaturas livianas).",
  "admin.help.proof-setup.s3": "Abrí el álbum y en {options} elegí {proofing}.",
  "admin.help.proof-setup.s4": "Tocá {saveOptions}.",
  "admin.help.proof-sizes.q": "¿Qué tamaños puede descargar el cliente?",
  "admin.help.proof-sizes.a":
    "Elegís qué ofrecer en {options} y guardás con {saveOptions}. Con {bulk}, pueden bajar todo o una sección en un solo archivo. El más grande mide 2048 px: sirve para pantallas, no para imprimir en grande.",
  "admin.help.proof-sizes.s1": "{highres}: el más grande y de mejor calidad.",
  "admin.help.proof-sizes.s2": "{web}: liviano, bueno para mandar por chat.",
  "admin.help.proof-sizes.s3":
    "{ig}: pensado para Instagram. Solo se ofrece si exportaste `ig`.",
  "admin.help.proof-favorites.q": "¿Cómo marcan favoritas los clientes?",
  "admin.help.proof-favorites.a":
    "Tocan el corazón de cada foto. No hay botón de enviar: vos ves lo que marcaron en {favorites}. Cada celular o computadora tiene su propia lista; si la persona usó el mismo email en dos, aparece como una sola.",
  "admin.help.proof-favorites-see.q":
    "¿Cómo veo las favoritas y las llevo a Capture One?",
  "admin.help.proof-favorites-see.s1": "Abrí el álbum, pestaña {favorites}.",
  "admin.help.proof-favorites-see.s2": "Mirá quién marcó cada foto.",
  "admin.help.proof-favorites-see.s3": "Tocá {copyCapture} (o {downloadTxt}).",
  "admin.help.proof-favorites-see.s4":
    "En Capture One, pegá el texto en el filtro de búsqueda.",
  "admin.help.proof-activity.q": "¿Cómo veo quién miró o descargó mis fotos?",
  "admin.help.proof-activity.a":
    "En el álbum, entrá en {activity}: ves visitas, descargas, país y dispositivo. {exportCsv} las baja a una planilla. En la lista de {galleries}, en la computadora, están las columnas {views} y {downloads}. Nunca guardamos la dirección IP.",

  // Clientes
  "admin.help.clients-create.q": "¿Cómo creo un cliente?",
  "admin.help.clients-create.a":
    "Un cliente junta varios álbumes bajo una misma dirección: `/cliente/album`. Es opcional.",
  "admin.help.clients-create.s1": "Entrá en {clients}.",
  "admin.help.clients-create.s2": "Completá {name}.",
  "admin.help.clients-create.s3": "Tocá {create}.",
  "admin.help.clients-assign.q": "¿Cómo pongo un álbum dentro de un cliente?",
  "admin.help.clients-assign.a":
    "El álbum pasa a abrirse en `/cliente/album`; la dirección vieja lleva a la nueva.",
  "admin.help.clients-assign.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.clients-assign.s2": "En {clientFolder}, elegí el cliente.",
  "admin.help.clients-assign.s3": "Tocá {save}.",
  "admin.help.clients-page.q":
    "¿Qué ve el cliente en su página y cómo la apago?",
  "admin.help.clients-page.a":
    "Ve la lista de sus álbumes publicados, con portada. Los que tienen PIN aparecen sin portada y piden el PIN. Para apagarla, desmarcá {pageEnabled} y tocá {saveClient}: la página deja de existir y los visitantes ven un error.",
  "admin.help.clients-defaults.q":
    "¿Qué son los valores por defecto de un cliente?",
  "admin.help.clients-defaults.a":
    "Son el modo ({delivery} o {proofing}) y si sus álbumes salen en la página de inicio. Se copian a un álbum cuando lo ponés en ese cliente. Para repetirlos en todos, tocá {applyAll}; el PIN y las descargas no cambian.",
  "admin.help.clients-delete.q": "¿Qué pasa si elimino un cliente?",
  "admin.help.clients-delete.a":
    "Sus álbumes no se borran: quedan sin cliente y siguen en su propia dirección. Se borran el cliente, su página y su PIN, así que ese PIN ya no los protege.",
  "admin.help.clients-delete.s1": "Abrí el cliente desde {clients}.",
  "admin.help.clients-delete.s2": "Bajá hasta {dangerClient}.",
  "admin.help.clients-delete.s3":
    "Escribí la dirección del cliente para confirmar.",
  "admin.help.clients-delete.s4": "Tocá {deleteClient}.",

  // Versiones y TIFF
  "admin.help.versions-what.q": "¿Para qué sirven las versiones?",
  "admin.help.versions-what.a":
    "Son para agencias de retoque que mandan varias rondas de la misma foto. El cliente ve siempre la última versión, puede mirar las anteriores, compararlas y aprobar. Viene apagado: lo activás álbum por álbum.",
  "admin.help.versions-on.q": "¿Cómo activo las versiones en un álbum?",
  "admin.help.versions-on.a":
    "Atención: si el álbum ya estaba cargado, una foto llamada `IMG_v2` se reemplaza por la versión 2 de `IMG`. Pierde sus favoritas y su uso como portada.",
  "admin.help.versions-on.s1": "Abrí el álbum, pestaña {details}.",
  "admin.help.versions-on.s2": "En {versionsSection}, marcá {versionsLabel}.",
  "admin.help.versions-on.s3": "Tocá {versionsSave}.",
  "admin.help.versions-on.s4":
    "Tocá {syncNow} en {settings}: la primera vez vuelve a leer las versiones.",
  "admin.help.versions-names.q": "¿Cómo nombro las versiones?",
  "admin.help.versions-names.a":
    "Agregá `_v2`, `_v3` y así al nombre: `IMG_0123_v2.jpg`. Sin sufijo es la versión 1. También sirve una carpeta `v2/` con las mismas carpetas de tamaño adentro. Si están las dos formas, gana el sufijo.",
  "admin.help.versions-rounds.q": "¿Qué es una ronda?",
  "admin.help.versions-rounds.a":
    "Cada vez que la agencia manda versiones nuevas es una ronda. Cada ronda trae solo las fotos que cambiaron: una foto ya aprobada no se vuelve a mandar. El cliente ve el número de ronda arriba y {newInRound} en las fotos nuevas.",
  "admin.help.versions-compare.q":
    "¿Cómo ve el cliente las versiones anteriores?",
  "admin.help.versions-compare.a":
    "Al abrir una foto con varias versiones aparece su historial. Ahí puede ver cada versión y compararla con la anterior: {flip} para ir de una a otra, o {slide} para ver el antes y el después en la misma foto.",
  "admin.help.versions-approvals.q":
    "¿Cómo aprueba el cliente una foto y cómo lo veo?",
  "admin.help.versions-approvals.a":
    "El cliente abre la foto y toca el botón de aprobar, que dice la versión. Una versión nueva vuelve a quedar por revisar. Vos ves cuántas hay aprobadas en {photos}, sección {approvals}. Aprobar no hace falta para descargar.",
  "admin.help.versions-tiff.q": "¿Cómo entrego archivos TIFF?",
  "admin.help.versions-tiff.a":
    "Poné los TIFF en una carpeta `tiff` (o en `high-res`). Los navegadores no muestran TIFF: para que la foto se vea, exportá también un JPEG en `web`. El cliente baja el TIFF desde la foto, de a uno.",
  "admin.help.versions-tiff-client.q": "¿Qué ve el cliente si solo hay TIFF?",
  "admin.help.versions-tiff-client.a":
    "Una tarjeta que dice {tiffCard} y el botón {tiffDownload}: no hay imagen para mirar. Si todo es TIFF, el álbum no tiene portada ni sale en la página de inicio. En la página del cliente aparece solo con su título y {tiffDelivery}.",

  // Algo no anda
  "admin.help.trouble-photo-missing.q": "No veo una foto en la galería",
  "admin.help.trouble-photo-missing.a":
    "Revisá en Drive que esté en `high-res`, que sea JPEG y que se llame igual en todas las carpetas. Después tocá {syncNow}. Si algo falla, queda anotado en {issues}. Si la borraste de Drive, se oculta y la app la quita de verdad después de 1 hora.",
  "admin.help.trouble-order.q": "Las fotos están en otro orden",
  "admin.help.trouble-order.a":
    "El orden se cambia a mano. En {photos}, arrastrá las miniaturas y tocá {saveOrder}.",
  "admin.help.trouble-old-photo.q":
    "Cambié una foto pero se sigue viendo la anterior",
  "admin.help.trouble-old-photo.a":
    "Exportá con el mismo nombre de archivo y esperá a que Drive termine de subirla. La app la detecta en la próxima actualización. El navegador puede guardar la foto vieja hasta 10 minutos: pedile al cliente que recargue la página.",
  "admin.help.trouble-blank-proof.q":
    "En modo {proofing} el cliente ve fotos en blanco",
  "admin.help.trouble-blank-proof.a":
    "Esas fotos no tienen su archivo en `preview-wm`. Exportá esa receta de nuevo y actualizá. Sin ese archivo la app nunca muestra la foto sin marca de agua.",
  "admin.help.trouble-pin.q": "El cliente dice que el PIN no funciona",
  "admin.help.trouble-pin.a":
    "Pedile que lo escriba tal cual lo guardaste. Si el cliente y el álbum tienen PIN, hay que escribir los dos, uno después del otro. Después de 5 intentos fallidos tiene que esperar unos minutos. Si lo cambiaste hace poco, tiene que usar el nuevo.",
  "admin.help.trouble-download.q": "El cliente no puede descargar",
  "admin.help.trouble-download.s1":
    "El álbum está en {proofing}: no hay descargas. Pasalo a {delivery} en {options}.",
  "admin.help.trouble-download.s2":
    "Ese tamaño está desactivado: marcalo en {options} y tocá {saveOptions}.",
  "admin.help.trouble-download.s3":
    "Pide un email y la persona no lo escribió.",
  "admin.help.trouble-download.s4":
    "Usó un enlace viejo: duran unos 10 minutos y se anulan al cambiar el PIN. Que toque descargar de nuevo.",
  "admin.help.trouble-download.s5":
    "En iPhone y iPad las descargas grandes pueden fallar: que baje por sección o desde una computadora.",
  "admin.help.trouble-link.q": "El enlace no abre o dice {unavailable}",
  "admin.help.trouble-link.a":
    "Esa pantalla sale si el álbum es borrador, está archivado o ya venció. Mirá su estado y su fecha en el álbum. Si cambiaste la dirección web, el enlace viejo no sirve: mandá el nuevo desde {share}.",
  "admin.help.trouble-back-button.q":
    "No aparece el botón para volver a la página del cliente",
  "admin.help.trouble-back-button.a":
    "Solo aparece si la persona llegó desde la página del cliente. Si abrió el enlace del álbum directo, no se muestra. Mandale la dirección de la página del cliente para que entre por ahí.",
  "admin.help.trouble-sync-error.q":
    "El menú muestra un error de sincronización",
  "admin.help.trouble-sync-error.a":
    "Suele ser un problema de conexión con Google. Tocá {syncNow} otra vez. Si sigue, volvé a conectar Google en {settings} con {reconnect}.",
  "admin.help.trouble-home.q": "Mi álbum no aparece en la página de inicio",
  "admin.help.trouble-home.a":
    "Tiene que estar publicado, sin PIN, sin vencer y con {homeLabel} marcado en {details}. En modo {proofing} además necesita una portada con marca de agua. La página de un cliente necesita al menos un álbum publicado con portada.",
} as const;
