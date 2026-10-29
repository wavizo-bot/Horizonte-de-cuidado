import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { useToast, Badge, Button, ConfirmDialog, Field, Icon, InfoNote, Input, Modal, SlotBadge, Textarea } from "./ui";
import { capacityForDate, usedOnDate } from "../lib/schedule";
import { formatLong, formatShortYear, todayISO } from "../lib/date";
import { navigate } from "../navigation";
import { SLOT_LABELS } from "../lib/defaults";
import type { AppointmentStatus } from "../types";

export function AppointmentDetail({ appointmentId, onClose }: { appointmentId: string | null; onClose: () => void }) {
  const { state, markAppointment, updateAppointment, scheduleMakeup, getPatient, getModel } = useStore();
  const { push } = useToast();
  const appointment = state.appointments.find((item) => item.id === appointmentId);
  const patient = appointment ? getPatient(appointment.patientId) : undefined;
  const model = appointment ? getModel(appointment.careModelId) : undefined;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(appointment?.date ?? todayISO());
  const [time, setTime] = useState(appointment?.time ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");

  useEffect(() => {
    if (!appointment) return;
    setDate(appointment.date);
    setTime(appointment.time ?? "");
    setNotes(appointment.notes ?? "");
    setEditing(false);
  }, [appointment?.id, appointment?.date, appointment?.time, appointment?.notes]);

  if (!appointment || !patient) return null;

  const capacity = capacityForDate(state, date);
  const used = usedOnDate(state, date);
  const overbooked = used[appointment.slotType] + (appointment.date === date ? 0 : 1) > capacity.capacity[appointment.slotType];

  const status = (next: AppointmentStatus) => {
    markAppointment(appointment.id, next);
    push(
      next === "done"
        ? "Atendimento marcado como realizado."
        : next === "missed"
          ? "Falta registrada. Você pode oferecer uma reposição."
          : "Atendimento cancelado.",
      next === "missed" ? "info" : "success",
    );
  };

  const saveReschedule = () => {
    if (!date) return;
    updateAppointment(appointment.id, { date, time: time || undefined, notes, locked: true });
    setEditing(false);
    push("Agendamento atualizado e fixado na agenda.");
  };

  return (
    <>
      <Modal
        open={Boolean(appointmentId)}
        onClose={onClose}
        title="Atendimento"
        description={`${formatLong(appointment.date)}${appointment.time ? ` · ${appointment.time}` : ""}`}
        size="md"
        footer={
          <>
            <Button variant="ghost" icon="message" onClick={() => { onClose(); navigate({ name: "messages", patientId: patient.id }); }}>
              Mensagem
            </Button>
            <Button onClick={onClose}>Fechar</Button>
          </>
        }
      >
        <div className="appointment-detail__patient">
          <div>
            <p className="eyebrow">Paciente</p>
            <h3>{patient.name}</h3>
            <div className="inline-badges">
              <SlotBadge slot={appointment.slotType} />
              <Badge tone={appointment.source === "manual" ? "info" : "neutral"}>{appointment.source === "manual" ? "Manual" : "Gerado pela agenda"}</Badge>
              {appointment.locked ? (
                <Badge tone="muted">
                  <Icon name="lock" size={12} /> Fixo
                </Badge>
              ) : null}
              {patient.priority ? <Badge tone="clay">Prioritário</Badge> : null}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon="user" onClick={() => { onClose(); navigate({ name: "patient", patientId: patient.id }); }}>
            Ver perfil
          </Button>
        </div>

        <div className="detail-grid">
          <div>
            <span className="detail-grid__label">Modelo de cuidado</span>
            <strong>{model?.name ?? "Não definido"}</strong>
          </div>
          <div>
            <span className="detail-grid__label">Equipe que encaminhou</span>
            <strong>{patient.referringTeam || "Não informada"}</strong>
          </div>
          <div>
            <span className="detail-grid__label">Telefone</span>
            <strong>{patient.phone ?? "Sem telefone"}</strong>
          </div>
          <div>
            <span className="detail-grid__label">Situação</span>
            <strong>
              {appointment.status === "scheduled"
                ? "Agendado"
                : appointment.status === "done"
                  ? "Realizado"
                  : appointment.status === "missed"
                    ? "Falta"
                    : "Cancelado"}
            </strong>
          </div>
        </div>

        {editing ? (
          <div className="reschedule-box">
            <div className="form-grid form-grid--2">
              <Field label="Nova data" htmlFor="reschedule-date" required>
                <Input id="reschedule-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field label="Horário" htmlFor="reschedule-time">
                <Input id="reschedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </Field>
            </div>
            <Field label="Observação do agendamento" htmlFor="reschedule-notes">
              <Textarea id="reschedule-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {capacity.closed ? (
              <InfoNote tone="warn" icon="alert" title="Dia fechado">
                Esta data está marcada como fechada nos ajustes. O agendamento manual será mantido, mas revise a decisão.
              </InfoNote>
            ) : overbooked ? (
              <InfoNote tone="warn" icon="alert" title="Capacidade excedida">
                A capacidade de {SLOT_LABELS[appointment.slotType].toLowerCase()} para este dia é {capacity.capacity[appointment.slotType]}. O encaixe manual é permitido, mas ficará sinalizado.
              </InfoNote>
            ) : null}
            <div className="inline-actions">
              <Button variant="primary" icon="save" onClick={saveReschedule}>
                Salvar alterações
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {appointment.status === "scheduled" ? (
              <div className="status-actions">
                <Button variant="primary" icon="check" onClick={() => status("done")}>
                  Marcar realizado
                </Button>
                <Button variant="secondary" icon="x" onClick={() => status("missed")}>
                  Registrar falta
                </Button>
                <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>
                  Remarcar
                </Button>
                <Button variant="ghost" icon="trash" onClick={() => setConfirmCancel(true)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="status-actions">
                <Button variant="secondary" icon="refresh" onClick={() => status("scheduled")}>
                  Reabrir como agendado
                </Button>
                {appointment.status === "missed" ? (
                  <Button
                    variant="soft"
                    icon="calendarPlus"
                    onClick={() => {
                      const result = scheduleMakeup(patient.id);
                      push(result ? `Reposição agendada para ${formatShortYear(result)}.` : "Não há vaga de reposição no horizonte.", result ? "success" : "error");
                      if (result) onClose();
                    }}
                  >
                    Oferecer reposição
                  </Button>
                ) : null}
                <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>
                  Remarcar
                </Button>
              </div>
            )}
            {appointment.notes ? <InfoNote icon="notes">{appointment.notes}</InfoNote> : null}
            <p className="muted small">
              Criado em {new Date(appointment.createdAt).toLocaleString("pt-BR")}. Agendamentos fixos não são alterados pelo planejamento automático.
            </p>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => status("cancelled")}
        title="Cancelar este atendimento?"
        description="A vaga será liberada e o paciente voltará a aparecer nas pendências do planejamento."
        confirmLabel="Cancelar atendimento"
        tone="danger"
      >
        <p>
          {patient.name} · {formatLong(appointment.date)}
        </p>
      </ConfirmDialog>
    </>
  );
}
