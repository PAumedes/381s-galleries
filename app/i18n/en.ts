import type { es } from "./es";

export const en = {
  "gallery.view": "View gallery",
  "gallery.all": "All",
  "gallery.sets": "Sections",
  "gallery.share": "Share",
  "pwa.ios": "Tap Share, then 'Add to Home Screen'",
  "pwa.install": "Add to Home Screen",
  "pwa.dismiss": "Close",
  "pwa.androidText": "Keep this gallery one tap away on your home screen",
  "gallery.linkCopied": "Link copied",

  "pin.placeholder": "PIN",
  "pin.submit": "Enter",
  "pin.wrong": "Wrong PIN",
  "pin.tooManyAttempts":
    "Too many attempts. Please try again in a few minutes.",
  "pin.forbidden": "Request not allowed.",

  "unavailable.title": "Gallery unavailable",
  "unavailable.message": "This gallery is not available right now.",

  "favorites.title": "Favorites",
  "favorites.add": "Add to favorites",
  "favorites.remove": "Remove from favorites",
  "favorites.empty": "You haven't marked any photos yet.",

  "favorites.tab": "Favorites {n}",
  "favorites.error": "Couldn't save your favorite. Please try again.",

  "download.title": "Download",
  "download.photo": "Download photo",
  "download.highres": "High resolution · 2048 px",
  "download.web": "Web · 1200 px",
  "download.ig": "Instagram · 1080 px",
  "download.scope": "What to download",
  "download.scopeAll": "Entire gallery",
  "download.scopeSet": "Section · {set}",
  "download.scopeFavorites": "Favorites",
  "download.size": "Size",
  "download.count.one": "{n} photo",
  "download.count.other": "{n} photos",
  "download.approx": "approx. {size}",
  "download.start": "Download",
  "download.cancel": "Cancel",
  "download.progress": "{done} / {total}",
  "download.waiting": "Waiting… resuming in {n} s",
  "download.done": "Download complete",
  "download.cancelled": "Download cancelled",
  "download.failed.one": "{n} file couldn't be downloaded",
  "download.failed.other": "{n} files couldn't be downloaded",
  "download.warnLarge":
    "This download is large and your browser will hold it in memory. Download by section or use a computer.",
  "download.warnIos":
    "Large downloads can fail on iPhone and iPad. Download by section or use a computer.",
  "download.pickerFailed": "Couldn't open the save dialog. Continue in memory?",
  "download.error": "Couldn't download. Please try again.",
  "download.confirmCancel": "Cancel the download?",
  "download.yes": "Yes",
  "download.no": "No",
  "download.continue": "Continue",

  "gate.title": "Enter your email to continue",
  "gate.placeholder": "Email",
  "gate.submit": "Continue",
  "gate.reason": "To save your favorites",
  "gate.name": "Name (optional)",
  "gate.error": "Something went wrong. Please try again.",
  "gate.invalid": "Enter a valid email",

  "grid.photo": "Photo {n}",

  "lightbox.close": "Close",
  "lightbox.previous": "Previous",
  "lightbox.next": "Next",
  "lightbox.counter": "{n} / {total}",
  "lightbox.loadError": "Couldn't load image",
  "lightbox.retry": "Retry",

  "error.notFound.title": "404",
  "error.notFound.message": "We couldn't find the page you're looking for.",
  "error.generic.title": "Error",
  "error.generic.message": "An unexpected error occurred.",
  "error.home": "Back to home",

  "footer.langEs": "ES",
  "footer.langEn": "EN",
  "footer.language": "Language",
  "footer.copyright": "© {year} {studio}",

  "footer.privacy": "Privacy",
  "privacy.title": "Privacy",
  "privacy.back": "Back to home",
  "privacy.who.title": "Who runs this",
  "privacy.who.body":
    "This app is run by {studio} to deliver photos to its clients.",
  "privacy.access.title": "What the app accesses",
  "privacy.access.body":
    "It only reads (read-only access) the studio's own Google Drive folder that holds the photos. It does not access any Google data of clients or visitors.",
  "privacy.stored.title": "What we store about visitors",
  "privacy.stored.body":
    "The email and name you optionally enter to use favorites or downloads, your favorites, and download and view logs with the country and a hashed IP. We use cookies for gallery access and to remember your language.",
  "privacy.purpose.title": "Why",
  "privacy.purpose.body":
    "To deliver the photos and to let the studio see activity on each gallery.",
  "privacy.retention.title": "How long",
  "privacy.retention.body": "Until the studio deletes the gallery.",
  "privacy.sharing.title": "Selling and third parties",
  "privacy.sharing.body": "We do not sell or share your data.",
  "privacy.contact.title": "Contact",
  "privacy.contact.generic":
    "For questions, contact the studio through the usual channels.",
  "privacy.contact.lead": "For questions, write to",
} as const satisfies Record<keyof typeof es, string>;
