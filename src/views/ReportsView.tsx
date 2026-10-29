import { useMemo } from "react";
import { useStore } from "../state/store";
import { Badge, Button, Card, EmptyState, Icon, PageHeader, ProgressBar, SectionHeading, useToast } from "../components/ui";
import { addDays, addMonths, formatLong, formatShortYear, formatMonthYear, startOfMonth, todayISO } from "../lib/date";
import { capacityForDate, daySummary } from "../lib/schedule";
import { daysWaiting, groupMeetings, waitingTriage } from "../lib/selectors";
import { saveTextFile, printPage } from "../lib/host";
import { SLOT_COLORS, SLOT_LABELS } from "../lib/defaults";
import type { SlotType } from "../types";

const SLOTS: SlotType[] = ["triage", "individual", "group", "collective", "makeup"];

export function ReportsView() {
  const { state, unscheduled, exportJson, exportCsv } = useStore();
  const { push } = useToast();
  const today = todayISO();
  const horizon = addDays(today, Math.max(1, state.settings.horizonDays) - 1);
  const waiting = waitingTriage(state);
  const activePatients = state.patients.filter((patient) => patient.status === "active");
  const planned = state.appointments.filter(
    (appointment) => appointment.status !== "cancelled" && appointment.date >= today && appointment.date <= horizon,
  );

  const models = useMemo(
    () =>
      state.careModels
        .filter((model) => model.active)
        .map((model) => {
          const patients = state.patients.filter(
            (patient) => patient.careModelId === model.id && !["discharged", "transferred", "refused", "deceased"].includes(patient.status),
          );
          const nextDates = patients
            .map((patient) => state.appointments.find((appointment) => appointment.patientId === patient.id && appointment.status === "scheduled" && appointment.date >= today)?.date)
            .filter(Boolean) as string[];
          const nextDate = nextDates.sort()[0];
          return { model, patients, nextDate };
        })
        .sort((a, b) => b.patients.length - a.patients.length),
    [state, today],
  );

  const months = useMemo(() => {
    const result: Array<{
      key: string;
      label: string;
      start: string;
      end: string;
      counts: Record<SlotType, number>;
      capacity: Record<SlotType, number>;
      total: number;
    }> = [];
    let cursor = startOfMonth(today);
    const last = startOfMonth(horizon);
    while (cursor <= last) {
      const monthEnd = addDays(addMonths(cursor, 1), -1);
      const start = cursor < today ? today : cursor;
      const end = monthEnd > horizon ? horizon : monthEnd;
      const counts: Record<SlotType, number> = { triage: 0, individual: 0, group: 0, collective: 0, makeup: 0 };
      const capacity: Record<SlotType, number> = { triage: 0, individual: 0, group: 0, collective: 0, makeup: 0 };
      let day = start;
      while (day <= end) {
        const summary = daySummary(state, day);
        for (const slot of SLOTS) {
          counts[slot] += summary.used[slot];
          capacity[slot] += capacityForDate(state, day).capacity[slot];
        }
        day = addDays(day, 1);
      }
      result.push({
        key: cursor,
        label: formatMonthYear(cursor),
        start,
        end,
        counts,
        capacity,
        total: SLOTS.reduce((sum, slot) => sum + counts[slot], 0),
      });
      cursor = addMonths(cursor, 1);
    }
    return result;
  }, [state, today, horizon]);

  const totalPlanned = planned.length;
  const totalCapacity = months.reduce((sum, month) => sum + month.capacity.individual + month.capacity.triage + month.capacity.group + month.capacity.collective + month.capacity.makeup, 0);
  const maxMonthTotal = Math.max(1, ...months.map((month) => month.total));
  const groupMeetingsTotal = state.careModels
    .filter((model) => model.active && (model.kind === "group" || model.kind === "collective"))
    .reduce((sum, model) => sum + groupMeetings(state, model, state.settings.horizonDays).length, 0);

  const exportCsvFile = async () => {
    const content = exportCsv();
    await saveTextFile("horizonte-pacientes.csv", content);
    push("CSV de pacientes gerado.");
  };

  const exportJsonFile = async () => {
    const content = exportJson();
    await saveTextFile("horizonte-backup.json", content);
    push("Backup JSON gerado.");
  };

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Relatórios"
        title="Visão do cuidado"
        description={`Planejamento de ${state.settings.horizonDays} dias · atualizado em ${formatLong(today)}`}
        actions={
          <>
            <Button variant="ghost" icon="printer" onClick={printPage} className="hide-mobile">Imprimir</Button>
            <Button variant="ghost" icon="download" onClick={() => void exportCsvFile()}>CSV</Button>
            <Button variant="secondary" icon="save" onClick={() => void exportJsonFile()}>Backup JSON</Button>
          </>
        }
      />

      <div className="report-stats">
        <Card className="report-stat"><span className="report-stat__icon report-stat__icon--sage"><Icon name="users" size={19} /></span><div><strong>{activePatients.length}</strong><span>em acompanhamento</span></div></Card>
        <Card className="report-stat"><span className="report-stat__icon report-stat__icon--clay"><Icon name="list" size={19} /></span><div><strong>{waiting.length}</strong><span>sem matriciamento</span></div></Card>
        <Card className="report-stat"><span className="report-stat__icon report-stat__icon--sky"><Icon name="calendar" size={19} /></span><div><strong>{totalPlanned}</strong><span>atendimentos planejados</span></div></Card>
        <Card className="report-stat"><span className="report-stat__icon report-stat__icon--sand"><Icon name="alert" size={19} /></span><div><strong>{unscheduled.length}</strong><span>sem vaga</span></div></Card>
      </div>

      <div className="report-grid">
        <Card className="report-card report-card--wide">
          <SectionHeading
            eyebrow="Por modelo de cuidado"
            title="Pacientes e próximas datas"
            description="Quem está em cada modelo e quando acontece o próximo atendimento."
            actions={<Badge tone="neutral">{models.length} modelos ativos</Badge>}
          />
          <div className="report-table">
            <div className="report-table__head">
              <span>Modelo</span><span>Pacientes</span><span>Com próxima data</span><span>Próximo atendimento</span><span>Ocupação</span>
            </div>
            {models.map(({ model, patients, nextDate }) => {
              const withNext = patients.filter((patient) => state.appointments.some((appointment) => appointment.patientId === patient.id && appointment.status === "scheduled" && appointment.date >= today)).length;
              return (
                <div key={model.id} className="report-table__row">
                  <span className="report-table__model"><i className="model-dot" style={{ background: model.color }} />{model.name}</span>
                  <span><strong>{patients.length}</strong></span>
                  <span>{withNext}</span>
                  <span>{nextDate ? formatShortYear(nextDate) : <span className="muted">—</span>}</span>
                  <span className="report-table__bar">
                    {patients.length ? <ProgressBar value={withNext} max={Math.max(1, patients.length)} tone={model.kind === "group" ? "sage" : "sky"} label={`${Math.round((withNext / Math.max(1, patients.length)) * 100)}%`} /> : <span className="muted">—</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="report-card">
          <SectionHeading eyebrow="Planejamento" title={`${state.settings.horizonDays} dias em números`} />
          <div className="plan-summary">
            <div className="plan-donut" style={{ ["--p" as string]: `${Math.min(100, Math.round((totalPlanned / Math.max(1, totalCapacity)) * 100))}%` }}>
              <div><strong>{totalCapacity ? Math.round((totalPlanned / totalCapacity) * 100) : 0}%</strong><span>da capacidade</span></div>
            </div>
            <div className="plan-summary__list">
              <div><span>Vagas planejadas</span><strong>{totalCapacity}</strong></div>
              <div><span>Atendimentos alocados</span><strong>{totalPlanned}</strong></div>
              <div><span>Encontros de grupo</span><strong>{groupMeetingsTotal}</strong></div>
              <div><span>Pendências sem vaga</span><strong>{unscheduled.length}</strong></div>
            </div>
          </div>
          <div className="plan-note">
            <Icon name="info" size={15} />
            <span>O cálculo soma as vagas dos dias úteis, os ajustes por data e os encontros recorrentes. Resultado de apoio à organização, não prescrição.</span>
          </div>
        </Card>

        <Card className="report-card report-card--wide">
          <SectionHeading eyebrow="Distribuição mensal" title="Atendimentos por mês e tipo" description="Barras empilhadas: cada cor representa um tipo de vaga." />
          <div className="month-bars">
            {months.map((month) => (
              <div key={month.key} className="month-bar">
                <div className="month-bar__label"><strong>{month.label}</strong><span>{formatShortYear(month.start)} – {formatShortYear(month.end)}</span></div>
                <div className="month-bar__track">
                  {SLOTS.map((slot) => {
                    const width = month.total ? (month.counts[slot] / maxMonthTotal) * 100 : 0;
                    if (!month.counts[slot]) return null;
                    return (
                      <span
                        key={slot}
                        className="month-bar__segment"
                        style={{ width: `${width}%`, background: SLOT_COLORS[slot] }}
                        title={`${SLOT_LABELS[slot]}: ${month.counts[slot]}`}
                      />
                    );
                  })}
                </div>
                <div className="month-bar__count"><strong>{month.total}</strong><span>atend.</span></div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            {SLOTS.map((slot) => <span key={slot}><i style={{ background: SLOT_COLORS[slot] }} />{SLOT_LABELS[slot]}</span>)}
          </div>
        </Card>

        <Card className="report-card report-card--wide">
          <SectionHeading
            eyebrow="Acesso oportuno"
            title="Encaminhados sem matriciamento"
            description="Ordenados por prioridade e tempo de espera. Este relatório não define conduta clínica."
            actions={<Badge tone={waiting.length ? "warn" : "ok"}>{waiting.length}</Badge>}
          />
          {waiting.length === 0 ? (
            <EmptyState compact icon="checkCircle" title="Todos matriculados" description="Nenhum encaminhamento aguardando primeiro atendimento." />
          ) : (
            <div className="report-table">
              <div className="report-table__head"><span>Paciente</span><span>Equipe</span><span>Espera</span><span>Prioridade</span><span>Próxima vaga</span></div>
              {waiting.map((patient) => {
                const next = state.appointments.find((appointment) => appointment.patientId === patient.id && appointment.slotType === "triage" && appointment.status === "scheduled" && appointment.date >= today);
                return (
                  <div key={patient.id} className="report-table__row">
                    <span className="report-table__person"><strong>{patient.name}</strong><small>{patient.referralReason || "motivo não informado"}</small></span>
                    <span>{patient.referringTeam || "—"}</span>
                    <span><strong>{daysWaiting(patient)}</strong> dias</span>
                    <span>{patient.priority ? <Badge tone="clay">prioritário</Badge> : <span className="muted">—</span>}</span>
                    <span>{next ? formatShortYear(next.date) : <Badge tone="warn">sem vaga</Badge>}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <p className="muted small">
        Relatório gerado localmente a partir dos registros da equipe. Dados de demonstração são fictícios. Compartilhe apenas com pessoas autorizadas.
      </p>
    </div>
  );
}
