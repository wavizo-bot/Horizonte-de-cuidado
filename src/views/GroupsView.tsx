import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, Icon, InfoNote, Input, Modal, PageHeader, ProgressBar, SearchInput, Select, Textarea, useToast } from "../components/ui";
import { navigate } from "../navigation";
import { formatLong, formatShortYear, todayISO, weekdayName } from "../lib/date";
import { groupMeetings, groupMembers, groupNextMeeting, modelScheduleLabel } from "../lib/selectors";
import { nextScheduled } from "../lib/schedule";
import type { CareKind, CareModel, MonthlyWeek, Recurrence, Weekday } from "../types";
import { WEEKDAY_ORDER } from "../lib/defaults";

const GROUP_COLORS = ["#5b7a63", "#b9684e", "#a97b32", "#486b78", "#7b6a9a", "#95503b"];

export function GroupsView() {
  const { state, createCareModel, saveCareModel, updatePatient, getModel, getPatient } = useStore();
  const { push } = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CareModel | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [form, setForm] = useState({
    name: "",
    kind: "group" as CareKind,
    color: GROUP_COLORS[0],
    maxMembers: "15",
    weekday: "1",
    recurrence: "weekly" as Recurrence,
    monthlyWeek: "1" as MonthlyWeek | string,
    time: "14:00",
    description: "",
    active: true,
  });

  const groups = state.careModels.filter((model) => model.active && (model.kind === "group" || model.kind === "collective"));
  const detail = detailId ? getModel(detailId) : undefined;
  const members = detail ? groupMembers(state, detail.id) : [];
  const totalMembers = groups.reduce((sum, model) => sum + groupMembers(state, model.id).length, 0);
  const meetingsNext30 = groups.reduce((sum, model) => sum + groupMeetings(state, model, 30).length, 0);

  const candidates = useMemo(() => {
    const text = memberQuery.trim().toLowerCase();
    return state.patients
      .filter((patient) => patient.status === "active" && patient.triageDate && patient.careModelId !== detailId)
      .filter((patient) => !text || patient.name.toLowerCase().includes(text) || patient.registrationNumber.includes(text))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [state.patients, memberQuery, detailId]);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "",
      kind: "group",
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      maxMembers: "15",
      weekday: "1",
      recurrence: "weekly",
      monthlyWeek: "1",
      time: "14:00",
      description: "",
      active: true,
    });
    setEditorOpen(true);
  };

  const openEdit = (model: CareModel) => {
    setEditing(model);
    setForm({
      name: model.name,
      kind: model.kind,
      color: model.color,
      maxMembers: model.maxMembers ? String(model.maxMembers) : "",
      weekday: model.schedule ? String(model.schedule.weekday) : "1",
      recurrence: model.schedule?.recurrence ?? "weekly",
      monthlyWeek: model.schedule?.monthlyWeek ? String(model.schedule.monthlyWeek) : "1",
      time: model.schedule?.time ?? "",
      description: model.description ?? "",
      active: model.active,
    });
    setEditorOpen(true);
  };

  const saveGroup = () => {
    if (!form.name.trim()) {
      push("Informe o nome do grupo.", "error");
      return;
    }
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      slotType: form.kind === "collective" ? ("collective" as const) : ("group" as const),
      color: form.color,
      active: form.active,
      maxMembers: form.maxMembers ? Number(form.maxMembers) : undefined,
      description: form.description.trim() || undefined,
      schedule: {
        weekday: Number(form.weekday) as Weekday,
        recurrence: form.recurrence,
        monthlyWeek: form.recurrence === "monthly" ? (Number(form.monthlyWeek) as MonthlyWeek) : undefined,
        time: form.time || undefined,
        anchorDate: editing?.schedule?.anchorDate ?? todayISO(),
      },
    };
    if (editing) {
      saveCareModel({ ...editing, ...payload });
      push("Grupo atualizado.");
    } else {
      createCareModel(payload);
      push("Grupo criado. A agenda de 90 dias já considera o novo encontro.");
    }
    setEditorOpen(false);
  };

  const addMember = () => {
    if (!detail || !memberId) return;
    const patient = getPatient(memberId);
    if (!patient) return;
    updatePatient(patient.id, {
      careModelId: detail.id,
      status: "active",
      recurrence: "weekly",
      preferredWeekday: detail.schedule?.weekday ?? patient.preferredWeekday,
    });
    push(`${patient.name} entrou em ${detail.name}.`);
    setMemberOpen(false);
    setMemberId("");
    setMemberQuery("");
  };

  const removeMember = (patientId: string) => {
    if (!detail) return;
    updatePatient(patientId, {
      careModelId: state.settings.defaultTriageModelId ?? "cm-triage",
      recurrence: "none",
      preferredWeekday: undefined,
    });
    push("Participante removido do grupo e devolvido à fila de matriciamento.", "info");
  };

  const openMessages = (model: CareModel) => {
    navigate({ name: "messages" });
    window.setTimeout(() => {
      const select = document.querySelector<HTMLSelectElement>("#message-group-filter");
      if (select) {
        select.value = model.id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, 150);
  };

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Cuidado em grupo"
        title="Grupos e atividades"
        description="Encontros recorrentes, participantes e ocupação. A frequência do grupo define a agenda de cada membro."
        actions={<Button variant="primary" icon="plus" onClick={openNew}>Novo grupo</Button>}
      />

      <div className="group-stats">
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--sage"><Icon name="layers" size={20} /></span>
          <div><strong>{groups.length}</strong><span>grupos ativos</span></div>
          <small>{groups.filter((group) => group.kind === "collective").length} atividades coletivas</small>
        </Card>
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--clay"><Icon name="users" size={20} /></span>
          <div><strong>{totalMembers}</strong><span>participantes</span></div>
          <small>Vínculos ativos nos grupos</small>
        </Card>
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--sand"><Icon name="calendar" size={20} /></span>
          <div><strong>{meetingsNext30}</strong><span>encontros em 30 dias</span></div>
          <small>Somando todos os grupos</small>
        </Card>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState icon="layers" title="Nenhum grupo ativo" description="Crie um grupo para organizar encontros recorrentes e acompanhar a participação." action={<Button variant="primary" icon="plus" onClick={openNew}>Criar primeiro grupo</Button>} />
        </Card>
      ) : (
        <div className="group-grid">
          {groups.map((model) => {
            const groupMembersList = groupMembers(state, model.id);
            const max = model.maxMembers ?? Math.max(1, groupMembersList.length);
            const next = groupNextMeeting(state, model);
            const meetings = groupMeetings(state, model, 90).length;
            const full = groupMembersList.length >= max;
            return (
              <Card key={model.id} className="group-card" as="article">
                <div className="group-card__stripe" style={{ background: model.color }} />
                <div className="group-card__head">
                  <span className="group-card__icon" style={{ background: `${model.color}1f`, color: model.color }}>
                    <Icon name={model.kind === "collective" ? "sparkles" : "layers"} size={21} />
                  </span>
                  <div>
                    <Badge tone="neutral">{model.kind === "collective" ? "Atividade coletiva" : "Grupo"}</Badge>
                    <h2>{model.name}</h2>
                  </div>
                </div>
                <p className="group-card__schedule"><Icon name="calendar" size={15} /> {modelScheduleLabel(model)}</p>
                <p className="group-card__next">
                  {next ? <>Próximo encontro em <strong>{formatLong(next)}</strong></> : "Sem próximo encontro definido"}
                </p>
                <div className="group-card__capacity">
                  <div>
                    <span>Participantes</span>
                    <strong>{groupMembersList.length}<small>/{max}</small></strong>
                  </div>
                  <ProgressBar value={groupMembersList.length} max={max} tone={full ? "clay" : "sage"} />
                  <small>{full ? "Capacidade atingida" : `${max - groupMembersList.length} vagas`} · {meetings} encontros em 90 dias</small>
                </div>
                <div className="group-card__members">
                  {groupMembersList.slice(0, 4).map((patient) => <Avatar key={patient.id} name={patient.name} size="xs" />)}
                  {groupMembersList.length > 4 ? <span className="group-card__more">+{groupMembersList.length - 4}</span> : null}
                  {groupMembersList.length === 0 ? <span className="muted small">Nenhum participante ainda</span> : null}
                </div>
                <div className="group-card__actions">
                  <Button variant="secondary" size="sm" icon="users" onClick={() => setDetailId(model.id)}>Abrir grupo</Button>
                  <Button variant="ghost" size="sm" icon="message" onClick={() => openMessages(model)}>Mensagem</Button>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => openEdit(model)} aria-label={`Editar ${model.name}`} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <InfoNote icon="info" title="Como os encontros entram na agenda">
        Cada participante ativo recebe um atendimento nos dias de encontro do grupo. A recorrência pode ser semanal, quinzenal ou mensal. Faltas e reposições são registradas individualmente.
      </InfoNote>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail?.name ?? "Grupo"}
        description={detail ? modelScheduleLabel(detail) : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" icon="message" onClick={() => detail && openMessages(detail)}>Mensagem ao grupo</Button>
            <Button variant="secondary" icon="edit" onClick={() => detail && openEdit(detail)}>Editar encontro</Button>
            <Button variant="primary" icon="plus" onClick={() => setMemberOpen(true)}>Adicionar participante</Button>
          </>
        }
      >
        {detail ? (
          <div className="group-detail">
            <div className="group-detail__summary">
              <div><span>Encontros em 90 dias</span><strong>{groupMeetings(state, detail, 90).length}</strong></div>
              <div><span>Participantes</span><strong>{members.length}/{detail.maxMembers ?? "—"}</strong></div>
              <div><span>Próximo encontro</span><strong>{groupNextMeeting(state, detail) ? formatShortYear(groupNextMeeting(state, detail)!) : "—"}</strong></div>
            </div>
            <div className="group-detail__meetings">
              <p className="eyebrow">Próximos encontros</p>
              <div className="meeting-pills">
                {groupMeetings(state, detail, 90).slice(0, 8).map((date) => <span key={date}>{formatShortYear(date)}</span>)}
              </div>
            </div>
            <div className="group-detail__members">
              <div className="section-heading">
                <div><p className="eyebrow">Participantes</p><h3>{members.length} vínculos ativos</h3></div>
              </div>
              {members.length === 0 ? (
                <EmptyState compact icon="users" title="Grupo sem participantes" description="Adicione pacientes já matriciados para gerar os atendimentos do grupo." action={<Button variant="soft" size="sm" icon="plus" onClick={() => setMemberOpen(true)}>Adicionar</Button>} />
              ) : (
                <div className="member-list">
                  {members.map((patient) => {
                    const next = nextScheduled(state, patient.id);
                    return (
                      <div key={patient.id} className="member-row">
                        <Avatar name={patient.name} size="sm" />
                        <button type="button" className="member-row__person" onClick={() => navigate({ name: "patient", patientId: patient.id })}>
                          <strong>{patient.name}{patient.priority ? <Badge tone="clay">prioridade</Badge> : null}</strong>
                          <small>{patient.phone ?? "sem telefone"} · {next ? `próximo em ${formatShortYear(next.date)}` : "sem próximo encontro"}</small>
                        </button>
                        <Button variant="ghost" size="sm" icon="x" onClick={() => removeMember(patient.id)}>Remover</Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {detail.description ? <InfoNote icon="notes">{detail.description}</InfoNote> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="Adicionar participante"
        description={detail ? `Entra em ${detail.name} e passa a receber os encontros na agenda.` : ""}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="plus" onClick={addMember} disabled={!memberId}>Adicionar</Button>
          </>
        }
      >
        <SearchInput value={memberQuery} onChange={setMemberQuery} placeholder="Buscar paciente já matriciado…" />
        <div className="candidate-list">
          {candidates.length === 0 ? (
            <EmptyState compact icon="users" title="Nenhum paciente disponível" description="Só aparecem pacientes ativos, já matriciados e que ainda não estão em outro grupo." />
          ) : (
            candidates.slice(0, 30).map((patient) => (
              <button
                key={patient.id}
                type="button"
                className={`candidate-row${memberId === patient.id ? " is-selected" : ""}`}
                onClick={() => setMemberId(patient.id)}
              >
                <Avatar name={patient.name} size="sm" />
                <span>
                  <strong>{patient.name}</strong>
                  <small>{getModel(patient.careModelId)?.name ?? "sem modelo"} · matriciado em {formatShortYear(patient.triageDate ?? todayISO())}</small>
                </span>
                <Icon name={memberId === patient.id ? "checkCircle" : "circle"} size={18} />
              </button>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Editar grupo" : "Novo grupo"}
        description="A recorrência define os encontros dos participantes no planejamento de 90 dias."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={saveGroup}>{editing ? "Salvar grupo" : "Criar grupo"}</Button>
          </>
        }
      >
        <div className="form-grid form-grid--2">
          <Field label="Nome do grupo" htmlFor="group-name" required className="form-grid__full">
            <Input id="group-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Grupo de ansiedade" />
          </Field>
          <Field label="Tipo" htmlFor="group-kind">
            <Select id="group-kind" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as CareKind }))}>
              <option value="group">Grupo terapêutico</option>
              <option value="collective">Atividade coletiva</option>
            </Select>
          </Field>
          <Field label="Limite de participantes" htmlFor="group-max">
            <Input id="group-max" type="number" min={1} value={form.maxMembers} onChange={(event) => setForm((current) => ({ ...current, maxMembers: event.target.value }))} />
          </Field>
          <Field label="Dia da semana" htmlFor="group-weekday">
            <Select id="group-weekday" value={form.weekday} onChange={(event) => setForm((current) => ({ ...current, weekday: event.target.value }))}>
              {WEEKDAY_ORDER.map((weekday) => <option key={weekday} value={weekday}>{weekdayName(weekday, true)}</option>)}
            </Select>
          </Field>
          <Field label="Frequência" htmlFor="group-recurrence">
            <Select id="group-recurrence" value={form.recurrence} onChange={(event) => setForm((current) => ({ ...current, recurrence: event.target.value as Recurrence }))}>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quinzenal</option>
              <option value="monthly">Mensal</option>
            </Select>
          </Field>
          {form.recurrence === "monthly" ? (
            <Field label="Semana do mês" htmlFor="group-monthly">
              <Select id="group-monthly" value={String(form.monthlyWeek)} onChange={(event) => setForm((current) => ({ ...current, monthlyWeek: event.target.value }))}>
                <option value="1">1ª semana</option>
                <option value="2">2ª semana</option>
                <option value="3">3ª semana</option>
                <option value="4">4ª semana</option>
                <option value="5">Última semana</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Horário" htmlFor="group-time">
            <Input id="group-time" type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} />
          </Field>
          <Field label="Cor de identificação" htmlFor="group-color" className="form-grid__full">
            <div className="color-choices">
              {GROUP_COLORS.map((color) => (
                <button key={color} type="button" className={`color-choice${form.color === color ? " is-selected" : ""}`} style={{ background: color }} onClick={() => setForm((current) => ({ ...current, color }))} aria-label={`Cor ${color}`} />
              ))}
            </div>
          </Field>
          <Field label="Descrição" htmlFor="group-description" className="form-grid__full">
            <Textarea id="group-description" rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Objetivo do grupo, materiais, combinações…" />
          </Field>
        </div>
        <Checkbox checked={form.active} onChange={(checked) => setForm((current) => ({ ...current, active: checked }))} label="Grupo ativo" description="Grupos inativos não geram novos encontros na agenda." />
      </Modal>
    </div>
  );
}
