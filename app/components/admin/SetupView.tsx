import { Form, useNavigation } from "react-router";

import { Logo } from "../Logo";
import { fmtTime } from "./AdminShell";

export interface SetupViewData {
  connected: boolean;
  mock: boolean;
  rootName: string | null;
  studioName: string;
  lastSyncAt: string | null;
  lastError: { at: string; message: string } | null;
}

export interface SetupActionData {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  result?: {
    skipped?: string;
    galleries: { created: number; updated: number; archived: number };
    photos: { added: number; updated: number; removed: number };
    issues: number;
  };
}

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const btnPrimary = `${btn} bg-ink text-paper`;
const input =
  "border-grey-300 bg-white w-full border px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-grey-200 flex max-w-2xl flex-col gap-3 border-t pt-6">
      <h2 className="text-micro uppercase text-grey-700">{title}</h2>
      {children}
    </section>
  );
}

function Feedback({
  data,
  intent,
}: {
  data: SetupActionData | undefined;
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
    <p role="status" className="text-small text-grey-700">
      {data.message}
    </p>
  ) : null;
}

function SyncSummary({
  result,
}: {
  result: NonNullable<SetupActionData["result"]>;
}) {
  if (result.skipped === "no_root")
    return (
      <p role="status" className="text-small">
        Primero elegí una carpeta raíz.
      </p>
    );
  if (result.skipped === "empty_root")
    return (
      <p role="status" className="text-small">
        La carpeta raíz está vacía: no se modificó nada.
      </p>
    );
  if (result.skipped === "locked")
    return (
      <p role="status" className="text-small">
        Ya hay una sincronización en curso.
      </p>
    );
  return (
    <ul role="status" className="text-small text-grey-700">
      <li>
        Galerías: {result.galleries.created} nuevas, {result.galleries.updated}{" "}
        actualizadas, {result.galleries.archived} archivadas
      </li>
      <li>
        Fotos: {result.photos.added} fotos nuevas, {result.photos.updated}{" "}
        actualizadas, {result.photos.removed} eliminadas
      </li>
      <li>Avisos: {result.issues}</li>
    </ul>
  );
}

export function SetupView({
  data,
  actionData,
}: {
  data: SetupViewData;
  actionData: SetupActionData | undefined;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title text-ink">Ajustes</h1>

      <Section title="Google Drive">
        <p className="text-body">
          {data.mock
            ? "Modo demo (Drive simulado)"
            : data.connected
              ? "Conectado"
              : "No conectado"}
        </p>
        <div className="flex flex-wrap gap-2">
          {data.mock ? (
            <button type="button" className={btn} disabled>
              Conectar
            </button>
          ) : (
            <a
              href="/admin/google/connect"
              className={`${btnPrimary} inline-block`}
            >
              {data.connected ? "Reconectar" : "Conectar"}
            </a>
          )}
          {data.connected && !data.mock && (
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <button type="submit" className={btn} disabled={busy}>
                Desconectar
              </button>
            </Form>
          )}
        </div>
        <Feedback data={actionData} intent="disconnect" />
      </Section>

      <Section title="Carpeta raíz">
        <p className="text-body">
          {data.rootName ? (
            <>
              Carpeta actual: <strong>{data.rootName}</strong>
            </>
          ) : (
            "Sin carpeta elegida"
          )}
        </p>
        <Form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            if (
              data.rootName &&
              !window.confirm(
                "Las galerías que no estén en la nueva carpeta se archivarán después del período de gracia. ¿Continuar?",
              )
            )
              ev.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="root" />
          {data.rootName && <input type="hidden" name="confirm" value="1" />}
          <label className="text-small flex flex-col gap-1">
            Enlace o ID de la carpeta de Drive
            <input
              name="folder"
              required
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://drive.google.com/drive/folders/…"
              className={input}
            />
          </label>
          <p className="text-small text-grey-600">
            Al cambiar la carpeta raíz, las galerías que no estén en la nueva
            carpeta se van a archivar después del período de gracia (1 hora).
          </p>
          <div>
            <button type="submit" className={btnPrimary} disabled={busy}>
              Guardar carpeta
            </button>
          </div>
        </Form>
        <Feedback data={actionData} intent="root" />
      </Section>

      <Section title="Sincronización">
        <p className="text-small text-grey-700">
          {data.lastSyncAt
            ? `Última sincronización: ${fmtTime(data.lastSyncAt)}`
            : "Sin sincronizar aún"}
        </p>
        {data.lastError && (
          <p role="alert" className="text-small">
            Último error ({fmtTime(data.lastError.at)}):{" "}
            {data.lastError.message}
          </p>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy && nav.formData?.get("intent") === "sync"
              ? "Sincronizando…"
              : "Sincronizar ahora"}
          </button>
        </Form>
        <Feedback data={actionData} intent="sync" />
        {actionData?.intent === "sync" &&
          actionData.ok &&
          actionData.result && <SyncSummary result={actionData.result} />}
      </Section>

      <Section title="Marca">
        <Logo variant="dark" className="h-16" name={data.studioName} />
        <p className="text-small text-grey-600">El logo es fijo.</p>
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="studio" />
          <label className="text-small flex flex-col gap-1">
            Nombre del estudio
            <input
              name="studioName"
              required
              minLength={1}
              maxLength={60}
              defaultValue={data.studioName}
              className={input}
            />
          </label>
          <div>
            <button type="submit" className={btnPrimary} disabled={busy}>
              Guardar nombre
            </button>
          </div>
        </Form>
        <Feedback data={actionData} intent="studio" />
      </Section>
    </div>
  );
}
