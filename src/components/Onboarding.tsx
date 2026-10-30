import { useState } from "react";
import { useStore } from "../state/store";
import { Button, Checkbox, Icon } from "../components/ui";
import { todayISO } from "../lib/date";

const STEPS = [
  {
    eyebrow: "Bem-vinda(o)",
    title: "Um caderno para enxergar o cuidado inteiro.",
    text: "O Horizonte de Cuidado reúne encaminhamentos, matriciamento, grupos, atendimentos individuais, faltas e busca ativa em um só lugar.",
  },
  {
    eyebrow: "Como funciona",
    title: "A agenda nasce da sua semana real.",
    text: "Você define os dias de atendimento e as vagas de cada tipo. O aplicativo distribui os pacientes no horizonte de 90 dias, respeitando prioridades e preservando tudo o que você marcar manualmente.",
  },
  {
    eyebrow: "Antes de começar",
    title: "Dados sensíveis pedem cuidado.",
    text: "O caderno fica neste dispositivo, com criptografia local. A nuvem é opcional e usa a sua própria conta Google. Nenhuma mensagem é enviada automaticamente.",
  },
];

export function Onboarding() {
  const { state, updateSettings, loadDemoData, resetLocalData } = useStore();
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [mode, setMode] = useState<"demo" | "empty">(state.patients.length ? "demo" : "empty");
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    if (!accepted || busy) return;
    setBusy(true);
    if (mode === "demo" && state.meta.seedSource !== "demonstracao") {
      await loadDemoData();
    }
    if (mode === "empty" && state.patients.length > 0) {
      await resetLocalData();
    }
    updateSettings({
      onboarded: true,
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: "1.0",
    });
    setBusy(false);
  };

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="onboarding">
      <div className="onboarding__backdrop" aria-hidden="true">
        <span className="onboarding__sun" />
        <span className="onboarding__hill onboarding__hill--one" />
        <span className="onboarding__hill onboarding__hill--two" />
      </div>

      <div className="onboarding__panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding__brand">
          <span className="onboarding__mark"><Icon name="sun" size={24} /></span>
          <span><strong>Horizonte</strong><small>de Cuidado</small></span>
          <span className="onboarding__step">{step + 1} de {STEPS.length}</span>
        </div>

        <div className="onboarding__content">
          <p className="eyebrow">{current.eyebrow}</p>
          <h1 id="onboarding-title">{current.title}</h1>
          <p>{current.text}</p>

          {step === 1 ? (
            <div className="onboarding__features">
              <div><span><Icon name="calendar" size={19} /></span><strong>Agenda viva</strong><small>Vagas por dia, exceções e reposições.</small></div>
              <div><span><Icon name="list" size={19} /></span><strong>Filas claras</strong><small>Prioridade, espera e matriciamento.</small></div>
              <div><span><Icon name="message" size={19} /></span><strong>Contato próximo</strong><small>WhatsApp com texto pronto e registro.</small></div>
            </div>
          ) : null}

          {last ? (
            <div className="onboarding__start">
              <div className="onboarding__choice">
                <button
                  type="button"
                  className={`onboarding-choice${mode === "demo" ? " is-selected" : ""}`}
                  onClick={() => setMode("demo")}
                >
                  <Icon name="sparkles" size={20} />
                  <span><strong>Explorar com dados fictícios</strong><small>Conheça o app com pacientes de demonstração. Você pode apagar depois.</small></span>
                </button>
                <button
                  type="button"
                  className={`onboarding-choice${mode === "empty" ? " is-selected" : ""}`}
                  onClick={() => setMode("empty")}
                >
                  <Icon name="file" size={20} />
                  <span><strong>Começar vazio</strong><small>Cadastre ou importe a planilha real da sua equipe.</small></span>
                </button>
              </div>
              <Checkbox
                checked={accepted}
                onChange={setAccepted}
                label="Li e aceito os termos de uso e a política de privacidade."
                description="Confirmo que uso o aplicativo como apoio à organização e que as decisões clínicas são da equipe profissional."
              />
              <p className="onboarding__legal">
                <a href="legal/termos-de-servico.html" target="_blank" rel="noreferrer">Termos de uso</a>
                <span>·</span>
                <a href="legal/politica-de-privacidade.html" target="_blank" rel="noreferrer">Política de privacidade</a>
                <span>·</span>
                <a href="legal/aviso-legal.html" target="_blank" rel="noreferrer">Aviso legal</a>
                <span>·</span>
                <a href="legal/suporte.html" target="_blank" rel="noreferrer">Suporte</a>
              </p>
            </div>
          ) : null}
        </div>

        <div className="onboarding__footer">
          <span className="muted small">{last ? `Aceite registrado em ${todayISO()}.` : "Você pode revisar tudo nos Ajustes."}</span>
          <div className="inline-actions">
            {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button> : null}
            {last ? (
              <Button variant="primary" icon="check" onClick={() => void finish()} disabled={!accepted || busy}>
                {busy ? "Preparando…" : "Começar"}
              </Button>
            ) : (
              <Button variant="primary" iconRight="arrowRight" onClick={() => setStep(step + 1)}>Continuar</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
