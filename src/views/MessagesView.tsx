import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  InfoNote,
  Modal,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from "../components/ui";
import { navigate } from "../navigation";
import { formatLong, formatShortYear, todayISO } from "../lib/date";
import { careModelOf, lastDone, nextScheduled } from "../lib/schedule";
import { groupMembers, groupNextMeeting, renderTemplate, suggestedCategory } from "../lib/selectors";
import { contactChannelLabel, contactOutcomeLabel, formatPhone, whatsappLink, whatsappNumber } from "../lib/whatsapp";
import { messageCategoryLabel } from "../lib/whatsapp";
import type { Appointment, ContactChannel, ContactOutcome, MessageCategory } from "../types";

type Audience = "patient" | "group";
type ListFilter = "all" | "today" | "waiting" | "no_whatsapp" | "groups";

const OUTCOMES: ContactOutcome[] = ["sent", "answered", "no_answer", "wrong_number", "no_whatsapp", "scheduled", "other"];
const CHANNELS: ContactChannel[] = ["whatsapp", "call", "sms", "in_person", "other"];

function lastMissed(state: ReturnType<typeof useStore>["state"], patientId: string): Appointment | undefined {
  return state.appointments
    .filter((appointment) => appointment.patientId === patientId && appointment.status === "missed")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function MessagesView({ routePatientId }: { routePatientId?: string }) {
  const { state, addContactAttempt, getPatient } = useStore();
  const { push } = useToast();
  const [audience, setAudience] = useState<Audience>("patient");
  const [patientId, setPatientId] = useState(routePatientId ?? "");
  const [groupId, setGroupId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [recordAfterSend, setRecordAfterSend] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<ContactChannel>("whatsapp");
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome>("sent");
  const [contactNote, setContactNote] = useState("");

  useEffect(() => {
    if (routePatientId) setPatientId(routePatientId);
  }, [routePatientId]);

  const groups = state.careModels.filter((model) => model.active && (model.kind === "group" || model.kind === "collective"));
  const selectedGroup = groups.find((group) => group.id === groupId) ?? groups[0];
  const groupMembersList = selectedGroup ? groupMembers(state, selectedGroup.id) : [];

  const filteredPatients = useMemo(() => {
    const text = query.trim().toLowerCase();
    const today = todayISO();
    return state.patients
      .filter((patient) => !["discharged", "transferred", "refused", "deceased"].includes(patient.status))
      .filter((patient) => {
        if (filter === "waiting" && patient.status !== "waiting_triage") return false;
        if (filter === "no_whatsapp" && !patient.noWhatsapp) return false;
        if (filter === "groups") {
          const kind = careModelOf(state, patient)?.kind;
          if (kind !== "group" && kind !== "collective") return false;
        }
        if (filter === "today") {
          const next = nextScheduled(state, patient.id);
          if (next?.date !== today) return false;
        }
        if (!text) return true;
        return [patient.name, patient.phone, patient.registrationNumber, patient.referringTeam]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(text));
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [state, query, filter]);

  const patient = audience === "group"
    ? groupMembersList.find((member) => member.id === patientId) ?? groupMembersList[0]
    : filteredPatients.find((item) => item.id === patientId) ?? getPatient(patientId) ?? filteredPatients[0];

  const model = patient ? careModelOf(state, patient) : undefined;
  const next = patient ? nextScheduled(state, patient.id) : undefined;
  const missed = patient ? lastMissed(state, patient.id) : undefined;
  const groupNext = selectedGroup ? groupNextMeeting(state, selectedGroup) : null;
  const suggested = patient ? suggestedCategory(patient, next) : "custom";
  const activeTemplates = state.templates.filter((template) => template.active);
  const template = activeTemplates.find((item) => item.id === templateId) ?? activeTemplates.find((item) => item.category === suggested) ?? activeTemplates[0];

  const contextAppointment: Appointment | undefined = audience === "group"
    ? (groupNext ? { id: `group-${selectedGroup?.id ?? "sem-grupo"}`, patientId: patient?.id ?? "", careModelId: selectedGroup?.id ?? "", date: groupNext, time: selectedGroup?.schedule?.time, slotType: "group", status: "scheduled", source: "auto", locked: false, createdAt: "", updatedAt: "" } : undefined)
    : suggested === "no_show" && missed ? missed : next;
  const context = {
    patient,
    careModel: audience === "group" ? selectedGroup : model,
    date: contextAppointment?.date,
    time: contextAppointment?.time,
    status: contextAppointment?.status,
    extra: "",
  };

  useEffect(() => {
    if (!template) return;
    setTemplateId(template.id);
    setBody(renderTemplate(template.body, state, context));
    // O texto é recalculado quando muda o paciente, o grupo ou o modelo escolhido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, patient?.id, selectedGroup?.id, contextAppointment?.date, state.settings.messageSignature]);

  useEffect(() => {
    if (audience === "group" && !groupId && groups[0]) setGroupId(groups[0].id);
    if (audience === "patient" && !patientId && filteredPatients[0]) setPatientId(filteredPatients[0].id);
  }, [audience, groupId, groups, patientId, filteredPatients]);

  const link = patient && !patient.noWhatsapp ? whatsappLink(patient.phone, body, state.settings.defaultDdd) : null;

  const chooseTemplate = (id: string) => {
    const chosen = state.templates.find((item) => item.id === id);
    if (!chosen) return;
    setTemplateId(id);
    setBody(renderTemplate(chosen.body, state, context));
  };

  const recordContact = (outcome: ContactOutcome, channel: ContactChannel, note?: string) => {
    if (!patient) return;
    addContactAttempt(patient.id, { channel, outcome, note, templateId: template?.id });
  };

  const openWhatsapp = () => {
    if (!link) {
      push("Este paciente não tem telefone válido ou está marcado sem WhatsApp.", "error");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    if (recordAfterSend) {
      recordContact("sent", "whatsapp");
      push("WhatsApp aberto e tentativa registrada.");
    } else {
      push("WhatsApp aberto.");
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(body);
      push("Mensagem copiada.");
    } catch {
      push("Não foi possível copiar. Selecione o texto manualmente.", "error");
    }
  };

  const saveContact = () => {
    recordContact(contactOutcome, contactChannel, contactNote.trim() || undefined);
    setContactOpen(false);
    setContactNote("");
    push("Tentativa de contato registrada.");
  };

  const listForAudience = audience === "group" ? groupMembersList : filteredPatients;

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Comunicação"
        title="Mensagens e busca ativa"
        description="Modelos prontos para grupo, retorno, falta e primeira consulta. O WhatsApp abre com o texto pronto; o envio continua sendo seu."
        actions={
          <Segmented
            ariaLabel="Destinatário"
            value={audience}
            onChange={(value) => { setAudience(value); setPatientId(""); }}
            options={[
              { value: "patient", label: "Paciente", icon: "user" },
              { value: "group", label: "Grupo", icon: "layers" },
            ]}
          />
        }
      />

      <div className="messages-layout">
        <Card className="message-people">
          {audience === "patient" ? (
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar paciente…" />
              <Select value={filter} onChange={(event) => setFilter(event.target.value as ListFilter)} aria-label="Filtrar lista de pacientes">
                <option value="all">Todos os pacientes</option>
                <option value="today">Com atendimento hoje</option>
                <option value="waiting">Aguardando matriciamento</option>
                <option value="groups">Em grupos</option>
                <option value="no_whatsapp">Sem WhatsApp</option>
              </Select>
            </>
          ) : (
            <Select id="message-group-filter" value={selectedGroup?.id ?? ""} onChange={(event) => { setGroupId(event.target.value); setPatientId(""); }}>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
          )}
          <div className="message-people__list">
            {listForAudience.length === 0 ? (
              <EmptyState compact icon="users" title="Ninguém por aqui" description="Ajuste a busca ou o filtro." />
            ) : (
              listForAudience.map((item) => {
                const nextDate = nextScheduled(state, item.id);
                const selected = patient?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`message-person${selected ? " is-selected" : ""}`}
                    onClick={() => setPatientId(item.id)}
                  >
                    <Avatar name={item.name} size="sm" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.noWhatsapp ? "sem WhatsApp" : formatPhone(item.phone) || "sem telefone"}
                        {nextDate ? ` · ${formatShortYear(nextDate.date)}` : ""}
                      </small>
                    </span>
                    {item.priority ? <span className="priority-dot"><Icon name="flag" size={12} /></span> : null}
                  </button>
                );
              })
            )}
          </div>
          {audience === "group" && selectedGroup ? (
            <p className="muted small">{groupMembersList.length} participantes · próximo encontro {groupNext ? formatShortYear(groupNext) : "a definir"}</p>
          ) : null}
        </Card>

        <div className="stack">
          {patient ? (
            <>
              <Card className="composer-card">
                <div className="composer-card__head">
                  <Avatar name={patient.name} size="lg" />
                  <div>
                    <div className="inline-badges">
                      <StatusBadge status={patient.status} />
                      {patient.priority ? <Badge tone="clay">prioridade</Badge> : null}
                      {patient.noWhatsapp ? <Badge tone="warn">sem WhatsApp</Badge> : null}
                    </div>
                    <h2>{patient.name}</h2>
                    <p>{formatPhone(patient.phone) || "Telefone não informado"} · {model?.name ?? "sem modelo"}</p>
                  </div>
                  <Button variant="ghost" size="sm" icon="user" onClick={() => navigate({ name: "patient", patientId: patient.id })}>Perfil</Button>
                </div>

                <div className="composer-card__template">
                  <div>
                    <span className="field__label">Modelo de mensagem</span>
                    <div className="template-chips">
                      {activeTemplates.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`template-chip${template?.id === item.id ? " is-active" : ""}`}
                          onClick={() => chooseTemplate(item.id)}
                        >
                          {messageCategoryLabel(item.category)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Select value={template?.id ?? ""} onChange={(event) => chooseTemplate(event.target.value)} aria-label="Escolher modelo de mensagem">
                    {activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </div>

                <div className="composer-card__context">
                  <span><Icon name="calendar" size={15} /> {contextAppointment?.date ? formatLong(contextAppointment.date) : "data a confirmar"}{contextAppointment?.time ? ` · ${contextAppointment.time}` : ""}</span>
                  {template ? <Badge tone="info">{template.name}</Badge> : null}
                </div>

                <Textarea
                  className="composer-card__body"
                  rows={10}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  aria-label="Mensagem"
                />
                <p className="composer-card__hint">
                  {body.length} caracteres · os campos entre chaves são substituídos automaticamente na prévia.
                </p>

                <div className="composer-card__actions">
                  <Button variant="whatsapp" icon="whatsapp" onClick={openWhatsapp} disabled={!patient.phone || patient.noWhatsapp}>
                    Abrir WhatsApp
                  </Button>
                  <Button variant="secondary" icon="copy" onClick={() => void copyMessage()}>Copiar mensagem</Button>
                  <Button variant="ghost" icon="phone" onClick={() => { setContactChannel("call"); setContactOutcome("no_answer"); setContactOpen(true); }}>Registrar contato</Button>
                  {patient.phone ? (
                    <Button
                      variant="ghost"
                      icon="external"
                      onClick={() => {
                        // Mesmo formato internacional do WhatsApp: o discador
                        // precisa do +55 para completar a ligação.
                        const number = whatsappNumber(patient.phone, state.settings.defaultDdd);
                        if (number) window.location.href = `tel:+${number}`;
                      }}
                    >
                      Ligar
                    </Button>
                  ) : null}
                </div>

                <div className="composer-card__record">
                  <Checkbox
                    checked={recordAfterSend}
                    onChange={setRecordAfterSend}
                    label="Registrar tentativa ao abrir o WhatsApp"
                    description="Fica registrado como 'mensagem enviada' no histórico do paciente. Ajuste depois se necessário."
                  />
                </div>

                {!patient.phone ? (
                  <InfoNote tone="warn" icon="alert" title="Sem telefone cadastrado">
                    Atualize o cadastro ou registre a busca ativa por outro canal. O aplicativo não envia mensagens sozinho.
                  </InfoNote>
                ) : patient.noWhatsapp ? (
                  <InfoNote tone="warn" icon="phone" title="Paciente sem WhatsApp">
                    Use ligação, SMS ou contato presencial. O modelo de mensagem pode ser copiado para outro canal.
                  </InfoNote>
                ) : null}
              </Card>

              <div className="messages-context-grid">
                <Card>
                  <p className="eyebrow">Contexto</p>
                  <h3>Próximos encontros</h3>
                  <div className="context-appointments">
                    {[next, missed].filter(Boolean).length === 0 ? (
                      <p className="muted small">Sem atendimento futuro registrado.</p>
                    ) : (
                      <>
                        {next ? (
                          <div><span className="dot-type dot-type--individual" /><span>Próximo</span><strong>{formatShortYear(next.date)} {next.time ?? ""}</strong></div>
                        ) : null}
                        {missed ? (
                          <div><span className="dot-type dot-type--triage" /><span>Última falta</span><strong>{formatShortYear(missed.date)}</strong></div>
                        ) : null}
                        {lastDone(state, patient.id) ? (
                          <div><span className="dot-type dot-type--group" /><span>Último realizado</span><strong>{formatShortYear(lastDone(state, patient.id)!.date)}</strong></div>
                        ) : null}
                      </>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => navigate({ name: "patient", patientId: patient.id })} className="btn--block">
                    Abrir histórico do paciente
                  </Button>
                </Card>

                <Card className="soft-card">
                  <p className="eyebrow">Boas práticas</p>
                  <h3>Comunicação cuidadosa</h3>
                  <ul className="check-list">
                    <li><Icon name="check" size={15} /> Confirme o número antes de enviar.</li>
                    <li><Icon name="check" size={15} /> Não inclua detalhes clínicos desnecessários.</li>
                    <li><Icon name="check" size={15} /> Registre o resultado do contato.</li>
                    <li><Icon name="check" size={15} /> Respeite a preferência de canal do paciente.</li>
                  </ul>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <EmptyState icon="message" title="Escolha um paciente" description="Selecione alguém na lista para preparar uma mensagem com os dados do próximo encontro." />
            </Card>
          )}
        </div>

        <aside className="stack messages-aside">
          <Card>
            <p className="eyebrow">Resumo</p>
            <h3>Busca ativa</h3>
            <div className="message-summary">
              <div><strong>{filteredPatients.length}</strong><span>na lista atual</span></div>
              <div><strong>{state.patients.filter((item) => item.noWhatsapp).length}</strong><span>sem WhatsApp</span></div>
              <div><strong>{state.patients.filter((item) => !nextScheduled(state, item.id) && item.status === "active").length}</strong><span>sem próximo atendimento</span></div>
            </div>
            <p className="muted small">Mensagens padrão: grupo, retorno, falta e primeira consulta. Edite os modelos em Ajustes.</p>
            <Button variant="ghost" size="sm" icon="settings" onClick={() => navigate({ name: "settings", tab: "mensagens" })} className="btn--block">
              Editar modelos
            </Button>
          </Card>
          <Card className="soft-card">
            <p className="eyebrow">Privacidade</p>
            <h3>O envio continua sendo seu</h3>
            <p className="muted">
              O app prepara o texto e abre o WhatsApp; nenhuma mensagem é disparada automaticamente. O histórico registra apenas canal, resultado e observação, sem copiar a conversa.
            </p>
          </Card>
          <Card>
            <p className="eyebrow">Sugestão</p>
            <h3>Modelo indicado</h3>
            <p className="muted">{messageCategoryLabel(suggested as MessageCategory)}</p>
            <div className="suggestion-list">
              {activeTemplates.filter((item) => item.category === suggested).slice(0, 2).map((item) => (
                <button key={item.id} type="button" onClick={() => chooseTemplate(item.id)}>
                  <Icon name="message" size={15} /> {item.name}
                </button>
              ))}
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Registrar tentativa de contato"
        description={patient ? `${patient.name} · ${formatPhone(patient.phone) || "sem telefone"}` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setContactOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={saveContact}>Registrar</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Canal" htmlFor="msg-contact-channel">
            <Select id="msg-contact-channel" value={contactChannel} onChange={(event) => setContactChannel(event.target.value as ContactChannel)}>
              {CHANNELS.map((channel) => <option key={channel} value={channel}>{contactChannelLabel(channel)}</option>)}
            </Select>
          </Field>
          <Field label="Resultado" htmlFor="msg-contact-outcome">
            <Select id="msg-contact-outcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value as ContactOutcome)}>
              {OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{contactOutcomeLabel(outcome)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Observação" htmlFor="msg-contact-note">
          <Textarea id="msg-contact-note" rows={2} value={contactNote} onChange={(event) => setContactNote(event.target.value)} placeholder="Ex.: recado deixado com familiar" />
        </Field>
      </Modal>
    </div>
  );
}
