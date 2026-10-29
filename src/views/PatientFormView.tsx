import { useEffect, useMemo, useState } from "react";
import { useStore, type PatientInput } from "../state/store";
import { Button, Card, Checkbox, Field, Icon, InfoNote, Input, PageHeader, Select, Textarea, useToast } from "../components/ui";
import { navigate } from "../navigation";
import { todayISO } from "../lib/date";
import { formatPhone } from "../lib/whatsapp";
import type { CareKind, PatientStatus, Recurrence, Weekday } from "../types";
import { WEEKDAY_ORDER } from "../lib/defaults";

const KIND_LABELS: Record<CareKind, string> = {
  triage: "Matriciamento",
  individual: "Atendimento individual",
  group: "Grupo",
  collective: "Atividade coletiva",
  other: "Outro",
};

const STATUS_OPTIONS: Array<{ value: PatientStatus; label: string }> = [
  { value: "waiting_triage", label: "Aguardando matriciamento" },
  { value: "active", label: "Em acompanhamento" },
  { value: "paused", label: "Pausado" },
  { value: "discharged", label: "Alta" },
  { value: "transferred", label: "Transferido" },
  { value: "refused", label: "Recusou o cuidado" },
  { value: "deceased", label: "Óbito" },
];

const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
  { value: "none", label: "Pontual / sem recorrência" },
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quinzenal" },
  { value: "monthly", label: "Mensal" },
];

interface FormState {
  name: string;
  registrationNumber: string;
  age: string;
  phone: string;
  noWhatsapp: boolean;
  phoneNote: string;
  referralDate: string;
  referralReason: string;
  referringTeam: string;
  triageDate: string;
  careModelId: string;
  status: PatientStatus;
  priority: boolean;
  priorityReason: string;
  recurrence: Recurrence;
  preferredWeekday: string;
  observations: string;
}

function emptyForm(defaultTriage: string): FormState {
  return {
    name: "",
    registrationNumber: "",
    age: "",
    phone: "",
    noWhatsapp: false,
    phoneNote: "",
    referralDate: todayISO(),
    referralReason: "",
    referringTeam: "",
    triageDate: "",
    careModelId: defaultTriage,
    status: "waiting_triage",
    priority: false,
    priorityReason: "",
    recurrence: "none",
    preferredWeekday: "",
    observations: "",
  };
}

export function PatientFormView({ patientId }: { patientId?: string }) {
  const { state, createPatient, updatePatient, getPatient } = useStore();
  const { push } = useToast();
  const patient = patientId ? getPatient(patientId) : undefined;
  const editing = Boolean(patientId);
  const [form, setForm] = useState<FormState>(() => emptyForm(state.settings.defaultTriageModelId ?? "cm-triage"));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!patient) return;
    setForm({
      name: patient.name,
      registrationNumber: patient.registrationNumber,
      age: patient.age === undefined ? "" : String(patient.age),
      phone: patient.phone ?? "",
      noWhatsapp: patient.noWhatsapp,
      phoneNote: patient.phoneNote ?? "",
      referralDate: patient.referralDate,
      referralReason: patient.referralReason,
      referringTeam: patient.referringTeam,
      triageDate: patient.triageDate ?? "",
      careModelId: patient.careModelId ?? state.settings.defaultTriageModelId ?? "cm-triage",
      status: patient.status,
      priority: patient.priority,
      priorityReason: patient.priorityReason ?? "",
      recurrence: patient.recurrence,
      preferredWeekday: patient.preferredWeekday === undefined ? "" : String(patient.preferredWeekday),
      observations: patient.observations ?? "",
    });
  }, [patient, state.settings.defaultTriageModelId]);

  const modelsByKind = useMemo(() => {
    const groups = new Map<CareKind, typeof state.careModels>();
    for (const model of state.careModels.filter((item) => item.active)) {
      const list = groups.get(model.kind) ?? [];
      list.push(model);
      groups.set(model.kind, list);
    }
    return groups;
  }, [state.careModels]);

  const selectedModel = state.careModels.find((model) => model.id === form.careModelId);
  const isGroup = selectedModel?.kind === "group" || selectedModel?.kind === "collective";

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const save = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Informe o nome do paciente.";
    if (!form.referralDate) nextErrors.referralDate = "Informe a data de encaminhamento.";
    if (form.age && (Number(form.age) < 0 || Number(form.age) > 120)) nextErrors.age = "Idade deve estar entre 0 e 120.";
    if (form.phone && form.phone.replace(/\D/g, "").length < 8) nextErrors.phone = "Telefone parece incompleto.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const status =
      form.triageDate && form.status === "waiting_triage" ? "active" : form.status;
    const input: PatientInput = {
      name: form.name.trim(),
      registrationNumber: form.registrationNumber.trim(),
      age: form.age ? Number(form.age) : undefined,
      phone: form.phone ? form.phone.replace(/\D/g, "") : undefined,
      noWhatsapp: form.noWhatsapp || !form.phone,
      phoneNote: form.phoneNote.trim() || undefined,
      referralDate: form.referralDate,
      referralReason: form.referralReason.trim(),
      referringTeam: form.referringTeam.trim(),
      triageDate: form.triageDate || undefined,
      careModelId: form.careModelId,
      status,
      priority: form.priority,
      priorityReason: form.priority ? form.priorityReason.trim() || "Prioridade definida pela equipe" : undefined,
      recurrence: isGroup ? "weekly" : form.recurrence,
      preferredWeekday: form.preferredWeekday === "" ? undefined : (Number(form.preferredWeekday) as Weekday),
      observations: form.observations.trim(),
    };

    if (editing && patient) {
      updatePatient(patient.id, input);
      push("Cadastro atualizado.");
      navigate({ name: "patient", patientId: patient.id });
    } else {
      const id = createPatient(input);
      push("Paciente cadastrado e incluído no planejamento.");
      navigate({ name: "patient", patientId: id });
    }
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow={editing ? "Editar cadastro" : "Novo cadastro"}
        title={editing ? (patient?.name ?? "Editar paciente") : "Cadastrar paciente"}
        description="Dados administrativos e de cuidado usados para organizar filas, agenda e contato. Não registre informações clínicas desnecessárias."
        actions={
          <Button variant="ghost" icon="chevronLeft" onClick={() => (editing && patient ? navigate({ name: "patient", patientId: patient.id }) : navigate({ name: "patients" }))}>
            Voltar
          </Button>
        }
      />

      <div className="form-layout">
        <div className="stack">
          <Card className="form-card">
            <div className="form-section-title">
              <span className="form-section-title__icon"><Icon name="user" size={18} /></span>
              <div>
                <h2>Identificação</h2>
                <p>Como o paciente será reconhecido na fila e na agenda.</p>
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <Field label="Nome completo" htmlFor="patient-name" required error={errors.name} className="form-grid__full">
                <Input
                  id="patient-name"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Nome do paciente"
                  autoComplete="off"
                />
              </Field>
              <Field label="Número de cadastro" htmlFor="patient-registration" hint="Prontuário, matrícula ou identificador local.">
                <Input
                  id="patient-registration"
                  value={form.registrationNumber}
                  onChange={(event) => update("registrationNumber", event.target.value)}
                  placeholder="Ex.: 100234"
                />
              </Field>
              <Field label="Idade" htmlFor="patient-age" error={errors.age}>
                <Input
                  id="patient-age"
                  type="number"
                  min={0}
                  max={120}
                  value={form.age}
                  onChange={(event) => update("age", event.target.value)}
                  placeholder="Anos"
                />
              </Field>
              <Field label="Telefone" htmlFor="patient-phone" error={errors.phone} hint={form.phone ? formatPhone(form.phone) : "DDD + número, com ou sem espaços."}>
                <Input
                  id="patient-phone"
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="(11) 90000-0000"
                  inputMode="tel"
                />
              </Field>
              <Field label="Observação sobre o contato" htmlFor="patient-phone-note" hint="Ex.: recado com familiar, melhor horário, telefone alternativo.">
                <Input
                  id="patient-phone-note"
                  value={form.phoneNote}
                  onChange={(event) => update("phoneNote", event.target.value)}
                  placeholder="Opcional"
                />
              </Field>
            </div>
            <div className="form-checks">
              <Checkbox
                checked={form.noWhatsapp}
                onChange={(checked) => update("noWhatsapp", checked)}
                label="Este paciente não usa WhatsApp"
                description="A interface vai priorizar ligação e registrar tentativas sem WhatsApp."
              />
            </div>
          </Card>

          <Card className="form-card">
            <div className="form-section-title">
              <span className="form-section-title__icon"><Icon name="file" size={18} /></span>
              <div>
                <h2>Encaminhamento</h2>
                <p>Origem do pedido e motivo relatado pela equipe que encaminhou.</p>
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <Field label="Data de encaminhamento" htmlFor="patient-referral-date" required error={errors.referralDate}>
                <Input
                  id="patient-referral-date"
                  type="date"
                  value={form.referralDate}
                  onChange={(event) => update("referralDate", event.target.value)}
                />
              </Field>
              <Field label="Equipe que encaminhou" htmlFor="patient-team">
                <Input
                  id="patient-team"
                  value={form.referringTeam}
                  onChange={(event) => update("referringTeam", event.target.value)}
                  placeholder="Ex.: Equipe Girassol"
                />
              </Field>
              <Field label="Motivo do encaminhamento" htmlFor="patient-reason" className="form-grid__full" hint="Use o relato recebido, sem concluir diagnóstico.">
                <Textarea
                  id="patient-reason"
                  rows={3}
                  value={form.referralReason}
                  onChange={(event) => update("referralReason", event.target.value)}
                  placeholder="O que motivou o encaminhamento?"
                />
              </Field>
            </div>
            <div className="form-checks">
              <Checkbox
                checked={form.priority}
                onChange={(checked) => update("priority", checked)}
                label="Paciente prioritário"
                description="Prioritários ocupam as próximas vagas de matriciamento. Ex.: gestante, risco de autoagressão, violência."
              />
              {form.priority ? (
                <Field label="Motivo da prioridade" htmlFor="patient-priority-reason">
                  <Input
                    id="patient-priority-reason"
                    value={form.priorityReason}
                    onChange={(event) => update("priorityReason", event.target.value)}
                    placeholder="Ex.: gestante"
                  />
                </Field>
              ) : null}
            </div>
          </Card>

          <Card className="form-card">
            <div className="form-section-title">
              <span className="form-section-title__icon"><Icon name="layers" size={18} /></span>
              <div>
                <h2>Cuidado e agenda</h2>
                <p>O modelo define a fila, a recorrência e as vagas usadas no planejamento de 90 dias.</p>
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <Field label="Data de matriciamento" htmlFor="patient-triage" hint="Deixe em branco enquanto aguarda o primeiro atendimento.">
                <Input
                  id="patient-triage"
                  type="date"
                  value={form.triageDate}
                  onChange={(event) => update("triageDate", event.target.value)}
                />
              </Field>
              <Field label="Modelo de cuidado" htmlFor="patient-model">
                <Select id="patient-model" value={form.careModelId} onChange={(event) => update("careModelId", event.target.value)}>
                  {Array.from(modelsByKind.entries()).map(([kind, models]) => (
                    <optgroup key={kind} label={KIND_LABELS[kind]}>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Situação" htmlFor="patient-status">
                <Select id="patient-status" value={form.status} onChange={(event) => update("status", event.target.value as PatientStatus)}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {!isGroup ? (
                <>
                  <Field label="Recorrência do atendimento" htmlFor="patient-recurrence">
                    <Select id="patient-recurrence" value={form.recurrence} onChange={(event) => update("recurrence", event.target.value as Recurrence)}>
                      {RECURRENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Dia preferido" htmlFor="patient-weekday" hint="Opcional. O planejador tenta respeitar este dia.">
                    <Select id="patient-weekday" value={form.preferredWeekday} onChange={(event) => update("preferredWeekday", event.target.value)}>
                      <option value="">Sem preferência</option>
                      {WEEKDAY_ORDER.map((weekday) => (
                        <option key={weekday} value={weekday}>
                          {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][weekday]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : (
                <div className="form-grid__full">
                  <InfoNote icon="layers" title="A recorrência vem do grupo">
                    O grupo define dia, frequência e horário. Ajuste esses dados em <strong>Grupos</strong> ou <strong>Ajustes → Modelos</strong>.
                  </InfoNote>
                </div>
              )}
              <Field label="Observações gerais" htmlFor="patient-observations" className="form-grid__full">
                <Textarea
                  id="patient-observations"
                  rows={4}
                  value={form.observations}
                  onChange={(event) => update("observations", event.target.value)}
                  placeholder="Informações administrativas ou de cuidado que ajudam a organizar o acompanhamento."
                />
              </Field>
            </div>
          </Card>
        </div>

        <aside className="form-aside">
          <Card className="form-aside__card">
            <h3>Antes de salvar</h3>
            <ul className="check-list">
              <li><Icon name="check" size={15} /> O nome e a data de encaminhamento são obrigatórios.</li>
              <li><Icon name="check" size={15} /> A prioridade só deve ser marcada quando houver critério da equipe.</li>
              <li><Icon name="check" size={15} /> Após o matriciamento, defina o modelo de cuidado para o paciente entrar na fila correta.</li>
              <li><Icon name="check" size={15} /> O aplicativo organiza o cuidado; a decisão clínica é sempre da equipe.</li>
            </ul>
            <div className="form-aside__actions">
              <Button variant="primary" icon="save" onClick={save} className="btn--block">
                {editing ? "Salvar alterações" : "Cadastrar paciente"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => (editing && patient ? navigate({ name: "patient", patientId: patient.id }) : navigate({ name: "patients" }))}
                className="btn--block"
              >
                Descartar
              </Button>
            </div>
          </Card>
          <InfoNote icon="shield" title="Privacidade">
            Os dados ficam neste dispositivo, cifrados no armazenamento local. Evite registrar informações que não sejam necessárias ao cuidado.
          </InfoNote>
        </aside>
      </div>
    </div>
  );
}
