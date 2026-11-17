import { useId } from "react";
import { Form, Link, useNavigation } from "react-router";

import type {
  GalleryActionResult,
  loadGalleryEdit,
} from "../../lib/server/admin-galleries";
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
  const wmDisabled = !data.hasWmFiles;

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
                    defaultValue={g.title}
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
              <Field label="Cliente" error={de.clientName}>
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
                    defaultValue={g.eventDate ?? ""}
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
                hint="De 4 a 32 caracteres."
              >
                {(p) => (
                  <input
                    {...p}
                    type="password"
                    name="pin"
                    required
                    minLength={4}
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

          <Section title="Opciones">
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="flags" />
              <Check
                name="allowHighres"
                label="Alta resolución (2048 px)"
                checked={g.allowHighres}
              />
              <Check
                name="allowWeb"
                label="Web (1200 px)"
                checked={g.allowWeb}
              />
              <Check
                name="allowIg"
                label="Instagram (1080 px)"
                checked={g.allowIg}
              />
              <Check
                name="allowBulk"
                label="Permitir descargar todo / por set"
                checked={g.allowBulk}
              />
              <Check
                name="requireEmail"
                label="Pedir email para descargar y marcar favoritas"
                checked={g.requireEmail}
              />
              <Check
                name="useWatermarkPreview"
                label="Ver con marca de agua (preview-wm)"
                checked={g.useWatermarkPreview && !wmDisabled}
                disabled={wmDisabled}
                describedBy="wm-note"
              />
              <p id="wm-note" className="text-small text-grey-600">
                {wmDisabled
                  ? "Esta galería no tiene archivos preview-wm: exportá esa receta desde Capture One para poder activarla."
                  : "Las descargas siempre entregan los archivos sin marca de agua."}
              </p>
              {fe.useWatermarkPreview && (
                <p role="alert" className="text-small text-ink font-medium">
                  {fe.useWatermarkPreview}
                </p>
              )}
              <label className="flex items-center gap-2 text-small">
                <span>Tema</span>
                <select
                  name="theme"
                  defaultValue={g.theme}
                  className="border-grey-300 h-9 border bg-transparent px-2"
                >
                  <option value="light">Claro</option>
                  <option value="dark">Oscuro</option>
                </select>
              </label>
              {fe.theme && (
                <p role="alert" className="text-small text-ink font-medium">
                  {fe.theme}
                </p>
              )}
              <p className="text-small text-grey-600">
                Desactivar un tamaño anula de inmediato los enlaces de descarga
                ya emitidos.
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
          <Section title="Portada">
            {data.photos.length === 0 ? (
              <p className="text-small text-grey-600">
                Esta galería todavía no tiene fotos visibles.
              </p>
            ) : (
              <>
                <Form method="post" className="flex flex-col gap-3">
                  <input type="hidden" name="intent" value="cover" />
                  <fieldset className="flex flex-col gap-2">
                    <legend className="sr-only">Portada</legend>
                    <div className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 overflow-y-auto">
                      {data.photos.map((p) => (
                        <label
                          key={p.id}
                          className="relative block cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="photoId"
                            value={p.id}
                            aria-label={p.name}
                            defaultChecked={g.coverPhotoId === p.id}
                            className="peer sr-only"
                          />
                          <img
                            src={`/admin/img/${p.id}/thumb`}
                            alt={p.name}
                            loading="lazy"
                            className="bg-grey-100 peer-checked:outline-ink peer-focus-visible:outline-ink aspect-[3/2] w-full object-cover outline-offset-2 peer-checked:outline-4 peer-focus-visible:outline-2"
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <button
                      type="submit"
                      className={btnPrimary}
                      disabled={busy}
                    >
                      Guardar portada
                    </button>
                  </div>
                </Form>
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

          <Section title="Orden de las fotos">
            {data.photos.length === 0 ? (
              <p className="text-small text-grey-600">
                Sin fotos para ordenar.
              </p>
            ) : (
              <PhotoReorder
                key={data.photos.map((p) => p.id).join(",")}
                photos={data.photos}
                version={data.version}
                actionData={actionData}
              />
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
