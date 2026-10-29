import { Icon } from "./Icon";
import { Avatar, Badge, cx, IconButton, SlotBadge } from "./ui";
import type { Appointment, CareModel, Patient } from "../types";
import { formatShort, formatShortYear, relativeDayLabel, todayISO } from "../lib/date";

export function AppointmentCard({
  appointment,
  patient,
  model,
  onOpen,
  onDone,
  onMissed,
  showDate = false,
  compact = false,
}: {
  appointment: Appointment;
  patient?: Patient;
  model?: CareModel;
  onOpen: () => void;
  onDone?: () => void;
  onMissed?: () => void;
  showDate?: boolean;
  compact?: boolean;
}) {
  if (!patient) return null;
  const done = appointment.status === "done";
  const missed = appointment.status === "missed";
  const cancelled = appointment.status === "cancelled";
  return (
    <article
      className={cx(
        "appointment-card",
        `appointment-card--${appointment.slotType}`,
        (done || missed || cancelled) && "is-finished",
        compact && "appointment-card--compact",
      )}
    >
      <button type="button" className="appointment-card__main" onClick={onOpen} aria-label={`Abrir atendimento de ${patient.name}`}>
        <span className="appointment-card__time">
          <strong>{appointment.time ?? "—"}</strong>
          {showDate ? <small>{formatShort(appointment.date)}</small> : <small>{relativeDayLabel(appointment.date)}</small>}
        </span>
        <Avatar name={patient.name} size={compact ? "sm" : "md"} />
        <span className="appointment-card__info">
          <span className="appointment-card__name">
            {patient.name}
            {patient.priority ? (
              <span className="priority-dot" title={patient.priorityReason ?? "Paciente prioritário"}>
                <Icon name="flag" size={13} />
              </span>
            ) : null}
          </span>
          <span className="appointment-card__meta">
            <SlotBadge slot={appointment.slotType} />
            <span className="appointment-card__model">{model?.name ?? "Sem modelo"}</span>
          </span>
        </span>
        {done ? (
          <Badge tone="ok" dot>
            Realizado
          </Badge>
        ) : missed ? (
          <Badge tone="danger" dot>
            Falta
          </Badge>
        ) : cancelled ? (
          <Badge tone="muted" dot>
            Cancelado
          </Badge>
        ) : appointment.locked ? (
          <span className="appointment-card__lock" title="Agendamento fixo, preservado no replanejamento">
            <Icon name="lock" size={14} />
          </span>
        ) : null}
      </button>
      {!done && !missed && !cancelled && (onDone || onMissed) ? (
        <div className="appointment-card__actions">
          {onDone ? (
            <IconButton icon="check" label="Marcar como realizado" variant="soft" size="sm" onClick={onDone} />
          ) : null}
          {onMissed ? (
            <IconButton icon="x" label="Marcar falta" variant="danger" size="sm" onClick={onMissed} />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function AppointmentChip({
  appointment,
  patient,
  onOpen,
}: {
  appointment: Appointment;
  patient?: Patient;
  onOpen: () => void;
}) {
  if (!patient) return null;
  return (
    <button
      type="button"
      className={cx("appointment-chip", `appointment-chip--${appointment.slotType}`)}
      onClick={onOpen}
      title={`${appointment.time ?? ""} ${patient.name}`}
    >
      <span>{appointment.time ?? "—"}</span>
      <strong>{patient.name.split(" ").slice(0, 2).join(" ")}</strong>
    </button>
  );
}

export function AppointmentDateBadge({ date }: { date: string }) {
  const parsed = new Date(`${date}T12:00:00`);
  const isToday = date === todayISO();
  return (
    <span className={cx("date-badge", isToday && "is-today")}>
      <strong>{String(parsed.getDate()).padStart(2, "0")}</strong>
      <small>{formatShortYear(date).slice(3, 5)}</small>
    </span>
  );
}
