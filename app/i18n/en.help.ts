import type { esHelp } from "./es.help";

/**
 * Help for the studio owner (T6.57), English. Same keys as es.help.ts.
 * Button names come from `{name}` placeholders filled with the real label.
 * Only typographic quotes anywhere in the dictionaries (check:bundles parser).
 */
export const enHelp = {
  "admin.nav.help": "Help",
  "admin.meta.help": "Help",
  "admin.help.title": "Help",
  "admin.help.intro":
    "Short answers for using your panel. A gallery (album) is a folder of photos with its own link. Search for a word or open a question.",
  "admin.help.toc": "Help sections",
  "admin.help.search.label": "Search the help",
  "admin.help.search.placeholder": "Search, for example: PIN",
  "admin.help.search.submit": "Search",
  "admin.help.search.count.one": "{count} answer",
  "admin.help.search.count.other": "{count} answers",
  "admin.help.search.none": "We found nothing. Try another word.",
  "admin.help.section.start": "Getting started",
  "admin.help.section.drive": "Drive, Capture One and new photos",
  "admin.help.section.albums": "Galleries, photos and cover",
  "admin.help.section.access": "PIN and access",
  "admin.help.section.proof": "Proofs, downloads and favorites",
  "admin.help.section.clients": "Clients",
  "admin.help.section.versions": "Versions and TIFF",
  "admin.help.section.trouble": "Something is wrong",
  "admin.help.linkTo": "Help: {title}",

  // Getting started
  "admin.help.start-what.q": "What is this app for?",
  "admin.help.start-what.k": "what is app purpose intro",
  "admin.help.start-what.a":
    "It delivers your photos to clients in an online gallery with your brand. You export the photos from Capture One to a Google Drive folder and the app builds the galleries by itself.",
  "admin.help.start-overview.q": "What are the steps, start to finish?",
  "admin.help.start-overview.k": "steps start begin tutorial guide first",
  "admin.help.start-overview.s1": "Connect Google Drive in {settings}.",
  "admin.help.start-overview.s2":
    "Pick the Drive folder where you keep your shoots.",
  "admin.help.start-overview.s3": "Export your photos from Capture One to it.",
  "admin.help.start-overview.s4":
    "Wait a few minutes, or tap {syncNow} to make them appear.",
  "admin.help.start-overview.s5":
    "Open the gallery, check the photos and tap {publish}.",
  "admin.help.start-overview.s6":
    "Copy the link in {share} and send it to your client.",
  "admin.help.start-who-sees.q": "What does the client see, and what only me?",
  "admin.help.start-who-sees.k": "private public client sees permissions",
  "admin.help.start-who-sees.a":
    "The client sees the photos, can mark favorites and can download them if you allow it. Only you see this panel, the visits, the downloads, each person's favorites and the notices.",
  "admin.help.start-language.q": "In which language does everything show?",
  "admin.help.start-language.k": "language english spanish translate",
  "admin.help.start-language.a":
    "This panel has an ES / EN switch under the menu. Your clients see the gallery in their browser's language and can change it at the bottom of the page.",
  "admin.help.start-brand.q": "How do I change the studio name or logo?",
  "admin.help.start-brand.k": "logo name brand studio image",
  "admin.help.start-brand.a":
    "PNG, JPEG, WebP or a simple SVG, up to {logoKb} KB. Without a logo the studio name is shown.",
  "admin.help.start-brand.s1": "Go to {settings}.",
  "admin.help.start-brand.s2":
    "Type the name in {brandName} and tap {saveName}.",
  "admin.help.start-brand.s3":
    "In {onLight}, tap {upload} and choose the file. If you want, do the same in {onDark}.",
  "admin.help.start-brand.s4":
    "To go back to the default logo, tap {logoReset}.",
  "admin.help.start-logout.q": "How do I sign out of the panel?",
  "admin.help.start-logout.k": "sign out log out logout exit session",
  "admin.help.start-logout.a":
    "The panel has no sign-out button. To sign out, open `/cdn-cgi/access/logout` on the same address where you open the panel.",

  // Drive, Capture One and new photos
  "admin.help.drive-connect.q": "How do I connect Google Drive?",
  "admin.help.drive-connect.k": "connect google account authorize permission",
  "admin.help.drive-connect.a":
    "You only do it once. If Google shows a warning about an unverified app, that is normal: go on.",
  "admin.help.drive-connect.s1": "Go to {settings}.",
  "admin.help.drive-connect.s2":
    "In the {driveSection} section, tap {connect}.",
  "admin.help.drive-connect.s3":
    "Pick your Google account and accept the read-only permission.",
  "admin.help.drive-connect.s4":
    "You are back in the panel and under the menu it says {connected}.",
  "admin.help.drive-readonly.q":
    "Does the app change or delete anything in my Drive?",
  "admin.help.drive-readonly.k": "safe delete modify read-only resize security",
  "admin.help.drive-readonly.a":
    "No. The app only reads your folder: it never uploads, changes or deletes files. It does not resize or edit photos either: every size comes from Capture One.",
  "admin.help.drive-root.q": "How do I pick the Drive folder?",
  "admin.help.drive-root.k": "root folder choose link url",
  "admin.help.drive-root.a": "Every folder inside it becomes a gallery.",
  "admin.help.drive-root.s1":
    "In Google Drive, open the folder where you keep your shoots.",
  "admin.help.drive-root.s2": "Copy its link from the browser bar.",
  "admin.help.drive-root.s3": "In {settings}, paste it into {rootLabel}.",
  "admin.help.drive-root.s4": "Tap {rootSave}.",
  "admin.help.drive-root-change.q":
    "What happens if I change the Drive folder?",
  "admin.help.drive-root-change.k": "change folder move archive",
  "admin.help.drive-root-change.a":
    "Any gallery that is not in the new folder is archived after {graceMinutes} minutes. It is not deleted: you find it under {archived}. If the folder comes back, the gallery comes back by itself.",
  "admin.help.drive-folders.q": "Which folders must Capture One create?",
  "admin.help.drive-folders.k": "folders recipes sizes watermark",
  "admin.help.drive-folders.a":
    "One folder per size, inside the gallery folder. Only `high-res` is required. If `thumb` is missing, `web` is used; if `web` is missing, `high-res` is used.",
  "admin.help.drive-folders.s1":
    "`high-res`: 2048 px on the long side. The big photo.",
  "admin.help.drive-folders.s2":
    "`web`: 1200 px. Shown on phones, and the Web download.",
  "admin.help.drive-folders.s3":
    "`thumb`: 600 px. The small pictures of the grid.",
  "admin.help.drive-folders.s4":
    "`ig`: 1080 px. Optional: without it there is no Instagram download.",
  "admin.help.drive-folders.s5":
    "`preview-wm`: 2048 px with watermark. Required for proof galleries.",
  "admin.help.drive-folders.s6":
    "`thumb-wm`: 600 px with watermark. Optional: small pictures of proof galleries.",
  "admin.help.drive-names.q": "How do I organize and name the files in Drive?",
  "admin.help.drive-names.k": "names files extension organize",
  "admin.help.drive-names.a":
    "Inside the root folder goes one folder per gallery, and inside it one per size. Each photo must have the same name in every folder, for example `IMG_001.jpg`; the extension may differ. That is how the app knows which files are the same photo.",
  "admin.help.drive-captureone.q": "How do I set up Capture One just once?",
  "admin.help.drive-captureone.k":
    "capture one recipes export process output setup",
  "admin.help.drive-captureone.s1":
    "Create one process recipe per size, as JPEG with the sRGB profile.",
  "admin.help.drive-captureone.s2": "Turn on all the recipes.",
  "admin.help.drive-captureone.s3":
    "As output location, pick the root folder inside Drive for desktop.",
  "admin.help.drive-captureone.s4":
    "In the sub folder field type `[Session Name]/high-res`, and the same with each recipe.",
  "admin.help.drive-captureone.s5": "Process: everything comes out at once.",
  "admin.help.drive-sets.q": "How do I split a gallery into sections?",
  "admin.help.drive-sets.k": "sections subfolders tabs sets",
  "admin.help.drive-sets.a":
    "Create subfolders with the same name inside each size, for example `high-res/Ceremony` and `web/Ceremony`. Each one shows as a section with its own tab. Loose photos go to the Highlights section.",
  "admin.help.drive-rename.q":
    "What happens if I rename a gallery's folder in Drive?",
  "admin.help.drive-rename.k": "rename folder name change",
  "admin.help.drive-rename.a":
    "Nothing: the title, web address and status stay as they were. To change them, use the {details} tab of the gallery.",
  "admin.help.drive-disconnect.q": "How do I disconnect Google Drive?",
  "admin.help.drive-disconnect.k":
    "disconnect google remove account change account reconnect",
  "admin.help.drive-disconnect.a":
    "In {settings}, section {driveSection}, tap {disconnect}. Without a connection the app cannot read Drive and photos that are not ready may stop showing. To come back, tap {connect}.",
  "admin.help.updates-when.q": "When do new photos appear?",
  "admin.help.updates-when.k": "update sync new photos wait refresh how long",
  "admin.help.updates-when.a":
    "The app checks Drive by itself every 15 minutes. If you do not want to wait, tap {syncNow} in {settings}. New galleries show up as {draft}. Before that, Drive for desktop must finish uploading the files.",
  "admin.help.updates-issues.q": "What are the notices about files?",
  "admin.help.updates-issues.k": "notices errors problems warnings",
  "admin.help.updates-issues.a":
    "They are files the app could not use: unknown folders, files that are not JPEG, repeated names or missing sizes. You see them in the gallery list and, inside the gallery, in {photos}, section {issues}. Nothing is lost silently.",

  // Galleries, photos and cover
  "admin.help.albums-create.q": "How do I create a gallery?",
  "admin.help.albums-create.k": "create new album",
  "admin.help.albums-create.a":
    "You do not create it by hand: every new folder inside the Drive root folder becomes a gallery when the app updates. It starts as {draft}, so nobody sees it until you publish it.",
  "admin.help.albums-publish.q": "How do I publish a gallery?",
  "admin.help.albums-publish.k": "publish go live activate",
  "admin.help.albums-publish.s1": "Open the gallery from {galleries}.",
  "admin.help.albums-publish.s2":
    "Tap {preview} to see what the client will see.",
  "admin.help.albums-publish.s3":
    "In the {details} tab, section {status}, tap {publish}.",
  "admin.help.albums-publish.s4": "Copy the link in {share} and send it.",
  "admin.help.albums-hide.q": "How do I hide a gallery without deleting it?",
  "admin.help.albums-hide.k": "hide unpublish draft archive restore take down",
  "admin.help.albums-hide.a":
    "Tap {toDraft}: the link stops opening. {archive} puts it away and {restore} brings it back. Clients only see galleries that are {published} and have not expired.",
  "admin.help.albums-details.q":
    "How do I change the title, date or web address?",
  "admin.help.albums-details.k": "title date web address rename edit",
  "admin.help.albums-details.a":
    "If you change the web address, the links and QR codes you already sent stop working.",
  "admin.help.albums-details.s1": "Open the gallery, {details} tab.",
  "admin.help.albums-details.s2":
    "Change {title}, {eventDate} or {addressField}.",
  "admin.help.albums-details.s3": "Tap {save}.",
  "admin.help.albums-expiry.q": "How do I make a gallery expire?",
  "admin.help.albums-expiry.k": "expire expiry deadline end date",
  "admin.help.albums-expiry.a":
    "After that date clients see {unavailable}. Empty means it never expires; with no time, it expires at 23:59.",
  "admin.help.albums-expiry.s1": "Open the gallery, {details} tab.",
  "admin.help.albums-expiry.s2":
    "Fill in {expiresDate} and, if you want, {expiresTime}.",
  "admin.help.albums-expiry.s3": "Tap {save}.",
  "admin.help.albums-expiry.s4":
    "To reopen an expired gallery, set another date or leave it empty, and save.",
  "admin.help.albums-home.q": "How do I show a gallery on the home page?",
  "admin.help.albums-home.k": "home page front show main",
  "admin.help.albums-home.a":
    "It only works with galleries that are published, have no PIN and have not expired. If its client has a PIN, it does not show on the home page either.",
  "admin.help.albums-home.s1": "Open the gallery, {details} tab.",
  "admin.help.albums-home.s2": "In {homeSection}, tick {homeLabel}.",
  "admin.help.albums-home.s3": "Tap {homeSave}.",
  "admin.help.albums-share.q": "How do I share the gallery with my client?",
  "admin.help.albums-share.k": "share link url qr whatsapp card print send",
  "admin.help.albums-share.a":
    "The gallery must be published. If it has a PIN, send the PIN separately.",
  "admin.help.albums-share.s1": "Open the gallery and go to {share}.",
  "admin.help.albums-share.s2": "Tap {copy} to copy the link.",
  "admin.help.albums-share.s3": "Or tap {whatsapp} to send it by WhatsApp.",
  "admin.help.albums-share.s4":
    "To print, download the QR code with {qrSvg} or {qrPng}.",
  "admin.help.albums-share.s5":
    "Or open {card}: it has the QR, the title and your logo.",
  "admin.help.albums-design.q":
    "How do I change the colors and design of the gallery?",
  "admin.help.albums-design.k": "design colors palette grid style theme",
  "admin.help.albums-design.s1": "Open the gallery, {design} tab.",
  "admin.help.albums-design.s2":
    "Pick {palette}, {coverLayout}, {grid} and {gap}.",
  "admin.help.albums-design.s3":
    "Look at the preview: it changes at once, before saving.",
  "admin.help.albums-design.s4": "Tap {saveDesign}.",
  "admin.help.albums-delete.q": "How do I delete a gallery?",
  "admin.help.albums-delete.k": "delete remove erase",
  "admin.help.albums-delete.a":
    "It does not come back by itself, even if the folder is still in Drive. The gallery and all its data are deleted: favorites, visits, downloads and PIN. Your Drive files are not touched.",
  "admin.help.albums-delete.s1": "Open the gallery, {details} tab.",
  "admin.help.albums-delete.s2": "Scroll down to {danger}.",
  "admin.help.albums-delete.s3": "Type the gallery's web address to confirm.",
  "admin.help.albums-delete.s4": "Tap {deleteButton}.",
  "admin.help.albums-reinclude.q":
    "How do I create a gallery again after deleting it?",
  "admin.help.albums-reinclude.k": "recover recreate deleted include again",
  "admin.help.albums-reinclude.a":
    "In {settings}, section {ignored}, tap {reinclude}. The next update creates it from zero, without the old data.",
  "admin.help.albums-find.q": "How do I find a gallery in the list?",
  "admin.help.albums-find.k": "search filter list find",
  "admin.help.albums-find.a":
    "In {galleries}, type in the search box: it searches title, web address or client. With {fPublished}, {fDrafts} and {fArchived} you filter by status.",
  "admin.help.photos-order.q": "How do I change the order of the photos?",
  "admin.help.photos-order.k": "order sort move drag reorder",
  "admin.help.photos-order.s1": "Open the gallery, {photos} tab.",
  "admin.help.photos-order.s2":
    "Drag a thumbnail, or select it and move it with the move buttons.",
  "admin.help.photos-order.s3": "Or tap {sortDate} or {sortName}.",
  "admin.help.photos-order.s4": "Tap {saveOrder}: changes apply when you save.",
  "admin.help.photos-add.q":
    "How do I add photos to a gallery that already exists?",
  "admin.help.photos-add.k": "add upload new more photos",
  "admin.help.photos-add.a":
    "Export the new photos from Capture One to the same gallery folder, with all the recipes. At the next update (or {syncNow}) they are added at the end.",
  "admin.help.photos-remove.q": "How do I remove a photo from the gallery?",
  "admin.help.photos-remove.k": "remove delete take out photo",
  "admin.help.photos-remove.a":
    "Delete it from Drive, from every size folder. It is hidden at the next update and the app really deletes it {graceMinutes} minutes later. If you put it back in Drive before that, it shows again.",
  "admin.help.photos-cover.q": "How do I choose the cover photo?",
  "admin.help.photos-cover.k": "cover main photo choose",
  "admin.help.photos-cover.a": "If you choose none, the first photo is used.",
  "admin.help.photos-cover.s1": "Open the gallery, {photos} tab.",
  "admin.help.photos-cover.s2":
    "Under the thumbnail you want, tap {tileCover}.",
  "admin.help.photos-cover.s3":
    "For a different cover on phones, tap {tileMobile} under another thumbnail.",
  "admin.help.photos-focal.q":
    "How do I stop the cover from cutting off a face?",
  "admin.help.photos-focal.k": "focal point crop face center framing",
  "admin.help.photos-focal.a":
    "The focal point is the area that always stays in view when the cover is cropped.",
  "admin.help.photos-focal.s1": "Open the gallery, {cover} tab.",
  "admin.help.photos-focal.s2": "Tap the photo where the important part is.",
  "admin.help.photos-focal.s3":
    "Check below how it looks on desktop and on phone.",
  "admin.help.photos-focal.s4": "Tap {saveFocal}.",
  "admin.help.photos-mobile-cover.q": "Can I use a different cover for phones?",
  "admin.help.photos-mobile-cover.k": "mobile cover phone",
  "admin.help.photos-mobile-cover.a":
    "Yes. In {cover}, pick {mobileCover}, tap {chooseMobile} and choose a photo, which can be the same one. If you choose none, phones use the desktop cover.",
  "admin.help.photos-view-as.q": "What is {viewAs} for?",
  "admin.help.photos-view-as.k": "view as desktop phone preview",
  "admin.help.photos-view-as.a":
    "Switch between {desktop} and {mobile} to see how the cover and gallery look on each screen. Changes show at once, before saving.",

  // PIN and access
  "admin.help.access-pin-album.q": "How do I put a PIN on a gallery?",
  "admin.help.access-pin-album.k": "password code pin protect private access",
  "admin.help.access-pin-album.a":
    "The PIN has between {pinMin} and {pinMax} characters. Anyone with the link will have to type it to see the photos.",
  "admin.help.access-pin-album.s1": "Open the gallery, {details} tab.",
  "admin.help.access-pin-album.s2":
    "In {pinSection}, type the PIN in {pinNew}.",
  "admin.help.access-pin-album.s3":
    "Tap {pinSave} (or {pinChange} if it already had one).",
  "admin.help.access-pin-change.q": "What happens if I change or remove a PIN?",
  "admin.help.access-pin-change.k": "change remove pin password session",
  "admin.help.access-pin-change.a":
    "People who were already in must type the new PIN. Download links you already sent stop working. With {pinRemove}, the gallery is open to anyone with the link.",
  "admin.help.access-pin-client.q":
    "How do I put a PIN on all of a client's galleries?",
  "admin.help.access-pin-client.k": "client pin password all galleries",
  "admin.help.access-pin-client.a":
    "Whoever types that PIN once opens all the client's galleries. If one has its own PIN, it still asks for it, after. Also, those galleries stop showing on the home page.",
  "admin.help.access-pin-client.s1": "Go to {clients} and open the client.",
  "admin.help.access-pin-client.s2": "In {clientPin}, type the PIN.",
  "admin.help.access-pin-client.s3": "Tap {pinSave}.",
  "admin.help.access-email.q":
    "Can I ask for the email of whoever views the gallery?",
  "admin.help.access-email.k": "email mail ask contact data",
  "admin.help.access-email.a":
    "Yes. In {options}, tick {requireEmail} and tap {saveOptions}. The first time someone downloads or marks a favorite, they must leave their email. You then see it in {activity} and {favorites}.",

  // Proofs, downloads and favorites
  "admin.help.proof-modes.q":
    "What is the difference between {delivery} and {proofing}?",
  "admin.help.proof-modes.k": "proof delivery watermark mode difference",
  "admin.help.proof-modes.s1":
    "{delivery}: photos have no watermark and the client can download them.",
  "admin.help.proof-modes.s2":
    "{proofing}: everything has a watermark and there are no downloads. The client only picks favorites.",
  "admin.help.proof-setup.q":
    "How do I set up a proof gallery with a watermark?",
  "admin.help.proof-setup.k": "proof watermark preview-wm pick photos",
  "admin.help.proof-setup.a":
    "Capture One adds the watermark, not the app. A new gallery that already has a `preview-wm` folder starts in {proofing}.",
  "admin.help.proof-setup.s1":
    "In Capture One, export the `preview-wm` recipe with your watermark.",
  "admin.help.proof-setup.s2":
    "If you want, also export `thumb-wm` (light small pictures).",
  "admin.help.proof-setup.s3":
    "Open the gallery and in {options} choose {proofing}.",
  "admin.help.proof-setup.s4": "Tap {saveOptions}.",
  "admin.help.proof-sizes.q": "Which sizes can the client download?",
  "admin.help.proof-sizes.k":
    "downloads zip everything sizes high resolution web instagram print",
  "admin.help.proof-sizes.a":
    "You choose what to offer in {options} and save with {saveOptions}. With {bulk}, they can get everything or one section in a single file. The biggest is 2048 px: fine for screens, not for big prints.",
  "admin.help.proof-sizes.s1": "{highres}: the biggest and best quality.",
  "admin.help.proof-sizes.s2": "{web}: light, good for sending by chat.",
  "admin.help.proof-sizes.s3":
    "{ig}: made for Instagram. Only offered if you exported `ig`.",
  "admin.help.proof-favorites.q": "How do clients mark favorites?",
  "admin.help.proof-favorites.k": "favorites heart like pick select",
  "admin.help.proof-favorites.a":
    "They tap the heart on each photo. There is no send button: you see what they marked in {favorites}. Each phone or computer has its own list; if the person used the same email on two, it shows as one.",
  "admin.help.proof-favorites-see.q":
    "How do I see the favorites and take them to Capture One?",
  "admin.help.proof-favorites-see.k": "favorites see copy list capture one txt",
  "admin.help.proof-favorites-see.s1": "Open the gallery, {favorites} tab.",
  "admin.help.proof-favorites-see.s2": "See who marked each photo.",
  "admin.help.proof-favorites-see.s3": "Tap {copyCapture} (or {downloadTxt}).",
  "admin.help.proof-favorites-see.s4":
    "In Capture One, paste the text into the search filter.",
  "admin.help.proof-activity.q":
    "How do I see who looked at or downloaded my photos?",
  "admin.help.proof-activity.k":
    "statistics visits downloads activity csv who viewed",
  "admin.help.proof-activity.a":
    "In the gallery, go to {activity}: you see visits, downloads, country and device. {exportCsv} saves them to a spreadsheet. In the {galleries} list, on a computer, there are the {views} and {downloads} columns. We never store anyone's IP address.",

  // Clients
  "admin.help.clients-create.q": "How do I create a client?",
  "admin.help.clients-create.k": "create client new folder",
  "admin.help.clients-create.a":
    "A client gathers several albums under one address: `/client/album`. It is optional.",
  "admin.help.clients-create.s1": "Go to {clients}.",
  "admin.help.clients-create.s2": "Fill in {name}.",
  "admin.help.clients-create.s3": "Tap {create}.",
  "admin.help.clients-assign.q": "How do I put an album inside a client?",
  "admin.help.clients-assign.k": "assign move gallery client folder",
  "admin.help.clients-assign.a":
    "The album now opens at `/client/album`; the old address leads to the new one.",
  "admin.help.clients-assign.s1": "Open the album, {details} tab.",
  "admin.help.clients-assign.s2": "In {clientFolder}, pick the client.",
  "admin.help.clients-assign.s3": "Tap {save}.",
  "admin.help.clients-page.q":
    "What does the client see on their page, and how do I turn it off?",
  "admin.help.clients-page.k": "client page public turn off cover back button",
  "admin.help.clients-page.a":
    "They see their published albums, with covers. If the client has a PIN, none shows a cover; otherwise only albums with their own PIN have no cover.",
  "admin.help.clients-page.s1":
    "To turn it off, untick {pageEnabled} and tap {saveClient}: visitors see an error.",
  "admin.help.clients-page.s2":
    "The back button to this page, inside a gallery, only shows if the person came from it.",
  "admin.help.clients-defaults.q": "What are a client's default values?",
  "admin.help.clients-defaults.k": "default values mode apply all",
  "admin.help.clients-defaults.a":
    "They are the mode ({delivery} or {proofing}) and whether their albums show on the home page. They are copied to an album when you put it in that client. To repeat them on all albums, tap {applyAll}; PIN and downloads do not change.",
  "admin.help.clients-rename.q":
    "What happens if I change a client's name or address?",
  "admin.help.clients-rename.k": "change name address client",
  "admin.help.clients-rename.a":
    "The name changes with no trouble. If you change the web address, the client's earlier addresses stop working: links and QR codes already sent do not open. Change it in {clients}, {clientDetails}, and save with {saveClient}.",
  "admin.help.clients-delete.q": "What happens if I delete a client?",
  "admin.help.clients-delete.k": "delete remove client",
  "admin.help.clients-delete.a":
    "Their albums are not deleted: they have no client and keep their own address. The client, its page and its PIN are deleted, so that PIN no longer protects them.",
  "admin.help.clients-delete.s1": "Open the client from {clients}.",
  "admin.help.clients-delete.s2": "Scroll down to {dangerClient}.",
  "admin.help.clients-delete.s3": "Type the client's address to confirm.",
  "admin.help.clients-delete.s4": "Tap {deleteClient}.",

  // Versions and TIFF
  "admin.help.versions-what.q": "What are versions for?",
  "admin.help.versions-what.k": "retouch agency rounds versions approve round",
  "admin.help.versions-what.a":
    "They are for retouching agencies that send several rounds of the same photo. Each round brings only the photos that changed, marked {newInRound}. The client sees the latest version, looks at older ones, compares them and approves.",
  "admin.help.versions-on.q": "How do I turn on versions in a gallery?",
  "admin.help.versions-on.k": "turn on versions v2 retouch",
  "admin.help.versions-on.a":
    "It is off by default. Careful: if the gallery was already loaded, a photo called `IMG_v2` is replaced by version 2 of `IMG`. It loses its favorites and its use as cover.",
  "admin.help.versions-on.s1": "Open the gallery, {details} tab.",
  "admin.help.versions-on.s2": "In {versionsSection}, tick {versionsLabel}.",
  "admin.help.versions-on.s3": "Tap {versionsSave}.",
  "admin.help.versions-on.s4":
    "Tap {syncNow} in {settings}: the first time it reads the versions again.",
  "admin.help.versions-names.q": "How do I name the versions?",
  "admin.help.versions-names.k": "naming v2 v3 suffix folder versions",
  "admin.help.versions-names.a":
    "Add `_v2`, `_v3` and so on to the name: `IMG_0123_v2.jpg`. No suffix means version 1. A `v2/` folder with the same size folders inside also works. If both exist, the suffix wins.",
  "admin.help.versions-compare.q": "How does the client see earlier versions?",
  "admin.help.versions-compare.k": "compare history earlier before after",
  "admin.help.versions-compare.a":
    "Opening a photo with several versions shows its history. There they can see each version and compare it with the previous one: {flip} to go back and forth, or {slide} to see before and after on the same photo.",
  "admin.help.versions-approvals.q":
    "How does the client approve a photo, and how do I see it?",
  "admin.help.versions-approvals.k": "approve approval review",
  "admin.help.versions-approvals.a":
    "The client opens the photo and taps the approve button, which shows the version. A new version goes back to waiting for review. You see how many are approved in {photos}, section {approvals}. Approving is not needed to download.",
  "admin.help.versions-tiff.q": "How do I deliver TIFF files?",
  "admin.help.versions-tiff.k": "tiff original deliver files",
  "admin.help.versions-tiff.a":
    "Put the TIFF files in a `tiff` folder (or in `high-res`). Browsers cannot show TIFF: also export a JPEG into `web`. They download one at a time, with {highres} ticked. Photos with a TIFF do not go in the download of everything.",
  "admin.help.versions-tiff-client.q":
    "What does the client see if there is only a TIFF?",
  "admin.help.versions-tiff-client.k": "tiff card no preview",
  "admin.help.versions-tiff-client.a":
    "A card that says {tiffCard} and the {tiffDownload} button: there is no picture to look at. If everything is TIFF, the gallery has no cover and does not show on the home page. On the client's page it shows only with its title and {tiffDelivery}.",

  // Something is wrong
  "admin.help.trouble-photo-missing.q": "I cannot see a photo in the gallery",
  "admin.help.trouble-photo-missing.k": "missing photo not showing disappeared",
  "admin.help.trouble-photo-missing.a":
    "Check in Drive that it is in `high-res`, that it is a JPEG and that it has the same name in every folder. Then tap {syncNow}. If something fails, it is noted in {issues}. If you deleted it from Drive, it is hidden and the app really removes it after {graceMinutes} minutes.",
  "admin.help.trouble-order.q": "The photos are in a different order",
  "admin.help.trouble-order.k": "order different order shuffled",
  "admin.help.trouble-order.a":
    "At first they go by capture date and, if tied, by name. New photos are added at the end. To change the order, drag in {photos} and tap {saveOrder}.",
  "admin.help.trouble-old-photo.q":
    "I changed a photo but the old one still shows",
  "admin.help.trouble-old-photo.k": "old photo changed not updating previous",
  "admin.help.trouble-old-photo.a":
    "Export with the same file name and wait until Drive finishes uploading it. The app notices it at its next update. The browser may keep the old photo for up to 10 minutes: ask the client to reload the page.",
  "admin.help.trouble-blank-proof.q":
    "In {proofing} mode the client sees blank photos",
  "admin.help.trouble-blank-proof.k": "blank empty proof watermark not visible",
  "admin.help.trouble-blank-proof.a":
    "Those photos have no file in `preview-wm`. Export that recipe again and update. Without that file the app never shows the photo without a watermark.",
  "admin.help.trouble-pin.q": "The client says the PIN does not work",
  "admin.help.trouble-pin.k": "pin password not working code error",
  "admin.help.trouble-pin.a":
    "Ask them to type it exactly as you saved it. If both the client and the gallery have a PIN, they must type both, one after the other. After {pinMaxAttempts} wrong tries they must wait a few minutes. If you changed it recently, they must use the new one.",
  "admin.help.trouble-download.q": "The client cannot download",
  "admin.help.trouble-download.k": "download cannot download blocked error",
  "admin.help.trouble-download.s1":
    "The gallery is in {proofing}: no downloads. Switch it to {delivery} in {options}.",
  "admin.help.trouble-download.s2":
    "That size is turned off: tick it in {options} and tap {saveOptions}. TIFF needs {highres}.",
  "admin.help.trouble-download.s3":
    "It asks for an email and the person did not type one.",
  "admin.help.trouble-download.s4":
    "They used an old link: they last about {dlMinutes} minutes and stop if the PIN changes, a size is turned off or you switch to {proofing}.",
  "admin.help.trouble-download.s5":
    "On iPhone and iPad big downloads can fail: download by section or from a computer.",
  "admin.help.trouble-link.q": "The link does not open or says {unavailable}",
  "admin.help.trouble-link.k": "link does not open unavailable",
  "admin.help.trouble-link.a":
    "That screen shows if the gallery is a draft, is archived or has expired. Check its status and date in the gallery. If you changed the web address, the old link no longer works: send the new one from {share}.",
  "admin.help.trouble-sync-error.q": "The menu shows an error after updating",
  "admin.help.trouble-sync-error.k": "error sync google connection",
  "admin.help.trouble-sync-error.a":
    "It is usually a connection problem with Google. Tap {syncNow} again. If it keeps happening, connect Google again in {settings} with {reconnect}.",
  "admin.help.trouble-home.q": "My gallery does not show on the home page",
  "admin.help.trouble-home.k": "home not showing cover main page",
  "admin.help.trouble-home.a":
    "It must be published, have no PIN, not be expired and have {homeLabel} ticked in {details}. If its client has a PIN, it never shows on the home page. In {proofing} mode it also needs a cover with a watermark.",
  "admin.help.trouble-client-page.q": "My client's page shows an error",
  "admin.help.trouble-client-page.k": "client page error 404 not showing",
  "admin.help.trouble-client-page.a":
    "Check that {pageEnabled} is ticked on the client and that it has at least one published gallery with a cover.",
} as const satisfies Record<keyof typeof esHelp, string>;
