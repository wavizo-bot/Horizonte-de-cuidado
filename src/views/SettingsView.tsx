import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  Icon,
  InfoNote,
  Input,
  Modal,
  PageHeader,
  SectionHeading,
  Select,
  Tabs,
  Textarea,
  useToast,
} from "../components/ui";
import { addDays, formatShortYear, todayISO, weekdayName } from "../lib/date";
import { SLOT_LABELS, WEEKDAY_ORDER, defaultWeeklyCapacity } from "../lib/defaults";
import { getAppVersion, hostPlatform, openTextFile, saveTextFile } from "../lib/host";
import { recurrenceLabel } from "../lib/date";
import { messageCategoryLabel } from "../lib/whatsapp";
import type {
  CareKind,
  CareModel,
  DayCapacity,
  DayOverride,
  MessageCategory,
  MessageTemplate,
  MonthlyWeek,
  Recurrence,
  SlotType,
  Weekday,
} from "../types";

type SettingsTab = "perfil" | "agenda" | "modelos" | "mensagens" | "dados" | "nuvem" | "sobre";

const TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "perfil", label: "Perfil" },
  { value: "agenda", label: "Agenda e capacidade" },
  { value: "modelos", label: "Modelos de cuidado" },
  { value: "mensagens", label: "Mensagens" },
  { value: "dados", label: "Dados e importação" },
  { value: "nuvem", label: "Nuvem" },
  { value: "sobre", label: "Sobre" },
];

const SLOTS: SlotType[] = ["triage", "individual", "group", "collective", "makeup"];
const CARE_KINDS: Array<{ value: CareKind; label: string }> = [
  { value: "triage", label: "Matriciamento / triagem" },
  { value: "individual", label: "Atendimento individual" },
  { value: "group", label: "Grupo" },
  { value: "collective", label: "Atividade coletiva" },
  { value: "other", label: "Outro" },
];
const CATEGORIES: MessageCategory[] = ["group", "return", "no_show", "first", "custom"];
const MODEL_COLORS = ["#5b7a63", "#b9684e", "#a97b32", "#486b78", "#7b6a9a", "#95503b", "#8a6d4f"];

function capacityRow(weekday: Weekday, rows: DayCapacity[]): DayCapacity {
  return rows.find((row) => row.weekday === weekday) ?? {
    weekday,
    triage: 0,
    individual: 0,
    group: 0,
    collective: 0,
    makeup: 0,
  };
}

function modelSlotType(kind: CareKind): SlotType {
  if (kind === "triage") return "triage";
  if (kind === "individual") return "individual";
  if (kind === "collective") return "collective";
  return "group";
}

export function SettingsView({ initialTab }: { initialTab?: string }) {
  const {
    state,
    updateSettings,
    setDayOverride,
    removeDayOverride,
    createCareModel,
    saveCareModel,
    deleteCareModel,
    createTemplate,
    saveTemplate,
    deleteTemplate,
    importTable,
    importJson,
    exportJson,
    exportCsv,
    resetLocalData,
    loadDemoData,
    reloadFromDisk,
    drive,
  } = useStore();
  const { push } = useToast();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const found = TABS.find((item) => item.value === initialTab);
    return found?.value ?? "perfil";
  });

  useEffect(() => {
    const found = TABS.find((item) => item.value === initialTab);
    if (found) setTab(found.value);
  }, [initialTab]);

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Configuração"
        title="Ajustes do serviço"
        description="Defina o perfil, a semana de trabalho, as vagas, os modelos de cuidado e as mensagens padrão. Tudo fica salvo neste dispositivo."
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="settings-tabs" />

      {tab === "perfil" ? <ProfileTab /> : null}
      {tab === "agenda" ? (
        <AgendaTab
          onSave={(patch) => {
            updateSettings(patch);
            push("Agenda e capacidade atualizadas.");
          }}
          setDayOverride={setDayOverride}
          removeDayOverride={removeDayOverride}
        />
      ) : null}
      {tab === "modelos" ? (
        <ModelsTab
          createCareModel={createCareModel}
          saveCareModel={saveCareModel}
          deleteCareModel={deleteCareModel}
        />
      ) : null}
      {tab === "mensagens" ? (
        <MessagesTab
          createTemplate={createTemplate}
          saveTemplate={saveTemplate}
          deleteTemplate={deleteTemplate}
        />
      ) : null}
      {tab === "dados" ? (
        <DataTab
          importTable={importTable}
          importJson={importJson}
          exportJson={exportJson}
          exportCsv={exportCsv}
          resetLocalData={resetLocalData}
          loadDemoData={loadDemoData}
          reloadFromDisk={reloadFromDisk}
        />
      ) : null}
      {tab === "nuvem" ? <CloudTab /> : null}
      {tab === "sobre" ? <AboutTab /> : null}

      <p className="muted small">
        {state.patients.length} pacientes · {state.careModels.length} modelos · {state.appointments.length} atendimentos ·
        alterações salvas automaticamente neste dispositivo.
      </p>
      <span hidden>{drive.status.hostAvailable ? "host" : "browser"}</span>
    </div>
  );
}

function ProfileTab() {
  const { state, updateSettings } = useStore();
  const { push } = useToast();
  const [form, setForm] = useState({
    unitName: state.settings.unitName,
    teamName: state.settings.teamName,
    professionalName: state.settings.professionalName,
    professionalRole: state.settings.professionalRole,
    messageSignature: state.settings.messageSignature,
    defaultDdd: state.settings.defaultDdd,
  });

  const save = () => {
    updateSettings(form);
    push("Perfil do serviço atualizado.");
  };

  return (
    <div className="settings-grid">
      <Card className="settings-card">
        <SectionHeading
          eyebrow="Identificação"
          title="Quem usa este caderno"
          description="Esses dados aparecem no cabeçalho, nos relatórios e nas mensagens."
        />
        <div className="form-grid form-grid--2">
          <Field label="Unidade ou serviço" htmlFor="set-unit" required>
            <Input id="set-unit" value={form.unitName} onChange={(event) => setForm({ ...form, unitName: event.target.value })} />
          </Field>
          <Field label="Equipe" htmlFor="set-team">
            <Input id="set-team" value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })} />
          </Field>
          <Field label="Nome do profissional" htmlFor="set-name" required>
            <Input id="set-name" value={form.professionalName} onChange={(event) => setForm({ ...form, professionalName: event.target.value })} />
          </Field>
          <Field label="Categoria profissional" htmlFor="set-role">
            <Input id="set-role" value={form.professionalRole} onChange={(event) => setForm({ ...form, professionalRole: event.target.value })} placeholder="Psicóloga(o), assistente social…" />
          </Field>
          <Field label="Assinatura das mensagens" htmlFor="set-signature" hint="Usada no lugar de {assinatura} nos modelos.">
            <Input id="set-signature" value={form.messageSignature} onChange={(event) => setForm({ ...form, messageSignature: event.target.value })} />
          </Field>
          <Field label="DDD padrão" htmlFor="set-ddd" hint="Aplicado a telefones cadastrados sem DDD.">
            <Input id="set-ddd" value={form.defaultDdd} onChange={(event) => setForm({ ...form, defaultDdd: event.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </Field>
        </div>
        <div className="inline-actions">
          <Button variant="primary" icon="save" onClick={save}>Salvar perfil</Button>
        </div>
      </Card>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Cuidado com os dados</p>
        <h3>Uso profissional e responsável</h3>
        <p className="muted">
          O aplicativo organiza encaminhamentos, agendas e contatos. Ele não define diagnóstico, conduta ou prioridade clínica:
          essas decisões continuam sendo da equipe.
        </p>
        <ul className="check-list">
          <li><Icon name="check" size={15} /> Dados salvos localmente, com criptografia.</li>
          <li><Icon name="check" size={15} /> Nuvem opcional, na sua própria conta Google.</li>
          <li><Icon name="check" size={15} /> Nenhum envio automático de mensagens.</li>
        </ul>
      </Card>
    </div>
  );
}

function AgendaTab({
  onSave,
  setDayOverride,
  removeDayOverride,
}: {
  onSave: (patch: Parameters<ReturnType<typeof useStore>["updateSettings"]>[0]) => void;
  setDayOverride: (override: DayOverride) => void;
  removeDayOverride: (date: string) => void;
}) {
  const { state } = useStore();
  const { push } = useToast();
  const [workdays, setWorkdays] = useState<Weekday[]>(state.settings.workdays);
  const [rows, setRows] = useState<DayCapacity[]>(() => {
    const base = defaultWeeklyCapacity();
    return WEEKDAY_ORDER.map((weekday) => capacityRow(weekday, state.settings.weeklyCapacity.length ? state.settings.weeklyCapacity : base));
  });
  const [horizon, setHorizon] = useState(String(state.settings.horizonDays));
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState(addDays(todayISO(), 1));
  const [overrideClosed, setOverrideClosed] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideCapacity, setOverrideCapacity] = useState<Record<string, string>>({});

  const toggleWorkday = (weekday: Weekday, checked: boolean) => {
    setWorkdays((current) =>
      checked ? [...new Set([...current, weekday])].sort((a, b) => a - b) : current.filter((day) => day !== weekday),
    );
    if (!checked) {
      setRows((current) => current.map((row) => (row.weekday === weekday ? { ...row, triage: 0, individual: 0, group: 0, collective: 0, makeup: 0 } : row)));
    }
  };

  const setCapacity = (weekday: Weekday, slot: SlotType, value: string) => {
    const number = Math.max(0, Math.min(999, Number(value.replace(/\D/g, "")) || 0));
    setRows((current) => current.map((row) => (row.weekday === weekday ? { ...row, [slot]: number } : row)));
  };

  const save = () => {
    const weeklyCapacity = WEEKDAY_ORDER.map((weekday) => capacityRow(weekday, rows));
    onSave({
      workdays,
      weeklyCapacity,
      horizonDays: Math.max(7, Math.min(365, Number(horizon) || 90)),
    });
  };

  const addOverride = () => {
    const capacity: Partial<Record<SlotType, number>> = {};
    for (const slot of SLOTS) {
      const value = overrideCapacity[slot];
      if (value !== undefined && value !== "") capacity[slot] = Math.max(0, Number(value) || 0);
    }
    setDayOverride({
      date: overrideDate,
      closed: overrideClosed,
      reason: overrideReason.trim() || undefined,
      capacity: Object.keys(capacity).length ? capacity : undefined,
    });
    setOverrideOpen(false);
    setOverrideReason("");
    setOverrideCapacity({});
    push(overrideClosed ? "Dia fechado adicionado ao calendário." : "Capacidade específica adicionada.");
  };

  const overrides = state.settings.dayOverrides.slice().sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="settings-grid">
      <div className="stack">
        <Card className="settings-card">
          <SectionHeading
            eyebrow="Semana de trabalho"
            title="Dias e vagas por dia"
            description="Marque os dias em que o serviço atende e informe quantas vagas de cada tipo existem em um dia comum."
          />
          <div className="capacity-form">
            <div className="capacity-grid">
              <div className="capacity-grid__head">
                <span>Dia</span>
                {SLOTS.map((slot) => <span key={slot}>{SLOT_LABELS[slot]}</span>)}
              </div>
              {WEEKDAY_ORDER.map((weekday) => {
                const row = capacityRow(weekday, rows);
                const active = workdays.includes(weekday);
                return (
                  <div key={weekday} className={`capacity-row${active ? "" : " is-off"}`}>
                    <label className="capacity-row__day">
                      <Checkbox checked={active} onChange={(checked) => toggleWorkday(weekday, checked)} label={weekdayName(weekday, true)} />
                    </label>
                    {SLOTS.map((slot) => (
                      <div key={slot} className={`capacity-cell capacity-cell--${slot}`}>
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={row[slot]}
                          disabled={!active}
                          onChange={(event) => setCapacity(weekday, slot, event.target.value)}
                          aria-label={`${SLOT_LABELS[slot]} de ${weekdayName(weekday, true)}`}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="capacity-form__foot">
              <Field label="Horizonte de planejamento (dias)" htmlFor="set-horizon" hint="Entre 7 e 365 dias. O padrão é 90.">
                <Input id="set-horizon" type="number" min={7} max={365} value={horizon} onChange={(event) => setHorizon(event.target.value)} />
              </Field>
              <div className="inline-actions">
                <Button variant="primary" icon="save" onClick={save}>Salvar agenda</Button>
                <Button
                  variant="ghost"
                  icon="refresh"
                  onClick={() => {
                    setRows(defaultWeeklyCapacity());
                    setWorkdays([1, 2, 3, 4, 5]);
                    push("Capacidade padrão restaurada no formulário. Salve para aplicar.", "info");
                  }}
                >
                  Restaurar padrão
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <SectionHeading
            eyebrow="Exceções"
            title="Dias fechados e capacidades específicas"
            description="Use para feriados, reuniões de equipe, capacitações ou dias com mais vagas. A exceção vale só para a data escolhida."
            actions={<Button variant="secondary" icon="plus" onClick={() => setOverrideOpen(true)}>Adicionar data</Button>}
          />
          {overrides.length === 0 ? (
            <div className="override-note">
              <Icon name="calendar" size={18} />
              <span>Nenhuma exceção cadastrada. A agenda segue a capacidade semanal.</span>
            </div>
          ) : (
            <div className="override-list">
              {overrides.map((override) => (
                <div key={override.date} className="override-row">
                  <span className={`override-row__date${override.closed ? " is-closed" : ""}`}>
                    <strong>{formatShortYear(override.date)}</strong>
                    <small>{weekdayName(override.date, true)}</small>
                  </span>
                  <span className="override-row__reason">
                    <strong>{override.closed ? "Fechado" : "Capacidade específica"}</strong>
                    <small>{override.reason || "Sem motivo informado"}</small>
                  </span>
                  {override.capacity ? (
                    <span className="override-row__capacity">
                      {SLOTS.filter((slot) => override.capacity?.[slot] !== undefined).map((slot) => (
                        <Badge key={slot} tone="neutral">{SLOT_LABELS[slot]}: {override.capacity?.[slot]}</Badge>
                      ))}
                    </span>
                  ) : <span />}
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => { removeDayOverride(override.date); push("Exceção removida."); }}>
                    Remover
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Como o planejamento funciona</p>
        <h3>Vagas primeiro, pessoas depois</h3>
        <p className="muted">
          O motor distribui matriciamentos, retornos individuais e encontros de grupo dentro das vagas configuradas.
          Prioridades ocupam as primeiras vagas de matriciamento.
        </p>
        <p className="muted">
          Atendimentos manuais, realizados ou com falta ficam fixos e não são apagados quando a agenda é recalculada.
          Se alguém não couber no horizonte, aparece na fila de pendências — nunca é descartado.
        </p>
        <InfoNote icon="info" title="Ajuste fino">
          Para um dia específico com mais vagas, crie uma exceção com capacidade própria. Para fechar o serviço, marque o dia como fechado.
        </InfoNote>
      </Card>

      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Adicionar exceção na agenda"
        description="A regra semanal continua valendo para os demais dias."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={addOverride} disabled={!overrideDate}>Adicionar</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Data" htmlFor="override-date" required>
            <Input id="override-date" type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} />
          </Field>
          <Field label="Motivo" htmlFor="override-reason">
            <Input id="override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Feriado, reunião, capacitação…" />
          </Field>
        </div>
        <Checkbox
          checked={overrideClosed}
          onChange={setOverrideClosed}
          label="Fechar o serviço neste dia"
          description="Nenhuma vaga automática será criada. Encaixes manuais continuam permitidos, com aviso."
        />
        {!overrideClosed ? (
          <div className="capacity-form__grid">
            {SLOTS.map((slot) => (
              <Field key={slot} label={SLOT_LABELS[slot]} htmlFor={`override-${slot}`}>
                <Input
                  id={`override-${slot}`}
                  type="number"
                  min={0}
                  max={999}
                  value={overrideCapacity[slot] ?? ""}
                  placeholder="Manter"
                  onChange={(event) => setOverrideCapacity({ ...overrideCapacity, [slot]: event.target.value })}
                />
              </Field>
            ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ModelsTab({
  createCareModel,
  saveCareModel,
  deleteCareModel,
}: {
  createCareModel: ReturnType<typeof useStore>["createCareModel"];
  saveCareModel: ReturnType<typeof useStore>["saveCareModel"];
  deleteCareModel: ReturnType<typeof useStore>["deleteCareModel"];
}) {
  const { state, getModel } = useStore();
  const { push } = useToast();
  const [editing, setEditing] = useState<CareModel | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    kind: "group" as CareKind,
    color: MODEL_COLORS[0],
    maxMembers: "15",
    weekday: "1",
    recurrence: "weekly" as Recurrence,
    monthlyWeek: "1",
    time: "14:00",
    description: "",
    active: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "",
      kind: "group",
      color: MODEL_COLORS[0],
      maxMembers: "15",
      weekday: "1",
      recurrence: "weekly",
      monthlyWeek: "1",
      time: "14:00",
      description: "",
      active: true,
    });
  };

  const openEdit = (model: CareModel) => {
    setEditing(model);
    setEditorOpen(true);
    setForm({
      name: model.name,
      kind: model.kind,
      color: model.color,
      maxMembers: model.maxMembers ? String(model.maxMembers) : "",
      weekday: String(model.schedule?.weekday ?? 1),
      recurrence: model.schedule?.recurrence ?? "weekly",
      monthlyWeek: String(model.schedule?.monthlyWeek ?? 1),
      time: model.schedule?.time ?? "14:00",
      description: model.description ?? "",
      active: model.active,
    });
  };

  const save = () => {
    if (!form.name.trim()) return;
    const isGroup = form.kind === "group" || form.kind === "collective";
    const schedule = form.kind === "triage" || form.kind === "individual"
      ? undefined
      : {
          weekday: Number(form.weekday) as Weekday,
          recurrence: form.recurrence,
          monthlyWeek: form.recurrence === "monthly" ? (Number(form.monthlyWeek) as MonthlyWeek) : undefined,
          anchorDate: editing?.schedule?.anchorDate ?? todayISO(),
          time: form.time || undefined,
        };
    const model: CareModel = {
      id: editing?.id ?? "",
      name: form.name.trim(),
      kind: form.kind,
      slotType: modelSlotType(form.kind),
      color: form.color,
      active: form.active,
      description: form.description.trim() || undefined,
      schedule,
      maxMembers: isGroup ? Math.max(1, Number(form.maxMembers) || 15) : undefined,
    };
    if (editing) {
      saveCareModel(model);
      push("Modelo de cuidado atualizado.");
    } else {
      createCareModel(model);
      push("Modelo de cuidado criado.");
    }
    setEditorOpen(false);
    setEditing(null);
  };

  const [editorOpen, setEditorOpen] = useState(false);

  const models = state.careModels.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="settings-grid">
      <Card className="settings-card">
        <SectionHeading
          eyebrow="Catálogo do serviço"
          title="Modelos de cuidado"
          description="Cada paciente fica em um modelo. Grupos e coletivos têm dia, recorrência e limite de participantes."
          actions={<Button variant="secondary" icon="plus" onClick={() => { openNew(); setEditorOpen(true); }}>Novo modelo</Button>}
        />
        <div className="model-settings-list">
          {models.map((model) => {
            const count = state.patients.filter((patient) => patient.careModelId === model.id && !["discharged", "transferred", "refused", "deceased"].includes(patient.status)).length;
            return (
              <div key={model.id} className="model-settings-row">
                <span className="model-settings-row__dot" style={{ background: model.color }} />
                <div className="model-settings-row__main">
                  <strong>{model.name}</strong>
                  <small>
                    {CARE_KINDS.find((kind) => kind.value === model.kind)?.label}
                    {model.schedule ? ` · ${weekdayName(model.schedule.weekday, true)} · ${recurrenceLabel(model.schedule.recurrence)}${model.schedule.time ? ` · ${model.schedule.time}` : ""}` : " · sem agenda própria"}
                    {model.maxMembers ? ` · até ${model.maxMembers} pessoas` : ""}
                  </small>
                </div>
                <Badge tone={model.active ? "ok" : "muted"}>{model.active ? "Ativo" : "Inativo"}</Badge>
                <Badge tone="neutral">{count} pacientes</Badge>
                <div className="model-settings-row__actions">
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => openEdit(model)}>Editar</Button>
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteId(model.id)}>Excluir</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Planejamento</p>
        <h3>Um modelo, uma agenda</h3>
        <p className="muted">
          O dia e a frequência do grupo definem quando os encontros aparecem na agenda. Se o grupo muda de dia, os encontros
          automáticos são recalculados e os atendimentos fixos são preservados.
        </p>
        <p className="muted">
          Ao excluir um modelo, os pacientes vinculados voltam para o matriciamento. Nenhum cadastro é apagado.
        </p>
      </Card>

      <Modal
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        title={editing ? "Editar modelo de cuidado" : "Novo modelo de cuidado"}
        description="Modelos de grupo e coletivo precisam de dia e recorrência para entrar na agenda."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditorOpen(false); setEditing(null); }}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={save} disabled={!form.name.trim()}>Salvar modelo</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Nome do modelo" htmlFor="model-name" required>
            <Input id="model-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Grupo de adolescentes" />
          </Field>
          <Field label="Tipo" htmlFor="model-kind">
            <Select id="model-kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as CareKind })}>
              {CARE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </Select>
          </Field>
          <Field label="Limite de participantes" htmlFor="model-max" hint="Somente para grupos e coletivos.">
            <Input id="model-max" type="number" min={1} max={999} value={form.maxMembers} disabled={form.kind !== "group" && form.kind !== "collective"} onChange={(event) => setForm({ ...form, maxMembers: event.target.value })} />
          </Field>
          <Field label="Horário habitual" htmlFor="model-time">
            <Input id="model-time" type="time" value={form.time} disabled={form.kind === "triage" || form.kind === "individual"} onChange={(event) => setForm({ ...form, time: event.target.value })} />
          </Field>
          {form.kind !== "triage" && form.kind !== "individual" ? (
            <>
              <Field label="Dia da semana" htmlFor="model-weekday">
                <Select id="model-weekday" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
                  {WEEKDAY_ORDER.map((weekday) => <option key={weekday} value={weekday}>{weekdayName(weekday, true)}</option>)}
                </Select>
              </Field>
              <Field label="Frequência" htmlFor="model-recurrence">
                <Select id="model-recurrence" value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value as Recurrence })}>
                  <option value="weekly">Semanal</option>
                  <option value="biweekly">Quinzenal</option>
                  <option value="monthly">Mensal</option>
                </Select>
              </Field>
              {form.recurrence === "monthly" ? (
                <Field label="Semana do mês" htmlFor="model-monthweek">
                  <Select id="model-monthweek" value={form.monthlyWeek} onChange={(event) => setForm({ ...form, monthlyWeek: event.target.value })}>
                    <option value="1">1ª semana</option>
                    <option value="2">2ª semana</option>
                    <option value="3">3ª semana</option>
                    <option value="4">4ª semana</option>
                    <option value="5">Última semana</option>
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}
          <Field label="Descrição" htmlFor="model-description" className="form-grid__full">
            <Textarea id="model-description" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Objetivo, público e combinados do grupo." />
          </Field>
        </div>
        <div className="color-choices">
          {MODEL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-choice${form.color === color ? " is-selected" : ""}`}
              style={{ background: color }}
              aria-label={`Cor ${color}`}
              onClick={() => setForm({ ...form, color })}
            />
          ))}
        </div>
        <Checkbox checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} label="Modelo ativo" description="Modelos inativos não recebem novos pacientes e não geram encontros." />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) {
            deleteCareModel(deleteId);
            push("Modelo removido. Pacientes voltaram para o matriciamento.");
          }
        }}
        title="Excluir este modelo de cuidado?"
        description="Pacientes vinculados serão movidos para o matriciamento. O histórico de atendimentos é mantido."
        confirmLabel="Excluir modelo"
        tone="danger"
      >
        <p>{getModel(deleteId ?? undefined)?.name}</p>
      </ConfirmDialog>
    </div>
  );
}

function MessagesTab({
  createTemplate,
  saveTemplate,
  deleteTemplate,
}: {
  createTemplate: ReturnType<typeof useStore>["createTemplate"];
  saveTemplate: ReturnType<typeof useStore>["saveTemplate"];
  deleteTemplate: ReturnType<typeof useStore>["deleteTemplate"];
}) {
  const { state } = useStore();
  const { push } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "group" as MessageCategory,
    body: "",
    active: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", category: "custom", body: "Olá, {primeiro_nome}!\n\n{mensagem}\n\n{assinatura}", active: true });
    setEditorOpen(true);
  };

  const openEdit = (template: MessageTemplate) => {
    setEditing(template);
    setForm({ name: template.name, category: template.category, body: template.body, active: template.active });
    setEditorOpen(true);
  };

  const save = () => {
    if (!form.name.trim() || !form.body.trim()) return;
    if (editing) {
      saveTemplate({ ...editing, ...form, name: form.name.trim() });
      push("Modelo de mensagem atualizado.");
    } else {
      createTemplate({ ...form, name: form.name.trim() });
      push("Modelo de mensagem criado.");
    }
    setEditorOpen(false);
    setEditing(null);
  };

  return (
    <div className="settings-grid">
      <Card className="settings-card">
        <SectionHeading
          eyebrow="Comunicação"
          title="Modelos de mensagem"
          description="Use os campos {primeiro_nome}, {data}, {hora}, {grupo}, {assinatura} e {mensagem}. O texto é sempre revisado por você antes do envio."
          actions={<Button variant="secondary" icon="plus" onClick={openNew}>Novo modelo</Button>}
        />
        <div className="template-settings-list">
          {state.templates.map((template) => (
            <div key={template.id} className="template-settings-row">
              <span className={`template-settings-row__icon${template.active ? "" : " is-off"}`}><Icon name="message" size={18} /></span>
              <div className="template-settings-row__main">
                <strong>{template.name}</strong>
                <small>{messageCategoryLabel(template.category)} · {template.body.length} caracteres</small>
                <p>{template.body.split("\n")[0].slice(0, 120)}…</p>
              </div>
              <Badge tone={template.active ? "ok" : "muted"}>{template.active ? "Ativo" : "Inativo"}</Badge>
              <div className="model-settings-row__actions">
                <Button variant="ghost" size="sm" icon="edit" onClick={() => openEdit(template)}>Editar</Button>
                <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteId(template.id)}>Excluir</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Campos disponíveis</p>
        <h3>Personalize sem esquecer o essencial</h3>
        <div className="token-list">
          {["{primeiro_nome}", "{nome}", "{data}", "{hora}", "{grupo}", "{modelo}", "{profissional}", "{unidade}", "{equipe}", "{assinatura}", "{mensagem}"].map((token) => (
            <code key={token}>{token}</code>
          ))}
        </div>
        <p className="muted small">
          Evite incluir detalhes clínicos desnecessários no WhatsApp. O aplicativo não envia nada sozinho: ele abre a conversa com o texto pronto.
        </p>
      </Card>

      <Modal
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        title={editing ? "Editar modelo de mensagem" : "Novo modelo de mensagem"}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditorOpen(false); setEditing(null); }}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={save} disabled={!form.name.trim() || !form.body.trim()}>Salvar modelo</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Nome" htmlFor="tpl-name" required>
            <Input id="tpl-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Categoria" htmlFor="tpl-category">
            <Select id="tpl-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as MessageCategory })}>
              {CATEGORIES.map((category) => <option key={category} value={category}>{messageCategoryLabel(category)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Texto da mensagem" htmlFor="tpl-body" required hint="Quebras de linha são preservadas.">
          <Textarea id="tpl-body" rows={12} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
        </Field>
        <Checkbox checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} label="Modelo ativo" description="Aparece na tela de mensagens." />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) {
            deleteTemplate(deleteId);
            push("Modelo de mensagem excluído.");
          }
        }}
        title="Excluir este modelo?"
        description="O texto deixa de aparecer na tela de mensagens. Contatos já registrados não são alterados."
        confirmLabel="Excluir modelo"
        tone="danger"
      />
    </div>
  );
}

function DataTab({
  importTable,
  importJson,
  exportJson,
  exportCsv,
  resetLocalData,
  loadDemoData,
  reloadFromDisk,
}: {
  importTable: ReturnType<typeof useStore>["importTable"];
  importJson: ReturnType<typeof useStore>["importJson"];
  exportJson: ReturnType<typeof useStore>["exportJson"];
  exportCsv: ReturnType<typeof useStore>["exportCsv"];
  resetLocalData: ReturnType<typeof useStore>["resetLocalData"];
  loadDemoData: ReturnType<typeof useStore>["loadDemoData"];
  reloadFromDisk: ReturnType<typeof useStore>["reloadFromDisk"];
}) {
  const { state } = useStore();
  const { push } = useToast();
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<string>();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  const openFile = async () => {
    const content = await openTextFile();
    if (content) {
      setText(content);
      push("Arquivo carregado. Confira o conteúdo antes de importar.", "info");
    }
  };

  const doImportTable = () => {
    if (!text.trim()) return;
    try {
      const result = importTable(text);
      setSummary(`${result.added} adicionados, ${result.updated} atualizados, ${result.skipped} ignorados.${result.createdModels.length ? ` Modelos criados: ${result.createdModels.join(", ")}.` : ""}${result.warnings.length ? ` Avisos: ${result.warnings.slice(0, 3).join(" ")}` : ""}`);
      push("Importação de planilha concluída.");
    } catch (error) {
      push(error instanceof Error ? error.message : "Não foi possível importar a planilha.", "error");
    }
  };

  const doImportJson = (mode: "merge" | "replace") => {
    if (!text.trim()) return;
    try {
      const result = importJson(text, mode);
      setSummary(`${result.added} adicionados, ${result.updated} atualizados, ${result.skipped} ignorados.`);
      push("Backup JSON importado.");
      setReplaceOpen(false);
    } catch (error) {
      push(error instanceof Error ? error.message : "Não foi possível importar o JSON.", "error");
    }
  };

  const download = async (kind: "json" | "csv") => {
    const content = kind === "json" ? exportJson() : exportCsv();
    const name = kind === "json" ? `horizonte-backup-${todayISO()}.json` : `horizonte-pacientes-${todayISO()}.csv`;
    await saveTextFile(name, content);
    push(kind === "json" ? "Backup JSON gerado." : "Planilha CSV gerada.");
  };

  return (
    <div className="settings-grid">
      <div className="stack">
        <Card className="settings-card">
          <SectionHeading
            eyebrow="Entrada de dados"
            title="Importar planilha ou backup"
            description="Cole os dados copiados da planilha (colunas A–J) ou abra um arquivo CSV, TSV ou JSON. A importação nunca apaga pacientes existentes."
            actions={<Button variant="ghost" icon="upload" onClick={() => void openFile()}>Abrir arquivo</Button>}
          />
          <Field label="Conteúdo para importar" htmlFor="import-text" hint="Na planilha, selecione o cabeçalho e as linhas e copie. Também aceita CSV separado por vírgulas ou ponto e vírgula.">
            <Textarea
              id="import-text"
              rows={9}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Nome\tCadastro\tIdade\tTelefone\tData de encaminhamento\tMotivo\tEquipe\tData de matriciamento\tModelo\tObservações\n…"}
            />
          </Field>
          <div className="inline-actions">
            <Button variant="primary" icon="upload" onClick={doImportTable} disabled={!text.trim()}>Importar planilha</Button>
            <Button variant="secondary" icon="database" onClick={() => setReplaceOpen(true)} disabled={!text.trim()}>Importar backup JSON</Button>
            <Button variant="ghost" icon="x" onClick={() => { setText(""); setSummary(undefined); }}>Limpar</Button>
          </div>
          {summary ? <InfoNote tone="ok" icon="checkCircle" title="Resultado da importação">{summary}</InfoNote> : null}
        </Card>

        <Card className="settings-card">
          <SectionHeading
            eyebrow="Saída de dados"
            title="Exportar e guardar"
            description="Gere um backup completo em JSON ou uma planilha de pacientes em CSV. Guarde o arquivo em local seguro."
          />
          <div className="data-actions">
            <button type="button" className="data-action" onClick={() => void download("json")}>
              <span><Icon name="database" size={20} /></span>
              <strong>Backup completo</strong>
              <small>Pacientes, agenda, modelos, modelos de mensagem e ajustes.</small>
              <em>Baixar JSON</em>
            </button>
            <button type="button" className="data-action" onClick={() => void download("csv")}>
              <span><Icon name="file" size={20} /></span>
              <strong>Planilha de pacientes</strong>
              <small>Dados cadastrais, modelo atual e próximas datas.</small>
              <em>Baixar CSV</em>
            </button>
          </div>
        </Card>

        <Card className="settings-card">
          <SectionHeading
            eyebrow="Manutenção"
            title="Demonstração e reinício"
            description="A base de demonstração usa apenas nomes fictícios. Use-a para conhecer o aplicativo antes de importar dados reais."
          />
          <div className="inline-actions">
            <Button variant="secondary" icon="sparkles" onClick={() => setDemoOpen(true)}>Carregar dados de demonstração</Button>
            <Button variant="ghost" icon="refresh" onClick={() => void reloadFromDisk().then(() => push("Dados recarregados do dispositivo."))}>Recarregar do dispositivo</Button>
            <Button variant="ghost" icon="trash" onClick={() => setResetOpen(true)} className="btn--danger-text">Apagar tudo</Button>
          </div>
          <p className="muted small">Ao apagar, o caderno local fica vazio. Se a nuvem estiver conectada, o próximo envio substitui a cópia remota — confirme com atenção.</p>
        </Card>
      </div>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Privacidade</p>
        <h3>Dados reais não vão para o repositório</h3>
        <p className="muted">
          Este aplicativo é distribuído com dados fictícios. A planilha real deve ser importada apenas no seu dispositivo e o arquivo
          gerado fica fora do código público.
        </p>
        <div className="data-counts">
          <div><strong>{state.patients.length}</strong><span>pacientes</span></div>
          <div><strong>{state.appointments.length}</strong><span>atendimentos</span></div>
          <div><strong>{state.reminders.length}</strong><span>lembretes</span></div>
        </div>
        <p className="muted small">Antes de importar dados reais, confirme que você tem base legal e autorização institucional para o tratamento.</p>
      </Card>

      <ConfirmDialog
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        onConfirm={() => doImportJson("merge")}
        title="Importar backup JSON?"
        description="A importação mescla os registros do arquivo com os existentes, atualizando os itens de mesmo identificador."
        confirmLabel="Importar e mesclar"
      >
        <p>Depois você poderá revisar pacientes, agenda e ajustes.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        onConfirm={() => void loadDemoData().then(() => push("Dados de demonstração carregados."))}
        title="Substituir os dados atuais pela demonstração?"
        description="Pacientes e agenda atuais serão substituídos por registros fictícios. Exporte um backup antes se precisar guardar o conteúdo."
        confirmLabel="Carregar demonstração"
        tone="danger"
      />

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void resetLocalData().then(() => { setSummary(undefined); setText(""); push("Caderno local apagado."); })}
        title="Apagar todos os dados deste dispositivo?"
        description="Esta ação remove pacientes, agenda, modelos e mensagens salvas localmente. Não pode ser desfeita sem um backup."
        confirmLabel="Apagar tudo"
        tone="danger"
      />
    </div>
  );
}

function CloudTab() {
  const { drive, state } = useStore();
  const { push } = useToast();
  const [generationOpen, setGenerationOpen] = useState(false);
  const status = drive.status;
  const conflicts = drive.meta?.conflicts ?? [];

  return (
    <div className="settings-grid">
      <div className="stack">
        <Card className="settings-card">
          <SectionHeading
            eyebrow="Backup opcional"
            title="Google Drive"
            description="A sincronização usa a pasta privada do aplicativo (appDataFolder) na sua conta Google. O conteúdo não é publicado nem compartilhado."
            actions={
              <Badge tone={status.signedIn ? "ok" : status.configured ? "warn" : "muted"}>
                {status.signedIn ? "Conectado" : status.configured ? "Pronto para conectar" : "Não configurado"}
              </Badge>
            }
          />
          <div className="cloud-status">
            <span className={`cloud-status__icon${status.signedIn ? " is-on" : ""}`}><Icon name={status.signedIn ? "cloud" : "cloudOff"} size={28} /></span>
            <div>
              <strong>{status.signedIn ? status.email || "Conta Google conectada" : status.hostAvailable ? "Nuvem desconectada" : "Disponível no aplicativo instalado"}</strong>
              <p>
                {!status.hostAvailable
                  ? "No navegador, os dados ficam apenas neste dispositivo. Instale o aplicativo para Windows ou Android para ativar o backup no Google Drive."
                  : status.signedIn
                    ? status.lastSyncAt ? `Última sincronização em ${new Date(status.lastSyncAt).toLocaleString("pt-BR")}.` : "Conectado. Aguardando a primeira sincronização."
                    : status.configured ? "Entre com sua conta para ativar o backup automático a cada 15 segundos." : "O cliente OAuth ainda não foi configurado neste pacote. Consulte o README do projeto."}
              </p>
            </div>
          </div>
          <div className="inline-actions">
            {status.signedIn ? (
              <>
                <Button variant="primary" icon="refresh" onClick={() => void drive.syncNow()} disabled={status.busy}>Sincronizar agora</Button>
                <Button variant="ghost" icon="logout" onClick={() => void drive.disconnect()}>Desconectar</Button>
              </>
            ) : (
              <Button variant="primary" icon="cloud" onClick={() => void drive.connect()} disabled={!status.hostAvailable || !status.configured || status.busy}>
                Conectar Google Drive
              </Button>
            )}
            <Button variant="ghost" icon="shield" onClick={() => void drive.refreshDriveState()}>Atualizar estado</Button>
          </div>
          {status.error ? <InfoNote tone="warn" icon="alert" title="Aviso da nuvem">{status.error}</InfoNote> : null}
          {status.pendingGeneration !== null ? (
            <InfoNote tone="warn" icon="alert" title="A nuvem foi reiniciada em outro dispositivo">
              Há uma geração mais nova na nuvem. Você pode aplicar o conteúdo remoto ou criar um novo caderno a partir deste dispositivo.
              <div className="inline-actions">
                <Button variant="secondary" size="sm" onClick={() => { drive.applyPendingGeneration(); push("Conteúdo remoto aplicado."); }}>Aplicar conteúdo da nuvem</Button>
                <Button variant="ghost" size="sm" onClick={() => setGenerationOpen(true)}>Criar novo caderno</Button>
              </div>
            </InfoNote>
          ) : null}
        </Card>

        <Card className="settings-card">
          <SectionHeading
            eyebrow="Conflitos"
            title="Edições simultâneas"
            description="Quando dois dispositivos alteram o mesmo registro, o aplicativo preserva as duas versões e pede sua decisão."
            actions={<Badge tone={conflicts.length ? "warn" : "ok"}>{conflicts.length ? `${conflicts.length} pendente(s)` : "Sem pendências"}</Badge>}
          />
          {conflicts.length === 0 ? (
            <div className="override-note"><Icon name="checkCircle" size={18} /><span>Nenhum conflito aguardando decisão.</span></div>
          ) : (
            <div className="conflict-list">
              {conflicts.map((conflict) => (
                <div key={conflict.id} className="conflict-card">
                  <div className="conflict-card__head">
                    <strong>{conflict.docId}</strong>
                    <small>Detectado em {new Date(conflict.detectedAt).toLocaleString("pt-BR")}</small>
                  </div>
                  <div className="conflict-card__values">
                    <div>
                      <span>Versão deste dispositivo</span>
                      <pre>{JSON.stringify(conflict.localValue, null, 2).slice(0, 500)}</pre>
                      <Button variant="secondary" size="sm" onClick={() => { drive.resolveConflict(conflict.id, "local"); push("Versão local mantida."); }}>Manter local</Button>
                    </div>
                    <div>
                      <span>Versão da nuvem</span>
                      <pre>{JSON.stringify(conflict.remoteValue, null, 2).slice(0, 500)}</pre>
                      <Button variant="secondary" size="sm" onClick={() => { drive.resolveConflict(conflict.id, "remote"); push("Versão da nuvem aplicada."); }}>Usar nuvem</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Como funciona</p>
        <h3>Sincronização conservadora</h3>
        <ul className="check-list">
          <li><Icon name="check" size={15} /> Cada dispositivo grava seu próprio arquivo de operações.</li>
          <li><Icon name="check" size={15} /> Agendamentos automáticos não sobem: são recalculados localmente.</li>
          <li><Icon name="check" size={15} /> Conflitos nunca são resolvidos no silêncio.</li>
          <li><Icon name="check" size={15} /> É possível reiniciar a nuvem sem apagar o dispositivo.</li>
        </ul>
        <InfoNote icon="shield" title="Limite importante">
          A criptografia local protege contra acesso casual, mas não substitui BitLocker, senha de usuário e política institucional
          de proteção de dados.
        </InfoNote>
        <p className="muted small">{state.patients.length} pacientes neste caderno. A nuvem é um espelho, não a única cópia.</p>
      </Card>

      <ConfirmDialog
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
        onConfirm={() => void drive.startNewNotebook().then((ok) => ok && push("Novo caderno criado na nuvem."))}
        title="Criar um novo caderno na nuvem?"
        description="O conteúdo remoto atual será substituído por um caderno vazio. Os outros dispositivos verão um aviso de nova geração."
        confirmLabel="Criar novo caderno"
        tone="danger"
      />
    </div>
  );
}

function AboutTab() {
  const [version, setVersion] = useState("1.0.0");
  const platform = hostPlatform();
  const platformName =
    platform === "android" ? "Android" : platform === "windows" ? "Windows" : "Web";
  const platformDetail =
    platform === "android"
      ? "Android 7.0 ou superior"
      : platform === "windows"
        ? "Windows 10/11 · MSIX"
        : "Navegador (PWA)";
  useEffect(() => {
    void getAppVersion().then((value) => value && setVersion(value.replace(/^v/i, "")));
  }, []);

  return (
    <div className="settings-grid">
      <Card className="settings-card about-card">
        <div className="about-card__brand">
          <span className="about-card__mark">
            <Icon name="sun" size={28} />
          </span>
          <div>
            <p className="eyebrow">Aplicativo {platformName}</p>
            <h2>Horizonte de Cuidado</h2>
            <p className="muted">Agenda, filas e comunicação para o cuidado em saúde mental.</p>
          </div>
          <Badge tone="info">versão {version}</Badge>
        </div>
        <p>
          O Horizonte de Cuidado organiza encaminhamentos, matriciamento, grupos, atendimentos individuais, faltas e busca ativa.
          Ele foi pensado para equipes de saúde mental que precisam enxergar o cuidado com clareza sem transformar pessoas em números.
        </p>
        <InfoNote tone="clay" icon="heart" title="O aplicativo não decide por você">
          Prioridades, vagas e relatórios são apoio à organização. A decisão clínica, a avaliação de risco e a conduta continuam
          sendo responsabilidade da equipe profissional.
        </InfoNote>
        <div className="about-links">
          <a href="legal/politica-de-privacidade.html" target="_blank" rel="noreferrer"><Icon name="shield" size={16} /> Política de privacidade</a>
          <a href="legal/termos-de-servico.html" target="_blank" rel="noreferrer"><Icon name="file" size={16} /> Termos de uso</a>
          <a href="legal/aviso-legal.html" target="_blank" rel="noreferrer"><Icon name="info" size={16} /> Aviso legal</a>
          <a href="legal/suporte.html" target="_blank" rel="noreferrer"><Icon name="help" size={16} /> Suporte</a>
        </div>
      </Card>

      <Card className="soft-card settings-aside">
        <p className="eyebrow">Transparência</p>
        <h3>O que fica onde</h3>
        <p className="muted">Pacientes, agenda e anotações ficam neste dispositivo. A nuvem é opcional e usa a sua conta Google.</p>
        <p className="muted">Não há anúncios, rastreamento de terceiros ou envio automático de mensagens.</p>
        <div className="about-meta">
          <div><span>Aplicativo</span><strong>Horizonte de Cuidado</strong></div>
          <div><span>Plataforma</span><strong>{platformDetail}</strong></div>
          <div><span>Versão</span><strong>{version}</strong></div>
          <div><span>Última atualização</span><strong>2026</strong></div>
        </div>
        <p className="muted small">Canais de distribuição: Microsoft Store (Windows/MSIX) e Google Play (Android).</p>
      </Card>
    </div>
  );
}
