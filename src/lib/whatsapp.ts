import type { AppointmentStatus, ContactChannel, ContactOutcome, MessageCategory } from "../types";

export function onlyDigits(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Converte um telefone brasileiro para o formato internacional do wa.me. */
export function whatsappNumber(phone: string | undefined, defaultDdd = ""): string | null {
  let digits = onlyDigits(phone ?? "");
  if (!digits) return null;
  if (defaultDdd && digits.length <= 9) digits = onlyDigits(defaultDdd) + digits;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return null;
}

export function formatPhone(phone: string | undefined): string {
  const digits = onlyDigits(phone ?? "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 13 && digits.startsWith("55")) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith("55")) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return phone?.trim() || "";
}

export function whatsappLink(phone: string | undefined, text: string, defaultDdd = ""): string | null {
  const number = whatsappNumber(phone, defaultDdd);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function smsLink(phone: string | undefined, text: string, defaultDdd = ""): string | null {
  const number = whatsappNumber(phone, defaultDdd);
  if (!number) return null;
  return `sms:+${number}?body=${encodeURIComponent(text)}`;
}

export function contactChannelLabel(channel: ContactChannel): string {
  const labels: Record<ContactChannel, string> = {
    whatsapp: "WhatsApp",
    call: "Ligação",
    sms: "SMS",
    in_person: "Presencial",
    other: "Outro",
  };
  return labels[channel];
}

export function contactOutcomeLabel(outcome: ContactOutcome): string {
  const labels: Record<ContactOutcome, string> = {
    sent: "Mensagem enviada",
    answered: "Respondeu",
    no_answer: "Sem resposta",
    wrong_number: "Número incorreto",
    no_whatsapp: "Sem WhatsApp",
    scheduled: "Contato agendado",
    other: "Outro",
  };
  return labels[outcome];
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  const labels: Record<AppointmentStatus, string> = {
    scheduled: "Agendado",
    done: "Compareceu",
    missed: "Faltou",
    cancelled: "Cancelado",
  };
  return labels[status];
}

export function messageCategoryLabel(category: MessageCategory): string {
  const labels: Record<MessageCategory, string> = {
    group: "Grupo",
    return: "Retorno",
    no_show: "Falta",
    first: "Primeira consulta",
    custom: "Livre",
  };
  return labels[category];
}

export function firstName(name: string): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}
