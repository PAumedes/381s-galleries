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
    "Short answers for using your panel. Search for a word or open a question.",
  "admin.help.toc": "Help sections",
  "admin.help.search.label": "Search the help",
  "admin.help.search.placeholder": "Search, for example: PIN",
  "admin.help.search.submit": "Search",
  "admin.help.search.count.one": "{count} answer",
  "admin.help.search.count.other": "{count} answers",
  "admin.help.search.none": "We found nothing. Try another word.",
  "admin.help.link": "Help",

  "admin.help.section.start": "Getting started",
  "admin.help.section.drive": "Drive, Capture One and new photos",
  "admin.help.section.albums": "Albums, photos and cover",
  "admin.help.section.access": "PIN and access",
  "admin.help.section.proof": "Proofs, downloads and favorites",
  "admin.help.section.clients": "Clients",
  "admin.help.section.versions": "Versions and TIFF",
  "admin.help.section.trouble": "Something is wrong",

  // Getting started
  "admin.help.start-what.q": "What is this app for?",
  "admin.help.start-what.a":
    "It delivers your photos to clients in an online gallery with your brand. You export the photos from Capture One to a Google Drive folder and the app builds the galleries by itself.",
  "admin.help.start-overview.q": "What are the steps, start to finish?",
  "admin.help.start-overview.s1": "Connect Google Drive in {settings}.",
  "admin.help.start-overview.s2":
    "Pick the Drive folder where you keep your shoots.",
  "admin.help.start-overview.s3": "Export your photos from Capture One to it.",
  "admin.help.start-overview.s4":
    "Wait a few minutes, or tap {syncNow} to make them appear.",
  "admin.help.start-overview.s5":
    "Open the album, check the photos and tap {publish}.",
  "admin.help.start-overview.s6":
    "Copy the link in {share} and send it to your client.",
  "admin.help.start-who-sees.q": "What does the client see, and what only me?",
  "admin.help.start-who-sees.a":
    "The client sees the photos, can mark favorites and can download them if you allow it. Only you see this panel, the visits, the downloads, each person's favorites and the notices.",
  "admin.help.start-language.q": "In which language does everything show?",
  "admin.help.start-language.a":
    "This panel has an ES / EN switch under the menu. Your clients see the gallery in their browser's language and can change it at the bottom of the page.",
  "admin.help.start-brand.q": "How do I change the studio name or logo?",
  "admin.help.start-brand.a":
    "The logo can be PNG, JPEG, WebP or a simple SVG, up to 512 KB. Without a logo the studio name is shown.",
  "admin.help.start-brand.s1": "Go to {settings}.",
  "admin.help.start-brand.s2":
    "Type the name in {brandName} and tap {saveName}.",
  "admin.help.start-brand.s3":
    "For the logo, tap {upload} and choose the file.",

  // Drive, Capture One and new photos
  "admin.help.drive-connect.q": "How do I connect Google Drive?",
  "admin.help.drive-connect.a":
    "You only do it once. If Google shows a warning about an unverified app, that is normal: go on.",
  "admin.help.drive-connect.s1": "Go to {settings}.",
  "admin.help.drive-connect.s2": "In the Google Drive section, tap {connect}.",
  "admin.help.drive-connect.s3":
    "Pick your Google account and accept the read-only permission.",
  "admin.help.drive-connect.s4":
    "You are back in the panel and under the menu it says {connected}.",
  "admin.help.drive-readonly.q":
    "Does the app change or delete anything in my Drive?",
  "admin.help.drive-readonly.a":
    "No. The app only reads your folder: it never uploads, changes or deletes files. It does not resize or edit photos either: every size comes from Capture One.",
  "admin.help.drive-root.q": "How do I pick the Drive folder?",
  "admin.help.drive-root.a": "Every folder inside it becomes an album.",
  "admin.help.drive-root.s1":
    "In Google Drive, open the folder where you keep your shoots.",
  "admin.help.drive-root.s2": "Copy its link from the browser bar.",
  "admin.help.drive-root.s3": "In {settings}, paste it into {rootLabel}.",
  "admin.help.drive-root.s4": "Tap {rootSave}.",
  "admin.help.drive-root-change.q":
    "What happens if I change the Drive folder?",
  "admin.help.drive-root-change.a":
    "Albums that are not in the new folder are archived after 1 hour. They are not deleted: you find them under {archived}. If the folder comes back, the albums come back by themselves.",
  "admin.help.drive-folders.q": "Which folders must Capture One create?",
  "admin.help.drive-folders.a":
    "One folder per size, inside the album folder. Only `high-res` is required. If `web` or `thumb` is missing, the largest size available is used.",
  "admin.help.drive-folders.s1":
    "`high-res`: 2048 px on the long side. The big photo.",
  "admin.help.drive-folders.s2":
    "`web`: 1200 px. Shown on phones, and the Web download.",
  "admin.help.drive-folders.s3":
    "`thumb`: 600 px. The small pictures of the grid.",
  "admin.help.drive-folders.s4":
    "`ig`: 1080 px. Optional: without it there is no Instagram download.",
  "admin.help.drive-folders.s5":
    "`preview-wm`: 2048 px with watermark. Optional: what proof galleries show.",
  "admin.help.drive-folders.s6":
    "`thumb-wm`: 600 px with watermark. Optional: small pictures of proof galleries.",
  "admin.help.drive-names.q": "How do I organize and name the files in Drive?",
  "admin.help.drive-names.a":
    "Inside the root folder goes one folder per album, and inside it one per size. Each photo must have the same name in every folder, for example `IMG_001.jpg`. That is how the app knows which files are the same photo.",
  "admin.help.drive-captureone.q": "How do I set up Capture One just once?",
  "admin.help.drive-captureone.s1":
    "Create one process recipe per size, as JPEG with the sRGB profile.",
  "admin.help.drive-captureone.s2": "Turn on all the recipes.",
  "admin.help.drive-captureone.s3":
    "As output location, pick the root folder inside Drive for desktop.",
  "admin.help.drive-captureone.s4":
    "In the sub folder field type `[Session Name]/high-res`, and the same with each recipe.",
  "admin.help.drive-captureone.s5": "Process: everything comes out at once.",
  "admin.help.drive-sets.q": "How do I split an album into sections?",
  "admin.help.drive-sets.a":
    "Create subfolders with the same name inside each size, for example `high-res/Ceremony` and `web/Ceremony`. Each one shows as a section with its own tab. Loose photos go to the Highlights section.",
  "admin.help.updates-when.q": "When do new photos appear?",
  "admin.help.updates-when.a":
    "The app checks Drive by itself every 15 minutes. If you do not want to wait, tap {syncNow} in {settings}. New albums show up as {draft}. Before that, Drive for desktop must finish uploading the files.",
  "admin.help.updates-issues.q": "What are the notices about files?",
  "admin.help.updates-issues.a":
    "They are files the app could not use: unknown folders, files that are not JPEG, repeated names or missing sizes. You see them in the album list and, inside the album, in {photos}, section {issues}. Nothing is lost silently.",

  // Albums, photos and cover
  "admin.help.albums-create.q": "How do I create an album?",
  "admin.help.albums-create.a":
    "You do not create it by hand: every new folder inside the Drive root folder becomes an album when the app updates. It starts as {draft}, so nobody sees it until you publish it.",
  "admin.help.albums-publish.q": "How do I publish an album?",
  "admin.help.albums-publish.s1": "Open the album from {galleries}.",
  "admin.help.albums-publish.s2":
    "Tap {preview} to see what the client will see.",
  "admin.help.albums-publish.s3":
    "In the {details} tab, section {status}, tap {publish}.",
  "admin.help.albums-publish.s4": "Copy the link in {share} and send it.",
  "admin.help.albums-hide.q": "How do I hide an album without deleting it?",
  "admin.help.albums-hide.a":
    "Tap {toDraft}: the link stops opening. {archive} puts it away and {restore} brings it back. Clients only see {published} albums that have not expired.",
  "admin.help.albums-details.q":
    "How do I change the title, date or web address?",
  "admin.help.albums-details.a":
    "If you change the web address, the links and QR codes you already sent stop working.",
  "admin.help.albums-details.s1": "Open the album, {details} tab.",
  "admin.help.albums-details.s2":
    "Change {title}, {eventDate} or {addressField}.",
  "admin.help.albums-details.s3": "Tap {save}.",
  "admin.help.albums-expiry.q": "How do I make an album expire?",
  "admin.help.albums-expiry.a":
    "After that date clients see {unavailable}. Empty means it never expires; with no time, it expires at 23:59.",
  "admin.help.albums-expiry.s1": "Open the album, {details} tab.",
  "admin.help.albums-expiry.s2":
    "Fill in {expiresDate} and, if you want, {expiresTime}.",
  "admin.help.albums-expiry.s3": "Tap {save}.",
  "admin.help.albums-expiry.s4":
    "To reopen an expired album, set another date or leave it empty, and save.",
  "admin.help.albums-home.q": "How do I show an album on the home page?",
  "admin.help.albums-home.a":
    "It only works with albums that are published, have no PIN and have not expired.",
  "admin.help.albums-home.s1": "Open the album, {details} tab.",
  "admin.help.albums-home.s2": "In {homeSection}, tick {homeLabel}.",
  "admin.help.albums-home.s3": "Tap {homeSave}.",
  "admin.help.albums-share.q": "How do I share the album with my client?",
  "admin.help.albums-share.a":
    "The album must be published. If it has a PIN, send the PIN separately.",
  "admin.help.albums-share.s1": "Open the album and go to {share}.",
  "admin.help.albums-share.s2": "Tap {copy} to copy the link.",
  "admin.help.albums-share.s3": "Or tap {whatsapp} to send it by WhatsApp.",
  "admin.help.albums-share.s4":
    "To print, download the QR code with {qrSvg} or {qrPng}.",
  "admin.help.albums-share.s5":
    "Or open {card}: it has the QR, the title and your logo.",
  "admin.help.albums-design.q":
    "How do I change the colors and design of the gallery?",
  "admin.help.albums-design.s1": "Open the album, {design} tab.",
  "admin.help.albums-design.s2":
    "Pick {palette}, {coverLayout}, {grid} and {gap}.",
  "admin.help.albums-design.s3":
    "Look at the preview: it changes at once, before saving.",
  "admin.help.albums-design.s4": "Tap {saveDesign}.",
  "admin.help.albums-delete.q": "How do I delete an album?",
  "admin.help.albums-delete.a":
    "The album and all its data are deleted: favorites, visits, downloads and PIN. Your Drive files are not touched. It cannot be undone.",
  "admin.help.albums-delete.s1": "Open the album, {details} tab.",
  "admin.help.albums-delete.s2": "Scroll down to {danger}.",
  "admin.help.albums-delete.s3": "Type the album's web address to confirm.",
  "admin.help.albums-delete.s4": "Tap {deleteButton}.",
  "admin.help.albums-delete.s5":
    "To create it again from zero: in {settings}, section {ignored}, tap {reinclude}.",
  "admin.help.photos-order.q": "How do I change the order of the photos?",
  "admin.help.photos-order.s1": "Open the album, {photos} tab.",
  "admin.help.photos-order.s2":
    "Drag a thumbnail, or select it and move it with the move buttons.",
  "admin.help.photos-order.s3": "Or tap {sortDate} or {sortName}.",
  "admin.help.photos-order.s4": "Tap {saveOrder}: changes apply when you save.",
  "admin.help.photos-cover.q": "How do I choose the cover photo?",
  "admin.help.photos-cover.a": "If you choose none, the first photo is used.",
  "admin.help.photos-cover.s1": "Open the album, {photos} tab.",
  "admin.help.photos-cover.s2":
    "Tap a thumbnail (on a computer, hover over it).",
  "admin.help.photos-cover.s3": "Tap {useCover}.",
  "admin.help.photos-focal.q":
    "How do I stop the cover from cutting off a face?",
  "admin.help.photos-focal.a":
    "The focal point is the area that always stays in view when the cover is cropped.",
  "admin.help.photos-focal.s1": "Open the album, {cover} tab.",
  "admin.help.photos-focal.s2": "Tap the photo where the important part is.",
  "admin.help.photos-focal.s3":
    "Check below how it looks on desktop and on phone.",
  "admin.help.photos-focal.s4": "Tap {saveFocal}.",
  "admin.help.photos-mobile-cover.q": "Can I use a different cover for phones?",
  "admin.help.photos-mobile-cover.a":
    "Yes. In {cover}, pick {mobileCover}, tap {chooseMobile} and choose a photo, which can be the same one. If you choose none, phones use the desktop cover.",

  // PIN and access
  "admin.help.access-pin-album.q": "How do I put a PIN on an album?",
  "admin.help.access-pin-album.a":
    "The PIN has between {pinMin} and {pinMax} characters. Anyone with the link will have to type it to see the photos.",
  "admin.help.access-pin-album.s1": "Open the album, {details} tab.",
  "admin.help.access-pin-album.s2":
    "In {pinSection}, type the PIN in {pinNew}.",
  "admin.help.access-pin-album.s3":
    "Tap {pinSave} (or {pinChange} if it already had one).",
  "admin.help.access-pin-change.q": "What happens if I change or remove a PIN?",
  "admin.help.access-pin-change.a":
    "People who were already in must type the new PIN. Download links you already sent stop working. With {pinRemove}, the album is open to anyone with the link.",
  "admin.help.access-pin-client.q":
    "How do I put a PIN on all of a client's albums?",
  "admin.help.access-pin-client.a":
    "Whoever types that PIN once opens all the client's albums. If an album has its own PIN, it still asks for it, after the client PIN.",
  "admin.help.access-pin-client.s1": "Go to {clients} and open the client.",
  "admin.help.access-pin-client.s2": "In {clientPin}, type the PIN.",
  "admin.help.access-pin-client.s3": "Tap {pinSave}.",
  "admin.help.access-email.q":
    "Can I ask for the email of whoever views the album?",
  "admin.help.access-email.a":
    "Yes. In {options}, tick {requireEmail} and tap {saveOptions}. The first time someone downloads or marks a favorite, they must leave their email. You then see it in {activity} and {favorites}.",

  // Proofs, downloads and favorites
  "admin.help.proof-modes.q":
    "What is the difference between {delivery} and {proofing}?",
  "admin.help.proof-modes.s1":
    "{delivery}: photos have no watermark and the client can download them.",
  "admin.help.proof-modes.s2":
    "{proofing}: everything has a watermark and there are no downloads. The client only picks favorites.",
  "admin.help.proof-setup.q":
    "How do I set up a proof gallery with a watermark?",
  "admin.help.proof-setup.a":
    "Capture One adds the watermark, not the app. A new album that already has a `preview-wm` folder starts in {proofing}.",
  "admin.help.proof-setup.s1":
    "In Capture One, export the `preview-wm` recipe with your watermark.",
  "admin.help.proof-setup.s2":
    "If you want, also export `thumb-wm` (light small pictures).",
  "admin.help.proof-setup.s3":
    "Open the album and in {options} choose {proofing}.",
  "admin.help.proof-setup.s4": "Tap {saveOptions}.",
  "admin.help.proof-sizes.q": "Which sizes can the client download?",
  "admin.help.proof-sizes.a":
    "You choose what to offer in {options} and save with {saveOptions}. With {bulk}, they can get everything or one section in a single file. The biggest is 2048 px: fine for screens, not for big prints.",
  "admin.help.proof-sizes.s1": "{highres}: the biggest and best quality.",
  "admin.help.proof-sizes.s2": "{web}: light, good for sending by chat.",
  "admin.help.proof-sizes.s3":
    "{ig}: made for Instagram. Only offered if you exported `ig`.",
  "admin.help.proof-favorites.q": "How do clients mark favorites?",
  "admin.help.proof-favorites.a":
    "They tap the heart on each photo. There is no send button: you see what they marked in {favorites}. Each phone or computer has its own list; if the person used the same email on two, it shows as one.",
  "admin.help.proof-favorites-see.q":
    "How do I see the favorites and take them to Capture One?",
  "admin.help.proof-favorites-see.s1": "Open the album, {favorites} tab.",
  "admin.help.proof-favorites-see.s2": "See who marked each photo.",
  "admin.help.proof-favorites-see.s3": "Tap {copyCapture} (or {downloadTxt}).",
  "admin.help.proof-favorites-see.s4":
    "In Capture One, paste the text into the search filter.",
  "admin.help.proof-activity.q":
    "How do I see who looked at or downloaded my photos?",
  "admin.help.proof-activity.a":
    "In the album, go to {activity}: you see visits, downloads, country and device. {exportCsv} saves them to a spreadsheet. In the {galleries} list, on a computer, there are the {views} and {downloads} columns. We never store anyone's IP address.",

  // Clients
  "admin.help.clients-create.q": "How do I create a client?",
  "admin.help.clients-create.a":
    "A client gathers several albums under one address: `/client/album`. It is optional.",
  "admin.help.clients-create.s1": "Go to {clients}.",
  "admin.help.clients-create.s2": "Fill in {name}.",
  "admin.help.clients-create.s3": "Tap {create}.",
  "admin.help.clients-assign.q": "How do I put an album inside a client?",
  "admin.help.clients-assign.a":
    "The album now opens at `/client/album`; the old address leads to the new one.",
  "admin.help.clients-assign.s1": "Open the album, {details} tab.",
  "admin.help.clients-assign.s2": "In {clientFolder}, pick the client.",
  "admin.help.clients-assign.s3": "Tap {save}.",
  "admin.help.clients-page.q":
    "What does the client see on their page, and how do I turn it off?",
  "admin.help.clients-page.a":
    "They see the list of their published albums, with covers. Albums with a PIN show without a cover and ask for the PIN. To turn it off, untick {pageEnabled} and tap {saveClient}: the page stops existing and visitors see an error.",
  "admin.help.clients-defaults.q": "What are a client's default values?",
  "admin.help.clients-defaults.a":
    "They are the mode ({delivery} or {proofing}) and whether their albums show on the home page. They are copied to an album when you put it in that client. To repeat them on all albums, tap {applyAll}; PIN and downloads do not change.",
  "admin.help.clients-delete.q": "What happens if I delete a client?",
  "admin.help.clients-delete.a":
    "Their albums are not deleted: they have no client and keep their own address. The client, its page and its PIN are deleted, so that PIN no longer protects them.",
  "admin.help.clients-delete.s1": "Open the client from {clients}.",
  "admin.help.clients-delete.s2": "Scroll down to {dangerClient}.",
  "admin.help.clients-delete.s3": "Type the client's address to confirm.",
  "admin.help.clients-delete.s4": "Tap {deleteClient}.",

  // Versions and TIFF
  "admin.help.versions-what.q": "What are versions for?",
  "admin.help.versions-what.a":
    "They are for retouching agencies that send several rounds of the same photo. The client always sees the latest version, and can look at older ones, compare them and approve. It is off by default: you turn it on album by album.",
  "admin.help.versions-on.q": "How do I turn on versions in an album?",
  "admin.help.versions-on.a":
    "Careful: if the album was already loaded, a photo called `IMG_v2` is replaced by version 2 of `IMG`. It loses its favorites and its use as cover.",
  "admin.help.versions-on.s1": "Open the album, {details} tab.",
  "admin.help.versions-on.s2": "In {versionsSection}, tick {versionsLabel}.",
  "admin.help.versions-on.s3": "Tap {versionsSave}.",
  "admin.help.versions-on.s4":
    "Tap {syncNow} in {settings}: the first time it reads the versions again.",
  "admin.help.versions-names.q": "How do I name the versions?",
  "admin.help.versions-names.a":
    "Add `_v2`, `_v3` and so on to the name: `IMG_0123_v2.jpg`. No suffix means version 1. A `v2/` folder with the same size folders inside also works. If both exist, the suffix wins.",
  "admin.help.versions-rounds.q": "What is a round?",
  "admin.help.versions-rounds.a":
    "Each time the agency sends new versions, that is a round. Each round brings only the photos that changed: a photo already approved is not sent again. The client sees the round number on top and {newInRound} on the new photos.",
  "admin.help.versions-compare.q": "How does the client see earlier versions?",
  "admin.help.versions-compare.a":
    "Opening a photo with several versions shows its history. There they can see each version and compare it with the previous one: {flip} to go back and forth, or {slide} to see before and after on the same photo.",
  "admin.help.versions-approvals.q":
    "How does the client approve a photo, and how do I see it?",
  "admin.help.versions-approvals.a":
    "The client opens the photo and taps the approve button, which shows the version. A new version goes back to waiting for review. You see how many are approved in {photos}, section {approvals}. Approving is not needed to download.",
  "admin.help.versions-tiff.q": "How do I deliver TIFF files?",
  "admin.help.versions-tiff.a":
    "Put the TIFF files in a `tiff` folder (or in `high-res`). Browsers cannot show TIFF: for the photo to be visible, also export a JPEG into `web`. The client downloads the TIFF from the photo, one at a time.",
  "admin.help.versions-tiff-client.q":
    "What does the client see if there is only a TIFF?",
  "admin.help.versions-tiff-client.a":
    "A card that says {tiffCard} and the {tiffDownload} button: there is no picture to look at. If everything is TIFF, the album has no cover and does not show on the home page. On the client's page it shows only with its title and {tiffDelivery}.",

  // Something is wrong
  "admin.help.trouble-photo-missing.q": "I cannot see a photo in the gallery",
  "admin.help.trouble-photo-missing.a":
    "Check in Drive that it is in `high-res`, that it is a JPEG and that it has the same name in every folder. Then tap {syncNow}. If something fails, it is noted in {issues}. If you deleted it from Drive, it is hidden and the app really removes it after 1 hour.",
  "admin.help.trouble-order.q": "The photos are in a different order",
  "admin.help.trouble-order.a":
    "The order is changed by hand. In {photos}, drag the thumbnails and tap {saveOrder}.",
  "admin.help.trouble-old-photo.q":
    "I changed a photo but the old one still shows",
  "admin.help.trouble-old-photo.a":
    "Export with the same file name and wait until Drive finishes uploading it. The app notices it at its next update. The browser may keep the old photo for up to 10 minutes: ask the client to reload the page.",
  "admin.help.trouble-blank-proof.q":
    "In {proofing} mode the client sees blank photos",
  "admin.help.trouble-blank-proof.a":
    "Those photos have no file in `preview-wm`. Export that recipe again and update. Without that file the app never shows the photo without a watermark.",
  "admin.help.trouble-pin.q": "The client says the PIN does not work",
  "admin.help.trouble-pin.a":
    "Ask them to type it exactly as you saved it. If both the client and the album have a PIN, they must type both, one after the other. After 5 wrong tries they must wait a few minutes. If you changed it recently, they must use the new one.",
  "admin.help.trouble-download.q": "The client cannot download",
  "admin.help.trouble-download.s1":
    "The album is in {proofing}: no downloads. Switch it to {delivery} in {options}.",
  "admin.help.trouble-download.s2":
    "That size is turned off: tick it in {options} and tap {saveOptions}.",
  "admin.help.trouble-download.s3":
    "It asks for an email and the person did not type one.",
  "admin.help.trouble-download.s4":
    "They used an old link: they last about 10 minutes and stop working when the PIN changes. Tap download again.",
  "admin.help.trouble-download.s5":
    "On iPhone and iPad big downloads can fail: download by section or from a computer.",
  "admin.help.trouble-link.q": "The link does not open or says {unavailable}",
  "admin.help.trouble-link.a":
    "That screen shows if the album is a draft, is archived or has expired. Check its status and date in the album. If you changed the web address, the old link no longer works: send the new one from {share}.",
  "admin.help.trouble-back-button.q":
    "The button to go back to the client page is missing",
  "admin.help.trouble-back-button.a":
    "It only shows if the person came from the client's page. If they opened the album link directly, it is not shown. Send them the address of the client's page so they enter from there.",
  "admin.help.trouble-sync-error.q": "The menu shows an error after updating",
  "admin.help.trouble-sync-error.a":
    "It is usually a connection problem with Google. Tap {syncNow} again. If it keeps happening, connect Google again in {settings} with {reconnect}.",
  "admin.help.trouble-home.q": "My album does not show on the home page",
  "admin.help.trouble-home.a":
    "It must be published, have no PIN, not be expired and have {homeLabel} ticked in {details}. In {proofing} mode it also needs a cover with a watermark. A client's page needs at least one published album with a cover.",
} as const satisfies Record<keyof typeof esHelp, string>;
