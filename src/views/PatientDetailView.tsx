import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { AppointmentCard } from "../components/AppointmentCard";
import { AppointmentDetail } from "../components/AppointmentDetail";
import { NewAppointmentModal } from "../components/NewAppointmentModal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  InfoNote,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from "../components/ui";
import { navigate } from "../navigation";
import { addDays, formatLong, formatShortYear, todayISO, weekdayName } from "../lib/date";
import { appointmentsForPatient, careModelOf, nextScheduled } from "../lib/schedule";
import { daysWaiting, lastContact, priorityLabel, suggestedCategory } from "../lib/selectors";
import { contactChannelLabel, contactOutcomeLabel, formatPhone } from "../lib/whatsapp";
import type { ContactChannel, ContactOutcome, PatientStatus, Recurrence } from "../types";

type Tab = "overview" | "appointments" | "notes";

const STATUS_OPTIONS: Array<{ value: PatientStatus; label: string }> = [
  { value: "waiting_triage", label: "Aguardando matriciamento" },
  { value: "active", label: "Em acompanhamento" },
  { value: "paused", label: "Pausado" },
  { value: "discharged", label: "Alta" },
  { value: "transferred", label: "Transferido" },
  { value: "refused", label: "Recusou o cuidado" },
  { value: "deceased", label: "Óbito" },
];

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "Pontual",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
};

const CHANNELS: ContactChannel[] = ["whatsapp", "call", "sms", "in_person", "other"];
const OUTCOMES: ContactOutcome[] = ["sent", "answered", "no_answer", "wrong_number", "no_whatsapp", "scheduled", "other"];

export function PatientDetailView({ patientId }: { patientId: string }) {
  const { state, getPatient, getModel, updatePatient, deletePatient, addPatientNote, addContactAttempt, scheduleMakeup, markAppointment } = useStore();
  const { push } = useToast();
  const patient = getPatient(patientId);
  const [tab, setTab] = useState<Tab>("overview");
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [note, setNote] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<ContactChannel>("whatsapp");
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome>("sent");
  const [contactNote, setContactNote] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState(patient?.careModelId ?? "");
  const [statusDraft, setStatusDraft] = useState<PatientStatus>(patient?.status ?? "waiting_triage");
  const [noWhatsappDraft, setNoWhatsappDraft] = useState(patient?.noWhatsapp ?? false);

  useEffect(() => {
    setModelDraft(patient?.careModelId ?? "");
    setStatusDraft(patient?.status ?? "waiting_triage");
    setNoWhatsappDraft(patient?.noWhatsapp ?? false);
    setTab("overview");
  }, [patientId]);

  const appointments = useMemo(() => (patient ? appointmentsForPatient(state, patient.id) : []), [state, patient]);
  const today = todayISO();
  const upcoming = appointments.filter((appointment) => appointment.date >= today && appointment.status === "scheduled");
  const overdue = appointments.filter((appointment) => appointment.date < today && appointment.status === "scheduled");
  const history = appointments.filter((appointment) => appointment.status !== "scheduled" || appointment.date < today).slice().reverse();
  const model = patient ? careModelOf(state, patient) : undefined;
  const next = patient ? nextScheduled(state, patient.id) : undefined;

  if (!patient) {
    return (
      <div className="stack">
        <PageHeader title="Paciente não encontrado" description="O cadastro pode ter sido excluído ou o link está incorreto." />
        <Button variant="primary" icon="users" onClick={() => navigate({ name: "patients" })}>Voltar para pacientes</Button>
      </div>
    );
  }

  const saveNote = () => {
    if (!note.trim()) return;
    addPatientNote(patient.id, note);
    setNote("");
    push("Anotação registrada.");
  };

  const saveContact = () => {
    addContactAttempt(patient.id, {
      channel: contactChannel,
      outcome: contactOutcome,
      note: contactNote.trim() || undefined,
    });
    if (contactOutcome === "no_whatsapp") updatePatient(patient.id, { noWhatsapp: true });
    setContactOpen(false);
    setContactNote("");
    push("Tentativa de contato registrada.");
  };

  const saveCare = () => {
    const chosen = getModel(modelDraft);
    updatePatient(patient.id, {
      careModelId: modelDraft,
      status: statusDraft,
      noWhatsapp: noWhatsappDraft,
      recurrence: chosen?.kind === "group" || chosen?.kind === "collective" ? "weekly" : patient.recurrence,
      preferredWeekday: chosen?.schedule?.weekday ?? patient.preferredWeekday,
    });
    push("Plano de cuidado atualizado.");
  };

  const startTriageToday = () => {
    updatePatient(patient.id, { triageDate: today, status: "active" });
    push("Matriciamento registrado. Agora defina o modelo de cuidado.");
  };

  const contact = patient.contactAttempts.slice().sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="stack stack--lg">
      <div className="patient-detail__back">
        <Button variant="ghost" size="sm" icon="chevronLeft" onClick={() => navigate({ name: "patients" })}>
          Pacientes
        </Button>
      </div>

      <section className="patient-hero">
        <Avatar name={patient.name} size="xl" />
        <div className="patient-hero__main">
          <div className="inline-badges">
            <StatusBadge status={patient.status} />
            {patient.priority ? <Badge tone="clay"><Icon name="flag" size={12} /> {priorityLabel(patient)}</Badge> : null}
            {!patient.triageDate ? <Badge tone="warn">Aguardando matriciamento</Badge> : null}
          </div>
          <h1>{patient.name}</h1>
          <p>
            {patient.registrationNumber ? `Cadastro ${patient.registrationNumber}` : "Sem número de cadastro"}
            {patient.age !== undefined ? ` · ${patient.age} anos` : ""}
            {patient.phone ? ` · ${formatPhone(patient.phone)}` : " · sem telefone"}
            {patient.noWhatsapp ? " · sem WhatsApp" : ""}
          </p>
          <div className="patient-hero__model">
            <i className="model-dot" style={{ background: model?.color ?? "#8a8a8a" }} />
            <span>{model?.name ?? "Modelo de cuidado não definido"}</span>
            {next ? <span className="muted">· próximo atendimento {formatShortYear(next.date)}</span> : <span className="muted">· sem próximo atendimento</span>}
          </div>
        </div>
        <div className="patient-hero__actions">
          {patient.phone && !patient.noWhatsapp ? (
            <Button variant="whatsapp" icon="whatsapp" onClick={() => navigate({ name: "messages", patientId: patient.id })}>
              WhatsApp
            </Button>
          ) : (
            <Button variant="secondary" icon="phone" onClick={() => setContactOpen(true)}>
              Registrar contato
            </Button>
          )}
          <Button variant="primary" icon="calendarPlus" onClick={() => setNewOpen(true)}>Agendar</Button>
          <Button variant="secondary" icon="edit" onClick={() => navigate({ name: "patient-edit", patientId: patient.id })}>Editar</Button>
        </div>
      </section>

      <div className="patient-detail__bar">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Visão geral" },
            { value: "appointments", label: "Atendimentos", count: upcoming.length },
            { value: "notes", label: "Anotações e contatos", count: patient.notes.length + contact.length },
          ]}
        />
        <div className="patient-detail__quick">
          <Select
            value={patient.status}
            onChange={(event) => {
              updatePatient(patient.id, { status: event.target.value as PatientStatus });
              push("Situação atualizada.");
            }}
            aria-label="Alterar situação do paciente"
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteOpen(true)} className="btn--danger-text">Excluir</Button>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="patient-overview">
          <div className="stack">
            {!patient.triageDate ? (
              <Card className="triage-callout">
                <div>
                  <p className="eyebrow">Primeiro atendimento</p>
                  <h3>Aguardando matriciamento há {daysWaiting(patient)} dias</h3>
                  <p>
                    {next
                      ? `Vaga prevista para ${formatLong(next.date)}${next.time ? ` às ${next.time}` : ""}.`
                      : "Ainda não há vaga no horizonte. Revise a capacidade de matriciamento."}
                  </p>
                </div>
                <div className="inline-actions">
                  {next ? <Button variant="secondary" size="sm" onClick={() => setAppointmentId(next.id)}>Abrir vaga</Button> : null}
                  <Button variant="primary" size="sm" icon="check" onClick={startTriageToday}>Registrar matriciamento hoje</Button>
                </div>
              </Card>
            ) : null}

            {patient.triageDate && (!model || model.kind === "triage") ? (
              <InfoNote tone="warn" icon="target" title="Defina o modelo de cuidado">
                O matriciamento foi registrado em {formatShortYear(patient.triageDate)}. Escolha abaixo para onde o paciente segue: individual, grupo, coletivo ou outro.
              </InfoNote>
            ) : null}

            <Card>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Dados do cadastro</p>
                  <h2>Encaminhamento e cuidado</h2>
                </div>
              </div>
              <div className="detail-grid detail-grid--3">
                <div><span className="detail-grid__label">Data de encaminhamento</span><strong>{formatLong(patient.referralDate)}</strong></div>
                <div><span className="detail-grid__label">Equipe que encaminhou</span><strong>{patient.referringTeam || "Não informada"}</strong></div>
                <div><span className="detail-grid__label">Data de matriciamento</span><strong>{patient.triageDate ? formatLong(patient.triageDate) : "Pendente"}</strong></div>
                <div><span className="detail-grid__label">Modelo de cuidado</span><strong>{model?.name ?? "Não definido"}</strong></div>
                <div><span className="detail-grid__label">Recorrência</span><strong>{model?.kind === "group" || model?.kind === "collective" ? "Definida pelo grupo" : RECURRENCE_LABEL[patient.recurrence]}</strong></div>
                <div><span className="detail-grid__label">Dia preferido</span><strong>{patient.preferredWeekday === undefined ? "Sem preferência" : weekdayName(patient.preferredWeekday, true)}</strong></div>
                <div className="detail-grid__full"><span className="detail-grid__label">Motivo do encaminhamento</span><strong>{patient.referralReason || "Não informado"}</strong></div>
                <div className="detail-grid__full"><span className="detail-grid__label">Observações</span><strong>{patient.observations || "Sem observações."}</strong></div>
              </div>
            </Card>

            <Card>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Próximos passos</p>
                  <h2>Continuidade do cuidado</h2>
                </div>
                <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => setTab("appointments")}>Ver todos</Button>
              </div>
              {upcoming.length === 0 ? (
                <EmptyState
                  compact
                  icon="calendar"
                  title="Sem atendimento futuro"
                  description="Agende um retorno ou defina o modelo de cuidado para o planejamento automático incluir este paciente."
                  action={<Button variant="soft" icon="calendarPlus" onClick={() => setNewOpen(true)}>Agendar</Button>}
                />
              ) : (
                <div className="appointment-list">
                  {upcoming.slice(0, 3).map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={appointment}
                      patient={patient}
                      model={getModel(appointment.careModelId)}
                      onOpen={() => setAppointmentId(appointment.id)}
                      showDate
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <aside className="stack">
            <Card className="care-plan-card">
              <p className="eyebrow">Plano de cuidado</p>
              <h3>Ajustar acompanhamento</h3>
              <Field label="Modelo de cuidado" htmlFor="detail-model">
                <Select id="detail-model" value={modelDraft || patient.careModelId || ""} onChange={(event) => setModelDraft(event.target.value)}>
                  <option value="">Selecione…</option>
                  {state.careModels.filter((item) => item.active).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Situação" htmlFor="detail-status">
                <Select id="detail-status" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as PatientStatus)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </Field>
              <Checkbox
                checked={noWhatsappDraft}
                onChange={setNoWhatsappDraft}
                label="Sem WhatsApp"
                description="Priorizar ligação ou contato presencial."
              />
              <Button variant="primary" icon="save" onClick={saveCare} className="btn--block">Salvar plano</Button>
            </Card>

            <Card>
              <p className="eyebrow">Contato</p>
              <h3>{patient.phone ? formatPhone(patient.phone) : "Telefone não informado"}</h3>
              <p className="muted small">{patient.phoneNote || (patient.noWhatsapp ? "Paciente marcado sem WhatsApp." : "WhatsApp disponível para contato.")}</p>
              <div className="contact-actions">
                {patient.phone ? (
                  <Button variant="secondary" size="sm" icon="phone" onClick={() => { void navigator.clipboard?.writeText(patient.phone ?? ""); push("Telefone copiado."); }}>
                    Copiar telefone
                  </Button>
                ) : null}
                {patient.phone && !patient.noWhatsapp ? (
                  <Button variant="whatsapp" size="sm" icon="whatsapp" onClick={() => navigate({ name: "messages", patientId: patient.id })}>
                    Abrir mensagem
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" icon="notes" onClick={() => setContactOpen(true)}>Registrar contato</Button>
              </div>
              <p className="muted small">
                Último contato: {lastContact(patient) ? new Date(lastContact(patient)!).toLocaleDateString("pt-BR") : "nenhum registro"} · {contact.length} tentativas.
              </p>
            </Card>

            <Card className="soft-card">
              <p className="eyebrow">Apoio à decisão</p>
              <h3>O app não decide o cuidado</h3>
              <p className="muted">
                Prioridades, modelos e agendas são registros da equipe. A avaliação clínica e a definição do projeto terapêutico são responsabilidade do profissional habilitado.
              </p>
            </Card>
          </aside>
        </div>
      ) : null}

      {tab === "appointments" ? (
        <div className="stack">
          {overdue.length > 0 ? (
            <InfoNote tone="warn" icon="clock" title={`${overdue.length} atendimento(s) em atraso`}>
              Estes agendamentos ficaram no passado sem registro de presença ou falta. Atualize para manter a fila confiável.
            </InfoNote>
          ) : null}
          <Card>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Agenda</p>
                <h2>Próximos atendimentos</h2>
              </div>
              <Button variant="primary" size="sm" icon="calendarPlus" onClick={() => setNewOpen(true)}>Novo</Button>
            </div>
            {upcoming.length === 0 && overdue.length === 0 ? (
              <EmptyState compact icon="calendar" title="Nada agendado" description="O planejamento automático pode incluir este paciente quando houver modelo e vaga." />
            ) : (
              <div className="appointment-list">
                {[...overdue, ...upcoming].map((appointment) => (
                  <div key={appointment.id} className={appointment.date < today ? "overdue-appointment" : undefined}>
                    <AppointmentCard
                      appointment={appointment}
                      patient={patient}
                      model={getModel(appointment.careModelId)}
                      onOpen={() => setAppointmentId(appointment.id)}
                      onDone={() => markAppointment(appointment.id, "done")}
                      onMissed={() => markAppointment(appointment.id, "missed")}
                      showDate
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Histórico</p>
                <h2>Atendimentos anteriores</h2>
              </div>
              <Button
                variant="soft"
                size="sm"
                icon="refresh"
                onClick={() => {
                  const result = scheduleMakeup(patient.id);
                  push(result ? `Reposição agendada para ${formatShortYear(result)}.` : "Sem vaga de reposição no horizonte.", result ? "success" : "error");
                }}
              >
                Reposição
              </Button>
            </div>
            {history.length === 0 ? (
              <EmptyState compact icon="archive" title="Sem histórico" description="Presenças e faltas aparecerão aqui depois dos atendimentos." />
            ) : (
              <div className="appointment-list">
                {history.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    patient={patient}
                    model={getModel(appointment.careModelId)}
                    onOpen={() => setAppointmentId(appointment.id)}
                    showDate
                    compact
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="notes-layout">
          <Card>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Anotações</p>
                <h2>Registro de acompanhamento</h2>
              </div>
            </div>
            <div className="note-composer">
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Registre uma informação administrativa ou de continuidade do cuidado. Evite dados clínicos desnecessários."
              />
              <Button variant="primary" icon="plus" onClick={saveNote} disabled={!note.trim()}>Adicionar anotação</Button>
            </div>
            {patient.notes.length === 0 ? (
              <EmptyState compact icon="notes" title="Nenhuma anotação" description="Use este espaço para registrar combinados, preparação de grupo ou pendências." />
            ) : (
              <ol className="timeline">
                {patient.notes.slice().reverse().map((item) => (
                  <li key={item.id}>
                    <span className="timeline__dot" />
                    <div>
                      <time>{new Date(item.at).toLocaleString("pt-BR")}</time>
                      <p>{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Contato</p>
                <h2>Tentativas registradas</h2>
              </div>
              <Button variant="soft" size="sm" icon="plus" onClick={() => setContactOpen(true)}>Registrar</Button>
            </div>
            {contact.length === 0 ? (
              <EmptyState compact icon="message" title="Nenhum contato registrado" description="Ao enviar mensagem ou ligar, registre o resultado para acompanhar a busca ativa." />
            ) : (
              <ol className="timeline">
                {contact.map((item) => (
                  <li key={item.id}>
                    <span className={`timeline__dot timeline__dot--${item.outcome}`} />
                    <div>
                      <time>{new Date(item.at).toLocaleString("pt-BR")}</time>
                      <strong>{contactChannelLabel(item.channel)} · {contactOutcomeLabel(item.outcome)}</strong>
                      {item.note ? <p>{item.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="soft-card">
            <p className="eyebrow">Mensagem sugerida</p>
            <h3>Retorno ou primeira consulta</h3>
            <p className="muted">
              O modelo sugerido é <strong>{suggestedCategory(patient, next) === "first" ? "primeira consulta" : "retorno"}</strong>. Use a tela de mensagens para personalizar e abrir o WhatsApp.
            </p>
            <Button variant="whatsapp" icon="whatsapp" onClick={() => navigate({ name: "messages", patientId: patient.id })} className="btn--block">
              Preparar mensagem
            </Button>
          </Card>
        </div>
      ) : null}

      <AppointmentDetail appointmentId={appointmentId} onClose={() => setAppointmentId(null)} />
      <NewAppointmentModal open={newOpen} onClose={() => setNewOpen(false)} defaultDate={addDays(today, 1)} defaultPatientId={patient.id} />

      <Modal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Registrar tentativa de contato"
        description={`${patient.name} · ${formatPhone(patient.phone) || "sem telefone"}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setContactOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={saveContact}>Registrar</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Canal" htmlFor="contact-channel">
            <Select id="contact-channel" value={contactChannel} onChange={(event) => setContactChannel(event.target.value as ContactChannel)}>
              {CHANNELS.map((channel) => <option key={channel} value={channel}>{contactChannelLabel(channel)}</option>)}
            </Select>
          </Field>
          <Field label="Resultado" htmlFor="contact-outcome">
            <Select id="contact-outcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value as ContactOutcome)}>
              {OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{contactOutcomeLabel(outcome)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Observação" htmlFor="contact-note">
          <Textarea id="contact-note" rows={2} value={contactNote} onChange={(event) => setContactNote(event.target.value)} placeholder="Opcional" />
        </Field>
        <InfoNote icon="shield">
          Registre apenas o necessário para a continuidade do cuidado. O conteúdo da mensagem não é armazenado pelo aplicativo.
        </InfoNote>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          deletePatient(patient.id);
          push("Cadastro excluído.", "info");
          navigate({ name: "patients" });
        }}
        title="Excluir este cadastro?"
        description="Todos os agendamentos e anotações vinculados serão removidos. Esta ação não pode ser desfeita."
        confirmLabel="Excluir definitivamente"
        tone="danger"
      >
        <p><strong>{patient.name}</strong> · {patient.registrationNumber || "sem cadastro"}</p>
      </ConfirmDialog>
    </div>
  );
}
