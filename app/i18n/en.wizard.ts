/**
 * First-run wizard for the studio owner (T6.58), English. Same keys and
 * placeholders as es.wizard.ts (tests compare them).
 */
import type { esWizard } from "./es.wizard";

export const enWizard = {
  "admin.nav.wizard": "Get started",
  "admin.meta.wizard": "First steps",
  "admin.wizard.title": "First steps",
  "admin.wizard.intro":
    "Six short steps to get everything ready. Skip the ones you do not need and come back any time.",
  "admin.wizard.steps": "All the steps",
  "admin.wizard.progress": "Step {n} of {total}",
  "admin.wizard.state.done": "Done",
  "admin.wizard.state.todo": "To do",
  "admin.wizard.state.optional": "Optional",
  "admin.wizard.state.read": "To read",
  "admin.wizard.back": "Back",
  "admin.wizard.next": "Next",
  "admin.wizard.skip": "Skip this step",
  "admin.wizard.finish": "Finish",
  "admin.wizard.goStep": "Go to step {n}",
  "admin.wizard.moreHelp": "More help: {title}",
  "admin.wizard.helpLink": "First time here? Follow the first steps guide.",
  "admin.wizard.banner.title": "First steps",
  "admin.wizard.banner.text":
    "In six short steps we show you how to connect Drive, create your first client and your first gallery, and send the link.",
  "admin.wizard.banner.open": "Open the guide",
  "admin.wizard.banner.dismiss": "Do not show again",

  "admin.wizard.drive.connected": "Google Drive is connected.",
  "admin.wizard.drive.notConnected": "You have not connected Google Drive yet.",
  "admin.wizard.drive.root": "Chosen folder: {root}",
  "admin.wizard.drive.noRoot": "You still need to choose your sessions folder.",
  "admin.wizard.drive.openSettings": "Open Settings",
  "admin.wizard.drive.title": "Connect Google Drive",
  "admin.wizard.drive.a":
    "That is where your photos live. The app only looks at them: it never changes or deletes them.",
  "admin.wizard.drive.l1": "Tap {connect} and accept the Google permission.",
  "admin.wizard.drive.l2":
    "Then, in {settings}, paste the link of your sessions folder into {rootLabel}.",
  "admin.wizard.drive.l3": "Tap {rootSave}.",

  "admin.wizard.folders.title": "Set up your folders in Capture One",
  "admin.wizard.folders.a":
    "Each session is a folder inside your Drive folder. Inside it, Capture One saves one folder for each photo size.",
  "admin.wizard.folders.l1": "One folder per session, for example `Boda-Ana`.",
  "admin.wizard.folders.l2":
    "Inside, only `high-res` is required: it is the big photo.",
  "admin.wizard.folders.l3":
    "`web` and `thumb` make it load faster, and `ig` adds the Instagram download.",
  "admin.wizard.folders.l4":
    "For a proofing gallery add `preview-wm`: the photos with a watermark.",

  "admin.wizard.client.title": "Create your first client",
  "admin.wizard.client.a":
    "A client gathers all their galleries under one address. It is optional: if you do not need it, skip this step.",
  "admin.wizard.client.l1":
    "Type your client name, for example Ana and Martin.",
  "admin.wizard.client.l2":
    "Then put each gallery in its client from {details}, in {clientFolder}.",
  "admin.wizard.client.hint": "It is the name you will see in your list.",
  "admin.wizard.client.none": "You have not created any client yet.",
  "admin.wizard.client.some.one": "You already have {count} client.",
  "admin.wizard.client.some.other": "You already have {count} clients.",

  "admin.wizard.gallery.title": "Create your first gallery",
  "admin.wizard.gallery.a":
    "It is not created by hand: every new Drive folder becomes a gallery. The app checks Drive by itself every {syncMinutes} minutes.",
  "admin.wizard.gallery.l1":
    "Export the photos of a session from Capture One to your Drive folder.",
  "admin.wizard.gallery.l2": "If you do not want to wait, tap {syncNow}.",
  "admin.wizard.gallery.l3":
    "A new gallery starts as {draft}: nobody sees it until you publish it.",
  "admin.wizard.gallery.none": "No gallery has shown up yet.",
  "admin.wizard.gallery.some.one": "We found {count} gallery:",
  "admin.wizard.gallery.some.other": "We found {count} galleries:",
  "admin.wizard.gallery.more": "and {count} more",
  "admin.wizard.gallery.needDrive":
    "First connect Google Drive, so the app can see your folders.",

  "admin.wizard.settings.title": "Pick the most important settings",
  "admin.wizard.settings.a":
    "You change them inside the gallery, in the {details} tab. Each line shows how it is today.",
  "admin.wizard.settings.l1":
    "Publish: with {publish} your client can see the gallery.",
  "admin.wizard.settings.l2":
    "PIN: a code of {pinMin} to {pinMax} characters to get in.",
  "admin.wizard.settings.l3":
    "{proofing} has a watermark and no downloads; {delivery} hands over clean photos.",
  "admin.wizard.settings.l4":
    "Downloads: you choose which sizes your client can save, in {options}.",
  "admin.wizard.settings.l5":
    "Expiry: with {expiresDate}, after that day the gallery stops showing.",
  "admin.wizard.settings.noGallery": "There is no gallery to set up yet.",
  "admin.wizard.settings.for": "Gallery: {title}",
  "admin.wizard.settings.open": "Open the gallery",
  "admin.wizard.settings.now": "Now: {value}",
  "admin.wizard.val.pinOn": "with PIN",
  "admin.wizard.val.pinOff": "no PIN",
  "admin.wizard.val.dlOn": "downloads allowed",
  "admin.wizard.val.dlOff": "no downloads",
  "admin.wizard.val.expiryNone": "never expires",
  "admin.wizard.val.expiryAt": "expires on {date}",

  "admin.wizard.share.title": "Send the link to your client",
  "admin.wizard.share.a":
    "Once the gallery is published, copy its link and send it by WhatsApp or email.",
  "admin.wizard.share.l1": "The gallery link opens only that gallery.",
  "admin.wizard.share.l2":
    "If you use a client, their page gathers all their published galleries.",
  "admin.wizard.share.l3":
    "The QR and the printable card are in {share}, inside the gallery.",
  "admin.wizard.share.noGallery": "There is no gallery to share yet.",
  "admin.wizard.share.draft":
    "This gallery is still a draft: publish it before sending the link.",
  "admin.wizard.share.linkLabel": "Gallery link",
  "admin.wizard.share.clientLinkLabel": "Client page link",
} as const satisfies Record<keyof typeof esWizard, string>;
