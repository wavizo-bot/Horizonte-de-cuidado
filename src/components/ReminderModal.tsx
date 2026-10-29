import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "../components/ui";
import { todayISO } from "../lib/date";
import type { Reminder } from "../types";

export function ReminderModal({
  open,
  onClose,
  reminder,
  defaultDate = todayISO(),
}: {
  open: boolean;
  onClose: () => void;
  reminder?: Reminder;
  defaultDate?: string;
}) {
  const { state, createReminder, updateReminder } = useStore();
  const { push } = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [careModelId, setCareModelId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(reminder?.title ?? "");
    setDate(reminder?.date ?? defaultDate);
    setTime(reminder?.time ?? "");
    setNotes(reminder?.notes ?? "");
    setCareModelId(reminder?.careModelId ?? "");
    setError("");
  }, [open, reminder, defaultDate]);

  const save = () => {
    if (!title.trim()) {
      setError("Dê um título ao lembrete.");
      return;
    }
    const payload = {
      title: title.trim(),
      date,
      time: time || undefined,
      notes: notes.trim() || undefined,
      careModelId: careModelId || undefined,
      done: reminder?.done ?? false,
    };
    if (reminder) {
      updateReminder(reminder.id, payload);
      push("Lembrete atualizado.");
    } else {
      createReminder(payload);
      push("Lembrete criado.");
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reminder ? "Editar lembrete" : "Novo lembrete"}
      description="Use para preparar grupo, revisar fila, ligar para alguém ou lembrar de uma pendência."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon="bell" onClick={save}>Salvar lembrete</Button>
        </>
      }
    >
      <Field label="Título" htmlFor="reminder-title" required error={error}>
        <Input
          id="reminder-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ex.: preparar material do grupo"
        />
      </Field>
      <div className="form-grid form-grid--2">
        <Field label="Data" htmlFor="reminder-date">
          <Input id="reminder-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Horário" htmlFor="reminder-time">
          <Input id="reminder-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </Field>
      </div>
      <Field label="Relacionado a" htmlFor="reminder-model">
        <Select id="reminder-model" value={careModelId} onChange={(event) => setCareModelId(event.target.value)}>
          <option value="">Sem vínculo com grupo/modelo</option>
          {state.careModels.filter((model) => model.active).map((model) => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Detalhes" htmlFor="reminder-notes">
        <Textarea
          id="reminder-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Opcional"
        />
      </Field>
    </Modal>
  );
}
