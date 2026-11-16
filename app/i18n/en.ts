import type { es } from "./es";

export const en = {
  "gallery.view": "View gallery",
  "gallery.all": "All",
  "gallery.sets": "Sections",
  "gallery.share": "Share",
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
} as const satisfies Record<keyof typeof es, string>;
