import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Button, Field, InfoNote, Input, Modal, Select, Textarea, useToast } from "../components/ui";
import { todayISO } from "../lib/date";
import { nextAvailableDate, capacityForDate, usedOnDate } from "../lib/schedule";
import { SLOT_LABELS } from "../lib/defaults";
import type { SlotType } from "../types";

export function NewAppointmentModal({
  open,
  onClose,
  defaultDate = todayISO(),
  defaultPatientId,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  defaultPatientId?: string;
}) {
  const { state, createAppointment, getPatient } = useStore();
  const { push } = useToast();
  const [patientId, setPatientId] = useState(defaultPatientId ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [slotType, setSlotType] = useState<SlotType>("individual");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const patients = useMemo(
    () =>
      state.patients
        .filter((patient) => !["discharged", "transferred", "refused", "deceased"].includes(patient.status))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [state.patients],
  );

  useEffect(() => {
    if (!open) return;
    setPatientId(defaultPatientId ?? patients[0]?.id ?? "");
    setDate(defaultDate);
    setTime("");
    setNotes("");
    setError("");
    const patient = patients.find((item) => item.id === (defaultPatientId ?? patients[0]?.id));
    setSlotType(patient?.careModelId?.includes("group") ? "group" : patient?.triageDate ? "individual" : "triage");
  }, [open, defaultDate, defaultPatientId, patients]);

  const patient = getPatient(patientId);
  const capacity = capacityForDate(state, date);
  const used = usedOnDate(state, date);
  const wouldExceed = used[slotType] + 1 > capacity.capacity[slotType];

  const suggest = () => {
    const result = nextAvailableDate(state, patientId || "novo", slotType, date < todayISO() ? todayISO() : date);
    if (result) {
      setDate(result);
      push("Próxima vaga sugerida.");
    } else {
      push("Não encontrei vaga livre no horizonte para este tipo.", "error");
    }
  };

  const save = () => {
    if (!patientId) {
      setError("Escolha um paciente.");
      return;
    }
    if (!date) {
      setError("Informe a data.");
      return;
    }
    createAppointment({ patientId, date, time: time || undefined, slotType, notes: notes.trim() || undefined, locked: true });
    push(`Atendimento agendado para ${patient?.name ?? "paciente"}.`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo agendamento"
      description="Encaixe manual, reposição ou atendimento pontual. O agendamento fica fixo e é preservado no replanejamento."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon="calendarPlus" onClick={save}>Agendar</Button>
        </>
      }
    >
      <div className="form-grid form-grid--2">
        <Field label="Paciente" htmlFor="new-appointment-patient" required className="form-grid__full">
          <Select
            id="new-appointment-patient"
            value={patientId}
            onChange={(event) => {
              setPatientId(event.target.value);
              const chosen = getPatient(event.target.value);
              setSlotType(chosen?.careModelId?.includes("group") ? "group" : chosen?.triageDate ? "individual" : "triage");
            }}
          >
            <option value="">Selecione…</option>
            {patients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.priority ? " · prioritário" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data" htmlFor="new-appointment-date" required>
          <Input id="new-appointment-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Horário" htmlFor="new-appointment-time">
          <Input id="new-appointment-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </Field>
        <Field label="Tipo de vaga" htmlFor="new-appointment-slot">
          <Select id="new-appointment-slot" value={slotType} onChange={(event) => setSlotType(event.target.value as SlotType)}>
            {(Object.keys(SLOT_LABELS) as SlotType[]).map((slot) => (
              <option key={slot} value={slot}>{SLOT_LABELS[slot]}</option>
            ))}
          </Select>
        </Field>
        <div className="field field--inline">
          <Button variant="soft" size="sm" icon="sparkles" onClick={suggest}>
            Sugerir próxima vaga
          </Button>
        </div>
        <Field label="Observação" htmlFor="new-appointment-notes" className="form-grid__full">
          <Textarea
            id="new-appointment-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: encaixe solicitado pela equipe"
          />
        </Field>
      </div>

      {error ? <InfoNote tone="warn" icon="alert">{error}</InfoNote> : null}
      {capacity.closed ? (
        <InfoNote tone="warn" icon="lock" title="Dia fechado">
          {capacity.reason ?? "Este dia está marcado como fechado."} O agendamento manual será permitido, mas ficará fora da capacidade planejada.
        </InfoNote>
      ) : wouldExceed ? (
        <InfoNote tone="warn" icon="alert" title="Acima da capacidade">
          Capacidade de {SLOT_LABELS[slotType].toLowerCase()}: {capacity.capacity[slotType]} · já usados: {used[slotType]}. O encaixe é permitido com aviso.
        </InfoNote>
      ) : (
        <p className="muted small">
          Capacidade de {SLOT_LABELS[slotType].toLowerCase()} em {date}: {used[slotType]} de {capacity.capacity[slotType]} usados.
        </p>
      )}
    </Modal>
  );
}
