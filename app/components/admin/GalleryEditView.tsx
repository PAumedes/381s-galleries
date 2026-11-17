import { useId, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import type {
  GalleryActionResult,
  loadGalleryEdit,
} from "../../lib/server/admin-galleries";
import type { Design } from "../../lib/design";
import { CoverPreview } from "./CoverPreview";
import { DesignPanel } from "./DesignPanel";
import { GalleryTabs } from "./GalleryTabs";
import { StatusPill } from "./GalleryList";
import { PhotoReorder } from "./PhotoReorder";
import { SharePanel } from "./SharePanel";

export type GalleryEditData = NonNullable<
  Awaited<ReturnType<typeof loadGalleryEdit>>
>;

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const btnPrimary = `${btn} bg-ink text-paper`;
const inputCls =
  "border-grey-300 bg-white w-full border px-3 py-2 text-body aria-invalid:border-ink aria-invalid:border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-grey-200 flex flex-col gap-3 border-t pt-6">
      <h2 className="text-micro text-grey-700 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Feedback({
  data,
  intent,
}: {
  data: GalleryActionResult | undefined;
  intent: string;
}) {
  if (!data || data.intent !== intent) return null;
  if (!data.ok)
    return (
      <p role="alert" className="border-ink border p-3 text-small">
        {data.error}
      </p>
    );
  return data.message ? (
    <p className="text-small text-grey-700">{data.message}</p>
  ) : null;
}

/** Label + control + inline error/hint wiring (aria-invalid, aria-describedby). */
function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (p: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errId, hint && hintId]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small">
        {label}
      </label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-small text-grey-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-small text-ink font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

function Check({
  name,
  label,
  checked,
  disabled,
  describedBy,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        className="size-4"
      />
      <label htmlFor={id} className="text-small">
        {label}
      </label>
    </div>
  );
}

export function GalleryEditView({
  data,
  origin,
  actionData,
}: {
  data: GalleryEditData;
  origin?: string;
  actionData: GalleryActionResult | undefined;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const g = data.gallery;
  const errs = (intent: string) =>
    actionData && actionData.intent === intent && !actionData.ok
      ? (actionData.fieldErrors ?? {})
      : {};
  const de = errs("details");
  const pe = errs("pin");
  const fe = errs("flags");
  const ge = errs("design");
  const [mode, setMode] = useState<"proofing" | "delivery">(g.mode);
  const proofing = mode === "proofing";
  const [title, setTitle] = useState(g.title);
  const [eventDate, setEventDate] = useState(g.eventDate ?? "");
  const [design, setDesign] = useState<Design>({
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
  });
  // Not offered while the home query would hide the gallery anyway.
  const homeBlocked = g.hasPin || g.status !== "published";
  const coverId = g.coverPhotoId ?? data.photos[0]?.id ?? null;
  const coverPhoto = data.photos.find((p) => p.id === coverId);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to="/admin"
          className="text-micro text-grey-700 uppercase hover:text-ink"
        >
          ← Galerías
        </Link>
        <h1 className="text-title text-ink">{g.title}</h1>
        <StatusPill status={g.status} />
      </div>
      <GalleryTabs id={g.id} current="datos" />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <Section title="Datos">
            <CoverPreview
              key={coverId ?? "none"}
              title={title}
              eventDate={eventDate || null}
              palette={design.palette}
              coverLayout={design.coverLayout}
              proofing={proofing}
              coverId={coverId}
              coverWidth={coverPhoto?.width ?? null}
              coverHeight={coverPhoto?.height ?? null}
              initialFocus={g.coverFocus}
              actionData={actionData}
            />
            <Form
              method="post"
              className="flex flex-col gap-4"
              onSubmit={(ev) => {
                const slug = (
                  ev.currentTarget.elements.namedItem(
                    "slug",
                  ) as HTMLInputElement
                ).value
                  .trim()
                  .toLowerCase();
                if (
                  slug !== g.slug &&
                  !window.confirm(
                    "Cambiar el slug rompe los enlaces y códigos QR ya compartidos. ¿Continuar?",
                  )
                )
                  ev.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="details" />
              <Field label="Título" error={de.title}>
                {(p) => (
                  <input
                    {...p}
                    name="title"
                    required
                    maxLength={120}
                    value={title}
                    onChange={(ev) => setTitle(ev.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field
                label="Slug"
                error={de.slug}
                hint="Si cambiás el slug, los enlaces y códigos QR ya compartidos dejarán de funcionar."
              >
                {(p) => (
                  <input
                    {...p}
                    name="slug"
                    required
                    maxLength={60}
                    autoComplete="off"
                    spellCheck={false}
                    defaultValue={g.slug}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field
                label="Cliente (solo para vos)"
                error={de.clientName}
                hint="Solo lo ves vos en el panel: no se muestra a los clientes ni a quien abra la galería."
              >
                {(p) => (
                  <input
                    {...p}
                    name="clientName"
                    maxLength={120}
                    defaultValue={g.clientName ?? ""}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field label="Fecha del evento" error={de.eventDate}>
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    name="eventDate"
                    value={eventDate}
                    onChange={(ev) => setEventDate(ev.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Vence (fecha)">
                    {(p) => (
                      <input
                        {...p}
                        type="date"
                        name="expiresDate"
                        defaultValue={g.expires?.date ?? ""}
                        aria-invalid={de.expires ? true : undefined}
                        aria-describedby="expires-note"
                        className={inputCls}
                      />
                    )}
                  </Field>
                  <Field label="Vence (hora)">
                    {(p) => (
                      <input
                        {...p}
                        type="time"
                        name="expiresTime"
                        defaultValue={g.expires?.time ?? ""}
                        aria-invalid={de.expires ? true : undefined}
                        aria-describedby="expires-note"
                        className={inputCls}
                      />
                    )}
                  </Field>
                </div>
                <p id="expires-note" className="text-small text-grey-600">
                  Hora de Buenos Aires. Vacío = nunca vence. Sin hora, vence al
                  final del día.
                </p>
                {de.expires && (
                  <p role="alert" className="text-small text-ink font-medium">
                    {de.expires}
                  </p>
                )}
              </div>
              <div>
                <button type="submit" className={btnPrimary} disabled={busy}>
                  Guardar datos
                </button>
              </div>
              <Feedback data={actionData} intent="details" />
            </Form>
          </Section>

          <Section title="Diseño">
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="design" />
              <DesignPanel design={design} onChange={setDesign} errors={ge} />
              <p className="text-small text-grey-600">
                La tipografía es siempre Montserrat. La portada de arriba
                muestra los cambios al instante; se aplican al guardar.
              </p>
              <div>
                <button type="submit" className={btnPrimary} disabled={busy}>
                  Guardar diseño
                </button>
              </div>
              <Feedback data={actionData} intent="design" />
            </Form>
          </Section>

          <Section title="Compartir">
            <SharePanel
              url={`${origin ?? window.location.origin}/${g.slug}`}
              slug={g.slug}
              status={g.status}
              hasPin={g.hasPin}
              cardHref={`/admin/g/${g.id}/card`}
            />
          </Section>

          <Section title="Estado">
            <p className="text-small text-grey-700">
              Solo las galerías publicadas y sin vencer son visibles para los
              clientes.
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                {
                  draft: [
                    ["publish", "Publicar"],
                    ["archive", "Archivar"],
                  ],
                  published: [
                    ["draft", "Pasar a borrador"],
                    ["archive", "Archivar"],
                  ],
                  archived: [["restore", "Restaurar"]],
                } as const
              )[g.status].map(([to, label]) => (
                <Form method="post" key={to}>
                  <input type="hidden" name="intent" value="status" />
                  <input type="hidden" name="to" value={to} />
                  <button
                    type="submit"
                    className={to === "publish" ? btnPrimary : btn}
                    disabled={busy}
                  >
                    {label}
                  </button>
                </Form>
              ))}
            </div>
            <Feedback data={actionData} intent="status" />
          </Section>

          <Section title="PIN de acceso">
            <p className="text-body">{g.hasPin ? "PIN activo" : "Sin PIN"}</p>
            <p className="text-small text-grey-600">
              Cambiar o quitar el PIN cierra las sesiones de los clientes y
              anula los enlaces de descarga ya emitidos.
            </p>
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="pin" />
              <input type="hidden" name="mode" value="set" />
              <Field
                label="Nuevo PIN"
                error={pe.pin}
                hint="De 6 a 32 caracteres."
              >
                {(p) => (
                  <input
                    {...p}
                    type="password"
                    name="pin"
                    required
                    minLength={6}
                    maxLength={32}
                    autoComplete="new-password"
                    className={inputCls}
                  />
                )}
              </Field>
              <div>
                <button type="submit" className={btnPrimary} disabled={busy}>
                  {g.hasPin ? "Cambiar PIN" : "Guardar PIN"}
                </button>
              </div>
            </Form>
            {g.hasPin && (
              <Form method="post">
                <input type="hidden" name="intent" value="pin" />
                <input type="hidden" name="mode" value="remove" />
                <button type="submit" className={btn} disabled={busy}>
                  Quitar PIN
                </button>
              </Form>
            )}
            <Feedback data={actionData} intent="pin" />
          </Section>

          <Section title="Portada pública">
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="home" />
              {/* A checkbox submits nothing when off: the hidden 0 comes first. */}
              <input type="hidden" name="showOnHome" value="0" />
              <div className="flex items-start gap-2">
                <input
                  id="show-on-home"
                  type="checkbox"
                  name="showOnHome"
                  value="1"
                  defaultChecked={g.showOnHome}
                  disabled={homeBlocked}
                  aria-describedby="show-on-home-hint"
                  className="mt-1 size-4"
                />
                <div>
                  <label htmlFor="show-on-home" className="text-small">
                    Mostrar en la portada
                  </label>
                  <p
                    id="show-on-home-hint"
                    className="text-small text-grey-600"
                  >
                    {g.hasPin
                      ? "No disponible: la galería tiene PIN."
                      : g.status !== "published"
                        ? "No disponible: la galería no está publicada."
                        : "Aparece en la página de inicio con su portada. Con PIN o sin publicar se oculta sola."}
                  </p>
                </div>
              </div>
              <div>
                <button
                  type="submit"
                  className={btnPrimary}
                  disabled={busy || homeBlocked}
                >
                  Guardar portada pública
                </button>
              </div>
              <Feedback data={actionData} intent="home" />
            </Form>
          </Section>

          <Section title="Opciones">
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="flags" />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-small font-medium">Modo</legend>
                <div className="flex items-start gap-2">
                  <input
                    id="mode-delivery"
                    type="radio"
                    name="mode"
                    value="delivery"
                    checked={!proofing}
                    onChange={() => setMode("delivery")}
                    aria-describedby="mode-delivery-note"
                    className="mt-1 size-4"
                  />
                  <div>
                    <label htmlFor="mode-delivery" className="text-small">
                      Entrega
                    </label>
                    <p
                      id="mode-delivery-note"
                      className="text-small text-grey-600"
                    >
                      Fotos sin marca de agua y con las descargas habilitadas.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    id="mode-proofing"
                    type="radio"
                    name="mode"
                    value="proofing"
                    checked={proofing}
                    onChange={() => setMode("proofing")}
                    aria-describedby="mode-proofing-note"
                    className="mt-1 size-4"
                  />
                  <div>
                    <label htmlFor="mode-proofing" className="text-small">
                      Prueba
                    </label>
                    <p
                      id="mode-proofing-note"
                      className="text-small text-grey-600"
                    >
                      Todo con marca de agua y sin descargas: el cliente solo
                      elige favoritas.
                    </p>
                  </div>
                </div>
              </fieldset>
              {fe.mode && (
                <p role="alert" className="text-small text-ink font-medium">
                  {fe.mode}
                </p>
              )}
              {proofing && !data.hasWmFiles && (
                <p role="alert" className="text-small text-ink font-medium">
                  Esta galería no tiene archivos preview-wm: en modo Prueba los
                  clientes no verán ninguna foto. Exportá esa receta desde
                  Capture One.
                </p>
              )}
              {proofing && data.hasWmFiles && !data.hasThumbWmFiles && (
                <p role="status" className="text-small text-grey-700">
                  No hay miniaturas thumb-wm: la grilla usará la vista de 2048
                  px, más pesada.
                </p>
              )}
              <Check
                name="allowHighres"
                label="Alta resolución (2048 px)"
                checked={g.allowHighres}
                disabled={proofing}
              />
              <Check
                name="allowWeb"
                label="Web (1200 px)"
                checked={g.allowWeb}
                disabled={proofing}
              />
              <Check
                name="allowIg"
                label="Instagram (1080 px)"
                checked={g.allowIg}
                disabled={proofing}
              />
              <Check
                name="allowBulk"
                label="Permitir descargar todo / por set"
                checked={g.allowBulk}
                disabled={proofing}
              />
              {proofing && (
                <p className="text-small text-grey-600">
                  En modo Prueba no hay descargas: las opciones de tamaño quedan
                  desactivadas (se conservan para el modo Entrega).
                </p>
              )}
              <Check
                name="requireEmail"
                label="Pedir email para descargar y marcar favoritas"
                checked={g.requireEmail}
              />
              <p className="text-small text-grey-600">
                Desactivar un tamaño, o pasar a modo Prueba, anula de inmediato
                los enlaces de descarga ya emitidos.
              </p>
              <div>
                <button type="submit" className={btnPrimary} disabled={busy}>
                  Guardar opciones
                </button>
              </div>
              <Feedback data={actionData} intent="flags" />
            </Form>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <Section title="Fotos">
            {data.photos.length === 0 ? (
              <p className="text-small text-grey-600">
                Esta galería todavía no tiene fotos visibles.
              </p>
            ) : (
              <>
                <PhotoReorder
                  key={data.photos.map((p) => p.id).join(",")}
                  photos={data.photos}
                  version={data.version}
                  coverPhotoId={coverId}
                  coverAuto={g.coverPhotoId === null}
                  actionData={actionData}
                />
                <Form method="post">
                  <input type="hidden" name="intent" value="cover" />
                  <input type="hidden" name="photoId" value="" />
                  <button type="submit" className={btn} disabled={busy}>
                    Usar la primera foto
                  </button>
                </Form>
                <Feedback data={actionData} intent="cover" />
              </>
            )}
          </Section>

          <Section title="Avisos de sincronización">
            {data.issues.total === 0 ? (
              <p className="text-small text-grey-600">Sin avisos.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {data.issues.groups.map((grp) => (
                  <div key={grp.type}>
                    <h3 className="text-small font-medium">
                      {grp.label} ({grp.items.length})
                    </h3>
                    <ul className="text-small text-grey-700 mt-1 list-disc pl-5">
                      {grp.items.map((it, i) => (
                        <li key={i}>
                          {it.set ? `${it.set} / ` : ""}
                          {it.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {data.issues.truncated > 0 && (
                  <p className="text-small text-grey-600">
                    …y {data.issues.truncated} avisos más.
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
